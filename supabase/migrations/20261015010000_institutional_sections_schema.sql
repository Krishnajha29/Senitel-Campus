-- ==============================================================================
-- SENTINEL CAMPUS: Institutional Academic Section Model & Automatic Rosters
-- Migration: 20261015010000_institutional_sections_schema.sql
-- ==============================================================================

-- 1. Academic Sections Table (Normalized Institutional Cohorts)
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

-- 2. Add section_id to Students Table
ALTER TABLE public.students 
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.academic_sections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_students_section_id ON public.students(section_id);

-- 3. Add section_id, cohort fields & enrollment_type to Classes Table
ALTER TABLE public.classes 
    ADD COLUMN IF NOT EXISTS section_id UUID REFERENCES public.academic_sections(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS programme TEXT,
    ADD COLUMN IF NOT EXISTS batch TEXT,
    ADD COLUMN IF NOT EXISTS semester TEXT,
    ADD COLUMN IF NOT EXISTS enrollment_type TEXT NOT NULL DEFAULT 'section';

-- Enforce check constraint on enrollment_type if not existing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'chk_classes_enrollment_type'
    ) THEN
        ALTER TABLE public.classes 
            ADD CONSTRAINT chk_classes_enrollment_type CHECK (enrollment_type IN ('section', 'manual'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_classes_section_id ON public.classes(section_id);

-- 4. Row Level Security for Academic Sections
ALTER TABLE public.academic_sections ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "Instructors can view own academic sections" ON public.academic_sections;
    DROP POLICY IF EXISTS "Instructors can insert own academic sections" ON public.academic_sections;
    DROP POLICY IF EXISTS "Instructors can update own academic sections" ON public.academic_sections;
    DROP POLICY IF EXISTS "Instructors can delete own academic sections" ON public.academic_sections;
END $$;

CREATE POLICY "Instructors can view own academic sections"
    ON public.academic_sections FOR SELECT
    TO authenticated
    USING (instructor_id = auth.uid());

CREATE POLICY "Instructors can insert own academic sections"
    ON public.academic_sections FOR INSERT
    TO authenticated
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can update own academic sections"
    ON public.academic_sections FOR UPDATE
    TO authenticated
    USING (instructor_id = auth.uid())
    WITH CHECK (instructor_id = auth.uid());

CREATE POLICY "Instructors can delete own academic sections"
    ON public.academic_sections FOR DELETE
    TO authenticated
    USING (instructor_id = auth.uid());

-- 5. Trigger for updated_at on academic_sections
CREATE OR REPLACE TRIGGER tr_academic_sections_updated_at 
    BEFORE UPDATE ON public.academic_sections 
    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 6. Safe Data Backfill: Populate academic_sections from distinct existing student records
INSERT INTO public.academic_sections (instructor_id, programme, batch, academic_year, name, is_active)
SELECT DISTINCT 
    s.instructor_id,
    COALESCE(NULLIF(TRIM(s.course), ''), 'B.Tech Computer Science'),
    COALESCE(NULLIF(TRIM(s.batch), ''), 'Batch 2024-2028'),
    COALESCE(NULLIF(TRIM(s.academic_year), ''), '2026-2027'),
    COALESCE(NULLIF(REPLACE(TRIM(s.section), 'Section ', ''), ''), 'A'),
    true
FROM public.students s
ON CONFLICT (instructor_id, programme, batch, academic_year, name) DO NOTHING;

-- Link existing students to their normalized academic_section
UPDATE public.students s
SET section_id = sec.id
FROM public.academic_sections sec
WHERE s.instructor_id = sec.instructor_id
  AND COALESCE(NULLIF(TRIM(s.course), ''), 'B.Tech Computer Science') = sec.programme
  AND COALESCE(NULLIF(TRIM(s.batch), ''), 'Batch 2024-2028') = sec.batch
  AND COALESCE(NULLIF(TRIM(s.academic_year), ''), '2026-2027') = sec.academic_year
  AND COALESCE(NULLIF(REPLACE(TRIM(s.section), 'Section ', ''), ''), 'A') = sec.name
  AND s.section_id IS NULL;

-- Link existing classes to matching academic_section
UPDATE public.classes c
SET section_id = sec.id,
    programme = sec.programme,
    batch = sec.batch,
    enrollment_type = 'section'
FROM public.academic_sections sec
WHERE c.instructor_id = sec.instructor_id
  AND c.academic_year = sec.academic_year
  AND COALESCE(NULLIF(REPLACE(TRIM(c.section), 'Section ', ''), ''), 'A') = sec.name
  AND c.section_id IS NULL;
