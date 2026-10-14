-- ==============================================================================
-- SENTINEL CAMPUS: QR-Based Classroom Photo Upload Schema
-- Phase 1: Upload Sessions, Token Hashing, Atomic State Transitions & Audit
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Photo Upload Sessions Table
-- Stores cryptographically hashed temporary upload tokens for mobile phone capture
-- ------------------------------------------------------------------------------
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

-- Indexes for rapid lookup by token hash, session, and status
CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_session ON public.photo_upload_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_hash ON public.photo_upload_sessions(token_hash);
CREATE INDEX IF NOT EXISTS idx_photo_upload_sessions_status ON public.photo_upload_sessions(status, expires_at);

-- Partial index ensuring at most ONE awaiting_scan upload session per attendance session
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_awaiting_upload_session
    ON public.photo_upload_sessions(session_id)
    WHERE status = 'awaiting_scan';

-- ------------------------------------------------------------------------------
-- 2. Row Level Security (RLS)
-- Instructors can manage their own upload sessions; anon/phone can validate & submit with valid token
-- ------------------------------------------------------------------------------
ALTER TABLE public.photo_upload_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors can view own photo upload sessions"
    ON public.photo_upload_sessions FOR SELECT
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can create photo upload sessions for their lectures"
    ON public.photo_upload_sessions FOR INSERT
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update photo upload sessions for their lectures"
    ON public.photo_upload_sessions FOR UPDATE
    USING (instructor_id = auth.uid());

-- ------------------------------------------------------------------------------
-- 3. Stored Procedure: Atomic Token Consumption and Photo Registration
-- Ensures concurrent upload submissions cannot reuse or duplicate consumption
-- ------------------------------------------------------------------------------
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
    -- Atomically select and lock the upload session row
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

    -- Validate state
    IF v_session.status = 'revoked' THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'REVOKED_TOKEN',
            'message', 'This upload session was revoked by the instructor.'
        );
    END IF;

    IF v_session.status = 'photo_received' OR v_session.consumed_at IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'ALREADY_CONSUMED',
            'message', 'A classroom photo has already been uploaded for this session.'
        );
    END IF;

    IF v_session.expires_at < v_now THEN
        -- Mark as expired
        UPDATE public.photo_upload_sessions
        SET status = 'expired', updated_at = v_now
        WHERE id = p_upload_session_id;

        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'EXPIRED_TOKEN',
            'message', 'This upload session has expired. Please ask the instructor for a new QR code.'
        );
    END IF;

    -- Update session atomically to photo_received
    UPDATE public.photo_upload_sessions
    SET status = 'photo_received',
        photo_storage_path = p_storage_path,
        photo_file_name = p_file_name,
        photo_file_size = p_file_size,
        photo_mime_type = p_mime_type,
        consumed_at = v_now,
        updated_at = v_now
    WHERE id = p_upload_session_id;

    -- Create audit log entry
    INSERT INTO public.attendance_audit_logs (
        record_id,
        session_id,
        student_id,
        action,
        previous_status,
        new_status,
        changed_by,
        changed_at,
        reason
    ) VALUES (
        p_upload_session_id,
        v_session.session_id,
        NULL,
        'classroom_photo_uploaded',
        NULL,
        NULL,
        v_session.instructor_id,
        v_now,
        'Classroom photo uploaded from mobile device via QR session'
    );

    RETURN jsonb_build_object(
        'success', true,
        'upload_session_id', p_upload_session_id,
        'photo_storage_path', p_storage_path,
        'uploaded_at', v_now
    );
END;
$$;
