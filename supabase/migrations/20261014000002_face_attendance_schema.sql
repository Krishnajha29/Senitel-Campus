-- ==============================================================================
-- Sentinel Campus Migration: Step 3 - Multi-Face Recognition & Attendance Schema
-- ==============================================================================

-- 1. Extend students table with Face Biometric Enrollment columns
ALTER TABLE students 
ADD COLUMN IF NOT EXISTS face_descriptor JSONB DEFAULT NULL,
ADD COLUMN IF NOT EXISTS face_enrolled_at TIMESTAMPTZ DEFAULT NULL,
ADD COLUMN IF NOT EXISTS face_enrollment_status TEXT DEFAULT 'not_enrolled'
  CHECK (face_enrollment_status IN ('enrolled', 'pending', 'failed', 'not_enrolled')),
ADD COLUMN IF NOT EXISTS face_quality_score NUMERIC(4,3) DEFAULT NULL;

COMMENT ON COLUMN students.face_descriptor IS '128-dimensional L2-normalized Euclidean face embedding vector';
COMMENT ON COLUMN students.face_enrollment_status IS 'Quality and readiness indicator for biometric face matching';

-- Index to quickly look up enrolled students for a class roster
CREATE INDEX IF NOT EXISTS idx_students_face_status ON students(face_enrollment_status);

-- 2. Extend attendance_records marking method and verification metadata
ALTER TABLE attendance_records
DROP CONSTRAINT IF EXISTS attendance_records_method_check;

ALTER TABLE attendance_records
ADD CONSTRAINT attendance_records_method_check 
CHECK (method IN ('manual', 'face_recognition', 'face_scan', 'presence_key', 'admin_override'));

ALTER TABLE attendance_records
ADD COLUMN IF NOT EXISTS face_verification_metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN attendance_records.face_verification_metadata IS 'Captures detection_id, match_confidence, similarity, and bounding box for face verification audit';

-- 3. Create face_scan_sessions Audit Table (tracks scans without storing raw biometrics permanently)
CREATE TABLE IF NOT EXISTS face_scan_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  instructor_id UUID NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
  total_faces_detected INT NOT NULL DEFAULT 0,
  high_confidence_matches INT NOT NULL DEFAULT 0,
  needs_review_matches INT NOT NULL DEFAULT 0,
  unknown_faces INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_face_scan_sessions_session ON face_scan_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_face_scan_sessions_instructor ON face_scan_sessions(instructor_id);

-- Enable Row Level Security
ALTER TABLE face_scan_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors manage their face scan sessions"
  ON face_scan_sessions
  FOR ALL
  TO authenticated
  USING (instructor_id = auth.uid())
  WITH CHECK (instructor_id = auth.uid());

-- 4. Atomically submit face attendance with audit logging and idempotency
CREATE OR REPLACE FUNCTION submit_face_attendance(
  p_session_id UUID,
  p_submissions JSONB -- array of { student_id, status, detection_id, confidence, similarity, match_type }
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_instructor_id UUID;
  v_session_status TEXT;
  v_class_id UUID;
  v_item JSONB;
  v_student_id UUID;
  v_status TEXT;
  v_existing_id UUID;
  v_existing_status TEXT;
  v_marked_present_count INT := 0;
  v_already_present_count INT := 0;
  v_is_enrolled BOOLEAN;
  v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
  -- Verify Instructor Authentication
  v_instructor_id := auth.uid();
  IF v_instructor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required.');
  END IF;

  -- Verify Session and Instructor Ownership
  SELECT status, class_id INTO v_session_status, v_class_id
  FROM attendance_sessions
  WHERE id = p_session_id AND instructor_id = v_instructor_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Session not found or access denied.');
  END IF;

  IF v_session_status IN ('finalized', 'cancelled') THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_CLOSED', 'message', 'Cannot submit face attendance for a closed or finalized session.');
  END IF;

  -- Iterate through submissions
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_submissions)
  LOOP
    v_student_id := (v_item->>'student_id')::UUID;
    v_status := COALESCE(v_item->>'status', 'present');

    -- Verify Enrollment in this class
    SELECT EXISTS (
      SELECT 1 FROM class_enrollments
      WHERE class_id = v_class_id AND student_id = v_student_id
    ) INTO v_is_enrolled;

    IF NOT v_is_enrolled THEN
      -- Skip non-enrolled students (safety boundary)
      CONTINUE;
    END IF;

    -- Check Existing Attendance Record for this session and student
    SELECT id, status INTO v_existing_id, v_existing_status
    FROM attendance_records
    WHERE session_id = p_session_id AND student_id = v_student_id;

    IF v_existing_id IS NOT NULL THEN
      -- If already marked Present, preserve original record and avoid duplicate counts
      IF v_existing_status = 'present' AND v_status = 'present' THEN
        v_already_present_count := v_already_present_count + 1;
        CONTINUE;
      END IF;

      -- Transition existing record (e.g. absent/unmarked -> present)
      UPDATE attendance_records
      SET status = v_status,
          method = 'face_scan',
          marked_by = v_instructor_id,
          marked_at = v_now,
          face_verification_metadata = jsonb_build_object(
            'detection_id', v_item->>'detection_id',
            'confidence', (v_item->>'confidence')::NUMERIC,
            'similarity', (v_item->>'similarity')::NUMERIC,
            'match_type', v_item->>'match_type'
          ),
          updated_at = v_now
      WHERE id = v_existing_id;

      -- Audit Log
      INSERT INTO attendance_audit_logs (
        record_id, session_id, student_id, previous_status, new_status,
        changed_by, changed_at, reason
      ) VALUES (
        v_existing_id, p_session_id, v_student_id, v_existing_status, v_status,
        v_instructor_id, v_now, 'Face attendance confirmation (' || COALESCE(v_item->>'match_type', 'high_confidence') || ')'
      );

      IF v_status = 'present' THEN
        v_marked_present_count := v_marked_present_count + 1;
      END IF;
    ELSE
      -- Insert brand new attendance record
      INSERT INTO attendance_records (
        session_id, student_id, status, marked_by, marked_at, method,
        face_verification_metadata, created_at, updated_at
      ) VALUES (
        p_session_id, v_student_id, v_status, v_instructor_id, v_now, 'face_scan',
        jsonb_build_object(
          'detection_id', v_item->>'detection_id',
          'confidence', (v_item->>'confidence')::NUMERIC,
          'similarity', (v_item->>'similarity')::NUMERIC,
          'match_type', v_item->>'match_type'
        ),
        v_now, v_now
      ) RETURNING id INTO v_existing_id;

      -- Audit Log
      INSERT INTO attendance_audit_logs (
        record_id, session_id, student_id, previous_status, new_status,
        changed_by, changed_at, reason
      ) VALUES (
        v_existing_id, p_session_id, v_student_id, NULL, v_status,
        v_instructor_id, v_now, 'Initial face attendance scan confirmation'
      );

      IF v_status = 'present' THEN
        v_marked_present_count := v_marked_present_count + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'marked_present_count', v_marked_present_count,
    'already_present_count', v_already_present_count,
    'message', 'Face attendance submitted successfully.'
  );
END;
$$;
