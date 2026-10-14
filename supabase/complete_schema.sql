-- ==============================================================================
-- SENTINEL CAMPUS: COMPLETE UNIFIED PRODUCTION DATABASE SCHEMA
-- Compatible with Supabase PostgreSQL (Postgres 15+)
-- Contains: Core System, Presence Keys, Face Biometrics, QR Multi-Photo,
--           Row Level Security (RLS) Isolation, Storage Buckets & Secure RPCs
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. CORE DATA TABLES
-- ==============================================================================

-- 1.1 Instructors Table (Extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS public.instructors (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    institution TEXT NOT NULL DEFAULT 'Sentinel University',
    department TEXT NOT NULL DEFAULT 'Computer Science & Engineering',
    avatar_url TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

-- 1.2 Academic Sections Table (Normalized Institutional Cohorts)
CREATE TABLE IF NOT EXISTS public.academic_sections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,                     -- e.g. 'A' or 'Section A'
    programme TEXT NOT NULL,                -- e.g. 'B.Tech Software Engineering', 'B.Tech Computer Science'
    batch TEXT NOT NULL,                    -- e.g. '2024-2028'
    academic_year TEXT NOT NULL,            -- e.g. '2026-2027'
    semester TEXT,                          -- e.g. 'Semester 4'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_instructor_section_cohort UNIQUE (instructor_id, programme, batch, academic_year, name)
);

CREATE INDEX IF NOT EXISTS idx_academic_sections_instructor ON public.academic_sections(instructor_id);
CREATE INDEX IF NOT EXISTS idx_academic_sections_cohort ON public.academic_sections(programme, batch, academic_year, name);
CREATE INDEX IF NOT EXISTS idx_academic_sections_active ON public.academic_sections(is_active);

-- 1.3 Students Table (with biometric face descriptor extensions)
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    section_id UUID REFERENCES public.academic_sections(id) ON DELETE SET NULL,
    roll_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    course TEXT NOT NULL,
    batch TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    section TEXT NOT NULL,
    photo_path TEXT NOT NULL, -- Private path in Supabase Storage bucket 'student-photos'
    is_active BOOLEAN NOT NULL DEFAULT true,
    face_descriptor JSONB DEFAULT NULL,
    face_enrolled_at TIMESTAMPTZ DEFAULT NULL,
    face_enrollment_status TEXT DEFAULT 'not_enrolled' CHECK (face_enrollment_status IN ('enrolled', 'pending', 'failed', 'not_enrolled')),
    face_quality_score NUMERIC(4,3) DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_instructor_roll_number UNIQUE (instructor_id, roll_number)
);

CREATE INDEX IF NOT EXISTS idx_students_instructor ON public.students(instructor_id);
CREATE INDEX IF NOT EXISTS idx_students_section_id ON public.students(section_id);
CREATE INDEX IF NOT EXISTS idx_students_roll_number ON public.students(instructor_id, roll_number);
CREATE INDEX IF NOT EXISTS idx_students_filter ON public.students(course, academic_year, section, is_active);
CREATE INDEX IF NOT EXISTS idx_students_face_status ON public.students(face_enrollment_status);

-- 1.4 Classes Table
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    section_id UUID REFERENCES public.academic_sections(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    section TEXT NOT NULL,
    programme TEXT,
    batch TEXT,
    semester TEXT,
    enrollment_type TEXT NOT NULL DEFAULT 'section' CHECK (enrollment_type IN ('section', 'manual')),
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_instructor_class_code_section UNIQUE (instructor_id, code, section)
);

CREATE INDEX IF NOT EXISTS idx_classes_instructor ON public.classes(instructor_id);
CREATE INDEX IF NOT EXISTS idx_classes_section_id ON public.classes(section_id);
CREATE INDEX IF NOT EXISTS idx_classes_active ON public.classes(is_active);

-- 1.5 Class Enrollments Table
CREATE TABLE IF NOT EXISTS public.class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_class_student_enrollment UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.class_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.class_enrollments(student_id);

-- 1.5 Attendance Sessions Table
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    session_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('scheduled', 'active', 'finalized', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_sessions_class_date ON public.attendance_sessions(class_id, session_date);
CREATE INDEX IF NOT EXISTS idx_sessions_instructor ON public.attendance_sessions(instructor_id);

-- 1.6 Attendance Records Table
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unmarked' CHECK (status IN ('present', 'absent', 'late', 'unmarked')),
    marked_by UUID NOT NULL REFERENCES public.instructors(id),
    marked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'face_recognition', 'face_scan', 'presence_key', 'admin_override')),
    face_verification_metadata JSONB DEFAULT NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_session_student_attendance UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_records_session ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_student ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON public.attendance_records(status);

-- 1.7 Attendance Audit Logs Table
CREATE TABLE IF NOT EXISTS public.attendance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID REFERENCES public.attendance_records(id) ON DELETE SET NULL,
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID REFERENCES public.students(id) ON DELETE CASCADE,
    action TEXT DEFAULT 'status_change',
    previous_status TEXT,
    new_status TEXT,
    changed_by UUID NOT NULL REFERENCES public.instructors(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON public.attendance_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_student ON public.attendance_audit_logs(student_id);

-- ==============================================================================
-- 2. PRESENCE KEYS & CHECK-IN TABLES
-- ==============================================================================

-- 2.1 Presence Keys Table
CREATE TABLE IF NOT EXISTS public.presence_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    key_hash TEXT NOT NULL,
    key_salt TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'revoked')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES public.instructors(id)
);

CREATE INDEX IF NOT EXISTS idx_presence_keys_session ON public.presence_keys(session_id);
CREATE INDEX IF NOT EXISTS idx_presence_keys_hash ON public.presence_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_presence_keys_status ON public.presence_keys(status, expires_at);

-- Partial index guaranteeing at most ONE active presence key per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_presence_key
    ON public.presence_keys(session_id)
    WHERE status = 'active';

-- 2.2 Presence Check-in Rate Limiting Log Table
CREATE TABLE IF NOT EXISTS public.presence_checkin_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    ip_address TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    was_successful BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_checkin_attempts_student ON public.presence_checkin_attempts(student_id, attempted_at);

-- ==============================================================================
-- 3. PHOTO UPLOAD & CLASSROOM MULTI-PHOTO TABLES
-- ==============================================================================

-- 3.1 Photo Upload Sessions Table (Temporary Mobile QR Capture)
CREATE TABLE IF NOT EXISTS public.photo_upload_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL,
    token_salt TEXT NOT NULL,
    qr_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'awaiting_scan'
        CHECK (status IN ('awaiting_scan', 'uploading', 'photo_received', 'upload_failed', 'expired', 'revoked', 'processing')),
    expires_at TIMESTAMPTZ NOT NULL,
    photo_storage_path TEXT,
    photo_file_name TEXT,
    photo_file_size INTEGER,
    photo_mime_type TEXT,
    consumed_at TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_session ON public.photo_upload_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_hash ON public.photo_upload_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_status ON public.photo_upload_sessions(status, expires_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_single_awaiting_upload_session
    ON public.photo_upload_sessions(session_id)
    WHERE status = 'awaiting_scan';

-- 3.2 Classroom Photos Table (Multi-Photo Batches)
CREATE TABLE IF NOT EXISTS public.classroom_photos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    upload_session_id UUID NOT NULL REFERENCES public.photo_upload_sessions(id) ON DELETE CASCADE,
    photo_storage_path TEXT NOT NULL,
    photo_file_name TEXT NOT NULL,
    photo_file_size INTEGER NOT NULL,
    photo_mime_type TEXT NOT NULL,
    photo_device_info TEXT,
    status TEXT NOT NULL DEFAULT 'uploaded'
        CHECK (status IN ('uploaded', 'processing', 'processed', 'failed')),
    faces_detected_count INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_classroom_photos_upload_session ON public.classroom_photos(upload_session_id);
CREATE INDEX IF NOT EXISTS idx_classroom_photos_session ON public.classroom_photos(session_id);

-- 3.3 Face Scan Audit Sessions Table
CREATE TABLE IF NOT EXISTS public.face_scan_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    total_faces_detected INT NOT NULL DEFAULT 0,
    high_confidence_matches INT NOT NULL DEFAULT 0,
    needs_review_matches INT NOT NULL DEFAULT 0,
    unknown_faces INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now())
);

CREATE INDEX IF NOT EXISTS idx_face_scan_sessions_session ON public.face_scan_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_face_scan_sessions_instructor ON public.face_scan_sessions(instructor_id);

-- ==============================================================================
-- 4. TRIGGERS FOR AUTOMATIC updated_at TIMESTAMPS
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_instructors_updated_at ON public.instructors;
CREATE TRIGGER tr_instructors_updated_at BEFORE UPDATE ON public.instructors FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_academic_sections_updated_at ON public.academic_sections;
CREATE TRIGGER tr_academic_sections_updated_at BEFORE UPDATE ON public.academic_sections FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_students_updated_at ON public.students;
CREATE TRIGGER tr_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_classes_updated_at ON public.classes;
CREATE TRIGGER tr_classes_updated_at BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_sessions_updated_at ON public.attendance_sessions;
CREATE TRIGGER tr_sessions_updated_at BEFORE UPDATE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_records_updated_at ON public.attendance_records;
CREATE TRIGGER tr_records_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_photo_sessions_updated_at ON public.photo_upload_sessions;
CREATE TRIGGER tr_photo_sessions_updated_at BEFORE UPDATE ON public.photo_upload_sessions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS tr_classroom_photos_updated_at ON public.classroom_photos;
CREATE TRIGGER tr_classroom_photos_updated_at BEFORE UPDATE ON public.classroom_photos FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ==============================================================================
-- 5. ROW LEVEL SECURITY (RLS) POLICIES
-- Complete isolation: Instructors manage only their own data
-- ==============================================================================

ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academic_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_checkin_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.face_scan_sessions ENABLE ROW LEVEL SECURITY;

-- 5.1 Instructors RLS
DROP POLICY IF EXISTS "Instructors can view own profile" ON public.instructors;
CREATE POLICY "Instructors can view own profile" ON public.instructors FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Instructors can update own profile" ON public.instructors;
CREATE POLICY "Instructors can update own profile" ON public.instructors FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Instructors can insert own profile" ON public.instructors;
CREATE POLICY "Instructors can insert own profile" ON public.instructors FOR INSERT WITH CHECK (auth.uid() = id);

-- 5.2 Academic Sections RLS
DROP POLICY IF EXISTS "Instructors can view own academic sections" ON public.academic_sections;
CREATE POLICY "Instructors can view own academic sections" ON public.academic_sections FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can insert own academic sections" ON public.academic_sections;
CREATE POLICY "Instructors can insert own academic sections" ON public.academic_sections FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update own academic sections" ON public.academic_sections;
CREATE POLICY "Instructors can update own academic sections" ON public.academic_sections FOR UPDATE USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can delete own academic sections" ON public.academic_sections;
CREATE POLICY "Instructors can delete own academic sections" ON public.academic_sections FOR DELETE USING (instructor_id = auth.uid());

-- 5.3 Students RLS
DROP POLICY IF EXISTS "Instructors can view own students" ON public.students;
CREATE POLICY "Instructors can view own students" ON public.students FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can insert own students" ON public.students;
CREATE POLICY "Instructors can insert own students" ON public.students FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update own students" ON public.students;
CREATE POLICY "Instructors can update own students" ON public.students FOR UPDATE USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can delete own students" ON public.students;
CREATE POLICY "Instructors can delete own students" ON public.students FOR DELETE USING (instructor_id = auth.uid());

-- 5.3 Classes RLS
DROP POLICY IF EXISTS "Instructors can view own classes" ON public.classes;
CREATE POLICY "Instructors can view own classes" ON public.classes FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can insert own classes" ON public.classes;
CREATE POLICY "Instructors can insert own classes" ON public.classes FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update own classes" ON public.classes;
CREATE POLICY "Instructors can update own classes" ON public.classes FOR UPDATE USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can delete own classes" ON public.classes;
CREATE POLICY "Instructors can delete own classes" ON public.classes FOR DELETE USING (instructor_id = auth.uid());

-- 5.4 Class Enrollments RLS
DROP POLICY IF EXISTS "Instructors can view enrollments in their classes" ON public.class_enrollments;
CREATE POLICY "Instructors can view enrollments in their classes" ON public.class_enrollments FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.classes WHERE classes.id = class_enrollments.class_id AND classes.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can enroll students in their classes" ON public.class_enrollments;
CREATE POLICY "Instructors can enroll students in their classes" ON public.class_enrollments FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.classes WHERE classes.id = class_enrollments.class_id AND classes.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can remove enrollments in their classes" ON public.class_enrollments;
CREATE POLICY "Instructors can remove enrollments in their classes" ON public.class_enrollments FOR DELETE
    USING (EXISTS (SELECT 1 FROM public.classes WHERE classes.id = class_enrollments.class_id AND classes.instructor_id = auth.uid()));

-- 5.5 Attendance Sessions RLS
DROP POLICY IF EXISTS "Instructors can view own sessions" ON public.attendance_sessions;
CREATE POLICY "Instructors can view own sessions" ON public.attendance_sessions FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can insert own sessions" ON public.attendance_sessions;
CREATE POLICY "Instructors can insert own sessions" ON public.attendance_sessions FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update own sessions" ON public.attendance_sessions;
CREATE POLICY "Instructors can update own sessions" ON public.attendance_sessions FOR UPDATE USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can delete own sessions" ON public.attendance_sessions;
CREATE POLICY "Instructors can delete own sessions" ON public.attendance_sessions FOR DELETE USING (instructor_id = auth.uid());

-- 5.6 Attendance Records RLS
DROP POLICY IF EXISTS "Instructors can view attendance records for their sessions" ON public.attendance_records;
CREATE POLICY "Instructors can view attendance records for their sessions" ON public.attendance_records FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = attendance_records.session_id AND s.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can insert attendance records for their sessions" ON public.attendance_records;
CREATE POLICY "Instructors can insert attendance records for their sessions" ON public.attendance_records FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = attendance_records.session_id AND s.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can update attendance records for their sessions" ON public.attendance_records;
CREATE POLICY "Instructors can update attendance records for their sessions" ON public.attendance_records FOR UPDATE
    USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = attendance_records.session_id AND s.instructor_id = auth.uid()));

-- 5.7 Attendance Audit Logs RLS
DROP POLICY IF EXISTS "Instructors can view audit logs for their sessions" ON public.attendance_audit_logs;
CREATE POLICY "Instructors can view audit logs for their sessions" ON public.attendance_audit_logs FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = attendance_audit_logs.session_id AND s.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can insert audit logs" ON public.attendance_audit_logs;
CREATE POLICY "Instructors can insert audit logs" ON public.attendance_audit_logs FOR INSERT WITH CHECK (changed_by = auth.uid());

-- 5.8 Presence Keys RLS
DROP POLICY IF EXISTS "Instructors can view own session presence keys" ON public.presence_keys;
CREATE POLICY "Instructors can view own session presence keys" ON public.presence_keys FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can create presence keys for their sessions" ON public.presence_keys;
CREATE POLICY "Instructors can create presence keys for their sessions" ON public.presence_keys FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update/revoke presence keys for their sessions" ON public.presence_keys;
CREATE POLICY "Instructors can update/revoke presence keys for their sessions" ON public.presence_keys FOR UPDATE USING (instructor_id = auth.uid());

-- 5.9 Photo Upload Sessions RLS
DROP POLICY IF EXISTS "Instructors can view own photo upload sessions" ON public.photo_upload_sessions;
CREATE POLICY "Instructors can view own photo upload sessions" ON public.photo_upload_sessions FOR SELECT USING (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can create photo upload sessions for their lectures" ON public.photo_upload_sessions;
CREATE POLICY "Instructors can create photo upload sessions for their lectures" ON public.photo_upload_sessions FOR INSERT WITH CHECK (instructor_id = auth.uid());

DROP POLICY IF EXISTS "Instructors can update photo upload sessions for their lectures" ON public.photo_upload_sessions;
CREATE POLICY "Instructors can update photo upload sessions for their lectures" ON public.photo_upload_sessions FOR UPDATE USING (instructor_id = auth.uid());

-- 5.10 Classroom Photos RLS
DROP POLICY IF EXISTS "Instructors can view own classroom photos" ON public.classroom_photos;
CREATE POLICY "Instructors can view own classroom photos" ON public.classroom_photos FOR SELECT
    USING (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = classroom_photos.session_id AND s.instructor_id = auth.uid()));

DROP POLICY IF EXISTS "Instructors can insert classroom photos" ON public.classroom_photos;
CREATE POLICY "Instructors can insert classroom photos" ON public.classroom_photos FOR INSERT
    WITH CHECK (EXISTS (SELECT 1 FROM public.attendance_sessions s WHERE s.id = classroom_photos.session_id AND s.instructor_id = auth.uid()));

-- 5.11 Face Scan Sessions RLS
DROP POLICY IF EXISTS "Instructors manage their face scan sessions" ON public.face_scan_sessions;
CREATE POLICY "Instructors manage their face scan sessions" ON public.face_scan_sessions FOR ALL TO authenticated
    USING (instructor_id = auth.uid()) WITH CHECK (instructor_id = auth.uid());

-- ==============================================================================
-- 6. PRIVATE STORAGE BUCKETS & POLICIES
-- ==============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'student-photos',
    'student-photos',
    false, -- Private bucket: access only via signed URLs
    5242880, -- 5 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'classroom-photos',
    'classroom-photos',
    false,
    10485760, -- 10 MB limit
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- Storage Objects Policies for student-photos
DROP POLICY IF EXISTS "Instructors can upload student photos" ON storage.objects;
CREATE POLICY "Instructors can upload student photos" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'student-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Instructors can read student photos" ON storage.objects;
CREATE POLICY "Instructors can read student photos" ON storage.objects FOR SELECT
    USING (bucket_id = 'student-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Instructors can update student photos" ON storage.objects;
CREATE POLICY "Instructors can update student photos" ON storage.objects FOR UPDATE
    USING (bucket_id = 'student-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Instructors can delete student photos" ON storage.objects;
CREATE POLICY "Instructors can delete student photos" ON storage.objects FOR DELETE
    USING (bucket_id = 'student-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- Storage Objects Policies for classroom-photos
DROP POLICY IF EXISTS "Instructors can upload classroom photos" ON storage.objects;
CREATE POLICY "Instructors can upload classroom photos" ON storage.objects FOR INSERT
    WITH CHECK (bucket_id = 'classroom-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

DROP POLICY IF EXISTS "Instructors can read classroom photos" ON storage.objects;
CREATE POLICY "Instructors can read classroom photos" ON storage.objects FOR SELECT
    USING (bucket_id = 'classroom-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ==============================================================================
-- 7. SECURE STORED PROCEDURES / RPCS
-- ==============================================================================

-- 7.1 Student Check-in via Cryptographic Presence Key
CREATE OR REPLACE FUNCTION public.student_check_in_with_key(
    p_key_code TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_student_id UUID;
    v_student RECORD;
    v_key_record RECORD;
    v_enrollment RECORD;
    v_existing_record RECORD;
    v_computed_hash TEXT;
    v_recent_attempts INTEGER;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Identify authenticated student via auth.uid()
    SELECT * INTO v_student
    FROM public.students
    WHERE email = (SELECT email FROM auth.users WHERE id = auth.uid())
      AND is_active = true
    LIMIT 1;

    IF v_student IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'STUDENT_NOT_FOUND',
            'message', 'No active student profile associated with this account.'
        );
    END IF;

    v_student_id := v_student.id;

    -- 2. Enforce Rate Limiting (max 5 failed attempts in the last 5 minutes)
    SELECT COUNT(*) INTO v_recent_attempts
    FROM public.presence_checkin_attempts
    WHERE student_id = v_student_id
      AND was_successful = false
      AND attempted_at > (v_now - INTERVAL '5 minutes');

    IF v_recent_attempts >= 5 THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'RATE_LIMITED',
            'message', 'Too many invalid attempts. Please wait 5 minutes before trying again.'
        );
    END IF;

    -- 3. Find active presence key matching the salt & hash
    FOR v_key_record IN
        SELECT pk.*, s.class_id, s.status AS session_status, s.title AS session_title
        FROM public.presence_keys pk
        JOIN public.attendance_sessions s ON s.id = pk.session_id
        WHERE pk.status = 'active'
          AND pk.expires_at > v_now
          AND s.status = 'active'
    LOOP
        v_computed_hash := encode(digest(v_key_record.key_salt || ':' || trim(p_key_code) || ':' || v_key_record.session_id::text, 'sha256'), 'hex');
        IF v_computed_hash = v_key_record.key_hash THEN
            EXIT;
        END IF;
    END LOOP;

    IF v_key_record.id IS NULL OR v_computed_hash <> v_key_record.key_hash THEN
        INSERT INTO public.presence_checkin_attempts (student_id, was_successful)
        VALUES (v_student_id, false);

        RETURN jsonb_build_object(
            'success', false,
            'code', 'INVALID_OR_EXPIRED_KEY',
            'message', 'Invalid or expired presence key.'
        );
    END IF;

    -- 4. Verify Student is Enrolled in the Session's Class
    SELECT * INTO v_enrollment
    FROM public.class_enrollments
    WHERE class_id = v_key_record.class_id
      AND student_id = v_student_id;

    IF v_enrollment IS NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'code', 'NOT_ENROLLED',
            'message', 'You are not enrolled in the class for this attendance session.'
        );
    END IF;

    -- 5. Check Existing Attendance Record with Row Lock
    SELECT * INTO v_existing_record
    FROM public.attendance_records
    WHERE session_id = v_key_record.session_id
      AND student_id = v_student_id
    FOR UPDATE;

    -- 6. Idempotency Check
    IF v_existing_record.status = 'present' THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_checked_in', true,
            'message', 'Attendance already recorded for this lecture.',
            'session', jsonb_build_object(
                'id', v_key_record.session_id,
                'title', v_key_record.session_title
            ),
            'record', jsonb_build_object(
                'id', v_existing_record.id,
                'status', v_existing_record.status,
                'marked_at', v_existing_record.marked_at,
                'method', v_existing_record.method
            )
        );
    END IF;

    -- 7. Update or Insert Single Attendance Record
    IF v_existing_record.id IS NOT NULL THEN
        UPDATE public.attendance_records
        SET status = 'present',
            method = 'presence_key',
            marked_at = v_now,
            updated_at = v_now
        WHERE id = v_existing_record.id;

        INSERT INTO public.attendance_audit_logs (
            record_id, session_id, student_id, action,
            previous_status, new_status,
            changed_by, changed_at, reason
        ) VALUES (
            v_existing_record.id, v_key_record.session_id, v_student_id, 'student_presence_checkin',
            v_existing_record.status, 'present',
            v_key_record.instructor_id, v_now,
            'Student self-check-in via verified presence key'
        );
    ELSE
        INSERT INTO public.attendance_records (
            session_id, student_id, status,
            marked_by, marked_at, method
        ) VALUES (
            v_key_record.session_id, v_student_id, 'present',
            v_key_record.instructor_id, v_now, 'presence_key'
        );

        INSERT INTO public.attendance_audit_logs (
            session_id, student_id, action,
            previous_status, new_status,
            changed_by, changed_at, reason
        ) VALUES (
            v_key_record.session_id, v_student_id, 'student_presence_checkin',
            NULL, 'present',
            v_key_record.instructor_id, v_now,
            'Initial student self-check-in via presence key'
        );
    END IF;

    -- Log successful attempt
    INSERT INTO public.presence_checkin_attempts (student_id, was_successful)
    VALUES (v_student_id, true);

    RETURN jsonb_build_object(
        'success', true,
        'already_checked_in', false,
        'message', 'Attendance recorded successfully.',
        'session', jsonb_build_object(
            'id', v_key_record.session_id,
            'title', v_key_record.session_title
        ),
        'record', jsonb_build_object(
            'status', 'present',
            'marked_at', v_now,
            'method', 'presence_key'
        )
    );
END;
$$;

-- 7.2 Submit Face Attendance in Batch
CREATE OR REPLACE FUNCTION public.submit_face_attendance(
    p_session_id UUID,
    p_submissions JSONB
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
    v_instructor_id := auth.uid();
    IF v_instructor_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'message', 'Authentication required.');
    END IF;

    SELECT status, class_id INTO v_session_status, v_class_id
    FROM public.attendance_sessions
    WHERE id = p_session_id AND instructor_id = v_instructor_id;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'message', 'Session not found or access denied.');
    END IF;

    IF v_session_status IN ('finalized', 'cancelled') THEN
        RETURN jsonb_build_object('success', false, 'code', 'SESSION_CLOSED', 'message', 'Cannot submit face attendance for a closed session.');
    END IF;

    FOR v_item IN SELECT * FROM jsonb_array_elements(p_submissions)
    LOOP
        v_student_id := (v_item->>'student_id')::UUID;
        v_status := COALESCE(v_item->>'status', 'present');

        SELECT EXISTS (
            SELECT 1 FROM public.class_enrollments
            WHERE class_id = v_class_id AND student_id = v_student_id
        ) INTO v_is_enrolled;

        IF NOT v_is_enrolled THEN
            CONTINUE;
        END IF;

        SELECT id, status INTO v_existing_id, v_existing_status
        FROM public.attendance_records
        WHERE session_id = p_session_id AND student_id = v_student_id;

        IF v_existing_id IS NOT NULL THEN
            IF v_existing_status = 'present' AND v_status = 'present' THEN
                v_already_present_count := v_already_present_count + 1;
                CONTINUE;
            END IF;

            UPDATE public.attendance_records
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

            INSERT INTO public.attendance_audit_logs (
                record_id, session_id, student_id, action,
                previous_status, new_status,
                changed_by, changed_at, reason
            ) VALUES (
                v_existing_id, p_session_id, v_student_id, 'face_attendance_match',
                v_existing_status, v_status,
                v_instructor_id, v_now, 'Face attendance confirmation (' || COALESCE(v_item->>'match_type', 'high_confidence') || ')'
            );

            IF v_status = 'present' THEN
                v_marked_present_count := v_marked_present_count + 1;
            END IF;
        ELSE
            INSERT INTO public.attendance_records (
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

            INSERT INTO public.attendance_audit_logs (
                record_id, session_id, student_id, action,
                previous_status, new_status,
                changed_by, changed_at, reason
            ) VALUES (
                v_existing_id, p_session_id, v_student_id, 'face_attendance_match',
                NULL, v_status,
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

-- 7.3 Register Classroom Photo Upload
CREATE OR REPLACE FUNCTION public.register_classroom_photo_upload(
    p_upload_session_id UUID,
    p_storage_path TEXT,
    p_file_name TEXT,
    p_file_size INTEGER,
    p_mime_type TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_session RECORD;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    SELECT * INTO v_session
    FROM public.photo_upload_sessions
    WHERE id = p_upload_session_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'SESSION_NOT_FOUND',
            'message', 'Photo upload session not found.'
        );
    END IF;

    IF v_session.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'REVOKED_TOKEN',
            'message', 'This upload session was revoked by the instructor.'
        );
    END IF;

    IF v_session.expires_at < v_now THEN
        UPDATE public.photo_upload_sessions
        SET status = 'expired', updated_at = v_now
        WHERE id = p_upload_session_id;

        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'EXPIRED_TOKEN',
            'message', 'This upload session has expired.'
        );
    END IF;

    UPDATE public.photo_upload_sessions
    SET status = 'photo_received',
        photo_storage_path = p_storage_path,
        photo_file_name = p_file_name,
        photo_file_size = p_file_size,
        photo_mime_type = p_mime_type,
        consumed_at = v_now,
        updated_at = v_now
    WHERE id = p_upload_session_id;

    INSERT INTO public.attendance_audit_logs (
        session_id, student_id, action,
        previous_status, new_status,
        changed_by, changed_at, reason
    ) VALUES (
        v_session.session_id, NULL, 'classroom_photo_uploaded',
        NULL, NULL,
        v_session.instructor_id, v_now,
        'Classroom photo captured from mobile phone via QR session'
    );

    RETURN jsonb_build_object(
        'success', true,
        'upload_session_id', p_upload_session_id,
        'photo_storage_path', p_storage_path,
        'uploaded_at', v_now
    );
END;
$$;
