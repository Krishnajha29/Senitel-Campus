import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';
import { validatePhotoFile } from '../services/storage';

describe('Sentinel Campus Comprehensive Automated Test Suite', () => {
  beforeEach(() => {
    // Clear localStorage before each test run
    localStorage.clear();
    LocalDatabase.resetToEmpty();
  });

  describe('1. Image Validation and Upload Rules', () => {
    it('validates allowed image formats (JPEG, PNG, WebP)', () => {
      const validJpeg = new File(['dummy'], 'photo.jpg', { type: 'image/jpeg' });
      const validPng = new File(['dummy'], 'photo.png', { type: 'image/png' });
      const validWebp = new File(['dummy'], 'photo.webp', { type: 'image/webp' });

      expect(validatePhotoFile(validJpeg).valid).toBe(true);
      expect(validatePhotoFile(validPng).valid).toBe(true);
      expect(validatePhotoFile(validWebp).valid).toBe(true);
    });

    it('rejects disallowed file types (GIF, PDF, EXE)', () => {
      const invalidGif = new File(['dummy'], 'photo.gif', { type: 'image/gif' });
      const invalidPdf = new File(['dummy'], 'doc.pdf', { type: 'application/pdf' });

      expect(validatePhotoFile(invalidGif).valid).toBe(false);
      expect(validatePhotoFile(invalidPdf).valid).toBe(false);
    });

    it('enforces maximum 5MB image file size limit', () => {
      // 6MB dummy file
      const largeBlob = new Uint8Array(6 * 1024 * 1024);
      const largeFile = new File([largeBlob], 'large.jpg', { type: 'image/jpeg' });

      const res = validatePhotoFile(largeFile);
      expect(res.valid).toBe(false);
      expect(res.error).toContain('exceeds the 5 MB limit');
    });
  });

  describe('2. Student Management & Duplicate Roll Number Validation', () => {
    it('successfully creates a student and normalizes roll number and whitespace', () => {
      const student = LocalDatabase.createStudent({
        roll_number: ' cs2024-001 ',
        full_name: ' Johnathan Doe ',
        email: 'john@campus.edu',
        course: 'B.Tech CS',
        batch: 'Batch 2024-2028',
        academic_year: 'Year 2',
        section: 'Section A',
        photo_path: 'inst-001/photo1.jpg',
        is_active: true,
      });

      expect(student.id).toBeDefined();
      expect(student.roll_number).toBe('CS2024-001'); // Normalized uppercase and trimmed
      expect(student.full_name).toBe('Johnathan Doe');
      expect(student.is_active).toBe(true);

      const retrieved = LocalDatabase.getStudentById(student.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved?.roll_number).toBe('CS2024-001');
    });

    it('strictly prevents duplicate roll numbers within the instructor scope', () => {
      LocalDatabase.createStudent({
        roll_number: 'CS2024-100',
        full_name: 'Alice Smith',
        course: 'B.Tech CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'photo1.jpg',
        is_active: true,
      });

      // Attempting to create student with identical roll number
      expect(() => {
        LocalDatabase.createStudent({
          roll_number: 'cs2024-100', // same case-insensitive
          full_name: 'Bob Jones',
          course: 'B.Tech CS',
          batch: '2024',
          academic_year: 'Year 1',
          section: 'A',
          photo_path: 'photo2.jpg',
          is_active: true,
        });
      }).toThrow(/This roll number already exists/);
    });

    it('searches and filters students by name, roll number, course, and section', () => {
      LocalDatabase.createStudent({
        roll_number: 'CS-01',
        full_name: 'Emma Watson',
        course: 'Computer Science',
        batch: '2024',
        academic_year: 'Year 2',
        section: 'Section A',
        photo_path: 'p1.jpg',
        is_active: true,
      });
      LocalDatabase.createStudent({
        roll_number: 'EE-02',
        full_name: 'David Miller',
        course: 'Electrical Eng',
        batch: '2024',
        academic_year: 'Year 2',
        section: 'Section B',
        photo_path: 'p2.jpg',
        is_active: true,
      });

      // Search by name
      const searchByName = LocalDatabase.getStudents({ search: 'Watson' });
      expect(searchByName.length).toBe(1);
      expect(searchByName[0].full_name).toBe('Emma Watson');

      // Filter by course
      const filterByCourse = LocalDatabase.getStudents({ course: 'Electrical Eng' });
      expect(filterByCourse.length).toBe(1);
      expect(filterByCourse[0].roll_number).toBe('EE-02');

      // Filter by section
      const filterBySection = LocalDatabase.getStudents({ section: 'Section A' });
      expect(filterBySection.length).toBe(1);
      expect(filterBySection[0].roll_number).toBe('CS-01');
    });

    it('activates and deactivates a student', () => {
      const student = LocalDatabase.createStudent({
        roll_number: 'CS-03',
        full_name: 'Lucas Gray',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p3.jpg',
        is_active: true,
      });

      const deactivated = LocalDatabase.toggleStudentStatus(student.id, false);
      expect(deactivated.is_active).toBe(false);

      const activeOnly = LocalDatabase.getStudents({ is_active: true });
      expect(activeOnly.some((s) => s.id === student.id)).toBe(false);

      const reactivated = LocalDatabase.toggleStudentStatus(student.id, true);
      expect(reactivated.is_active).toBe(true);
    });
  });

  describe('3. Classes, Courses and Duplicate Enrollment Prevention', () => {
    it('creates a class and prevents duplicate class code in the same section', () => {
      const cls = LocalDatabase.createClass({
        name: 'Algorithms',
        code: 'CS201',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      expect(cls.id).toBeDefined();
      expect(cls.code).toBe('CS201');

      // Duplicate code and section should throw error
      expect(() => {
        LocalDatabase.createClass({
          name: 'Advanced Algorithms',
          code: 'CS201',
          academic_year: '2026-2027',
          section: 'A',
          is_active: true,
        });
      }).toThrow(/already exists/);

      // Same code but different section is allowed
      const clsB = LocalDatabase.createClass({
        name: 'Algorithms Sec B',
        code: 'CS201',
        academic_year: '2026-2027',
        section: 'B',
        is_active: true,
      });
      expect(clsB.id).toBeDefined();
    });

    it('enrolls students into class and prevents duplicate enrollment', () => {
      const s1 = LocalDatabase.createStudent({
        roll_number: 'CS-10',
        full_name: 'Student Ten',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p10.jpg',
        is_active: true,
      });

      const cls = LocalDatabase.createClass({
        name: 'Databases',
        code: 'CS301',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      LocalDatabase.enrollStudentsInClass(cls.id, [s1.id]);
      let roster = LocalDatabase.getClassEnrollments(cls.id);
      expect(roster.length).toBe(1);
      expect(roster[0].id).toBe(s1.id);

      // Attempt duplicate enrollment of s1
      LocalDatabase.enrollStudentsInClass(cls.id, [s1.id]);
      roster = LocalDatabase.getClassEnrollments(cls.id);
      expect(roster.length).toBe(1); // Still exactly 1 enrollment!
    });
  });

  describe('4. Attendance Sessions & Critical Rule (Unique 1 Record Per Student)', () => {
    it('creates a session, initializes unmarked records, and takes attendance', () => {
      const s1 = LocalDatabase.createStudent({
        roll_number: 'CS-20',
        full_name: 'Twenty',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p20.jpg',
        is_active: true,
      });
      const s2 = LocalDatabase.createStudent({
        roll_number: 'CS-21',
        full_name: 'Twenty One',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p21.jpg',
        is_active: true,
      });

      const cls = LocalDatabase.createClass({
        name: 'Networks',
        code: 'CS401',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      LocalDatabase.enrollStudentsInClass(cls.id, [s1.id, s2.id]);

      // Create attendance session
      const session = LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'Lecture 1: Intro',
        session_date: '2026-10-14',
        start_time: '10:00',
        end_time: '11:30',
      });

      const initialAttendance = LocalDatabase.getSessionAttendance(session.id);
      expect(initialAttendance.length).toBe(2);
      // Both should start as 'unmarked' pending confirmation
      expect(initialAttendance[0].record?.status).toBe('unmarked');
      expect(initialAttendance[1].record?.status).toBe('unmarked');

      // Instructor marks attendance
      LocalDatabase.saveAttendanceRecords(session.id, [
        { student_id: s1.id, status: 'present', notes: 'Arrived on time' },
        { student_id: s2.id, status: 'late', notes: 'Joined 10 mins late' },
      ]);

      const updated = LocalDatabase.getSessionAttendance(session.id);
      expect(updated.find((r) => r.student.id === s1.id)?.record?.status).toBe('present');
      expect(updated.find((r) => r.student.id === s2.id)?.record?.status).toBe('late');

      // Verify audit trail logged both changes
      const auditLogs = LocalDatabase.getAttendanceAuditLogs(session.id);
      expect(auditLogs.length).toBeGreaterThanOrEqual(2);
    });

    it('enforces the critical rule: exactly one attendance record per student per session', () => {
      const s1 = LocalDatabase.createStudent({
        roll_number: 'CS-30',
        full_name: 'Thirty',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p30.jpg',
        is_active: true,
      });

      const cls = LocalDatabase.createClass({
        name: 'Operating Systems',
        code: 'CS501',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      LocalDatabase.enrollStudentsInClass(cls.id, [s1.id]);

      const session = LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'Lecture 2: Kernel',
        session_date: '2026-10-14',
        start_time: '12:00',
        end_time: '13:30',
      });

      // Saving multiple updates for same student in same session
      LocalDatabase.saveAttendanceRecords(session.id, [
        { student_id: s1.id, status: 'present' },
      ]);
      LocalDatabase.saveAttendanceRecords(session.id, [
        { student_id: s1.id, status: 'absent' }, // correction
      ]);

      const finalRoll = LocalDatabase.getSessionAttendance(session.id);
      // There must be exactly ONE record for s1, not multiple duplicated rows
      const s1Records = finalRoll.filter((r) => r.student.id === s1.id);
      expect(s1Records.length).toBe(1);
      expect(s1Records[0].record?.status).toBe('absent');
    });

    it('distinguishes unmarked from confirmed absence, converting unmarked only when finalized', () => {
      const s1 = LocalDatabase.createStudent({
        roll_number: 'CS-40',
        full_name: 'Forty',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p40.jpg',
        is_active: true,
      });

      const cls = LocalDatabase.createClass({
        name: 'Cybersecurity',
        code: 'CS601',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      LocalDatabase.enrollStudentsInClass(cls.id, [s1.id]);

      const session = LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'Lecture 3: Crypto',
        session_date: '2026-10-14',
        start_time: '14:00',
        end_time: '15:30',
      });

      // While active, status is unmarked
      let attendance = LocalDatabase.getSessionAttendance(session.id);
      expect(attendance[0].record?.status).toBe('unmarked');

      // Finalize session
      LocalDatabase.updateSessionStatus(session.id, 'finalized');

      // Now it should be confirmed absent
      attendance = LocalDatabase.getSessionAttendance(session.id);
      expect(attendance[0].record?.status).toBe('absent');
    });
  });

  describe('5. Multi-Tenant Authorization & Isolation', () => {
    it('isolates data so Instructor B cannot see Instructor A students or classes', () => {
      // Current is Dr. Sarah Mitchell (inst-001)
      LocalDatabase.createStudent({
        roll_number: 'MITCHELL-01',
        full_name: 'Sarah Student',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p.jpg',
        is_active: true,
      });
      LocalDatabase.createClass({
        name: 'Sarah Class',
        code: 'SARAH101',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      expect(LocalDatabase.getStudents().length).toBe(1);
      expect(LocalDatabase.getClasses().length).toBe(1);

      // Switch to Instructor B (Dr. Alan Turing, inst-002)
      LocalDatabase.setCurrentInstructor({
        id: 'inst-002',
        full_name: 'Dr. Alan Turing',
        email: 'alan.turing@sentinel.edu',
        institution: 'Sentinel Institute of Technology',
        department: 'Department of Mathematics & Computing',
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Instructor B should see 0 students and 0 classes belonging to Instructor A!
      expect(LocalDatabase.getStudents().length).toBe(0);
      expect(LocalDatabase.getClasses().length).toBe(0);

      // Instructor B creates their own student
      LocalDatabase.createStudent({
        roll_number: 'TURING-01',
        full_name: 'Alan Student',
        course: 'Math',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'pturing.jpg',
        is_active: true,
      });
      expect(LocalDatabase.getStudents().length).toBe(1);
      expect(LocalDatabase.getStudents()[0].roll_number).toBe('TURING-01');

      // Switch back to Instructor A
      LocalDatabase.setCurrentInstructor({
        id: 'inst-001',
        full_name: 'Dr. Sarah Mitchell',
        email: 'sarah.mitchell@sentinel.edu',
        institution: 'Sentinel Institute of Technology',
        department: 'Department of Computer Science & Engineering',
        avatar_url: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });

      // Instructor A sees only MITCHELL-01
      const instAStudents = LocalDatabase.getStudents();
      expect(instAStudents.length).toBe(1);
      expect(instAStudents[0].roll_number).toBe('MITCHELL-01');
    });
  });

  describe('6. Reports and Attendance Percentage Calculations', () => {
    it('computes percentage strictly from finalized sessions, excluding active or cancelled', () => {
      const student = LocalDatabase.createStudent({
        roll_number: 'PERC-01',
        full_name: 'Metric Test Student',
        course: 'CS',
        batch: '2024',
        academic_year: 'Year 1',
        section: 'A',
        photo_path: 'p.jpg',
        is_active: true,
      });

      const cls = LocalDatabase.createClass({
        name: 'Discrete Math',
        code: 'CS102',
        academic_year: '2026-2027',
        section: 'A',
        is_active: true,
      });

      LocalDatabase.enrollStudentsInClass(cls.id, [student.id]);

      // Session 1: Finalized, marked present
      const ses1 = LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'S1',
        session_date: '2026-10-01',
        start_time: '09:00',
        end_time: '10:00',
      });
      LocalDatabase.saveAttendanceRecords(ses1.id, [{ student_id: student.id, status: 'present' }]);
      LocalDatabase.updateSessionStatus(ses1.id, 'finalized');

      // Session 2: Finalized, marked absent
      const ses2 = LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'S2',
        session_date: '2026-10-02',
        start_time: '09:00',
        end_time: '10:00',
      });
      LocalDatabase.saveAttendanceRecords(ses2.id, [{ student_id: student.id, status: 'absent' }]);
      LocalDatabase.updateSessionStatus(ses2.id, 'finalized');

      // Session 3: Active in progress, unmarked
      LocalDatabase.createAttendanceSession({
        class_id: cls.id,
        title: 'S3 Active',
        session_date: '2026-10-03',
        start_time: '09:00',
        end_time: '10:00',
      });

      const summary = LocalDatabase.getStudentAttendanceSummary(student.id);
      // Denominator should be only the 2 finalized sessions.
      // 1 present out of 2 finalized sessions = 50%
      expect(summary.present).toBe(1);
      expect(summary.absent).toBe(1);
      expect(summary.percentage).toBe(50);
    });
  });
});
