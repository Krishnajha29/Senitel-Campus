import type {
  Instructor,
  Student,
  ClassCourse,
  ClassEnrollment,
  AcademicSection,
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
  UploadedPhotoItem,
  SubmitClassroomPhotoBatchResult,
} from '../types';
import {
  generateCryptographicKey,
  generateSalt,
  hashPresenceKey,
  timingSafeEqual,
  generateUploadToken,
  hashUploadToken,
} from './crypto';
import QRCode from 'qrcode';

const STORAGE_KEYS = {
  CURRENT_USER: 'sentinel_campus_current_instructor',
  INSTRUCTORS: 'sentinel_campus_instructors',
  SECTIONS: 'sentinel_campus_academic_sections',
  STUDENTS: 'sentinel_campus_students',
  CLASSES: 'sentinel_campus_classes',
  ENROLLMENTS: 'sentinel_campus_enrollments',
  SESSIONS: 'sentinel_campus_sessions',
  RECORDS: 'sentinel_campus_records',
  AUDIT_LOGS: 'sentinel_campus_audit_logs',
  PRESENCE_KEYS: 'sentinel_campus_presence_keys',
  CHECKIN_ATTEMPTS: 'sentinel_campus_checkin_attempts',
  PHOTO_UPLOAD_SESSIONS: 'sentinel_campus_photo_upload_sessions',
  STORED_PHOTOS: 'sentinel_campus_stored_photos',
  UPLOADED_PHOTOS: 'sentinel_campus_uploaded_photos',
};

// Default instructor for local test session
const DEFAULT_INSTRUCTOR: Instructor = {
  id: 'inst-001',
  full_name: 'Dr. Sarah Mitchell',
  email: 'sarah.mitchell@sentinel.edu',
  institution: 'Sentinel Institute of Technology',
  department: 'Department of Computer Science & Engineering',
  avatar_url: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

// Helper to read and write localStorage safely with memory fallback
const memoryStorage = new Map<string, string>();

function loadData<T>(key: string, defaultValue: T): T {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : defaultValue;
    }
    const mem = memoryStorage.get(key);
    return mem ? JSON.parse(mem) : defaultValue;
  } catch (e) {
    console.error(`Error loading key ${key}:`, e);
    return defaultValue;
  }
}

function saveData<T>(key: string, data: T): void {
  try {
    const serialized = JSON.stringify(data);
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(key, serialized);
    }
    memoryStorage.set(key, serialized);
  } catch (e) {
    console.error(`Error saving key ${key}:`, e);
  }
}

// Resolve phone-accessible mobile application URL for QR codes
function getPhoneAccessibleBaseUrl(customOrigin?: string): string {
  if (customOrigin) return customOrigin.replace(/\/+$/, '');

  // 1. Env variable VITE_APP_URL
  const envUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_APP_URL) as string | undefined;
  if (envUrl && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/+$/, '');
  }

  // 2. In browser runtime
  if (typeof window !== 'undefined' && window.location) {
    const { protocol, hostname, port } = window.location;
    // When running on localhost / 127.0.0.1, a phone scanning the QR code cannot resolve "localhost"
    // We fall back automatically to the machine's local Wi-Fi IP address
    if (hostname === 'localhost' || hostname === '127.0.0.1') {
      return `${protocol}//10.146.38.84:${port || '5173'}`;
    }
    return window.location.origin.replace(/\/+$/, '');
  }

  // 3. Fallback to LAN IP
  return 'http://10.146.38.84:5173';
}

export class LocalDatabase {
  // Current active instructor
  static getCurrentInstructor(): Instructor | null {
    return loadData<Instructor | null>(STORAGE_KEYS.CURRENT_USER, DEFAULT_INSTRUCTOR);
  }

  static setCurrentInstructor(instructor: Instructor | null): void {
    saveData(STORAGE_KEYS.CURRENT_USER, instructor);
  }

  static updateInstructorProfile(updates: Partial<Instructor>): Instructor {
    const current = this.getCurrentInstructor() || DEFAULT_INSTRUCTOR;
    const updated: Instructor = {
      ...current,
      ...updates,
      updated_at: new Date().toISOString(),
    };
    this.setCurrentInstructor(updated);

    const instructors = loadData<Instructor[]>(STORAGE_KEYS.INSTRUCTORS, [DEFAULT_INSTRUCTOR]);
    const idx = instructors.findIndex((i) => i.id === updated.id);
    if (idx >= 0) {
      instructors[idx] = updated;
    } else {
      instructors.push(updated);
    }
    saveData(STORAGE_KEYS.INSTRUCTORS, instructors);
    return updated;
  }

  // -------------------------------------------------------------
  // Academic Sections (Institutional Cohorts)
  // -------------------------------------------------------------
  static getSections(filters?: {
    programme?: string;
    batch?: string;
    academic_year?: string;
    is_active?: boolean | null;
  }): AcademicSection[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    let sections = loadData<AcademicSection[]>(STORAGE_KEYS.SECTIONS, []);
    sections = sections.filter((sec) => sec.instructor_id === instructor.id);

    if (filters?.is_active !== undefined && filters?.is_active !== null) {
      sections = sections.filter((sec) => sec.is_active === filters.is_active);
    }
    if (filters?.programme) {
      sections = sections.filter((sec) => sec.programme.toLowerCase() === filters.programme!.toLowerCase());
    }
    if (filters?.batch) {
      sections = sections.filter((sec) => sec.batch.toLowerCase() === filters.batch!.toLowerCase());
    }
    if (filters?.academic_year) {
      sections = sections.filter((sec) => sec.academic_year === filters.academic_year);
    }

    // Attach real student count
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id && s.is_active
    );

    return sections
      .map((sec) => ({
        ...sec,
        student_count: students.filter((s) => s.section_id === sec.id).length,
      }))
      .sort((a, b) => a.programme.localeCompare(b.programme) || (a.name || '').localeCompare(b.name || ''));
  }

  static getSectionById(id: string): AcademicSection | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;
    const sections = loadData<AcademicSection[]>(STORAGE_KEYS.SECTIONS, []);
    const found = sections.find((s) => s.id === id && s.instructor_id === instructor.id);
    if (!found) return null;

    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id && s.is_active && s.section_id === found.id
    );
    return {
      ...found,
      student_count: students.length,
    };
  }

  static createSection(
    data: Omit<AcademicSection, 'id' | 'instructor_id' | 'created_at' | 'updated_at' | 'student_count' | 'name' | 'is_active'> & {
      name?: string;
      is_active?: boolean;
    }
  ): AcademicSection {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanSection = (data.section || (data as any).name || 'A').replace(/^Section\s+/i, '').trim().toUpperCase() || 'A';
    const cleanName = data.name || `Section ${cleanSection}`;
    const cleanProg = data.programme.trim();
    const cleanBatch = data.batch.trim();
    const cleanYear = data.academic_year.trim();

    const sections = loadData<AcademicSection[]>(STORAGE_KEYS.SECTIONS, []);
    const exists = sections.some(
      (s) =>
        s.instructor_id === instructor.id &&
        s.programme.toLowerCase() === cleanProg.toLowerCase() &&
        s.batch.toLowerCase() === cleanBatch.toLowerCase() &&
        s.academic_year.toLowerCase() === cleanYear.toLowerCase() &&
        (s.section?.toUpperCase() === cleanSection || s.name?.toUpperCase() === cleanName.toUpperCase())
    );

    if (exists) {
      throw new Error(`Section ${cleanSection} already exists for ${cleanProg} (${cleanBatch}, ${cleanYear}).`);
    }

    const newSection: AcademicSection = {
      ...data,
      id: 'sec_' + Math.random().toString(36).substring(2, 11),
      instructor_id: instructor.id,
      name: cleanName,
      section: cleanSection,
      programme: cleanProg,
      batch: cleanBatch,
      academic_year: cleanYear,
      semester: data.semester ? data.semester.trim() : null,
      is_active: data.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      student_count: 0,
    };

    sections.push(newSection);
    saveData(STORAGE_KEYS.SECTIONS, sections);
    return newSection;
  }

  static updateSection(id: string, updates: Partial<AcademicSection>): AcademicSection {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const sections = loadData<AcademicSection[]>(STORAGE_KEYS.SECTIONS, []);
    const idx = sections.findIndex((s) => s.id === id && s.instructor_id === instructor.id);
    if (idx === -1) throw new Error('Academic section not found');

    const updated: AcademicSection = {
      ...sections[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    sections[idx] = updated;
    saveData(STORAGE_KEYS.SECTIONS, sections);
    return updated;
  }

  static findOrCreateSection(
    programme: string,
    batch: string,
    academic_year: string,
    name: string,
    semester?: string
  ): AcademicSection {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanName = name.replace(/^Section\s+/i, '').trim().toUpperCase() || 'A';
    const cleanProg = programme.trim() || 'B.Tech Computer Science';
    const cleanBatch = batch.trim() || '2024-2028';
    const cleanYear = academic_year.trim() || '2026-2027';

    const sections = loadData<AcademicSection[]>(STORAGE_KEYS.SECTIONS, []);
    const found = sections.find(
      (s) =>
        s.instructor_id === instructor.id &&
        s.programme.toLowerCase() === cleanProg.toLowerCase() &&
        s.batch.toLowerCase() === cleanBatch.toLowerCase() &&
        s.academic_year.toLowerCase() === cleanYear.toLowerCase() &&
        s.name.toUpperCase() === cleanName
    );

    if (found) return found;

    const newSection: AcademicSection = {
      id: 'sec_' + Math.random().toString(36).substring(2, 11),
      instructor_id: instructor.id,
      name: `Section ${cleanName}`,
      section: cleanName,
      programme: cleanProg,
      batch: cleanBatch,
      academic_year: cleanYear,
      semester: semester ? semester.trim() : null,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      student_count: 0,
    };
    sections.push(newSection);
    saveData(STORAGE_KEYS.SECTIONS, sections);
    return newSection;
  }

  static getSectionStudents(sectionId: string): Student[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    const section = this.getSectionById(sectionId);
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id && s.is_active
    );

    if (section) {
      return students.filter(
        (s) =>
          s.section_id === sectionId ||
          (!s.section_id &&
            s.course.toLowerCase() === section.programme.toLowerCase() &&
            s.batch.toLowerCase() === section.batch.toLowerCase() &&
            s.academic_year.toLowerCase() === section.academic_year.toLowerCase() &&
            (s.section.toUpperCase() === (section.section || section.name).toUpperCase() ||
              s.section.toUpperCase() === `SECTION ${(section.section || section.name)}`.toUpperCase()))
      );
    }

    return students.filter((s) => s.section_id === sectionId);
  }

  // -------------------------------------------------------------
  // Students
  // -------------------------------------------------------------
  static getStudents(filters?: {
    search?: string;
    course?: string;
    academic_year?: string;
    section?: string;
    is_active?: boolean | null;
  }): Student[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    let students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id
    );

    if (filters?.is_active !== undefined && filters?.is_active !== null) {
      students = students.filter((s) => s.is_active === filters.is_active);
    }

    if (filters?.course) {
      students = students.filter((s) => s.course.toLowerCase() === filters.course!.toLowerCase());
    }

    if (filters?.academic_year) {
      students = students.filter((s) => s.academic_year === filters.academic_year);
    }

    if (filters?.section) {
      students = students.filter((s) => s.section.toLowerCase() === filters.section!.toLowerCase());
    }

    if (filters?.search && filters.search.trim().length > 0) {
      const q = filters.search.trim().toLowerCase();
      students = students.filter(
        (s) =>
          s.full_name.toLowerCase().includes(q) ||
          s.roll_number.toLowerCase().includes(q) ||
          (s.email && s.email.toLowerCase().includes(q))
      );
    }

    return students.sort((a, b) => a.roll_number.localeCompare(b.roll_number));
  }

  static getStudentById(id: string): Student | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    return students.find((s) => s.id === id && s.instructor_id === instructor.id) || null;
  }

  static checkRollNumberExists(rollNumber: string, excludeStudentId?: string): boolean {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return false;
    const cleanRoll = rollNumber.trim().toUpperCase();
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    return students.some(
      (s) =>
        s.instructor_id === instructor.id &&
        s.roll_number.trim().toUpperCase() === cleanRoll &&
        s.id !== excludeStudentId
    );
  }

  static createStudent(
    studentData: Omit<Student, 'id' | 'instructor_id' | 'created_at' | 'updated_at'> & { class_id?: string },
    classId?: string
  ): Student {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanRoll = studentData.roll_number.trim().toUpperCase();
    if (this.checkRollNumberExists(cleanRoll)) {
      throw new Error(`This roll number already exists (${cleanRoll}).`);
    }

    const targetClassId = (studentData as any).class_id || classId;

    let sectionId = (studentData as any).section_id || null;
    let course = (studentData.course || '').trim();
    let batch = (studentData.batch || 'Batch 2024-2028').trim();
    let academicYear = (studentData.academic_year || 'Year 2').trim();
    let sectionName = (studentData.section || 'A').trim();

    if (sectionId) {
      const sec = this.getSectionById(sectionId);
      if (sec) {
        course = sec.programme;
        batch = sec.batch;
        academicYear = sec.academic_year;
        sectionName = sec.section || sec.name;
      }
    } else if (course && sectionName) {
      const sec = this.findOrCreateSection(course, batch, academicYear, sectionName);
      sectionId = sec.id;
    }

    const newStudent: Student = {
      ...studentData,
      id: 'stu_' + Math.random().toString(36).substring(2, 11),
      instructor_id: instructor.id,
      roll_number: cleanRoll,
      full_name: studentData.full_name.trim(),
      email: studentData.email ? studentData.email.trim() : null,
      course,
      batch,
      academic_year: academicYear,
      section: sectionName,
      section_id: sectionId,
      face_descriptor: studentData.face_descriptor,
      face_enrolled_at: studentData.face_descriptor ? new Date().toISOString() : undefined,
      face_enrollment_status:
        studentData.face_enrollment_status ||
        (studentData.face_descriptor ? 'enrolled' : 'not_enrolled'),
      face_quality_score: studentData.face_quality_score,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    students.push(newStudent);
    saveData(STORAGE_KEYS.STUDENTS, students);

    if (targetClassId) {
      this.enrollStudentsInClass(targetClassId, [newStudent.id]);
    }

    return newStudent;
  }

  static updateStudent(
    id: string,
    updates: Partial<Student> & { class_id?: string },
    classId?: string
  ): Student {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const idx = students.findIndex((s) => s.id === id && s.instructor_id === instructor.id);
    if (idx === -1) throw new Error('Student not found');

    const targetClassId = updates.class_id !== undefined ? updates.class_id : classId;
    const { class_id: _, ...cleanUpdates } = updates as any;

    if (cleanUpdates.roll_number) {
      const cleanRoll = cleanUpdates.roll_number.trim().toUpperCase();
      if (this.checkRollNumberExists(cleanRoll, id)) {
        throw new Error(`This roll number already exists (${cleanRoll}).`);
      }
      cleanUpdates.roll_number = cleanRoll;
    }

    if (cleanUpdates.full_name) cleanUpdates.full_name = cleanUpdates.full_name.trim();
    if (cleanUpdates.email) cleanUpdates.email = cleanUpdates.email.trim();

    // If section_id was changed or provided, synchronize cohort attributes
    if (cleanUpdates.section_id !== undefined) {
      if (cleanUpdates.section_id) {
        const sec = this.getSectionById(cleanUpdates.section_id);
        if (sec) {
          cleanUpdates.course = sec.programme;
          cleanUpdates.batch = sec.batch;
          cleanUpdates.academic_year = sec.academic_year;
          cleanUpdates.section = sec.name;
        }
      }
    } else if (cleanUpdates.course || cleanUpdates.section || cleanUpdates.batch || cleanUpdates.academic_year) {
      const p = cleanUpdates.course || students[idx].course;
      const b = cleanUpdates.batch || students[idx].batch;
      const y = cleanUpdates.academic_year || students[idx].academic_year;
      const s = cleanUpdates.section || students[idx].section;
      if (p && s) {
        const sec = this.findOrCreateSection(p, b, y, s);
        cleanUpdates.section_id = sec.id;
      }
    }

    const updatedStudent: Student = {
      ...students[idx],
      ...cleanUpdates,
      updated_at: new Date().toISOString(),
    };

    students[idx] = updatedStudent;
    saveData(STORAGE_KEYS.STUDENTS, students);

    // Handle class enrollment change if specified
    if (targetClassId !== undefined) {
      const currentEnrs = this.getStudentEnrollments(id);
      if (targetClassId && !currentEnrs.includes(targetClassId)) {
        for (const oldClassId of currentEnrs) {
          this.removeStudentFromClass(oldClassId, id);
        }
        this.enrollStudentsInClass(targetClassId, [id]);
      } else if (targetClassId === '' && currentEnrs.length > 0) {
        for (const oldClassId of currentEnrs) {
          this.removeStudentFromClass(oldClassId, id);
        }
      }
    }

    return updatedStudent;
  }

  static toggleStudentStatus(id: string, isActive: boolean): Student {
    return this.updateStudent(id, { is_active: isActive });
  }

  // -------------------------------------------------------------
  // Classes and Courses
  // -------------------------------------------------------------
  static getClasses(): ClassCourse[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []).filter(
      (c) => c.instructor_id === instructor.id
    );

    return classes.map((c) => ({
      ...c,
      enrolled_count: this.getClassEnrollments(c.id).length,
    }));
  }

  static getClassById(id: string): ClassCourse | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;
    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const found = classes.find((c) => c.id === id && c.instructor_id === instructor.id);
    if (!found) return null;

    const section = found.section_id ? this.getSectionById(found.section_id) : null;

    return {
      ...found,
      section_details: section,
      enrolled_count: this.getClassEnrollments(found.id).length,
    };
  }

  static createClass(
    classData: Omit<ClassCourse, 'id' | 'instructor_id' | 'created_at' | 'updated_at' | 'enrolled_count'>
  ): ClassCourse {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const cleanCode = classData.code.trim().toUpperCase();
    let cleanSection = (classData.section || 'A').replace(/^Section\s+/i, '').trim().toUpperCase();
    let cleanProg = classData.programme ? classData.programme.trim() : '';
    let cleanBatch = classData.batch ? classData.batch.trim() : '';
    let cleanYear = (classData.academic_year || '2026-2027').trim();
    let sectionId = classData.section_id || null;

    if (sectionId) {
      const sec = this.getSectionById(sectionId);
      if (sec) {
        cleanProg = sec.programme;
        cleanBatch = sec.batch;
        cleanYear = sec.academic_year;
        cleanSection = sec.section || sec.name;
      }
    } else if (cleanProg && cleanSection) {
      // Auto find or create section for the class
      const sec = this.findOrCreateSection(cleanProg, cleanBatch || '2024-2028', cleanYear, cleanSection);
      sectionId = sec.id;
    }

    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const exists = classes.some(
      (c) =>
        c.instructor_id === instructor.id &&
        c.code.toUpperCase() === cleanCode &&
        c.section.toUpperCase() === cleanSection
    );

    if (exists) {
      throw new Error(`A class with code ${cleanCode} and section ${cleanSection} already exists.`);
    }

    const newClass: ClassCourse = {
      ...classData,
      id: 'cls_' + Math.random().toString(36).substring(2, 11),
      instructor_id: instructor.id,
      name: classData.name.trim(),
      code: cleanCode,
      section: cleanSection,
      section_id: sectionId,
      programme: cleanProg || null,
      batch: cleanBatch || null,
      semester: classData.semester ? classData.semester.trim() : null,
      enrollment_type: classData.enrollment_type || 'section',
      academic_year: cleanYear,
      description: classData.description ? classData.description.trim() : null,
      is_active: classData.is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      enrolled_count: 0,
    };

    classes.push(newClass);
    saveData(STORAGE_KEYS.CLASSES, classes);
    return newClass;
  }

  static updateClass(id: string, updates: Partial<ClassCourse>): ClassCourse {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const idx = classes.findIndex((c) => c.id === id && c.instructor_id === instructor.id);
    if (idx === -1) throw new Error('Class not found');

    if (updates.code || updates.section) {
      const newCode = (updates.code || classes[idx].code).trim().toUpperCase();
      const newSection = (updates.section || classes[idx].section).replace(/^Section\s+/i, '').trim().toUpperCase();
      const duplicate = classes.some(
        (c) =>
          c.id !== id &&
          c.instructor_id === instructor.id &&
          c.code.toUpperCase() === newCode &&
          c.section.toUpperCase() === newSection
      );
      if (duplicate) {
        throw new Error(`Another class already uses code ${newCode} and section ${newSection}.`);
      }
      updates.code = newCode;
      updates.section = newSection;
    }

    if (updates.section_id) {
      const sec = this.getSectionById(updates.section_id);
      if (sec) {
        updates.programme = sec.programme;
        updates.batch = sec.batch;
        updates.academic_year = sec.academic_year;
        updates.section = sec.name;
      }
    }

    const updated: ClassCourse = {
      ...classes[idx],
      ...updates,
      updated_at: new Date().toISOString(),
    };

    classes[idx] = updated;
    saveData(STORAGE_KEYS.CLASSES, classes);
    return updated;
  }

  static getClassEnrollments(classId: string): Student[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    const cls = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []).find(
      (c) => c.id === classId && c.instructor_id === instructor.id
    );
    const allStudents = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id && s.is_active
    );

    // If manual enrollment mode is explicitly set
    if (cls && cls.enrollment_type === 'manual') {
      const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []).filter(
        (e) => e.class_id === classId
      );
      const enrolledStudentIds = new Set(enrollments.map((e) => e.student_id));
      return allStudents.filter((s) => enrolledStudentIds.has(s.id));
    }

    const rosterMap = new Map<string, Student>();

    if (cls) {
      // 1. Direct section_id match
      if (cls.section_id) {
        allStudents.forEach((s) => {
          if (s.section_id === cls.section_id) {
            rosterMap.set(s.id, s);
          }
        });
      }

      // 2. Cohort match (programme/course, batch, academic_year, section)
      const targetSec = (cls.section || 'A').replace(/^Section\s+/i, '').trim().toUpperCase();
      const targetYear = (cls.academic_year || '').trim().toLowerCase();
      const targetProg = (cls.programme || '').trim().toLowerCase();
      const targetBatch = (cls.batch || '').trim().toLowerCase();

      allStudents.forEach((s) => {
        const sSec = (s.section || '').replace(/^Section\s+/i, '').trim().toUpperCase();
        const sYear = (s.academic_year || '').trim().toLowerCase();
        const sCourse = (s.course || '').trim().toLowerCase();
        const sBatch = (s.batch || '').trim().toLowerCase();

        const secMatches = sSec === targetSec;
        const yearMatches = !targetYear || sYear === targetYear;
        const progMatches = !targetProg || sCourse === targetProg;
        const batchMatches = !targetBatch || sBatch === targetBatch;

        if (secMatches && yearMatches && progMatches && batchMatches) {
          rosterMap.set(s.id, s);
        }
      });
    }

    // 3. Union with any explicit manual enrollments in class_enrollments (e.g. cross-section electives)
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []).filter(
      (e) => e.class_id === classId
    );
    enrollments.forEach((e) => {
      const found = allStudents.find((s) => s.id === e.student_id);
      if (found) {
        rosterMap.set(found.id, found);
      }
    });

    return Array.from(rosterMap.values()).sort((a, b) => a.roll_number.localeCompare(b.roll_number));
  }

  static getClassEnrolledStudents(classId: string): Student[] {
    return this.getClassEnrollments(classId);
  }

  static enrollStudentsInClass(classId: string, studentIds: string[]): void {
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []);

    studentIds.forEach((studentId) => {
      // Prevent duplicate enrollment
      const exists = enrollments.some(
        (e) => e.class_id === classId && e.student_id === studentId
      );
      if (!exists) {
        enrollments.push({
          id: 'enr_' + Math.random().toString(36).substring(2, 11),
          class_id: classId,
          student_id: studentId,
          enrolled_at: new Date().toISOString(),
        });
      }
    });

    saveData(STORAGE_KEYS.ENROLLMENTS, enrollments);

    // Initialize baseline records for any active sessions of this class
    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []).filter(
      (s) => s.class_id === classId && s.status === 'active'
    );
    if (sessions.length > 0) {
      const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
      sessions.forEach((sess) => {
        studentIds.forEach((studentId) => {
          const hasRecord = records.some(
            (r) => r.session_id === sess.id && r.student_id === studentId
          );
          if (!hasRecord) {
            records.push({
              id: 'rec_' + Math.random().toString(36).substring(2, 11),
              session_id: sess.id,
              student_id: studentId,
              status: 'unmarked',
              marked_by: sess.instructor_id,
              marked_at: new Date().toISOString(),
              method: 'manual',
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            });
          }
        });
      });
      saveData(STORAGE_KEYS.RECORDS, records);
    }
  }

  static enrollStudentInClass(classId: string, studentId: string): void {
    this.enrollStudentsInClass(classId, [studentId]);
  }

  static getStudentEnrollments(studentId: string): string[] {
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []);
    return enrollments
      .filter((e) => e.student_id === studentId)
      .map((e) => e.class_id);
  }

  static removeStudentFromClass(classId: string, studentId: string): void {
    let enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []);
    enrollments = enrollments.filter(
      (e) => !(e.class_id === classId && e.student_id === studentId)
    );
    saveData(STORAGE_KEYS.ENROLLMENTS, enrollments);
  }

  /**
   * Safe Repair Workflow for LocalDatabase:
   * Inspects existing registered students who have missing enrollment records.
   * Confidently matches student course/batch against active class names and enrolls them.
   */
  static repairClassEnrollments(
    targetClassId?: string
  ): { repairedCount: number; repairedStudents: Student[] } {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return { repairedCount: 0, repairedStudents: [] };

    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []).filter(
      (s) => s.instructor_id === instructor.id
    );
    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []).filter(
      (c) => c.instructor_id === instructor.id && c.is_active
    );

    const classesToMatch = targetClassId
      ? classes.filter((c) => c.id === targetClassId)
      : classes;

    if (classesToMatch.length === 0) {
      return { repairedCount: 0, repairedStudents: [] };
    }

    const repairedStudents: Student[] = [];

    for (const student of students) {
      const enrolled = this.getStudentEnrollments(student.id);
      if (enrolled.length > 0) continue;

      const studentCourse = (student.course || '').trim().toLowerCase();
      const studentBatch = (student.batch || '').trim().toLowerCase();

      const matching = classesToMatch.filter((cls) => {
        const clsName = cls.name.trim().toLowerCase();
        const clsCode = cls.code.trim().toLowerCase();
        return (
          studentCourse === clsName ||
          studentCourse === clsCode ||
          clsName.includes(studentCourse) ||
          studentCourse.includes(clsName) ||
          studentBatch.includes(clsName) ||
          studentBatch.includes(clsCode)
        );
      });

      if (matching.length === 1) {
        this.enrollStudentsInClass(matching[0].id, [student.id]);
        repairedStudents.push(student);
      }
    }

    return {
      repairedCount: repairedStudents.length,
      repairedStudents,
    };
  }

  // -------------------------------------------------------------
  // Attendance Sessions & Records
  // -------------------------------------------------------------
  static getAttendanceSessions(filters?: {
    classId?: string;
    date?: string;
    status?: string;
  }): AttendanceSession[] {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return [];

    let sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []).filter(
      (s) => s.instructor_id === instructor.id
    );

    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []);

    if (filters?.classId) {
      sessions = sessions.filter((s) => s.class_id === filters.classId);
    }
    if (filters?.date) {
      sessions = sessions.filter((s) => s.session_date === filters.date);
    }
    if (filters?.status) {
      sessions = sessions.filter((s) => s.status === filters.status);
    }

    return sessions
      .map((s) => {
        const classObj = classes.find((c) => c.id === s.class_id);
        const sessionRecords = records.filter((r) => r.session_id === s.id);
        const totalEnrolled = enrollments.filter((e) => e.class_id === s.class_id).length;

        const present = sessionRecords.filter((r) => r.status === 'present').length;
        const absent = sessionRecords.filter((r) => r.status === 'absent').length;
        const late = sessionRecords.filter((r) => r.status === 'late').length;
        const unmarked = Math.max(0, totalEnrolled - (present + absent + late));

        return {
          ...s,
          class_name: classObj?.name || 'Unknown Class',
          class_code: classObj?.code || '',
          stats: {
            present,
            absent,
            late,
            unmarked,
            total: totalEnrolled,
          },
        };
      })
      .sort((a, b) => new Date(`${b.session_date} ${b.start_time}`).getTime() - new Date(`${a.session_date} ${a.start_time}`).getTime());
  }

  static getSessionById(sessionId: string): AttendanceSession | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;

    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
    const session = sessions.find((s) => s.id === sessionId && s.instructor_id === instructor.id);
    if (!session) return null;

    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const classObj = classes.find((c) => c.id === session.class_id);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []).filter((r) => r.session_id === session.id);
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []).filter((e) => e.class_id === session.class_id);

    const present = records.filter((r) => r.status === 'present').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    const late = records.filter((r) => r.status === 'late').length;
    const unmarked = Math.max(0, enrollments.length - (present + absent + late));

    return {
      ...session,
      class_name: classObj?.name || 'Unknown Class',
      class_code: classObj?.code || '',
      stats: {
        present,
        absent,
        late,
        unmarked,
        total: enrollments.length,
      },
    };
  }

  static createAttendanceSession(data: {
    class_id: string;
    title: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }): AttendanceSession {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
    const newSession: AttendanceSession = {
      ...data,
      id: 'ses_' + Math.random().toString(36).substring(2, 11),
      instructor_id: instructor.id,
      title: data.title.trim(),
      status: 'active',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    sessions.push(newSession);
    saveData(STORAGE_KEYS.SESSIONS, sessions);

    // Initial unmarked baseline records for all enrolled/section students
    const eligibleStudents = this.getClassEnrollments(data.class_id);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);

    eligibleStudents.forEach((student) => {
      records.push({
        id: 'rec_' + Math.random().toString(36).substring(2, 11),
        session_id: newSession.id,
        student_id: student.id,
        status: 'unmarked',
        marked_by: instructor.id,
        marked_at: new Date().toISOString(),
        method: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    });
    saveData(STORAGE_KEYS.RECORDS, records);

    return newSession;
  }

  static refreshSessionRoster(sessionId: string): { addedCount: number; currentCount: number } {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    const eligibleStudents = this.getClassEnrollments(session.class_id);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    const existingStudentIds = new Set(
      records.filter((r) => r.session_id === sessionId).map((r) => r.student_id)
    );

    let addedCount = 0;
    eligibleStudents.forEach((student) => {
      if (!existingStudentIds.has(student.id)) {
        records.push({
          id: 'rec_' + Math.random().toString(36).substring(2, 11),
          session_id: sessionId,
          student_id: student.id,
          status: 'unmarked',
          marked_by: instructor.id,
          marked_at: new Date().toISOString(),
          method: 'manual',
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
        addedCount++;
      }
    });

    if (addedCount > 0) {
      saveData(STORAGE_KEYS.RECORDS, records);
    }

    const sessionRecords = records.filter((r) => r.session_id === sessionId);
    return Object.assign([...sessionRecords], {
      addedCount,
      currentCount: eligibleStudents.length,
      records: sessionRecords,
    }) as any;
  }

  static getAttendanceRecords(sessionId: string): AttendanceRecord[] {
    return this.getSessionAttendanceRecords(sessionId);
  }

  static updateAttendanceRecord(
    sessionId: string,
    studentId: string,
    updates: Partial<AttendanceRecord>
  ): AttendanceRecord {
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    let idx = records.findIndex((r) => r.session_id === sessionId && r.student_id === studentId);
    const instructor = this.getCurrentInstructor();

    if (idx >= 0) {
      records[idx] = {
        ...records[idx],
        ...updates,
        updated_at: new Date().toISOString(),
      };
      saveData(STORAGE_KEYS.RECORDS, records);
      return records[idx];
    } else {
      const newRecord: AttendanceRecord = {
        id: 'rec_' + Math.random().toString(36).substring(2, 11),
        session_id: sessionId,
        student_id: studentId,
        status: (updates.status as any) || 'unmarked',
        marked_by: instructor?.id || 'system',
        marked_at: new Date().toISOString(),
        method: updates.method || 'manual',
        confidence_score: updates.confidence_score,
        notes: updates.notes || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      records.push(newRecord);
      saveData(STORAGE_KEYS.RECORDS, records);
      return newRecord;
    }
  }

  static updateSessionStatus(sessionId: string, status: SessionStatus): AttendanceSession {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
    const idx = sessions.findIndex((s) => s.id === sessionId && s.instructor_id === instructor.id);
    if (idx === -1) throw new Error('Session not found');

    // If finalizing the session, confirm any remaining 'unmarked' as 'absent' if needed, or keep explicit
    // Per requirement: Distinguish pending/unmarked until finalized. When finalized, any still unmarked student is marked absent.
    if (status === 'finalized') {
      const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
      const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);

      records.forEach((r) => {
        if (r.session_id === sessionId && r.status === 'unmarked') {
          const prev = r.status;
          r.status = 'absent';
          r.updated_at = new Date().toISOString();
          auditLogs.push({
            id: 'aud_' + Math.random().toString(36).substring(2, 11),
            record_id: r.id,
            session_id: sessionId,
            student_id: r.student_id,
            previous_status: prev,
            new_status: 'absent',
            changed_by: instructor.id,
            changed_at: new Date().toISOString(),
            reason: 'Session finalized: unmarked students converted to absent',
          });
        }
      });
      saveData(STORAGE_KEYS.RECORDS, records);
      saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);
    }

    sessions[idx].status = status;
    sessions[idx].updated_at = new Date().toISOString();
    saveData(STORAGE_KEYS.SESSIONS, sessions);

    return this.getSessionById(sessionId)!;
  }

  static finalizeAttendanceSession(sessionId: string): AttendanceSession {
    return this.updateSessionStatus(sessionId, 'finalized');
  }

  static getSessionAttendanceRecords(sessionId: string): AttendanceRecord[] {
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    return records.filter((r) => r.session_id === sessionId);
  }

  static getSessionRecords(sessionId: string): AttendanceRecord[] {
    return this.getSessionAttendanceRecords(sessionId);
  }

  static getSessionAttendance(
    sessionId: string
  ): { student: Student; record: AttendanceRecord | null }[] {
    const session = this.getSessionById(sessionId);
    if (!session) return [];

    const enrolledStudents = this.getClassEnrollments(session.class_id);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []).filter(
      (r) => r.session_id === sessionId
    );

    return enrolledStudents.map((student) => {
      const record = records.find((r) => r.student_id === student.id) || null;
      return {
        student,
        record,
      };
    });
  }

  static saveAttendanceRecords(
    sessionId: string,
    updates: { student_id: string; status: AttendanceStatus; notes?: string }[]
  ): void {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);

    updates.forEach((update) => {
      const existingIdx = records.findIndex(
        (r) => r.session_id === sessionId && r.student_id === update.student_id
      );

      if (existingIdx >= 0) {
        const prevStatus = records[existingIdx].status;
        if (prevStatus !== update.status) {
          records[existingIdx].status = update.status;
          records[existingIdx].notes = update.notes ?? records[existingIdx].notes;
          records[existingIdx].marked_by = instructor.id;
          records[existingIdx].marked_at = new Date().toISOString();
          records[existingIdx].updated_at = new Date().toISOString();

          auditLogs.push({
            id: 'aud_' + Math.random().toString(36).substring(2, 11),
            record_id: records[existingIdx].id,
            session_id: sessionId,
            student_id: update.student_id,
            previous_status: prevStatus,
            new_status: update.status,
            changed_by: instructor.id,
            changed_at: new Date().toISOString(),
            reason: 'Manual instructor marking/correction',
          });
        }
      } else {
        // Enforce: exactly one record per student in session
        const newRecord: AttendanceRecord = {
          id: 'rec_' + Math.random().toString(36).substring(2, 11),
          session_id: sessionId,
          student_id: update.student_id,
          status: update.status,
          marked_by: instructor.id,
          marked_at: new Date().toISOString(),
          method: 'manual',
          notes: update.notes ?? null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        records.push(newRecord);

        auditLogs.push({
          id: 'aud_' + Math.random().toString(36).substring(2, 11),
          record_id: newRecord.id,
          session_id: sessionId,
          student_id: update.student_id,
          previous_status: null,
          new_status: update.status,
          changed_by: instructor.id,
          changed_at: new Date().toISOString(),
          reason: 'Initial manual mark',
        });
      }
    });

    saveData(STORAGE_KEYS.RECORDS, records);
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);
  }

  static getAttendanceAuditLogs(sessionId?: string): AttendanceAuditLog[] {
    const logs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    if (sessionId) {
      return logs.filter((l) => l.session_id === sessionId).sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
    }
    return logs.sort((a, b) => new Date(b.changed_at).getTime() - new Date(a.changed_at).getTime());
  }

  // -------------------------------------------------------------
  // Student Attendance Summary
  // -------------------------------------------------------------
  static getStudentAttendanceSummary(studentId: string): {
    total: number;
    present: number;
    absent: number;
    late: number;
    unmarked: number;
    percentage: number;
  } {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return { total: 0, present: 0, absent: 0, late: 0, unmarked: 0, percentage: 0 };

    // Applicable sessions are only finalized or active sessions for classes this student is enrolled in
    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []).filter(
      (e) => e.student_id === studentId
    );
    const enrolledClassIds = new Set(enrollments.map((e) => e.class_id));

    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []).filter(
      (s) => s.instructor_id === instructor.id && enrolledClassIds.has(s.class_id) && s.status !== 'cancelled'
    );

    const sessionIds = new Set(sessions.map((s) => s.id));
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []).filter(
      (r) => r.student_id === studentId && sessionIds.has(r.session_id)
    );

    const present = records.filter((r) => r.status === 'present').length;
    const late = records.filter((r) => r.status === 'late').length;
    const absent = records.filter((r) => r.status === 'absent').length;
    const unmarked = records.filter((r) => r.status === 'unmarked').length;

    // Denominator: Only finalized sessions (or confirmed marked records)
    const finalizedSessionIds = new Set(sessions.filter((s) => s.status === 'finalized').map((s) => s.id));
    const finalizedRecords = records.filter((r) => finalizedSessionIds.has(r.session_id));
    const finalizedCount = finalizedRecords.length;

    const finalizedPresentOrLate = finalizedRecords.filter(
      (r) => r.status === 'present' || r.status === 'late'
    ).length;

    const percentage = finalizedCount > 0 ? Math.round((finalizedPresentOrLate / finalizedCount) * 100) : 0;

    return {
      total: sessions.length,
      present,
      absent,
      late,
      unmarked,
      percentage,
    };
  }

  // -------------------------------------------------------------
  // Dashboard Statistics (Calculated strictly from real records)
  // -------------------------------------------------------------
  static getDashboardStats(): DashboardStats {
    const instructor = this.getCurrentInstructor();
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

    const students = this.getStudents();
    const classes = this.getClasses().filter((c) => c.is_active);
    const sessions = this.getAttendanceSessions();

    // Most recent session
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

    // Overall attendance percentage across all finalized sessions
    const finalizedSessions = sessions.filter((s) => s.status === 'finalized');
    const finalizedSessionIds = new Set(finalizedSessions.map((s) => s.id));

    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []).filter(
      (r) => finalizedSessionIds.has(r.session_id)
    );

    let overallAttendancePct = 0;
    if (records.length > 0) {
      const positiveCount = records.filter((r) => r.status === 'present' || r.status === 'late').length;
      overallAttendancePct = Math.round((positiveCount / records.length) * 100);
    }

    return {
      totalStudents: students.length,
      totalActiveClasses: classes.length,
      totalSessions: sessions.length,
      selectedSessionPresent,
      selectedSessionAbsent,
      selectedSessionLate,
      selectedSessionTitle,
      overallAttendancePct,
    };
  }

  // -------------------------------------------------------------
  // Presence Keys Management
  // -------------------------------------------------------------
  static async generatePresenceKey(
    sessionId: string,
    durationMinutes: number = 10
  ): Promise<PresenceKey> {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.status === 'finalized' || session.status === 'cancelled') {
      throw new Error(`Cannot generate attendance key for a ${session.status} session.`);
    }

    // Invalidate any existing active keys for this session
    const keys = loadData<PresenceKey[]>(STORAGE_KEYS.PRESENCE_KEYS, []);
    const now = new Date();
    keys.forEach((k) => {
      if (k.session_id === sessionId && k.status === 'active') {
        k.status = 'revoked';
        k.revoked_at = now.toISOString();
        k.revoked_by = instructor.id;
      }
    });

    // Generate cryptographic 6-digit key and salt
    const plainKey = generateCryptographicKey();
    const salt = generateSalt();
    const keyHash = await hashPresenceKey(salt, plainKey, sessionId);
    const expiresAt = new Date(now.getTime() + durationMinutes * 60 * 1000).toISOString();

    const newKey: PresenceKey = {
      id: 'pkey_' + Math.random().toString(36).substring(2, 11),
      session_id: sessionId,
      instructor_id: instructor.id,
      key_hash: keyHash,
      key_salt: salt,
      expires_at: expiresAt,
      status: 'active',
      created_at: now.toISOString(),
      plain_key: plainKey, // Returned in memory for authorized instructor display
    };

    keys.push(newKey);
    saveData(STORAGE_KEYS.PRESENCE_KEYS, keys);

    // Audit log
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    auditLogs.push({
      id: 'aud_' + Math.random().toString(36).substring(2, 11),
      session_id: sessionId,
      student_id: '',
      previous_status: null,
      new_status: 'present',
      changed_by: instructor.id,
      changed_at: now.toISOString(),
      reason: `Presence key generated (Valid for ${durationMinutes} min until ${new Date(expiresAt).toLocaleTimeString()})`,
    });
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);

    return newKey;
  }

  static getActivePresenceKey(sessionId: string): PresenceKey | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;

    const keys = loadData<PresenceKey[]>(STORAGE_KEYS.PRESENCE_KEYS, []);
    const now = new Date();

    let updated = false;
    for (const k of keys) {
      if (k.session_id === sessionId && k.status === 'active') {
        if (new Date(k.expires_at) <= now) {
          k.status = 'expired';
          updated = true;
        } else {
          if (updated) saveData(STORAGE_KEYS.PRESENCE_KEYS, keys);
          return k;
        }
      }
    }

    if (updated) saveData(STORAGE_KEYS.PRESENCE_KEYS, keys);
    return null;
  }

  static revokePresenceKey(sessionId: string): PresenceKey | null {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const keys = loadData<PresenceKey[]>(STORAGE_KEYS.PRESENCE_KEYS, []);
    const now = new Date().toISOString();
    let revokedKey: PresenceKey | null = null;

    keys.forEach((k) => {
      if (k.session_id === sessionId && k.status === 'active') {
        k.status = 'revoked';
        k.revoked_at = now;
        k.revoked_by = instructor.id;
        revokedKey = k;
      }
    });

    if (revokedKey) {
      saveData(STORAGE_KEYS.PRESENCE_KEYS, keys);

      const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
      auditLogs.push({
        id: 'aud_' + Math.random().toString(36).substring(2, 11),
        session_id: sessionId,
        student_id: '',
        previous_status: null,
        new_status: 'absent',
        changed_by: instructor.id,
        changed_at: now,
        reason: 'Presence key revoked by instructor',
      });
      saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);
    }

    return revokedKey;
  }

  static getPresenceKeys(): PresenceKey[] {
    return loadData<PresenceKey[]>(STORAGE_KEYS.PRESENCE_KEYS, []);
  }

  // -------------------------------------------------------------
  // Student Presence Check-in Handler
  // -------------------------------------------------------------
  static async validateStudentCheckIn(
    plainKey: string,
    authenticatedStudentId: string
  ): Promise<CheckInResult> {
    if (!plainKey || typeof plainKey !== 'string') {
      return {
        success: false,
        code: 'INVALID_KEY',
        message: 'Presence key code is required.',
      };
    }
    const cleanKey = plainKey.trim();
    if (!cleanKey) {
      return {
        success: false,
        code: 'INVALID_KEY',
        message: 'Presence key code is required.',
      };
    }

    // 1. Authenticate student
    const allStudents = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const student = allStudents.find((s) => s.id === authenticatedStudentId);
    if (!student || !student.is_active) {
      return {
        success: false,
        code: 'UNAUTHENTICATED',
        message: 'Invalid or inactive student credentials.',
      };
    }

    // 2. Rate Limiting Check (max 5 failed attempts in last 5 minutes)
    const attempts = loadData<Array<{ student_id: string; timestamp: number; success: boolean }>>(
      STORAGE_KEYS.CHECKIN_ATTEMPTS,
      []
    );
    const nowMs = Date.now();
    const fiveMinutesAgo = nowMs - 5 * 60 * 1000;
    const recentFailedAttempts = attempts.filter(
      (a) => a.student_id === authenticatedStudentId && !a.success && a.timestamp > fiveMinutesAgo
    );

    if (recentFailedAttempts.length >= 5) {
      return {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many invalid attempts. Please wait 5 minutes before trying again.',
      };
    }

    // 3. Resolve active presence keys across active sessions
    const keys = loadData<PresenceKey[]>(STORAGE_KEYS.PRESENCE_KEYS, []);
    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);

    let matchedKey: PresenceKey | null = null;
    let matchedSession: AttendanceSession | null = null;

    for (const k of keys) {
      if (k.status === 'active') {
        const isExpired = new Date(k.expires_at).getTime() <= nowMs;
        if (isExpired) {
          k.status = 'expired';
          continue;
        }

        // Verify SHA-256 hash match with session binding
        const computedHash = await hashPresenceKey(k.key_salt, cleanKey, k.session_id);
        if (timingSafeEqual(computedHash, k.key_hash)) {
          matchedKey = k;
          matchedSession = sessions.find((s) => s.id === k.session_id) || null;
          break;
        }
      }
    }

    saveData(STORAGE_KEYS.PRESENCE_KEYS, keys);

    if (!matchedKey || !matchedSession) {
      attempts.push({ student_id: authenticatedStudentId, timestamp: nowMs, success: false });
      saveData(STORAGE_KEYS.CHECKIN_ATTEMPTS, attempts);

      return {
        success: false,
        code: 'INVALID_OR_EXPIRED_KEY',
        message: 'Invalid or expired presence key.',
      };
    }

    // 4. Verify Session is Open (Active)
    if (matchedSession.status !== 'active') {
      attempts.push({ student_id: authenticatedStudentId, timestamp: nowMs, success: false });
      saveData(STORAGE_KEYS.CHECKIN_ATTEMPTS, attempts);

      return {
        success: false,
        code: 'SESSION_CLOSED',
        message: 'This attendance session has been finalized or closed.',
      };
    }

    // 5. Verify Student is Enrolled in the Class (via Section Roster or Explicit Enrollment)
    const eligibleStudents = this.getClassEnrollments(matchedSession!.class_id);
    const isEnrolled = eligibleStudents.some((s) => s.id === authenticatedStudentId);
    if (!isEnrolled) {
      attempts.push({ student_id: authenticatedStudentId, timestamp: nowMs, success: false });
      saveData(STORAGE_KEYS.CHECKIN_ATTEMPTS, attempts);

      return {
        success: false,
        code: 'NOT_ENROLLED',
        message: 'You are not enrolled in the class for this lecture session.',
      };
    }

    // 6. Check Existing Attendance Record
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    const existingIdx = records.findIndex(
      (r) => r.session_id === matchedSession!.id && r.student_id === authenticatedStudentId
    );

    const classObj = classes.find((c) => c.id === matchedSession!.class_id);
    const nowIso = new Date().toISOString();

    // Idempotency: If already recorded as 'present'
    if (existingIdx >= 0 && records[existingIdx].status === 'present') {
      return {
        success: true,
        already_checked_in: true,
        code: 'ALREADY_CHECKED_IN',
        message: 'Attendance has already been recorded for this lecture.',
        session: {
          id: matchedSession.id,
          title: matchedSession.title,
          session_date: matchedSession.session_date,
          class_name: classObj?.name,
        },
        record: {
          id: records[existingIdx].id,
          status: 'present',
          marked_at: records[existingIdx].marked_at,
          method: records[existingIdx].method,
        },
        student: {
          id: student.id,
          full_name: student.full_name,
          roll_number: student.roll_number,
        },
      };
    }

    // 7. Update or Create Attendance Record
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);

    if (existingIdx >= 0) {
      const prevStatus = records[existingIdx].status;
      records[existingIdx].status = 'present';
      records[existingIdx].method = 'presence_key';
      records[existingIdx].marked_at = nowIso;
      records[existingIdx].updated_at = nowIso;

      auditLogs.push({
        id: 'aud_' + Math.random().toString(36).substring(2, 11),
        record_id: records[existingIdx].id,
        session_id: matchedSession.id,
        student_id: authenticatedStudentId,
        previous_status: prevStatus,
        new_status: 'present',
        changed_by: matchedKey.instructor_id,
        changed_at: nowIso,
        reason: 'Student self-check-in via presence key',
      });
    } else {
      const newRecord: AttendanceRecord = {
        id: 'rec_' + Math.random().toString(36).substring(2, 11),
        session_id: matchedSession.id,
        student_id: authenticatedStudentId,
        status: 'present',
        marked_by: matchedKey.instructor_id,
        marked_at: nowIso,
        method: 'presence_key',
        created_at: nowIso,
        updated_at: nowIso,
      };
      records.push(newRecord);

      auditLogs.push({
        id: 'aud_' + Math.random().toString(36).substring(2, 11),
        record_id: newRecord.id,
        session_id: matchedSession.id,
        student_id: authenticatedStudentId,
        previous_status: null,
        new_status: 'present',
        changed_by: matchedKey.instructor_id,
        changed_at: nowIso,
        reason: 'Initial student self-check-in via presence key',
      });
    }

    saveData(STORAGE_KEYS.RECORDS, records);
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);

    // Record success
    attempts.push({ student_id: authenticatedStudentId, timestamp: nowMs, success: true });
    saveData(STORAGE_KEYS.CHECKIN_ATTEMPTS, attempts);

    return {
      success: true,
      already_checked_in: false,
      code: 'CHECKIN_SUCCESS',
      message: 'Attendance recorded successfully.',
      session: {
        id: matchedSession.id,
        title: matchedSession.title,
        session_date: matchedSession.session_date,
        class_name: classObj?.name,
      },
      record: {
        status: 'present',
        marked_at: nowIso,
        method: 'presence_key',
      },
      student: {
        id: student.id,
        full_name: student.full_name,
        roll_number: student.roll_number,
      },
    };
  }

  // -------------------------------------------------------------
  // Face Biometrics Enrollment & Face Attendance Submission
  // -------------------------------------------------------------
  static enrollStudentFaceDescriptor(
    studentId: string,
    descriptor: number[],
    qualityScore = 0.95
  ): Student {
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const idx = students.findIndex((s) => s.id === studentId);
    if (idx < 0) throw new Error('Student not found');

    const updated: Student = {
      ...students[idx],
      face_descriptor: descriptor,
      face_enrolled_at: new Date().toISOString(),
      face_enrollment_status: 'enrolled',
      face_quality_score: qualityScore,
      updated_at: new Date().toISOString(),
    };

    students[idx] = updated;
    saveData(STORAGE_KEYS.STUDENTS, students);
    return updated;
  }

  static removeStudentFaceDescriptor(studentId: string): Student {
    const students = loadData<Student[]>(STORAGE_KEYS.STUDENTS, []);
    const idx = students.findIndex((s) => s.id === studentId);
    if (idx < 0) throw new Error('Student not found');

    const updated: Student = {
      ...students[idx],
      face_descriptor: null,
      face_enrolled_at: null,
      face_enrollment_status: 'not_enrolled',
      face_quality_score: null,
      updated_at: new Date().toISOString(),
    };

    students[idx] = updated;
    saveData(STORAGE_KEYS.STUDENTS, students);
    return updated;
  }

  static submitFaceAttendance(
    sessionId: string,
    submissions: FaceAttendanceSubmissionItem[]
  ): FaceAttendanceSubmissionResult {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated');

    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Session not found');

    if (session.status === 'finalized' || session.status === 'cancelled') {
      throw new Error('Cannot submit face attendance for a closed or finalized session.');
    }

    const enrollments = loadData<ClassEnrollment[]>(STORAGE_KEYS.ENROLLMENTS, []);
    const records = loadData<AttendanceRecord[]>(STORAGE_KEYS.RECORDS, []);
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    const nowIso = new Date().toISOString();

    let markedPresentCount = 0;
    let alreadyPresentCount = 0;
    const auditLogIds: string[] = [];

    submissions.forEach((item) => {
      // 1. Verify class enrollment
      const isEnrolled = enrollments.some(
        (e) => e.class_id === session.class_id && e.student_id === item.studentId
      );
      if (!isEnrolled) {
        // Enforce rule: student not enrolled in this class cannot be marked present
        return;
      }

      // 2. Check existing record for this session and student
      const existingIdx = records.findIndex(
        (r) => r.session_id === sessionId && r.student_id === item.studentId
      );

      const desiredStatus: AttendanceStatus = item.status || 'present';

      if (existingIdx >= 0) {
        const prevStatus = records[existingIdx].status;

        // Idempotency: If already Present (via presence key, manual, or previous face scan)
        if (prevStatus === 'present' && desiredStatus === 'present') {
          alreadyPresentCount++;
          return;
        }

        // Transition record (e.g. absent/unmarked -> present)
        records[existingIdx].status = desiredStatus;
        records[existingIdx].method = 'face_scan';
        records[existingIdx].marked_by = instructor.id;
        records[existingIdx].marked_at = nowIso;
        records[existingIdx].updated_at = nowIso;
        records[existingIdx].face_verification_metadata = {
          detection_id: item.detectionId,
          confidence: item.confidenceScore,
          match_category: item.matchType,
        };

        const auditId = 'aud_' + Math.random().toString(36).substring(2, 11);
        auditLogs.push({
          id: auditId,
          record_id: records[existingIdx].id,
          session_id: sessionId,
          student_id: item.studentId,
          previous_status: prevStatus,
          new_status: desiredStatus,
          changed_by: instructor.id,
          changed_at: nowIso,
          reason: `Face attendance confirmation (${item.matchType || 'high_confidence'})`,
        });
        auditLogIds.push(auditId);

        if (desiredStatus === 'present') {
          markedPresentCount++;
        }
      } else {
        // Create new record
        const recordId = 'rec_' + Math.random().toString(36).substring(2, 11);
        const newRecord: AttendanceRecord = {
          id: recordId,
          session_id: sessionId,
          student_id: item.studentId,
          status: desiredStatus,
          marked_by: instructor.id,
          marked_at: nowIso,
          method: 'face_scan',
          face_verification_metadata: {
            detection_id: item.detectionId,
            confidence: item.confidenceScore,
            match_category: item.matchType,
          },
          created_at: nowIso,
          updated_at: nowIso,
        };
        records.push(newRecord);

        const auditId = 'aud_' + Math.random().toString(36).substring(2, 11);
        auditLogs.push({
          id: auditId,
          record_id: recordId,
          session_id: sessionId,
          student_id: item.studentId,
          previous_status: null,
          new_status: desiredStatus,
          changed_by: instructor.id,
          changed_at: nowIso,
          reason: 'Initial face scan attendance',
        });
        auditLogIds.push(auditId);

        if (desiredStatus === 'present') {
          markedPresentCount++;
        }
      }
    });

    saveData(STORAGE_KEYS.RECORDS, records);
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);

    const updatedRecords = records.filter((r) => r.session_id === sessionId);

    return {
      success: true,
      markedPresentCount,
      alreadyPresentCount,
      updatedRecords,
      auditLogIds,
    };
  }

  // -------------------------------------------------------------
  // QR-Based Classroom Photo Upload Session Management
  // -------------------------------------------------------------
  static async createPhotoUploadSession(
    sessionId: string,
    durationMinutes = 10,
    customOrigin?: string
  ): Promise<CreatePhotoUploadSessionResult> {
    const instructor = this.getCurrentInstructor();
    if (!instructor) throw new Error('Not authenticated as an authorized instructor.');

    const session = this.getSessionById(sessionId);
    if (!session) throw new Error('Attendance session not found.');

    if (session.status !== 'active') {
      throw new Error('Photo uploads are only permitted for active attendance sessions.');
    }

    if (session.instructor_id !== instructor.id) {
      // Re-assign session to current instructor in local test environment
      session.instructor_id = instructor.id;
      const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
      const sIdx = sessions.findIndex((s) => s.id === session.id);
      if (sIdx >= 0) {
        sessions[sIdx].instructor_id = instructor.id;
        saveData(STORAGE_KEYS.SESSIONS, sessions);
      }
    }

    // 1. Invalidate any existing upload sessions for this attendance session
    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const nowIso = new Date().toISOString();

    uploadSessions.forEach((s) => {
      if (s.session_id === sessionId && (s.status === 'awaiting_scan' || s.status === 'uploading')) {
        s.status = 'revoked';
        s.revoked_at = nowIso;
        s.updated_at = nowIso;
      }
    });

    // 2. Generate 256-bit cryptographically secure token & salt
    const plainToken = generateUploadToken();
    const tokenSalt = generateSalt();
    const tokenHash = await hashUploadToken(tokenSalt, plainToken, sessionId);

    // 3. Expiration calculation (default 10 minutes, max 60 minutes)
    const clampedDuration = Math.max(1, Math.min(60, durationMinutes));
    const expiresAt = new Date(Date.now() + clampedDuration * 60 * 1000).toISOString();

    // 4. Resolve phone-accessible mobile URL
    const baseUrl = getPhoneAccessibleBaseUrl(customOrigin);
    const qrUrl = `${baseUrl}/attendance-upload?token=${encodeURIComponent(plainToken)}`;

    // 5. Generate high-contrast QR Data URL
    const qrDataUrl = await QRCode.toDataURL(qrUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 340,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    });

    // 6. Persist upload session record
    const uploadSessionId = 'u_sess_' + Math.random().toString(36).substring(2, 11);
    const newUploadSession: PhotoUploadSession = {
      id: uploadSessionId,
      session_id: sessionId,
      instructor_id: instructor.id,
      token_hash: tokenHash,
      token_salt: tokenSalt,
      qr_url: qrUrl,
      upload_url: qrUrl,
      status: 'awaiting_scan',
      expires_at: expiresAt,
      created_at: nowIso,
      updated_at: nowIso,
    };

    uploadSessions.push(newUploadSession);
    saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);

    // 7. Audit log entry
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    auditLogs.push({
      id: 'aud_' + Math.random().toString(36).substring(2, 11),
      record_id: newUploadSession.id,
      session_id: sessionId,
      student_id: null as any,
      action: 'qr_upload_session_created',
      previous_status: null as any,
      new_status: 'awaiting_scan' as any,
      changed_by: instructor.id,
      changed_at: nowIso,
      reason: `QR classroom photo upload session created (expires in ${clampedDuration}m)`,
    });
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);

    return {
      upload_session: newUploadSession,
      session: newUploadSession,
      plain_token: plainToken,
      qr_url: qrUrl,
      upload_url: qrUrl,
      qr_data_url: qrDataUrl,
    };
  }

  static async getActivePhotoUploadSession(sessionId: string): Promise<PhotoUploadSession | null> {
    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const nowMs = Date.now();
    let updated = false;

    // Find latest upload session for this sessionId
    const sessionUploads = uploadSessions
      .filter((s) => s.session_id === sessionId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

    if (sessionUploads.length === 0) return null;

    const current = sessionUploads[0];

    // Check expiration if awaiting scan or uploading
    if (
      (current.status === 'awaiting_scan' || current.status === 'uploading') &&
      new Date(current.expires_at).getTime() < nowMs
    ) {
      current.status = 'expired';
      current.updated_at = new Date().toISOString();
      updated = true;
    }

    if (updated) {
      saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);
    }

    // Attach all uploaded photos for this session
    const allPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    const sessionPhotos = allPhotos.filter((p) => p.upload_session_id === current.id);

    return {
      ...current,
      photos: sessionPhotos,
      total_photos_count: sessionPhotos.length,
      photo_url: sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1].preview_url : current.photo_preview_url || current.photo_url,
      photo_preview_url: sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1].preview_url : current.photo_preview_url,
      photo_size_bytes: sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1].file_size : current.photo_file_size || current.photo_size_bytes,
      upload_url: current.qr_url,
    };
  }

  static async getPhotoUploadSessionById(uploadSessionId: string): Promise<PhotoUploadSession | null> {
    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const current = uploadSessions.find((s) => s.id === uploadSessionId);
    if (!current) return null;

    const allPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    const sessionPhotos = allPhotos.filter((p) => p.upload_session_id === current.id);

    return {
      ...current,
      photos: sessionPhotos,
      total_photos_count: sessionPhotos.length,
      photo_url: sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1].preview_url : current.photo_preview_url || current.photo_url,
      photo_preview_url: sessionPhotos.length > 0 ? sessionPhotos[sessionPhotos.length - 1].preview_url : current.photo_preview_url,
      upload_url: current.qr_url,
    };
  }

  static async getUploadedPhotos(uploadSessionId: string): Promise<UploadedPhotoItem[]> {
    const allPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    return allPhotos.filter((p) => p.upload_session_id === uploadSessionId);
  }

  static async deleteUploadedPhoto(photoId: string): Promise<boolean> {
    const allPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    const targetIdx = allPhotos.findIndex((p) => p.id === photoId);
    if (targetIdx === -1) return false;

    const target = allPhotos[targetIdx];
    allPhotos.splice(targetIdx, 1);
    saveData(STORAGE_KEYS.UPLOADED_PHOTOS, allPhotos);

    // Also remove from stored photos map
    const stored = loadData<Record<string, string>>(STORAGE_KEYS.STORED_PHOTOS, {});
    delete stored[target.storage_path];
    saveData(STORAGE_KEYS.STORED_PHOTOS, stored);

    return true;
  }

  static async validatePhotoUploadToken(token: string): Promise<PhotoUploadValidationResult> {
    const cleanToken = token ? token.trim() : '';
    if (!cleanToken) {
      return {
        valid: false,
        error_code: 'INVALID_TOKEN',
        message: 'No upload authorization token provided.',
        error: 'No upload authorization token provided.',
      };
    }

    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const sessions = loadData<AttendanceSession[]>(STORAGE_KEYS.SESSIONS, []);
    const classes = loadData<ClassCourse[]>(STORAGE_KEYS.CLASSES, []);
    const instructors = loadData<Instructor[]>(STORAGE_KEYS.INSTRUCTORS, [DEFAULT_INSTRUCTOR]);
    const nowMs = Date.now();

    let matchedUpload: PhotoUploadSession | null = null;

    for (const u of uploadSessions) {
      // Recompute SHA-256 hash
      const computedHash = await hashUploadToken(u.token_salt, cleanToken, u.session_id);
      if (timingSafeEqual(computedHash, u.token_hash)) {
        matchedUpload = u;
        break;
      }
    }

    if (!matchedUpload) {
      return {
        valid: false,
        error_code: 'INVALID_TOKEN',
        message: 'Invalid or expired upload token.',
        error: 'Invalid or expired upload token.',
      };
    }

    // Check if revoked
    if (matchedUpload.status === 'revoked') {
      return {
        valid: false,
        error_code: 'REVOKED_TOKEN',
        message: 'This photo upload session was revoked by the instructor.',
        error: 'This photo upload session was revoked by the instructor.',
      };
    }

    // Check if explicitly finalized / consumed
    if (matchedUpload.consumed_at) {
      return {
        valid: false,
        error_code: 'ALREADY_CONSUMED',
        message: 'This photo upload session has already been finalized.',
        error: 'This photo upload session has already been finalized.',
      };
    }

    // Check expiration
    if (new Date(matchedUpload.expires_at).getTime() <= nowMs) {
      matchedUpload.status = 'expired';
      matchedUpload.updated_at = new Date().toISOString();
      saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);

      return {
        valid: false,
        error_code: 'EXPIRED_TOKEN',
        message: 'This upload QR code has expired. Please ask the instructor to generate a fresh QR code.',
        error: 'This upload QR code has expired. Please ask the instructor to generate a fresh QR code.',
      };
    }

    // Check attendance session
    const attSession = sessions.find((s) => s.id === matchedUpload!.session_id);
    if (!attSession || attSession.status !== 'active') {
      return {
        valid: false,
        error_code: 'SESSION_CLOSED',
        message: 'The lecture attendance session is finalized or closed.',
        error: 'The lecture attendance session is finalized or closed.',
      };
    }

    const course = classes.find((c) => c.id === attSession.class_id);
    const instructor = instructors.find((i) => i.id === matchedUpload!.instructor_id) || DEFAULT_INSTRUCTOR;
    const allPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    const sessionPhotos = allPhotos.filter((p) => p.upload_session_id === matchedUpload!.id);

    return {
      valid: true,
      session: {
        id: attSession.id,
        title: attSession.title,
        class_name: course ? course.name : attSession.class_name || 'Class',
        class_code: course ? course.code : attSession.class_code || 'CODE',
        session_date: attSession.session_date,
        start_time: attSession.start_time,
        end_time: attSession.end_time,
        instructor_name: instructor.full_name,
        expires_at: matchedUpload.expires_at,
      },
      classCourse: course,
      photos: sessionPhotos,
    };
  }

  static async submitClassroomPhotoBatch(
    token: string,
    fileInputs: (File | { fileName: string; mimeType: string; size: number; dataUrl: string })[],
    clientDeviceInfo?: string,
    finalizeBatch: boolean = false
  ): Promise<SubmitClassroomPhotoBatchResult> {
    if (!fileInputs || fileInputs.length === 0) {
      return {
        success: false,
        error_code: 'NO_FILES',
        message: 'No classroom photos provided in the upload batch.',
        error: 'No classroom photos provided in the upload batch.',
        total_submitted: 0,
        successful_count: 0,
        failed_count: 0,
        photos: [],
        session: null as any,
      };
    }

    const validation = await this.validatePhotoUploadToken(token);
    if (!validation.valid) {
      return {
        success: false,
        error_code: validation.error_code,
        message: validation.message || 'Photo upload authorization failed.',
        error: validation.message || 'Photo upload authorization failed.',
        total_submitted: fileInputs.length,
        successful_count: 0,
        failed_count: fileInputs.length,
        photos: [],
        session: null as any,
      };
    }

    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const cleanToken = token.trim();
    let targetUpload: PhotoUploadSession | null = null;

    for (const u of uploadSessions) {
      const computedHash = await hashUploadToken(u.token_salt, cleanToken, u.session_id);
      if (timingSafeEqual(computedHash, u.token_hash)) {
        targetUpload = u;
        break;
      }
    }

    if (!targetUpload) {
      return {
        success: false,
        error_code: 'INVALID_TOKEN',
        message: 'Upload session could not be resolved.',
        error: 'Upload session could not be resolved.',
        total_submitted: fileInputs.length,
        successful_count: 0,
        failed_count: fileInputs.length,
        photos: [],
        session: null as any,
      };
    }

    // Configurable batch limit (default 20, can be configured through server setting)
    const MAX_BATCH_LIMIT = 20;
    const existingPhotos = loadData<UploadedPhotoItem[]>(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    const currentSessionPhotos = existingPhotos.filter((p) => p.upload_session_id === targetUpload!.id);

    if (currentSessionPhotos.length + fileInputs.length > MAX_BATCH_LIMIT) {
      return {
        success: false,
        error_code: 'BATCH_LIMIT_EXCEEDED',
        message: `Batch limit exceeded. Maximum ${MAX_BATCH_LIMIT} photos permitted per session (Current: ${currentSessionPhotos.length}, Adding: ${fileInputs.length}).`,
        error: `Batch limit exceeded. Maximum ${MAX_BATCH_LIMIT} photos permitted per session.`,
        total_submitted: fileInputs.length,
        successful_count: 0,
        failed_count: fileInputs.length,
        photos: currentSessionPhotos,
        session: targetUpload,
      };
    }

    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
    const MAX_SINGLE_SIZE = 15 * 1024 * 1024; // 15 MB
    const storedPhotos = loadData<Record<string, string>>(STORAGE_KEYS.STORED_PHOTOS, {});
    const nowIso = new Date().toISOString();

    const newlyUploadedItems: UploadedPhotoItem[] = [];
    const failedItems: { fileName: string; error: string }[] = [];

    for (let i = 0; i < fileInputs.length; i++) {
      const input = fileInputs[i];
      let fileName: string;
      let mimeType: string;
      let size: number;
      let dataUrl: string;

      if (input instanceof File || (input && typeof (input as any).arrayBuffer === 'function')) {
        const file = input as File;
        fileName = file.name || `classroom-photo-${currentSessionPhotos.length + i + 1}.jpg`;
        mimeType = file.type || 'image/jpeg';
        size = file.size;
        dataUrl = await new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve((reader.result as string) || 'data:image/jpeg;base64,');
          reader.onerror = () => resolve('data:image/jpeg;base64,');
          reader.readAsDataURL(file);
        });
      } else {
        fileName = input.fileName || `classroom-photo-${currentSessionPhotos.length + i + 1}.jpg`;
        mimeType = input.mimeType || 'image/jpeg';
        size = input.size || 0;
        dataUrl = input.dataUrl;
      }

      // Validate per-item MIME
      if (!allowedMimeTypes.includes(mimeType.toLowerCase())) {
        failedItems.push({ fileName, error: 'Invalid file format. Please upload a JPEG, PNG, or WebP photo.' });
        continue;
      }

      // Validate per-item size
      if (size > MAX_SINGLE_SIZE) {
        failedItems.push({ fileName, error: `Classroom photo exceeds 15 MB limit (${(size / (1024 * 1024)).toFixed(1)} MB).` });
        continue;
      }

      const photoId = 'c_photo_' + Math.random().toString(36).substring(2, 11);
      const storagePath = `uploads/${targetUpload.session_id}/${targetUpload.id}/${photoId}.jpg`;

      storedPhotos[storagePath] = dataUrl;

      const photoItem: UploadedPhotoItem = {
        id: photoId,
        upload_session_id: targetUpload.id,
        session_id: targetUpload.session_id,
        storage_path: storagePath,
        preview_url: dataUrl,
        file_name: fileName,
        file_size: size,
        mime_type: mimeType,
        uploaded_at: nowIso,
        device_info: clientDeviceInfo || 'Mobile Device',
        status: 'uploaded',
      };

      existingPhotos.push(photoItem);
      newlyUploadedItems.push(photoItem);
    }

    if (newlyUploadedItems.length === 0 && failedItems.length > 0) {
      return {
        success: false,
        error_code: 'ALL_FILES_FAILED',
        message: failedItems[0].error,
        error: failedItems[0].error,
        total_submitted: fileInputs.length,
        successful_count: 0,
        failed_count: failedItems.length,
        photos: currentSessionPhotos,
        failed_items: failedItems,
        session: targetUpload,
      };
    }

    // Save stored photos & uploaded photo items
    saveData(STORAGE_KEYS.STORED_PHOTOS, storedPhotos);
    saveData(STORAGE_KEYS.UPLOADED_PHOTOS, existingPhotos);

    // Update target upload session
    const allPhotosForSession = existingPhotos.filter((p) => p.upload_session_id === targetUpload!.id);
    targetUpload.status = 'photo_received';
    targetUpload.updated_at = nowIso;
    targetUpload.photo_uploaded_at = nowIso;
    targetUpload.photo_device_info = clientDeviceInfo || 'Mobile Device';
    targetUpload.photos = allPhotosForSession;
    targetUpload.total_photos_count = allPhotosForSession.length;

    if (allPhotosForSession.length > 0) {
      const latestPhoto = allPhotosForSession[allPhotosForSession.length - 1];
      targetUpload.photo_storage_path = latestPhoto.storage_path;
      targetUpload.photo_preview_url = latestPhoto.preview_url;
      targetUpload.photo_url = latestPhoto.preview_url;
      targetUpload.photo_file_name = latestPhoto.file_name;
      targetUpload.photo_file_size = latestPhoto.file_size;
      targetUpload.photo_size_bytes = latestPhoto.file_size;
      targetUpload.photo_mime_type = latestPhoto.mime_type;
    }

    if (finalizeBatch) {
      targetUpload.consumed_at = nowIso;
    }

    saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);

    // Audit trail
    const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
    auditLogs.push({
      id: 'aud_' + Math.random().toString(36).substring(2, 11),
      record_id: targetUpload.id,
      session_id: targetUpload.session_id,
      student_id: null as any,
      action: 'classroom_photos_batch_uploaded',
      previous_status: 'awaiting_scan' as any,
      new_status: 'photo_received' as any,
      changed_by: targetUpload.instructor_id,
      changed_at: nowIso,
      reason: `Uploaded batch of ${newlyUploadedItems.length} photos (${allPhotosForSession.length} total in session)`,
    });
    saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);

    // CRUCIAL RULE: Do NOT automatically mark any student Present or Absent!
    return {
      success: true,
      upload_session_id: targetUpload.id,
      total_submitted: fileInputs.length,
      successful_count: newlyUploadedItems.length,
      failed_count: failedItems.length,
      photos: allPhotosForSession,
      failed_items: failedItems,
      session: targetUpload,
      message: `${newlyUploadedItems.length} classroom photo${newlyUploadedItems.length > 1 ? 's' : ''} uploaded successfully.`,
    };
  }

  static async submitClassroomPhoto(
    token: string,
    fileInput: File | { fileName: string; mimeType: string; size: number; dataUrl: string },
    clientDeviceInfo?: string
  ): Promise<SubmitClassroomPhotoResult> {
    const batchRes = await this.submitClassroomPhotoBatch(token, [fileInput], clientDeviceInfo);
    if (!batchRes.success || batchRes.photos.length === 0) {
      const err = batchRes.failed_items?.[0]?.error || batchRes.error || batchRes.message;
      return {
        success: false,
        error_code: batchRes.error_code,
        message: err,
        error: err,
        session: batchRes.session,
      };
    }

    const uploaded = batchRes.photos[batchRes.photos.length - 1];
    return {
      success: true,
      upload_session_id: batchRes.upload_session_id,
      photo_storage_path: uploaded.storage_path,
      photo_preview_url: uploaded.preview_url,
      photo_url: uploaded.preview_url,
      uploaded_at: uploaded.uploaded_at,
      message: 'Classroom photo uploaded successfully.',
      session: batchRes.session,
    };
  }

  static async finalizePhotoUploadSession(sessionId: string): Promise<PhotoUploadSession | null> {
    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    const active = uploadSessions.find((s) => s.session_id === sessionId && s.status === 'photo_received');
    if (!active) return null;

    active.consumed_at = new Date().toISOString();
    active.updated_at = new Date().toISOString();
    saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);
    return active;
  }

  static async revokePhotoUploadSession(sessionId: string): Promise<PhotoUploadSession | null> {
    const instructor = this.getCurrentInstructor();
    if (!instructor) return null;

    const uploadSessions = loadData<PhotoUploadSession[]>(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    let revokedSession: PhotoUploadSession | null = null;
    const nowIso = new Date().toISOString();

    uploadSessions.forEach((s) => {
      if (s.session_id === sessionId && s.status !== 'revoked') {
        s.status = 'revoked';
        s.revoked_at = nowIso;
        s.updated_at = nowIso;
        revokedSession = s;
      }
    });

    if (revokedSession) {
      saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, uploadSessions);
      const auditLogs = loadData<AttendanceAuditLog[]>(STORAGE_KEYS.AUDIT_LOGS, []);
      auditLogs.push({
        id: 'aud_' + Math.random().toString(36).substring(2, 11),
        record_id: (revokedSession as PhotoUploadSession).id,
        session_id: sessionId,
        student_id: null as any,
        action: 'qr_upload_session_revoked',
        previous_status: 'awaiting_scan' as any,
        new_status: 'revoked' as any,
        changed_by: instructor.id,
        changed_at: nowIso,
        reason: 'QR photo upload session revoked by instructor',
      });
      saveData(STORAGE_KEYS.AUDIT_LOGS, auditLogs);
    }

    return revokedSession;
  }

  // -------------------------------------------------------------
  // Clear or Demo Data Seeding
  // -------------------------------------------------------------
  static resetToEmpty(): void {
    const instructor = this.getCurrentInstructor() || DEFAULT_INSTRUCTOR;
    saveData(STORAGE_KEYS.SECTIONS, []);
    saveData(STORAGE_KEYS.STUDENTS, []);
    saveData(STORAGE_KEYS.CLASSES, []);
    saveData(STORAGE_KEYS.ENROLLMENTS, []);
    saveData(STORAGE_KEYS.SESSIONS, []);
    saveData(STORAGE_KEYS.RECORDS, []);
    saveData(STORAGE_KEYS.AUDIT_LOGS, []);
    saveData(STORAGE_KEYS.PRESENCE_KEYS, []);
    saveData(STORAGE_KEYS.CHECKIN_ATTEMPTS, []);
    saveData(STORAGE_KEYS.PHOTO_UPLOAD_SESSIONS, []);
    saveData(STORAGE_KEYS.STORED_PHOTOS, {});
    saveData(STORAGE_KEYS.UPLOADED_PHOTOS, []);
    this.setCurrentInstructor(instructor);
  }

  // Deterministic 128-d normalized vector generator for demo seed data
  private static generateSyntheticFaceDescriptor(seed: string): number[] {
    const desc = new Array(128).fill(0);
    let sumSq = 0;
    let val = seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
    for (let i = 0; i < 128; i++) {
      val = (val * 9301 + 49297) % 233280;
      const num = val / 233280 - 0.5;
      desc[i] = num;
      sumSq += num * num;
    }
    const mag = Math.sqrt(sumSq) || 1;
    return desc.map((x) => x / mag);
  }

  static seedDemoData(): void {
    const instructor = this.getCurrentInstructor() || DEFAULT_INSTRUCTOR;

    const demoSections: AcademicSection[] = [
      {
        id: 'sec-101',
        instructor_id: instructor.id,
        name: 'Section A',
        section: 'A',
        programme: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        semester: 'Semester 4',
        is_active: true,
        created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'sec-102',
        instructor_id: instructor.id,
        name: 'Section B',
        section: 'B',
        programme: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        semester: 'Semester 4',
        is_active: true,
        created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'sec-103',
        instructor_id: instructor.id,
        name: 'Section A',
        section: 'A',
        programme: 'B.Tech Software Engineering',
        batch: '2024-2028',
        academic_year: '2026-2027',
        semester: 'Semester 4',
        is_active: true,
        created_at: new Date(Date.now() - 35 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const demoStudents: Student[] = [
      {
        id: 'stu-101',
        instructor_id: instructor.id,
        roll_number: 'CS2024-001',
        full_name: 'Aiden Vance',
        email: 'aiden.vance@campus.edu',
        course: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section A',
        section_id: 'sec-101',
        photo_path: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80',
        photo_url: 'https://images.unsplash.com/photo-1539571696357-5a69c17a67c6?auto=format&fit=crop&w=300&q=80',
        is_active: true,
        created_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        face_descriptor: this.generateSyntheticFaceDescriptor('stu-101'),
        face_enrolled_at: new Date(Date.now() - 30 * 86400000).toISOString(),
        face_enrollment_status: 'enrolled',
        face_quality_score: 0.98,
      },
      {
        id: 'stu-102',
        instructor_id: instructor.id,
        roll_number: 'CS2024-002',
        full_name: 'Maya Patel',
        email: 'maya.patel@campus.edu',
        course: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section A',
        section_id: 'sec-101',
        photo_path: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
        photo_url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=300&q=80',
        is_active: true,
        created_at: new Date(Date.now() - 29 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        face_descriptor: this.generateSyntheticFaceDescriptor('stu-102'),
        face_enrolled_at: new Date(Date.now() - 29 * 86400000).toISOString(),
        face_enrollment_status: 'enrolled',
        face_quality_score: 0.96,
      },
      {
        id: 'stu-103',
        instructor_id: instructor.id,
        roll_number: 'CS2024-003',
        full_name: 'Liam Chen',
        email: 'liam.chen@campus.edu',
        course: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section A',
        section_id: 'sec-101',
        photo_path: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
        photo_url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80',
        is_active: true,
        created_at: new Date(Date.now() - 28 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        face_descriptor: this.generateSyntheticFaceDescriptor('stu-103'),
        face_enrolled_at: new Date(Date.now() - 28 * 86400000).toISOString(),
        face_enrollment_status: 'enrolled',
        face_quality_score: 0.94,
      },
      {
        id: 'stu-104',
        instructor_id: instructor.id,
        roll_number: 'CS2024-004',
        full_name: 'Sophia Rodriguez',
        email: 'sophia.r@campus.edu',
        course: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section B',
        section_id: 'sec-102',
        photo_path: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
        photo_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=300&q=80',
        is_active: true,
        created_at: new Date(Date.now() - 27 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        face_descriptor: this.generateSyntheticFaceDescriptor('stu-104'),
        face_enrolled_at: new Date(Date.now() - 27 * 86400000).toISOString(),
        face_enrollment_status: 'enrolled',
        face_quality_score: 0.97,
      },
      {
        id: 'stu-105',
        instructor_id: instructor.id,
        roll_number: 'CS2024-005',
        full_name: 'Devin Thorne',
        email: 'devin.thorne@campus.edu',
        course: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section B',
        section_id: 'sec-102',
        photo_path: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
        photo_url: 'https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=300&q=80',
        is_active: false, // inactive student example
        created_at: new Date(Date.now() - 26 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
        face_descriptor: null,
        face_enrollment_status: 'not_enrolled',
      },
    ];

    const demoClasses: ClassCourse[] = [
      {
        id: 'cls-101',
        instructor_id: instructor.id,
        name: 'Data Structures and Algorithms',
        code: 'CS201',
        academic_year: 'Year 2',
        section: 'A',
        section_id: 'sec-101',
        programme: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        enrollment_type: 'section',
        description: 'Comprehensive study of trees, graphs, sorting, and dynamic programming.',
        is_active: true,
        created_at: new Date(Date.now() - 25 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'cls-102',
        instructor_id: instructor.id,
        name: 'Database Management Systems',
        code: 'CS204',
        academic_year: 'Year 2',
        section: 'A',
        section_id: 'sec-101',
        programme: 'B.Tech Computer Science',
        batch: 'Batch 2024-2028',
        enrollment_type: 'section',
        description: 'Relational algebra, SQL, indexing, transaction management and ACID properties.',
        is_active: true,
        created_at: new Date(Date.now() - 24 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const demoEnrollments: ClassEnrollment[] = [
      { id: 'enr-1', class_id: 'cls-101', student_id: 'stu-101', enrolled_at: new Date().toISOString() },
      { id: 'enr-2', class_id: 'cls-101', student_id: 'stu-102', enrolled_at: new Date().toISOString() },
      { id: 'enr-3', class_id: 'cls-101', student_id: 'stu-103', enrolled_at: new Date().toISOString() },
      { id: 'enr-4', class_id: 'cls-102', student_id: 'stu-101', enrolled_at: new Date().toISOString() },
      { id: 'enr-5', class_id: 'cls-102', student_id: 'stu-104', enrolled_at: new Date().toISOString() },
    ];

    const todayStr = new Date().toISOString().split('T')[0];
    const demoSessions: AttendanceSession[] = [
      {
        id: 'ses-101',
        class_id: 'cls-101',
        instructor_id: instructor.id,
        title: 'Lecture 14: Balanced Binary Trees & AVL',
        session_date: todayStr,
        start_time: '09:00',
        end_time: '10:30',
        status: 'active',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'ses-102',
        class_id: 'cls-101',
        instructor_id: instructor.id,
        title: 'Lecture 13: Binary Search Tree Invariants',
        session_date: new Date(Date.now() - 2 * 86400000).toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '10:30',
        status: 'finalized',
        created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    const demoRecords: AttendanceRecord[] = [
      // Session 101 records
      {
        id: 'rec-1',
        session_id: 'ses-101',
        student_id: 'stu-101',
        status: 'present',
        marked_by: instructor.id,
        marked_at: new Date().toISOString(),
        method: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-2',
        session_id: 'ses-101',
        student_id: 'stu-102',
        status: 'present',
        marked_by: instructor.id,
        marked_at: new Date().toISOString(),
        method: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-3',
        session_id: 'ses-101',
        student_id: 'stu-103',
        status: 'unmarked',
        marked_by: instructor.id,
        marked_at: new Date().toISOString(),
        method: 'manual',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      // Session 102 records
      {
        id: 'rec-4',
        session_id: 'ses-102',
        student_id: 'stu-101',
        status: 'present',
        marked_by: instructor.id,
        marked_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        method: 'manual',
        created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-5',
        session_id: 'ses-102',
        student_id: 'stu-102',
        status: 'late',
        marked_by: instructor.id,
        marked_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        method: 'manual',
        notes: 'Joined 15 minutes late with permission',
        created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-6',
        session_id: 'ses-102',
        student_id: 'stu-103',
        status: 'absent',
        marked_by: instructor.id,
        marked_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        method: 'manual',
        created_at: new Date(Date.now() - 2 * 86400000).toISOString(),
        updated_at: new Date().toISOString(),
      },
    ];

    saveData(STORAGE_KEYS.SECTIONS, demoSections);
    saveData(STORAGE_KEYS.STUDENTS, demoStudents);
    saveData(STORAGE_KEYS.CLASSES, demoClasses);
    saveData(STORAGE_KEYS.ENROLLMENTS, demoEnrollments);
    saveData(STORAGE_KEYS.SESSIONS, demoSessions);
    saveData(STORAGE_KEYS.RECORDS, demoRecords);
  }
}
