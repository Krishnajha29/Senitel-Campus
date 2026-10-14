-- ==============================================================================
-- Sentinel Campus Migration: Step 4 - Class Enrollment RLS & Student Visibility
-- ==============================================================================

-- 1. Ensure class_enrollments table has full CRUD policies for authenticated instructors
DROP POLICY IF EXISTS "Instructors can update enrollments in their classes" ON public.class_enrollments;
CREATE POLICY "Instructors can update enrollments in their classes"
    ON public.class_enrollments FOR UPDATE
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM public.classes
        WHERE classes.id = class_enrollments.class_id
        AND classes.instructor_id = auth.uid()
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM public.classes
        WHERE classes.id = class_enrollments.class_id
        AND classes.instructor_id = auth.uid()
    ));

-- 2. Ensure instructors can view students enrolled in their classes (cross-table visibility)
DROP POLICY IF EXISTS "Instructors can view enrolled students in their classes" ON public.students;
CREATE POLICY "Instructors can view enrolled students in their classes"
    ON public.students FOR SELECT
    TO authenticated
    USING (
        instructor_id = auth.uid() OR
        EXISTS (
            SELECT 1 FROM public.class_enrollments ce
            JOIN public.classes c ON c.id = ce.class_id
            WHERE ce.student_id = students.id
            AND c.instructor_id = auth.uid()
        )
    );

-- 3. Composite index on class_enrollments for high-speed roster joins
CREATE INDEX IF NOT EXISTS idx_class_enrollments_class_student ON public.class_enrollments(class_id, student_id);
