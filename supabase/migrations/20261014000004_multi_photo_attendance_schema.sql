-- ==============================================================================
-- SENTINEL CAMPUS: Multi-Photo Classroom Attendance Schema
-- Extends photo_upload_sessions to support multi-photo batches per session
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Classroom Photos Table (Stores individual photos within an upload batch)
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. Row Level Security (RLS)
-- ------------------------------------------------------------------------------
ALTER TABLE public.classroom_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Instructors can view own classroom photos"
    ON public.classroom_photos FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.attendance_sessions s
            WHERE s.id = classroom_photos.session_id AND s.instructor_id = auth.uid()
        )
    );

CREATE POLICY "Instructors can insert classroom photos"
    ON public.classroom_photos FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.attendance_sessions s
            WHERE s.id = classroom_photos.session_id AND s.instructor_id = auth.uid()
        )
    );
