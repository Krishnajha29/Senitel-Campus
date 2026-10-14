import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { LocalDatabase } from './localDb';
import { uploadStudentPhoto, getStudentPhotoUrl, deleteStudentPhoto } from './storage';
import type {
  Instructor,
  Student,
  ClassCourse,
  AttendanceSession,
  AttendanceRecord,
  AttendanceAuditLog,
  AttendanceStatus,
  SessionStatus,
  DashboardStats,
  PresenceKey,
  CheckInResult,
  FaceAttendanceSubmissionItem,
  FaceAttendanceSubmissionResult,
  PhotoUploadSession,
  CreatePhotoUploadSessionResult,
  PhotoUploadValidationResult,
  SubmitClassroomPhotoResult,
  SubmitClassroomPhotoBatchResult,
  UploadedPhotoItem,
} from '../types';
import {
  generateCryptographicKey,
  generateSalt,
  hashPresenceKey,
} from './crypto';
import QRCode from 'qrcode';

export class ApiService {
  // -------------------------------------------------------------
  // Instructor / Auth
  // -------------------------------------------------------------
  static async getCurrentInstructor(): Promise<Instructor | null> {
    if (isSupabaseConfigured()) {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) return null;

      const { data, error } = await supabase
        .from('instructors')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error || !data) {
        // Auto-create instructor row if user exists in auth
        const newInstructor: Instructor = {
          id: user.id,
          full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Instructor',
          email: user.email || '',
          institution: 'Sentinel University',
          department: 'Computer Science & Engineering',
          avatar_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };

        const { data: inserted } = await supabase
          .from('instructors')
          .insert(newInstructor)
          .select()
          .single();

        return inserted || newInstructor;
      }

      return data as Instructor;
    }

    return LocalDatabase.getCurrentInstructor();
  }

  static async signIn(email: string, password: string): Promise<Instructor> {
    if (isSupabaseConfigured()) {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error) throw new Error(error.message);
      const instructor = await this.getCurrentInstructor();
      if (!instructor) throw new Error('Failed to retrieve instructor profile after sign in');
      return instructor;
    }
    return LocalDatabase.getCurrentInstructor()!;
  }

  static async signUp(
    email: string,
    password: string,
    fullName: string,
    department: string = 'Computer Science & Engineering',
    institution: string = 'Sentinel University'
  ): Promise<Instructor> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim(),
            department: department.trim(),
            institution: institution.trim(),
          },
        },
      });
      if (error) throw new Error(error.message);
      if (!data.user) throw new Error('Sign up did not return user');
      const instructor = await this.getCurrentInstructor();
      return (
        instructor || {
          id: data.user.id,
          full_name: fullName.trim(),
          email: email.trim(),
          institution: institution.trim(),
          department: department.trim(),
          avatar_url: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }
      );
    }
    return LocalDatabase.getCurrentInstructor()!;
  }

  static async signOut(): Promise<void> {
    if (isSupabaseConfigured()) {
      await supabase.auth.signOut();
    }
  }

  static async updateInstructorProfile(profile: Partial<Instructor>): Promise<Instructor> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) throw new Error('Not authenticated');

      const { data, error } = await supabase
        .from('instructors')
        .update({
          ...profile,
          updated_at: new Date().toISOString(),
        })
        .eq('id', instructor.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data as Instructor;
    }

    return LocalDatabase.updateInstructorProfile(profile);
  }

  // -------------------------------------------------------------
  // Students
  // -------------------------------------------------------------
  static async getStudents(filters?: {
    search?: string;
    course?: string;
    academic_year?: string;
    section?: string;
    is_active?: boolean | null;
  }): Promise<Student[]> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return [];

      let query = supabase.from('students').select('*').eq('instructor_id', instructor.id);

      if (filters?.is_active !== undefined && filters?.is_active !== null) {
        query = query.eq('is_active', filters.is_active);
      }
      if (filters?.course) {
        query = query.ilike('course', `%${filters.course}%`);
      }
      if (filters?.academic_year) {
        query = query.eq('academic_year', filters.academic_year);
      }
      if (filters?.section) {
        query = query.ilike('section', `%${filters.section}%`);
      }
      if (filters?.search && filters.search.trim().length > 0) {
        const q = filters.search.trim();
        query = query.or(`full_name.ilike.%${q}%,roll_number.ilike.%${q}%,email.ilike.%${q}%`);
      }

      const { data, error } = await query.order('roll_number', { ascending: true });
      if (error) {
        console.error('Error fetching students:', error);
        return [];
      }

      // Resolve signed photo URLs
      const studentsWithUrls = await Promise.all(
        (data as Student[]).map(async (s) => ({
          ...s,
          photo_url: await getStudentPhotoUrl(s.photo_path),
        }))
      );

      return studentsWithUrls;
    }

    const students = LocalDatabase.getStudents(filters);
    const withUrls = await Promise.all(
      students.map(async (s) => ({
        ...s,
        photo_url: s.photo_url || (await getStudentPhotoUrl(s.photo_path)),
      }))
    );
    return withUrls;
  }

  static async getStudentById(id: string): Promise<Student | null> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return null;

      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', id)
        .eq('instructor_id', instructor.id)
        .single();

      if (error || !data) return null;
      const student = data as Student;
      student.photo_url = await getStudentPhotoUrl(student.photo_path);
      return student;
    }

    const s = LocalDatabase.getStudentById(id);
    if (!s) return null;
    return {
      ...s,
      photo_url: s.photo_url || (await getStudentPhotoUrl(s.photo_path)),
    };
  }

  static async checkRollNumberExists(rollNumber: string, excludeId?: string): Promise<boolean> {
    const clean = rollNumber.trim().toUpperCase();
    if (!clean) return false;

    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return false;

      let q = supabase
        .from('students')
        .select('id')
        .eq('instructor_id', instructor.id)
        .ilike('roll_number', clean);

      if (excludeId) {
        q = q.neq('id', excludeId);
      }

      const { data } = await q;
      return (data && data.length > 0) || false;
    }

    return LocalDatabase.checkRollNumberExists(clean, excludeId);
  }

  static async createStudent(
    studentData: Omit<Student, 'id' | 'instructor_id' | 'created_at' | 'updated_at'>,
    photoFile?: File,
    onProgress?: (pct: number) => void
  ): Promise<Student> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanRoll = studentData.roll_number.trim().toUpperCase();

    // Verify duplicate roll number
    const exists = await this.checkRollNumberExists(cleanRoll);
    if (exists) {
      throw new Error(`This roll number already exists (${cleanRoll}).`);
    }

    let photoPath = studentData.photo_path;
    let photoUrl = studentData.photo_url || '';

    if (photoFile) {
      try {
        const uploadRes = await uploadStudentPhoto(photoFile, instructor.id, onProgress);
        photoPath = uploadRes.photoPath;
        photoUrl = uploadRes.photoUrl;
      } catch (err: any) {
        console.error('Photo upload failed:', err);
        throw new Error(`Photo upload failed: ${err.message || 'Check storage connection'}`);
      }
    }

    if (!photoPath) {
      throw new Error('Profile picture is required for student registration.');
    }

    const payload = {
      instructor_id: instructor.id,
      roll_number: cleanRoll,
      full_name: studentData.full_name.trim(),
      email: studentData.email ? studentData.email.trim() : null,
      course: studentData.course.trim(),
      batch: studentData.batch.trim(),
      academic_year: studentData.academic_year.trim(),
      section: studentData.section.trim(),
      photo_path: photoPath,
      is_active: studentData.is_active ?? true,
      face_descriptor: studentData.face_descriptor || null,
      face_enrolled_at: studentData.face_descriptor ? new Date().toISOString() : null,
      face_enrollment_status:
        studentData.face_enrollment_status ||
        (studentData.face_descriptor ? 'enrolled' : 'not_enrolled'),
      face_quality_score: studentData.face_quality_score || null,
    };

    const targetClassId = (studentData as any).class_id;

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('students')
        .insert(payload)
        .select()
        .single();

      if (error) {
        // Rollback uploaded photo if DB insert fails
        if (photoFile && photoPath) {
          await deleteStudentPhoto(photoPath).catch(() => {});
        }
        if (error.code === '23505') {
          throw new Error(`This roll number already exists (${cleanRoll}).`);
        }
        throw new Error(`Database error: ${error.message}`);
      }

      const createdStudent = {
        ...(data as Student),
        photo_url: photoUrl,
      };

      // Automatically enroll in selected class if specified
      if (targetClassId) {
        try {
          await this.enrollStudentsInClass(targetClassId, [createdStudent.id]);

          // Also populate baseline record if an active attendance session is running
          const { data: activeSessions } = await supabase
            .from('attendance_sessions')
            .select('id')
            .eq('class_id', targetClassId)
            .eq('status', 'active');

          if (activeSessions && activeSessions.length > 0) {
            const newRecords = activeSessions.map((ses) => ({
              session_id: ses.id,
              student_id: createdStudent.id,
              status: 'unmarked',
              marked_by: instructor.id,
              method: 'manual',
            }));
            await supabase.from('attendance_records').upsert(newRecords, { onConflict: 'session_id,student_id' });
          }
        } catch (enrErr) {
          console.warn('Auto-enrollment on student create warning:', enrErr);
        }
      }

      return createdStudent;
    }

    const created = LocalDatabase.createStudent({
      ...payload,
      photo_url: photoUrl,
      class_id: targetClassId,
    } as any);
    return created;
  }

  static async updateStudent(
    id: string,
    updates: Partial<Student>,
    newPhotoFile?: File,
    onProgress?: (pct: number) => void
  ): Promise<Student> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (updates.roll_number) {
      const cleanRoll = updates.roll_number.trim().toUpperCase();
      const exists = await this.checkRollNumberExists(cleanRoll, id);
      if (exists) {
        throw new Error(`This roll number already exists (${cleanRoll}).`);
      }
      updates.roll_number = cleanRoll;
    }

    let photoUrl = updates.photo_url;
    if (newPhotoFile) {
      const uploadRes = await uploadStudentPhoto(newPhotoFile, instructor.id, onProgress);
      updates.photo_path = uploadRes.photoPath;
      photoUrl = uploadRes.photoUrl;
    }

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('students')
        .update({
          ...updates,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('instructor_id', instructor.id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('This roll number already exists.');
        }
        throw new Error(`Update failed: ${error.message}`);
      }

      return {
        ...(data as Student),
        photo_url: photoUrl || (await getStudentPhotoUrl(data.photo_path)),
      };
    }

    const updated = LocalDatabase.updateStudent(id, {
      ...updates,
      photo_url: photoUrl,
    });
    return updated;
  }

  static async toggleStudentStatus(id: string, isActive: boolean): Promise<Student> {
    return this.updateStudent(id, { is_active: isActive });
  }

  // -------------------------------------------------------------
  // Classes and Courses
  // -------------------------------------------------------------
  static async getClasses(): Promise<ClassCourse[]> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return [];

      const { data, error } = await supabase
        .from('classes')
        .select('*, class_enrollments(count)')
        .eq('instructor_id', instructor.id)
        .order('name');

      if (error) {
        console.error('Error fetching classes:', error);
        return [];
      }

      return (data || []).map((c: any) => ({
        ...c,
        enrolled_count: c.class_enrollments?.[0]?.count || 0,
      }));
    }

    return LocalDatabase.getClasses();
  }

  static async getClassById(id: string): Promise<ClassCourse | null> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return null;

      const { data, error } = await supabase
        .from('classes')
        .select('*, class_enrollments(count)')
        .eq('id', id)
        .eq('instructor_id', instructor.id)
        .single();

      if (error || !data) return null;
      return {
        ...data,
        enrolled_count: data.class_enrollments?.[0]?.count || 0,
      };
    }

    return LocalDatabase.getClassById(id);
  }

  static async createClass(
    classData: Omit<ClassCourse, 'id' | 'instructor_id' | 'created_at' | 'updated_at' | 'enrolled_count'>
  ): Promise<ClassCourse> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanCode = classData.code.trim().toUpperCase();
    const cleanSection = classData.section.trim().toUpperCase();

    const payload = {
      ...classData,
      instructor_id: instructor.id,
      name: classData.name.trim(),
      code: cleanCode,
      section: cleanSection,
      academic_year: classData.academic_year.trim(),
      description: classData.description ? classData.description.trim() : null,
      is_active: classData.is_active ?? true,
    };

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('classes')
        .insert(payload)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error(`A class with code ${cleanCode} and section ${cleanSection} already exists.`);
        }
        throw new Error(error.message);
      }

      return { ...(data as ClassCourse), enrolled_count: 0 };
    }

    return LocalDatabase.createClass(payload);
  }

  static async updateClass(id: string, updates: Partial<ClassCourse>): Promise<ClassCourse> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('classes')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('instructor_id', instructor.id)
        .select()
        .single();

      if (error) {
        if (error.code === '23505') {
          throw new Error('A class with this code and section already exists.');
        }
        throw new Error(error.message);
      }

      return data as ClassCourse;
    }

    return LocalDatabase.updateClass(id, updates);
  }

  static async getClassEnrollments(classId: string): Promise<Student[]> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('class_enrollments')
        .select('student_id, students(*)')
        .eq('class_id', classId);

      if (error || !data) return [];
      let students = data.map((d: any) => d.students).filter(Boolean) as Student[];

      // Fallback: If join returned empty students but enrollment rows exist, query students by ID
      if (students.length === 0 && data.length > 0) {
        const studentIds = data.map((d: any) => d.student_id).filter(Boolean);
        if (studentIds.length > 0) {
          const { data: directStudents } = await supabase
            .from('students')
            .select('*')
            .in('id', studentIds);
          if (directStudents) {
            students = directStudents as Student[];
          }
        }
      }

      return Promise.all(
        students.map(async (s) => ({
          ...s,
          photo_url: await getStudentPhotoUrl(s.photo_path),
        }))
      );
    }

    const students = LocalDatabase.getClassEnrollments(classId);
    return Promise.all(
      students.map(async (s) => ({
        ...s,
        photo_url: s.photo_url || (await getStudentPhotoUrl(s.photo_path)),
      }))
    );
  }

  static async enrollStudentsInClass(classId: string, studentIds: string[]): Promise<void> {
    if (isSupabaseConfigured()) {
      const rows = studentIds.map((sid) => ({
        class_id: classId,
        student_id: sid,
      }));

      const { error } = await supabase
        .from('class_enrollments')
        .upsert(rows, { onConflict: 'class_id,student_id', ignoreDuplicates: true });

      if (error) throw new Error(`Enrollment failed: ${error.message}`);
      return;
    }

    LocalDatabase.enrollStudentsInClass(classId, studentIds);
  }

  static async removeStudentFromClass(classId: string, studentId: string): Promise<void> {
    if (isSupabaseConfigured()) {
      const { error } = await supabase
        .from('class_enrollments')
        .delete()
        .eq('class_id', classId)
        .eq('student_id', studentId);

      if (error) throw new Error(`Failed to remove enrollment: ${error.message}`);
      return;
    }

    LocalDatabase.removeStudentFromClass(classId, studentId);
  }

  // -------------------------------------------------------------
  // Attendance Sessions & Records
  // -------------------------------------------------------------
  static async getAttendanceSessions(filters?: {
    classId?: string;
    date?: string;
    status?: string;
  }): Promise<AttendanceSession[]> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return [];

      let query = supabase
        .from('attendance_sessions')
        .select('*, classes(name, code), attendance_records(status)')
        .eq('instructor_id', instructor.id);

      if (filters?.classId) query = query.eq('class_id', filters.classId);
      if (filters?.date) query = query.eq('session_date', filters.date);
      if (filters?.status) query = query.eq('status', filters.status);

      const { data, error } = await query.order('session_date', { ascending: false });
      if (error || !data) return [];

      return data.map((s: any) => {
        const records = s.attendance_records || [];
        const present = records.filter((r: any) => r.status === 'present').length;
        const absent = records.filter((r: any) => r.status === 'absent').length;
        const late = records.filter((r: any) => r.status === 'late').length;
        const unmarked = records.filter((r: any) => r.status === 'unmarked').length;

        return {
          id: s.id,
          class_id: s.class_id,
          instructor_id: s.instructor_id,
          title: s.title,
          session_date: s.session_date,
          start_time: s.start_time,
          end_time: s.end_time,
          status: s.status,
          created_at: s.created_at,
          updated_at: s.updated_at,
          class_name: s.classes?.name,
          class_code: s.classes?.code,
          stats: {
            present,
            absent,
            late,
            unmarked,
            total: records.length,
          },
        };
      });
    }

    return LocalDatabase.getAttendanceSessions(filters);
  }

  static async getSessionById(sessionId: string): Promise<AttendanceSession | null> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) return null;

      const { data, error } = await supabase
        .from('attendance_sessions')
        .select('*, classes(name, code), attendance_records(status)')
        .eq('id', sessionId)
        .eq('instructor_id', instructor.id)
        .single();

      if (error || !data) return null;

      const records = data.attendance_records || [];
      const present = records.filter((r: any) => r.status === 'present').length;
      const absent = records.filter((r: any) => r.status === 'absent').length;
      const late = records.filter((r: any) => r.status === 'late').length;
      const unmarked = records.filter((r: any) => r.status === 'unmarked').length;

      return {
        id: data.id,
        class_id: data.class_id,
        instructor_id: data.instructor_id,
        title: data.title,
        session_date: data.session_date,
        start_time: data.start_time,
        end_time: data.end_time,
        status: data.status,
        created_at: data.created_at,
        updated_at: data.updated_at,
        class_name: data.classes?.name,
        class_code: data.classes?.code,
        stats: {
          present,
          absent,
          late,
          unmarked,
          total: records.length,
        },
      };
    }

    return LocalDatabase.getSessionById(sessionId);
  }

  static async createAttendanceSession(data: {
    class_id: string;
    title: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }): Promise<AttendanceSession> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      // 1. Insert session
      const { data: session, error } = await supabase
        .from('attendance_sessions')
        .insert({
          ...data,
          instructor_id: instructor.id,
          title: data.title.trim(),
          status: 'active',
        })
        .select('*, classes(name, code)')
        .single();

      if (error || !session) throw new Error(`Failed to create session: ${error?.message}`);

      // 2. Fetch enrolled students and initialize unmarked records
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('student_id')
        .eq('class_id', data.class_id);

      if (enrollments && enrollments.length > 0) {
        const baseline = enrollments.map((e) => ({
          session_id: session.id,
          student_id: e.student_id,
          status: 'unmarked',
          marked_by: instructor.id,
          method: 'manual',
        }));
        await supabase.from('attendance_records').insert(baseline);
      }

      return {
        ...session,
        class_name: session.classes?.name,
        class_code: session.classes?.code,
        stats: {
          present: 0,
          absent: 0,
          late: 0,
          unmarked: enrollments?.length || 0,
          total: enrollments?.length || 0,
        },
      };
    }

    return LocalDatabase.createAttendanceSession(data);
  }

  static async updateSessionStatus(sessionId: string, status: SessionStatus): Promise<AttendanceSession> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) throw new Error('Not authenticated');

      // If finalizing, convert remaining unmarked to absent
      if (status === 'finalized') {
        await supabase
          .from('attendance_records')
          .update({
            status: 'absent',
            updated_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId)
          .eq('status', 'unmarked');
      }

      const { error } = await supabase
        .from('attendance_sessions')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', sessionId)
        .eq('instructor_id', instructor.id);

      if (error) throw new Error(error.message);
      const res = await this.getSessionById(sessionId);
      if (!res) throw new Error('Session not found');
      return res;
    }

    return LocalDatabase.updateSessionStatus(sessionId, status);
  }

  static async getSessionAttendance(
    sessionId: string
  ): Promise<{ student: Student; record: AttendanceRecord | null }[]> {
    if (isSupabaseConfigured()) {
      const session = await this.getSessionById(sessionId);
      if (!session) return [];

      const enrolledStudents = await this.getClassEnrollments(session.class_id);

      const { data: records } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId);

      const recordMap = new Map<string, AttendanceRecord>();
      (records || []).forEach((r: AttendanceRecord) => recordMap.set(r.student_id, r));

      return enrolledStudents.map((student) => ({
        student,
        record: recordMap.get(student.id) || null,
      }));
    }

    return LocalDatabase.getSessionAttendance(sessionId);
  }

  static async saveAttendanceRecords(
    sessionId: string,
    updates: { student_id: string; status: AttendanceStatus; notes?: string }[]
  ): Promise<void> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      const rows = updates.map((u) => ({
        session_id: sessionId,
        student_id: u.student_id,
        status: u.status,
        marked_by: instructor.id,
        marked_at: new Date().toISOString(),
        method: 'manual',
        notes: u.notes || null,
        updated_at: new Date().toISOString(),
      }));

      // Upsert enforces: UNIQUE(session_id, student_id)
      const { error } = await supabase
        .from('attendance_records')
        .upsert(rows, { onConflict: 'session_id,student_id' });

      if (error) throw new Error(`Failed to save attendance: ${error.message}`);
      return;
    }

    LocalDatabase.saveAttendanceRecords(sessionId, updates);
  }

  static async getAttendanceAuditLogs(sessionId?: string): Promise<AttendanceAuditLog[]> {
    if (isSupabaseConfigured()) {
      let q = supabase.from('attendance_audit_logs').select('*');
      if (sessionId) q = q.eq('session_id', sessionId);
      const { data } = await q.order('changed_at', { ascending: false });
      return (data || []) as AttendanceAuditLog[];
    }
    return LocalDatabase.getAttendanceAuditLogs(sessionId);
  }

  // -------------------------------------------------------------
  // Student Attendance Summary & Overall Reports
  // -------------------------------------------------------------
  static async getStudentAttendanceSummary(studentId: string): Promise<{
    total: number;
    present: number;
    absent: number;
    late: number;
    unmarked: number;
    percentage: number;
  }> {
    if (isSupabaseConfigured()) {
      // Find classes student is enrolled in
      const { data: enrollments } = await supabase
        .from('class_enrollments')
        .select('class_id')
        .eq('student_id', studentId);

      const classIds = (enrollments || []).map((e: any) => e.class_id);
      if (classIds.length === 0) {
        return { total: 0, present: 0, absent: 0, late: 0, unmarked: 0, percentage: 0 };
      }

      // Applicable sessions
      const { data: sessions } = await supabase
        .from('attendance_sessions')
        .select('id, status')
        .in('class_id', classIds)
        .neq('status', 'cancelled');

      const totalSessions = sessions?.length || 0;
      const finalizedSessionIds = new Set(
        (sessions || []).filter((s) => s.status === 'finalized').map((s) => s.id)
      );

      const { data: records } = await supabase
        .from('attendance_records')
        .select('session_id, status')
        .eq('student_id', studentId);

      const present = (records || []).filter((r) => r.status === 'present').length;
      const late = (records || []).filter((r) => r.status === 'late').length;
      const absent = (records || []).filter((r) => r.status === 'absent').length;
      const unmarked = (records || []).filter((r) => r.status === 'unmarked').length;

      // Finalized denominator
      const finalizedRecords = (records || []).filter((r) => finalizedSessionIds.has(r.session_id));
      const finalizedCount = finalizedRecords.length;
      const positive = finalizedRecords.filter((r) => r.status === 'present' || r.status === 'late').length;

      const percentage = finalizedCount > 0 ? Math.round((positive / finalizedCount) * 100) : 0;

      return {
        total: totalSessions,
        present,
        absent,
        late,
        unmarked,
        percentage,
      };
    }

    return LocalDatabase.getStudentAttendanceSummary(studentId);
  }

  static async getDashboardStats(): Promise<DashboardStats> {
    if (isSupabaseConfigured()) {
      const instructor = await this.getCurrentInstructor();
      if (!instructor) {
        return {
          totalStudents: 0,
          totalActiveClasses: 0,
          totalSessions: 0,
          selectedSessionPresent: 0,
          selectedSessionAbsent: 0,
          selectedSessionLate: 0,
          overallAttendancePct: 0,
        };
      }

      const [studentsRes, classesRes, sessions] = await Promise.all([
        supabase.from('students').select('*', { count: 'exact', head: true }).eq('instructor_id', instructor.id),
        supabase.from('classes').select('*', { count: 'exact', head: true }).eq('instructor_id', instructor.id).eq('is_active', true),
        this.getAttendanceSessions(),
      ]);

      const totalStudents = studentsRes.count || 0;
      const totalActiveClasses = classesRes.count || 0;
      const totalSessions = sessions.length;

      const recentSession = sessions.length > 0 ? sessions[0] : null;
      let selectedSessionPresent = 0;
      let selectedSessionAbsent = 0;
      let selectedSessionLate = 0;
      let selectedSessionTitle = undefined;

      if (recentSession && recentSession.stats) {
        selectedSessionPresent = recentSession.stats.present;
        selectedSessionAbsent = recentSession.stats.absent;
        selectedSessionLate = recentSession.stats.late;
        selectedSessionTitle = `${recentSession.title} (${recentSession.session_date})`;
      }

      // Calculate overall percentage across all finalized sessions
      const finalizedSessionIds = sessions.filter((s) => s.status === 'finalized').map((s) => s.id);
      let overallAttendancePct = 0;

      if (finalizedSessionIds.length > 0) {
        const { data: recs } = await supabase
          .from('attendance_records')
          .select('status')
          .in('session_id', finalizedSessionIds);

        if (recs && recs.length > 0) {
          const positive = recs.filter((r) => r.status === 'present' || r.status === 'late').length;
          overallAttendancePct = Math.round((positive / recs.length) * 100);
        }
      }

      return {
        totalStudents,
        totalActiveClasses,
        totalSessions,
        selectedSessionPresent,
        selectedSessionAbsent,
        selectedSessionLate,
        selectedSessionTitle,
        overallAttendancePct,
      };
    }

    return LocalDatabase.getDashboardStats();
  }

  // -------------------------------------------------------------
  // CSV Export Utility
  // -------------------------------------------------------------
  static exportToCSV(filename: string, rows: Record<string, any>[]): void {
    if (!rows || rows.length === 0) return;

    const headers = Object.keys(rows[0]);
    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        headers
          .map((header) => {
            let val = row[header] === null || row[header] === undefined ? '' : String(row[header]);
            if (val.includes(',') || val.includes('"') || val.includes('\n')) {
              val = `"${val.replace(/"/g, '""')}"`;
            }
            return val;
          })
          .join(',')
      ),
    ].join('\r\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${filename}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  // -------------------------------------------------------------
  // Presence Keys & Student Check-in API
  // -------------------------------------------------------------
  static async generatePresenceKey(
    sessionId: string,
    durationMinutes: number = 10
  ): Promise<PresenceKey> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      // Invalidate any existing active key
      await supabase
        .from('presence_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: instructor.id,
        })
        .eq('session_id', sessionId)
        .eq('status', 'active');

      const plainKey = generateCryptographicKey();
      const salt = generateSalt();
      const keyHash = await hashPresenceKey(salt, plainKey, sessionId);
      const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

      const { data, error } = await supabase
        .from('presence_keys')
        .insert({
          session_id: sessionId,
          instructor_id: instructor.id,
          key_hash: keyHash,
          key_salt: salt,
          expires_at: expiresAt,
          status: 'active',
        })
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to generate presence key: ${error?.message}`);
      }

      return {
        ...(data as PresenceKey),
        plain_key: plainKey,
      };
    }

    return LocalDatabase.generatePresenceKey(sessionId, durationMinutes);
  }

  static async getActivePresenceKey(sessionId: string): Promise<PresenceKey | null> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('presence_keys')
        .select('*')
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;
      return data as PresenceKey;
    }

    return LocalDatabase.getActivePresenceKey(sessionId);
  }

  static async revokePresenceKey(sessionId: string): Promise<PresenceKey | null> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('presence_keys')
        .update({
          status: 'revoked',
          revoked_at: new Date().toISOString(),
          revoked_by: instructor.id,
        })
        .eq('session_id', sessionId)
        .eq('status', 'active')
        .select()
        .maybeSingle();

      if (error) throw new Error(`Failed to revoke key: ${error.message}`);
      return data as PresenceKey | null;
    }

    return LocalDatabase.revokePresenceKey(sessionId);
  }

  static async validateStudentCheckIn(
    plainKey: string,
    authenticatedStudentId?: string
  ): Promise<CheckInResult> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase.rpc('student_check_in_with_key', {
        p_key_code: plainKey.trim(),
      });

      if (error) {
        return {
          success: false,
          code: 'SERVER_ERROR',
          message: error.message || 'Check-in validation service error.',
        };
      }

      return data as CheckInResult;
    }

    // Local / fallback mode
    const studentId = authenticatedStudentId || (LocalDatabase.getStudents()[0]?.id ?? '');
    return LocalDatabase.validateStudentCheckIn(plainKey, studentId);
  }

  // -------------------------------------------------------------
  // Face Recognition Biometric Enrollment & Attendance Submission
  // -------------------------------------------------------------
  static async submitFaceAttendance(
    sessionId: string,
    submissions: FaceAttendanceSubmissionItem[]
  ): Promise<FaceAttendanceSubmissionResult> {
    if (isSupabaseConfigured()) {
      const payload = submissions.map((s) => ({
        student_id: s.studentId,
        status: s.status,
        detection_id: s.detectionId,
        confidence: s.confidenceScore,
        match_type: s.matchType,
      }));

      const { data, error } = await supabase.rpc('submit_face_attendance', {
        p_session_id: sessionId,
        p_submissions: payload,
      });

      if (error) {
        throw new Error(`Face attendance submission failed: ${error.message}`);
      }

      // Fetch updated attendance records for this session
      const { data: records } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId);

      return {
        success: data?.success ?? true,
        markedPresentCount: data?.marked_present_count ?? 0,
        alreadyPresentCount: data?.already_present_count ?? 0,
        updatedRecords: (records || []) as AttendanceRecord[],
        auditLogIds: [],
      };
    }

    return LocalDatabase.submitFaceAttendance(sessionId, submissions);
  }

  static async enrollStudentFaceDescriptor(
    studentId: string,
    descriptor: number[],
    qualityScore = 0.95
  ): Promise<Student> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('students')
        .update({
          face_descriptor: descriptor,
          face_enrolled_at: new Date().toISOString(),
          face_enrollment_status: 'enrolled',
          face_quality_score: qualityScore,
          updated_at: new Date().toISOString(),
        })
        .eq('id', studentId)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to enroll face descriptor: ${error?.message}`);
      }
      return data as Student;
    }

    return LocalDatabase.enrollStudentFaceDescriptor(studentId, descriptor, qualityScore);
  }

  static async removeStudentFaceDescriptor(studentId: string): Promise<Student> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('students')
        .update({
          face_descriptor: null,
          face_enrolled_at: null,
          face_enrollment_status: 'not_enrolled',
          face_quality_score: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', studentId)
        .select()
        .single();

      if (error || !data) {
        throw new Error(`Failed to remove face descriptor: ${error?.message}`);
      }
      return data as Student;
    }

    return LocalDatabase.removeStudentFaceDescriptor(studentId);
  }

  // -------------------------------------------------------------
  // QR Photo Upload Session & Mobile Capture
  // -------------------------------------------------------------
  static async createPhotoUploadSession(
    sessionId: string,
    durationMinutes: number = 10,
    customOrigin?: string
  ): Promise<CreatePhotoUploadSessionResult> {
    const instructor = await this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    if (isSupabaseConfigured()) {
      try {
        await supabase
          .from('photo_upload_sessions')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId)
          .eq('status', 'awaiting_scan');

        const plainToken = generateCryptographicKey();
        const salt = generateSalt();
        const tokenHash = await hashPresenceKey(salt, plainToken, sessionId);
        const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();

        const origin =
          customOrigin ||
          (import.meta.env.VITE_APP_URL ? import.meta.env.VITE_APP_URL : window.location.origin);
        const qrUrl = `${origin.replace(/\/$/, '')}/mobile-upload?token=${encodeURIComponent(plainToken)}&session=${encodeURIComponent(sessionId)}`;

        const { data, error } = await supabase
          .from('photo_upload_sessions')
          .insert({
            session_id: sessionId,
            instructor_id: instructor.id,
            token_hash: tokenHash,
            token_salt: salt,
            qr_url: qrUrl,
            status: 'awaiting_scan',
            expires_at: expiresAt,
          })
          .select()
          .single();

        if (!error && data) {
          const sessionObj = data as PhotoUploadSession;
          const qrDataUrl = await QRCode.toDataURL(qrUrl, {
            errorCorrectionLevel: 'M',
            margin: 2,
          });

          return {
            upload_session: sessionObj,
            session: sessionObj,
            plain_token: plainToken,
            qr_url: qrUrl,
            upload_url: qrUrl,
            qr_data_url: qrDataUrl,
          };
        }
      } catch (err) {
        console.warn('Supabase photo session error, falling back to localDb:', err);
      }
    }

    return LocalDatabase.createPhotoUploadSession(sessionId, durationMinutes, customOrigin);
  }

  static async getActivePhotoUploadSession(sessionId: string): Promise<PhotoUploadSession | null> {
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('photo_upload_sessions')
          .select('*')
          .eq('session_id', sessionId)
          .eq('status', 'awaiting_scan')
          .gt('expires_at', new Date().toISOString())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error && data) return data as PhotoUploadSession;
      } catch (err) {
        console.warn('Supabase get active photo session error:', err);
      }
    }
    return LocalDatabase.getActivePhotoUploadSession(sessionId);
  }

  static async getPhotoUploadSessionById(id: string): Promise<PhotoUploadSession | null> {
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('photo_upload_sessions')
          .select('*')
          .eq('id', id)
          .maybeSingle();

        if (!error && data) return data as PhotoUploadSession;
      } catch (err) {
        console.warn('Supabase get photo session by id error:', err);
      }
    }
    return LocalDatabase.getPhotoUploadSessionById(id);
  }

  static async validatePhotoUploadToken(token: string): Promise<PhotoUploadValidationResult> {
    return LocalDatabase.validatePhotoUploadToken(token);
  }

  static async revokePhotoUploadSession(sessionId: string): Promise<PhotoUploadSession | null> {
    if (isSupabaseConfigured()) {
      try {
        const { data, error } = await supabase
          .from('photo_upload_sessions')
          .update({
            status: 'revoked',
            revoked_at: new Date().toISOString(),
          })
          .eq('session_id', sessionId)
          .eq('status', 'awaiting_scan')
          .select()
          .maybeSingle();

        if (!error && data) return data as PhotoUploadSession;
      } catch (err) {
        console.warn('Supabase revoke photo session error:', err);
      }
    }
    return LocalDatabase.revokePhotoUploadSession(sessionId);
  }

  static async getAttendanceRecords(sessionId: string): Promise<AttendanceRecord[]> {
    if (isSupabaseConfigured()) {
      const { data, error } = await supabase
        .from('attendance_records')
        .select('*')
        .eq('session_id', sessionId);

      if (error) {
        console.error('Error fetching attendance records from Supabase:', error);
        return [];
      }
      return (data || []) as AttendanceRecord[];
    }
    return LocalDatabase.getSessionAttendanceRecords(sessionId);
  }

  static async submitClassroomPhoto(
    token: string,
    file: File | { fileName: string; mimeType: string; size: number; dataUrl: string },
    clientDeviceInfo?: string
  ): Promise<SubmitClassroomPhotoResult> {
    const res = await LocalDatabase.submitClassroomPhoto(token, file, clientDeviceInfo);
    if (!res.success) {
      throw new Error(res.error || res.message || 'Photo upload failed');
    }
    return res;
  }

  static async submitClassroomPhotoBatch(
    token: string,
    files: (File | { fileName: string; mimeType: string; size: number; dataUrl: string })[],
    clientDeviceInfo?: string
  ): Promise<SubmitClassroomPhotoBatchResult> {
    const res = await LocalDatabase.submitClassroomPhotoBatch(token, files, clientDeviceInfo);
    if (!res.success) {
      throw new Error(res.error || res.message || 'Photo batch upload failed');
    }
    return res;
  }

  static async getUploadedPhotos(uploadSessionId: string): Promise<UploadedPhotoItem[]> {
    return LocalDatabase.getUploadedPhotos(uploadSessionId);
  }

  static async deleteUploadedPhoto(photoId: string): Promise<boolean> {
    return LocalDatabase.deleteUploadedPhoto(photoId);
  }
}

