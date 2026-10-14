import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';

const createMockStudent = (overrides: Partial<Parameters<typeof LocalDatabase.createStudent>[0]> = {}) => ({
  full_name: 'Test Student',
  roll_number: 'TEST-001',
  email: 'test@campus.edu',
  course: 'Computer Science',
  batch: '2024-2028',
  academic_year: 'Year 2',
  section: 'A',
  photo_path: 'test-instructor/test.jpg',
  is_active: true,
  ...overrides,
});

describe('Sentinel Campus — Class Enrollment & Classroom Roster Verification', () => {
  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();
  });

  describe('1. Class Creation and Student Registration with Enrollment', () => {
    it('creates a class course and enrolls a student at creation time', () => {
      const newClass = LocalDatabase.createClass({
        name: 'Circular Linked List',
        code: 'CS202-CLL',
        section: 'A',
        academic_year: '2025-2026',
        description: 'Advanced data structures course',
        is_active: true,
      });

      expect(newClass.id).toBeDefined();
      expect(newClass.name).toBe('Circular Linked List');

      const student = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Alice Turing',
          roll_number: 'CS2024-CLL-01',
          email: 'alice@campus.edu',
          course: 'Circular Linked List',
          photo_path: 'inst-001/alice.jpg',
        }),
        newClass.id
      );

      expect(student.id).toBeDefined();

      // Check student enrollments
      const enrolledClasses = LocalDatabase.getStudentEnrollments(student.id);
      expect(enrolledClasses).toContain(newClass.id);

      // Check class roster
      const roster = LocalDatabase.getClassEnrollments(newClass.id);
      expect(roster.length).toBe(1);
      expect(roster[0].id).toBe(student.id);
      expect(roster[0].full_name).toBe('Alice Turing');
      expect(roster[0].roll_number).toBe('CS2024-CLL-01');
    });

    it('creates a student without initial class and later assigns class via updateStudent', () => {
      const classA = LocalDatabase.createClass({
        name: 'Circular Linked List',
        code: 'CS202-CLL',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      const student = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Bob Lovelace',
          roll_number: 'CS2024-CLL-02',
          email: 'bob@campus.edu',
          photo_path: 'inst-001/bob.jpg',
        })
      );

      // Initially not enrolled in classA
      let roster = LocalDatabase.getClassEnrollments(classA.id);
      expect(roster.length).toBe(0);

      // Update student assigning classA
      LocalDatabase.updateStudent(student.id, { full_name: 'Bob Lovelace Jr.' }, classA.id);

      roster = LocalDatabase.getClassEnrollments(classA.id);
      expect(roster.length).toBe(1);
      expect(roster[0].id).toBe(student.id);
      expect(roster[0].full_name).toBe('Bob Lovelace Jr.');

      const enrollments = LocalDatabase.getStudentEnrollments(student.id);
      expect(enrollments).toContain(classA.id);
    });

    it('switches a student from one class to another without orphaned enrollments', () => {
      const class1 = LocalDatabase.createClass({
        name: 'Circular Linked List',
        code: 'CS202-CLL',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      const class2 = LocalDatabase.createClass({
        name: 'Binary Search Trees',
        code: 'CS202-BST',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      const student = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Carol Shannon',
          roll_number: 'CS2024-CLL-03',
          email: 'carol@campus.edu',
          photo_path: 'inst-001/carol.jpg',
        }),
        class1.id
      );

      expect(LocalDatabase.getClassEnrollments(class1.id).length).toBe(1);
      expect(LocalDatabase.getClassEnrollments(class2.id).length).toBe(0);

      // Reassign to class2
      LocalDatabase.updateStudent(student.id, {}, class2.id);

      expect(LocalDatabase.getClassEnrollments(class1.id).length).toBe(0);
      expect(LocalDatabase.getClassEnrollments(class2.id).length).toBe(1);
      expect(LocalDatabase.getClassEnrollments(class2.id)[0].id).toBe(student.id);
    });
  });

  describe('2. Safe Auto-Repair of Historical Unenrolled Students (repairClassEnrollments)', () => {
    it('detects students matching course name or code and safely enrolls them', () => {
      const targetClass = LocalDatabase.createClass({
        name: 'Circular Linked List',
        code: 'CS202-CLL',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      // Legacy student created with only course text 'Circular Linked List' but no class_enrollments row
      LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'David Dijkstra',
          roll_number: 'CS2024-CLL-04',
          email: 'david@campus.edu',
          course: 'Circular Linked List',
          photo_path: 'inst-001/david.jpg',
        })
      );

      // Another legacy student matching by course code substring
      LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Eva Euler',
          roll_number: 'CS2024-CLL-05',
          email: 'eva@campus.edu',
          course: 'CS202-CLL',
          photo_path: 'inst-001/eva.jpg',
        })
      );

      // Unrelated student
      LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Frank Fourier',
          roll_number: 'EE2024-001',
          email: 'frank@campus.edu',
          course: 'Signal Processing',
          photo_path: 'inst-001/frank.jpg',
        })
      );

      // Initially roster is 0
      expect(LocalDatabase.getClassEnrollments(targetClass.id).length).toBe(0);

      // Run repairClassEnrollments
      const repairResult = LocalDatabase.repairClassEnrollments(targetClass.id);

      expect(repairResult.repairedCount).toBe(2);

      // Roster now accurately contains both students
      const updatedRoster = LocalDatabase.getClassEnrollments(targetClass.id);
      expect(updatedRoster.length).toBe(2);
      const names = updatedRoster.map((s) => s.full_name);
      expect(names).toContain('David Dijkstra');
      expect(names).toContain('Eva Euler');
      expect(names).not.toContain('Frank Fourier');

      // Running repair again is idempotent and doesn't create duplicate enrollments
      const repeatResult = LocalDatabase.repairClassEnrollments(targetClass.id);
      expect(repeatResult.repairedCount).toBe(0);
      expect(LocalDatabase.getClassEnrollments(targetClass.id).length).toBe(2);
    });
  });

  describe('3. Attendance Session and Roster Integration', () => {
    it('creates attendance session for class and verifies session roster matches enrolled students', () => {
      const cllClass = LocalDatabase.createClass({
        name: 'Circular Linked List',
        code: 'CS202-CLL',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      const s1 = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Grace Hopper',
          roll_number: 'CS2024-CLL-06',
          email: 'grace@campus.edu',
          course: 'Circular Linked List',
          photo_path: 'inst-001/grace.jpg',
          face_descriptor: new Array(128).fill(0.05),
        }),
        cllClass.id
      );

      const s2 = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Henry Von Neumann',
          roll_number: 'CS2024-CLL-07',
          email: 'henry@campus.edu',
          course: 'Circular Linked List',
          photo_path: 'inst-001/henry.jpg',
        }),
        cllClass.id
      );

      // Create attendance session
      const session = LocalDatabase.createAttendanceSession({
        class_id: cllClass.id,
        title: 'Lecture 1 - CLL Traversal',
        session_date: new Date().toISOString().split('T')[0],
        start_time: '10:00',
        end_time: '11:00',
      });

      expect(session.id).toBeDefined();

      // Verify records were automatically initialized for all enrolled students
      const records = LocalDatabase.getSessionRecords(session.id);
      expect(records.length).toBe(2);
      const studentIdsInRecords = records.map((r) => r.student_id);
      expect(studentIdsInRecords).toContain(s1.id);
      expect(studentIdsInRecords).toContain(s2.id);

      // Verify enrolled with face descriptor vs missing descriptor
      const enrolledRoster = LocalDatabase.getClassEnrollments(cllClass.id);
      const with128d = enrolledRoster.filter(
        (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
      );
      const without128d = enrolledRoster.filter(
        (s) => !s.face_descriptor || !Array.isArray(s.face_descriptor) || s.face_descriptor.length !== 128
      );

      expect(with128d.length).toBe(1);
      expect(with128d[0].id).toBe(s1.id);
      expect(without128d.length).toBe(1);
      expect(without128d[0].id).toBe(s2.id);
    });

    it('adds new student to active sessions automatically when enrolled in class', () => {
      const bstClass = LocalDatabase.createClass({
        name: 'Binary Search Trees',
        code: 'CS202-BST',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      // Create session first when 0 students enrolled
      const session = LocalDatabase.createAttendanceSession({
        class_id: bstClass.id,
        title: 'Lecture 1 - BST Search',
        session_date: new Date().toISOString().split('T')[0],
        start_time: '09:00',
        end_time: '10:00',
      });

      expect(LocalDatabase.getSessionRecords(session.id).length).toBe(0);

      // Now create and enroll student
      const student = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Ivy Knuth',
          roll_number: 'CS2024-BST-01',
          email: 'ivy@campus.edu',
          course: 'Binary Search Trees',
          photo_path: 'inst-001/ivy.jpg',
        }),
        bstClass.id
      );

      // Student is now in the active session's baseline attendance records
      const updatedRecords = LocalDatabase.getSessionRecords(session.id);
      expect(updatedRecords.length).toBe(1);
      expect(updatedRecords[0].student_id).toBe(student.id);
      expect(updatedRecords[0].status).toBe('unmarked');
    });
  });

  describe('4. Direct Class Roster Manual Add & Remove Operations', () => {
    it('manually enrolls candidate student and verifies attendance record creation', () => {
      const cls = LocalDatabase.createClass({
        name: 'Distributed Systems',
        code: 'CS401-DS',
        section: 'A',
        academic_year: '2025-2026',
        is_active: true,
      });

      const s = LocalDatabase.createStudent(
        createMockStudent({
          full_name: 'Jack Lamport',
          roll_number: 'CS2024-DS-01',
          email: 'jack@campus.edu',
          course: 'Computer Science',
          photo_path: 'inst-001/jack.jpg',
        })
      );

      expect(LocalDatabase.getClassEnrollments(cls.id).length).toBe(0);

      LocalDatabase.enrollStudentInClass(cls.id, s.id);
      expect(LocalDatabase.getClassEnrollments(cls.id).length).toBe(1);

      LocalDatabase.removeStudentFromClass(cls.id, s.id);
      expect(LocalDatabase.getClassEnrollments(cls.id).length).toBe(0);
    });
  });
});
