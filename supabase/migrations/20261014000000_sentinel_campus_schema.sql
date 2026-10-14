-- ==============================================================================
-- SENTINEL CAMPUS: Core Database Schema, Constraints, Indexes & RLS Policies
-- Step 1: Instructor Dashboard, Student Management, Classes & Attendance
-- ==============================================================================

-- Enable UUID extension if not enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ------------------------------------------------------------------------------
-- 1. Instructors Table
-- Extends Supabase auth.users for profile and institution details
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 2. Students Table
-- Stores student information and private storage reference for photos
-- Uniqueness constraint on (instructor_id, roll_number) ensures no duplicates
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    roll_number TEXT NOT NULL,
    full_name TEXT NOT NULL,
    email TEXT,
    course TEXT NOT NULL,
    batch TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    section TEXT NOT NULL,
    photo_path TEXT NOT NULL, -- Path in private Supabase Storage bucket 'student-photos'
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_instructor_roll_number UNIQUE (instructor_id, roll_number)
);

-- Indexes for frequent searches and filters
CREATE INDEX IF NOT EXISTS idx_students_instructor ON public.students(instructor_id);
CREATE INDEX IF NOT EXISTS idx_students_roll_number ON public.students(instructor_id, roll_number);
CREATE INDEX IF NOT EXISTS idx_students_filter ON public.students(course, academic_year, section, is_active);

-- ------------------------------------------------------------------------------
-- 3. Classes Table
-- Courses and classes managed by the instructor
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.classes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    instructor_id UUID NOT NULL REFERENCES public.instructors(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    academic_year TEXT NOT NULL,
    section TEXT NOT NULL,
    description TEXT,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_instructor_class_code_section UNIQUE (instructor_id, code, section)
);

CREATE INDEX IF NOT EXISTS idx_classes_instructor ON public.classes(instructor_id);
CREATE INDEX IF NOT EXISTS idx_classes_active ON public.classes(is_active);

-- ------------------------------------------------------------------------------
-- 4. Class Enrollments Table
-- Links students to classes with strict uniqueness to prevent duplicate enrollment
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    class_id UUID NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    enrolled_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_class_student_enrollment UNIQUE (class_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_enrollments_class ON public.class_enrollments(class_id);
CREATE INDEX IF NOT EXISTS idx_enrollments_student ON public.class_enrollments(student_id);

-- ------------------------------------------------------------------------------
-- 5. Attendance Sessions Table
-- Sessions conducted for a class
-- ------------------------------------------------------------------------------
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

-- ------------------------------------------------------------------------------
-- 6. Attendance Records Table
-- Individual student status for a specific session
-- STRICT RULE: Exactly 0 or 1 record per student per session!
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'unmarked' CHECK (status IN ('present', 'absent', 'late', 'unmarked')),
    marked_by UUID NOT NULL REFERENCES public.instructors(id),
    marked_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    method TEXT NOT NULL DEFAULT 'manual' CHECK (method IN ('manual', 'face_recognition', 'presence_key', 'admin_override')),
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    CONSTRAINT uq_session_student_attendance UNIQUE (session_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_records_session ON public.attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_records_student ON public.attendance_records(student_id);
CREATE INDEX IF NOT EXISTS idx_records_status ON public.attendance_records(status);

-- ------------------------------------------------------------------------------
-- 7. Attendance Audit Logs Table
-- Tracks who changed what, when, and previous status vs new status
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.attendance_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id UUID REFERENCES public.attendance_records(id) ON DELETE SET NULL,
    session_id UUID NOT NULL REFERENCES public.attendance_sessions(id) ON DELETE CASCADE,
    student_id UUID NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
    previous_status TEXT,
    new_status TEXT NOT NULL,
    changed_by UUID NOT NULL REFERENCES public.instructors(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc'::text, now()),
    reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_session ON public.attendance_audit_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_audit_student ON public.attendance_audit_logs(student_id);

-- ------------------------------------------------------------------------------
-- 8. Updated At Trigger Function
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = timezone('utc'::text, now());
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tr_instructors_updated_at BEFORE UPDATE ON public.instructors FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER tr_students_updated_at BEFORE UPDATE ON public.students FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER tr_classes_updated_at BEFORE UPDATE ON public.classes FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER tr_sessions_updated_at BEFORE UPDATE ON public.attendance_sessions FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE OR REPLACE TRIGGER tr_records_updated_at BEFORE UPDATE ON public.attendance_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ------------------------------------------------------------------------------
-- 9. Row Level Security (RLS) Policies
-- Complete isolation: Instructors can only view and mutate their own data
-- ------------------------------------------------------------------------------
ALTER TABLE public.instructors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_audit_logs ENABLE ROW LEVEL SECURITY;

-- Instructors policies
CREATE POLICY "Instructors can view own profile"
    ON public.instructors FOR SELECT
    USING (auth.uid() = id);

CREATE POLICY "Instructors can update own profile"
    ON public.instructors FOR UPDATE
    USING (auth.uid() = id);

CREATE POLICY "Instructors can insert own profile"
    ON public.instructors FOR INSERT
    WITH CHECK (auth.uid() = id);

-- Students policies
CREATE POLICY "Instructors can view own students"
    ON public.students FOR SELECT
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can insert own students"
    ON public.students FOR INSERT
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update own students"
    ON public.students FOR UPDATE
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can delete own students"
    ON public.students FOR DELETE
    USING (instructor_id = auth.uid());

-- Classes policies
CREATE POLICY "Instructors can view own classes"
    ON public.classes FOR SELECT
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can insert own classes"
    ON public.classes FOR INSERT
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update own classes"
    ON public.classes FOR UPDATE
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can delete own classes"
    ON public.classes FOR DELETE
    USING (instructor_id = auth.uid());

-- Class Enrollments policies
CREATE POLICY "Instructors can view enrollments in their classes"
    ON public.class_enrollments FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.classes
        WHERE classes.id = class_enrollments.class_id
        AND classes.instructor_id = auth.uid()
    ));

CREATE POLICY "Instructors can enroll students in their classes"
    ON public.class_enrollments FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.classes
        WHERE classes.id = class_enrollments.class_id
        AND classes.instructor_id = auth.uid()
    ));

CREATE POLICY "Instructors can remove enrollments in their classes"
    ON public.class_enrollments FOR DELETE
    USING (EXISTS (
        SELECT 1 FROM public.classes
        WHERE classes.id = class_enrollments.class_id
        AND classes.instructor_id = auth.uid()
    ));

-- Attendance Sessions policies
CREATE POLICY "Instructors can view own sessions"
    ON public.attendance_sessions FOR SELECT
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can insert own sessions"
    ON public.attendance_sessions FOR INSERT
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update own sessions"
    ON public.attendance_sessions FOR UPDATE
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can delete own sessions"
    ON public.attendance_sessions FOR DELETE
    USING (instructor_id = auth.uid());

-- Attendance Records policies
CREATE POLICY "Instructors can view attendance records for their sessions"
    ON public.attendance_records FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE attendance_sessions.id = attendance_records.session_id
        AND attendance_sessions.instructor_id = auth.uid()
    ));

CREATE POLICY "Instructors can insert attendance records for their sessions"
    ON public.attendance_records FOR INSERT
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE attendance_sessions.id = attendance_records.session_id
        AND attendance_sessions.instructor_id = auth.uid()
    ));

CREATE POLICY "Instructors can update attendance records for their sessions"
    ON public.attendance_records FOR UPDATE
    USING (EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE attendance_sessions.id = attendance_records.session_id
        AND attendance_sessions.instructor_id = auth.uid()
    ));

-- Attendance Audit Logs policies
CREATE POLICY "Instructors can view audit logs for their sessions"
    ON public.attendance_audit_logs FOR SELECT
    USING (EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE attendance_sessions.id = attendance_audit_logs.session_id
        AND attendance_sessions.instructor_id = auth.uid()
    ));

CREATE POLICY "Instructors can insert audit logs"
    ON public.attendance_audit_logs FOR INSERT
    WITH CHECK (changed_by = auth.uid());

-- ------------------------------------------------------------------------------
-- 10. Storage Bucket Setup & Policies
-- Creates private bucket 'student-photos' with secure authenticated access
-- ------------------------------------------------------------------------------
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

-- Storage RLS: instructors can upload, read, update, delete their own student images
CREATE POLICY "Instructors can upload student photos"
    ON storage.objects FOR INSERT
    WITH CHECK (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Instructors can read student photos"
    ON storage.objects FOR SELECT
    USING (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Instructors can update student photos"
    ON storage.objects FOR UPDATE
    USING (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );

CREATE POLICY "Instructors can delete student photos"
    ON storage.objects FOR DELETE
    USING (
        bucket_id = 'student-photos'
        AND (storage.foldername(name))[1] = auth.uid()::text
    );
