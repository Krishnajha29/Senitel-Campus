-- ==============================================================================
-- SENTINEL CAMPUS: Step 2 - Secure Presence Keys & Student Check-in Schema
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Presence Keys Table
-- Stores cryptographically hashed presence keys with expiration and lifecycle
-- ------------------------------------------------------------------------------
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

-- Indexes for lightning-fast hash lookups and session state resolution
CREATE INDEX IF NOT EXISTS idx_presence_keys_session ON public.presence_keys(session_id);
CREATE INDEX IF NOT EXISTS idx_presence_keys_hash ON public.presence_keys(key_hash);
CREATE INDEX IF NOT EXISTS idx_presence_keys_status ON public.presence_keys(status, expires_at);

-- Partial index guaranteeing at most ONE active presence key per session
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_presence_key
    ON public.presence_keys(session_id)
    WHERE status = 'active';

-- ------------------------------------------------------------------------------
-- 2. Presence Key Rate Limiting Log Table
-- Guards against brute-force / key guessing attacks on student endpoints
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.presence_checkin_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    ip_address TEXT,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    was_successful BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_checkin_attempts_student ON public.presence_checkin_attempts(student_id, attempted_at);

-- ------------------------------------------------------------------------------
-- 3. Row Level Security (RLS) for Presence Keys
-- Instructors can only view and mutate presence keys for their own sessions
-- ------------------------------------------------------------------------------
ALTER TABLE public.presence_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.presence_checkin_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors can view own session presence keys"
    ON public.presence_keys FOR SELECT
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can create presence keys for their sessions"
    ON public.presence_keys FOR INSERT
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update/revoke presence keys for their sessions"
    ON public.presence_keys FOR UPDATE
    USING (instructor_id = auth.uid());

-- Students cannot directly view the presence_keys table; they must invoke the
-- secure, rate-limited RPC check-in function below.

-- ------------------------------------------------------------------------------
-- 4. Secure Student Check-in Database Function
-- Executes with SECURITY DEFINER to enforce atomic, race-free attendance check-in
-- ------------------------------------------------------------------------------
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
    v_session RECORD;
    v_enrollment RECORD;
    v_existing_record RECORD;
    v_computed_hash TEXT;
    v_recent_attempts INTEGER;
    v_now TIMESTAMPTZ := timezone('utc'::text, now());
BEGIN
    -- 1. Identify authenticated student via auth.uid()
    -- Look up student linked to the authenticated user's email or identity
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
    -- Search all active keys where expires_at > now()
    FOR v_key_record IN
        SELECT pk.*, s.class_id, s.status AS session_status, s.title AS session_title
        FROM public.presence_keys pk
        JOIN public.attendance_sessions s ON s.id = pk.session_id
        WHERE pk.status = 'active'
          AND pk.expires_at > v_now
          AND s.status = 'active'
    LOOP
        -- Compute SHA-256 of salt:key:session_id
        v_computed_hash := encode(digest(v_key_record.key_salt || ':' || trim(p_key_code) || ':' || v_key_record.session_id::text, 'sha256'), 'hex');

        IF v_computed_hash = v_key_record.key_hash THEN
            -- Matched key!
            EXIT; -- v_key_record holds the matched key
        END IF;
    END LOOP;

    -- If no active key matched
    IF v_key_record.id IS NULL OR v_computed_hash <> v_key_record.key_hash THEN
        -- Log failed attempt for rate limiting
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

    -- 5. Check Existing Attendance Record with Row Lock to prevent race conditions
    SELECT * INTO v_existing_record
    FROM public.attendance_records
    WHERE session_id = v_key_record.session_id
      AND student_id = v_student_id
    FOR UPDATE;

    -- 6. Idempotency Check: If already recorded as 'present'
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
        -- Transition from unmarked/absent to present
        UPDATE public.attendance_records
        SET status = 'present',
            method = 'presence_key',
            marked_at = v_now,
            updated_at = v_now
        WHERE id = v_existing_record.id;

        -- Log audit trail entry
        INSERT INTO public.attendance_audit_logs (
            record_id, session_id, student_id,
            previous_status, new_status,
            changed_by, changed_at, reason
        ) VALUES (
            v_existing_record.id, v_key_record.session_id, v_student_id,
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
            session_id, student_id,
            previous_status, new_status,
            changed_by, changed_at, reason
        ) VALUES (
            v_key_record.session_id, v_student_id,
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
