import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';

describe('Sentinel Campus — Institutional Section-Based Automatic Student Roster', () => {
  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();
  });

  // 1. Test creating academic sections
  it('1. creates academic sections with unique cohort properties', () => {
    const secA = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
      semester: 'Semester 5',
    });

    expect(secA.id).toBeDefined();
    expect(secA.programme).toBe('B.Tech Software Engineering');
    expect(secA.batch).toBe('2024-2028');
    expect(secA.academic_year).toBe('2026-2027');
    expect(secA.section).toBe('A');
    expect(secA.is_active).toBe(true);

    const allSections = LocalDatabase.getSections();
    expect(allSections.length).toBe(1);
    expect(allSections[0].id).toBe(secA.id);
  });

  // 2. Test registering students and linking them to a section
  it('2. registers students and automatically links them to an institutional section', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const student = LocalDatabase.createStudent({
      full_name: 'John Doe',
      roll_number: 'SE2024-001',
      email: 'john@campus.edu',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: section.section,
      section_id: section.id,
      photo_path: 'inst-01/john.jpg',
      is_active: true,
    });

    expect(student.id).toBeDefined();
    expect(student.section_id).toBe(section.id);

    const sectionStudents = LocalDatabase.getSectionStudents(section.id);
    expect(sectionStudents.length).toBe(1);
    expect(sectionStudents[0].id).toBe(student.id);
    expect(sectionStudents[0].roll_number).toBe('SE2024-001');
  });

  // 3. Test creating a class linked to an academic section
  it('3. creates a class course linked to an institutional academic section', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const cls = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      programme: section.programme,
      batch: section.batch,
      section_id: section.id,
      enrollment_type: 'section',
      is_active: true,
    });

    expect(cls.id).toBeDefined();
    expect(cls.section_id).toBe(section.id);
    expect(cls.enrollment_type).toBe('section');
    expect(cls.programme).toBe('B.Tech Software Engineering');
  });

  // 4. Test that getClassEnrollments(classId) returns all active students in the section without manual enrollment records
  it('4. automatically returns all active section students for class roster without manual class enrollments', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    // Register 3 students into this section
    const s1 = LocalDatabase.createStudent({
      full_name: 'Alice Turing',
      roll_number: 'SE-001',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/alice.jpg',
      is_active: true,
    });

    const s2 = LocalDatabase.createStudent({
      full_name: 'Bob Lovelace',
      roll_number: 'SE-002',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/bob.jpg',
      is_active: true,
    });

    const s3 = LocalDatabase.createStudent({
      full_name: 'Charlie Shannon',
      roll_number: 'SE-003',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/charlie.jpg',
      is_active: true,
    });

    // Create class for this section
    const cllClass = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      programme: section.programme,
      batch: section.batch,
      section_id: section.id,
      enrollment_type: 'section',
      is_active: true,
    });

    // No explicit call to enrollStudentsInClass was ever made!
    const roster = LocalDatabase.getClassEnrollments(cllClass.id);
    expect(roster.length).toBe(3);
    const rosterIds = roster.map((s) => s.id);
    expect(rosterIds).toContain(s1.id);
    expect(rosterIds).toContain(s2.id);
    expect(rosterIds).toContain(s3.id);

    // Verify live class enrolled_count is computed dynamically
    const retrievedClass = LocalDatabase.getClassById(cllClass.id);
    expect(retrievedClass?.enrolled_count).toBe(3);
  });

  // 5. Test that inactive students in the section are excluded from the class roster
  it('5. excludes inactive students in the section from the active class roster', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const activeStudent = LocalDatabase.createStudent({
      full_name: 'Active Student',
      roll_number: 'ACT-001',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/act.jpg',
      is_active: true,
    });

    const inactiveStudent = LocalDatabase.createStudent({
      full_name: 'Inactive Student',
      roll_number: 'INACT-002',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/inact.jpg',
      is_active: false,
    });

    const cllClass = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      enrollment_type: 'section',
      is_active: true,
    });

    const roster = LocalDatabase.getClassEnrollments(cllClass.id);
    expect(roster.length).toBe(1);
    expect(roster[0].id).toBe(activeStudent.id);
    expect(roster.find((s) => s.id === inactiveStudent.id)).toBeUndefined();
  });

  // 6. Test that students assigned to a different section are not included
  it('6. does not include students assigned to a different section', () => {
    const sectionA = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const sectionB = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'B',
    });

    const studentA = LocalDatabase.createStudent({
      full_name: 'Student Sec A',
      roll_number: 'SEC-A-01',
      course: sectionA.programme,
      batch: sectionA.batch,
      academic_year: sectionA.academic_year,
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'photos/a.jpg',
      is_active: true,
    });

    const studentB = LocalDatabase.createStudent({
      full_name: 'Student Sec B',
      roll_number: 'SEC-B-01',
      course: sectionB.programme,
      batch: sectionB.batch,
      academic_year: sectionB.academic_year,
      section: 'B',
      section_id: sectionB.id,
      photo_path: 'photos/b.jpg',
      is_active: true,
    });

    const classA = LocalDatabase.createClass({
      name: 'Data Structures - Section A',
      code: 'CS202-A',
      section: 'A',
      academic_year: '2026-2027',
      section_id: sectionA.id,
      enrollment_type: 'section',
      is_active: true,
    });

    const rosterA = LocalDatabase.getClassEnrollments(classA.id);
    expect(rosterA.length).toBe(1);
    expect(rosterA[0].id).toBe(studentA.id);
    expect(rosterA.find((s) => s.id === studentB.id)).toBeUndefined();
  });

  // 7. Test creating an attendance session for the class and verify that session attendance records are initialized for all section students
  it('7. initializes session attendance records for all active section students when session is created', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const s1 = LocalDatabase.createStudent({
      full_name: 'Alice',
      roll_number: 'ALICE-01',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/alice.jpg',
      is_active: true,
    });

    const s2 = LocalDatabase.createStudent({
      full_name: 'Bob',
      roll_number: 'BOB-02',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/bob.jpg',
      is_active: true,
    });

    const cllClass = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      is_active: true,
    });

    const session = LocalDatabase.createAttendanceSession({
      class_id: cllClass.id,
      title: 'Lecture 1: Introduction to Nodes and Pointers',
      session_date: '2026-10-15',
      start_time: '10:00',
      end_time: '11:30',
    });

    const records = LocalDatabase.getAttendanceRecords(session.id);
    expect(records.length).toBe(2);
    const studentIds = records.map((r) => r.student_id);
    expect(studentIds).toContain(s1.id);
    expect(studentIds).toContain(s2.id);
    expect(records[0].status.toLowerCase()).toBe('unmarked');
    expect(records[1].status.toLowerCase()).toBe('unmarked');
  });

  // 8. Test that changing a student's section after a session is created does not mutate or delete historical attendance records for prior sessions
  it('8. preserves historical attendance records when a student changes sections later', () => {
    const sectionA = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const sectionB = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'B',
    });

    const student = LocalDatabase.createStudent({
      full_name: 'Transfer Student',
      roll_number: 'TR-001',
      course: sectionA.programme,
      batch: sectionA.batch,
      academic_year: sectionA.academic_year,
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'photos/tr.jpg',
      is_active: true,
    });

    const classA = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: sectionA.id,
      is_active: true,
    });

    // Create session in Section A and record PRESENT
    const sessionPast = LocalDatabase.createAttendanceSession({
      class_id: classA.id,
      title: 'Historical Session 1',
      session_date: '2026-10-10',
      start_time: '09:00',
      end_time: '10:30',
    });

    LocalDatabase.updateAttendanceRecord(sessionPast.id, student.id, {
      status: 'present',
      method: 'face_recognition',
      confidence_score: 0.95,
    });

    // Student later changes sections from A to B
    LocalDatabase.updateStudent(student.id, {
      section: 'B',
      section_id: sectionB.id,
    });

    // Verify historical attendance record is completely intact
    const pastRecords = LocalDatabase.getAttendanceRecords(sessionPast.id);
    const studentPastRecord = pastRecords.find((r) => r.student_id === student.id);
    expect(studentPastRecord).toBeDefined();
    expect(studentPastRecord?.status.toLowerCase()).toBe('present');
    expect(studentPastRecord?.confidence_score).toBe(0.95);

    // But for a NEW session in Class A created today, student is NOT in the initial roster
    const sessionNew = LocalDatabase.createAttendanceSession({
      class_id: classA.id,
      title: 'New Session 2',
      session_date: '2026-10-15',
      start_time: '09:00',
      end_time: '10:30',
    });

    const newRecords = LocalDatabase.getAttendanceRecords(sessionNew.id);
    expect(newRecords.find((r) => r.student_id === student.id)).toBeUndefined();
  });

  // 9. Test refreshing an active session's roster (refreshSessionRoster) when a new student is added to the section
  it('9. adds newly registered section students to active session via refreshSessionRoster without overwriting existing marks', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const s1 = LocalDatabase.createStudent({
      full_name: 'Original Student',
      roll_number: 'ORIG-001',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/orig.jpg',
      is_active: true,
    });

    const cls = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      is_active: true,
    });

    const activeSession = LocalDatabase.createAttendanceSession({
      class_id: cls.id,
      title: 'Live Lab Session',
      session_date: '2026-10-15',
      start_time: '14:00',
      end_time: '15:30',
    });

    // Mark original student as PRESENT
    LocalDatabase.updateAttendanceRecord(activeSession.id, s1.id, {
      status: 'present',
      method: 'manual',
    });

    // Now a new student joins Section A mid-session
    const s2 = LocalDatabase.createStudent({
      full_name: 'Late Enrollee',
      roll_number: 'LATE-002',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/late.jpg',
      is_active: true,
    });

    // Instructor clicks "Refresh Section Roster"
    LocalDatabase.refreshSessionRoster(activeSession.id);
    const refreshedRecords = LocalDatabase.getAttendanceRecords(activeSession.id);
    expect(refreshedRecords.length).toBe(2);

    // Verify original student is still PRESENT and NOT reset to UNMARKED
    const s1Record = refreshedRecords.find((r) => r.student_id === s1.id);
    expect(s1Record?.status.toLowerCase()).toBe('present');

    // Verify late enrollee was added as UNMARKED without duplicating
    const s2Record = refreshedRecords.find((r) => r.student_id === s2.id);
    expect(s2Record?.status.toLowerCase()).toBe('unmarked');

    // Calling refresh a second time must NOT create duplicates
    LocalDatabase.refreshSessionRoster(activeSession.id);
    const doubleRefreshed = LocalDatabase.getAttendanceRecords(activeSession.id);
    expect(doubleRefreshed.length).toBe(2);
  });

  // 10. Test elective / manual enrollment type
  it('10. respects manual enrollment type for electives without auto-populating all section students', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const s1 = LocalDatabase.createStudent({
      full_name: 'Student 1',
      roll_number: 'STU-01',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/s1.jpg',
      is_active: true,
    });

    const s2 = LocalDatabase.createStudent({
      full_name: 'Student 2',
      roll_number: 'STU-02',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/s2.jpg',
      is_active: true,
    });

    // Create an elective class with enrollment_type = 'manual'
    const electiveClass = LocalDatabase.createClass({
      name: 'Quantum Computing Elective',
      code: 'QC401',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      enrollment_type: 'manual',
      is_active: true,
    });

    // In manual mode, roster is initially empty
    let roster = LocalDatabase.getClassEnrollments(electiveClass.id);
    expect(roster.length).toBe(0);

    // Explicitly enroll only s1
    LocalDatabase.enrollStudentsInClass(electiveClass.id, [s1.id]);

    roster = LocalDatabase.getClassEnrollments(electiveClass.id);
    expect(roster.length).toBe(1);
    expect(roster[0].id).toBe(s1.id);
    expect(roster.find((s) => s.id === s2.id)).toBeUndefined();
  });

  // 11. Test that FaceAttendanceModal receives the correct section student count and list
  it('11. provides correct section student roster and 128-d face descriptors to face recognition workflow', () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const mockDescriptor = new Array(128).fill(0.123);

    const s1 = LocalDatabase.createStudent({
      full_name: 'Biometric Enrolled Student',
      roll_number: 'BIO-001',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/bio.jpg',
      face_descriptor: mockDescriptor,
      face_enrollment_status: 'enrolled',
      is_active: true,
    });

    const s2 = LocalDatabase.createStudent({
      full_name: 'Pending Biometric Student',
      roll_number: 'BIO-002',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/pending.jpg',
      face_descriptor: null,
      face_enrollment_status: 'not_enrolled',
      is_active: true,
    });

    const cllClass = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      is_active: true,
    });

    // Face Attendance queries getClassEnrollments
    const enrolledStudents = LocalDatabase.getClassEnrollments(cllClass.id);
    expect(enrolledStudents.length).toBe(2);

    const enrolledWithFaces = enrolledStudents.filter(
      (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
    );
    expect(enrolledWithFaces.length).toBe(1);
    expect(enrolledWithFaces[0].id).toBe(s1.id);
    expect(enrolledWithFaces[0].face_descriptor?.length).toBe(128);

    const needingBiometrics = enrolledStudents.filter(
      (s) => (!s.face_descriptor || s.face_descriptor.length !== 128) && s.photo_path
    );
    expect(needingBiometrics.length).toBe(1);
    expect(needingBiometrics[0].id).toBe(s2.id);
  });

  // 12. Test presence key and session roll generation using the section-based roster
  it('12. generates presence key sessions and roll sheets containing the full section roster', async () => {
    const section = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const s1 = LocalDatabase.createStudent({
      full_name: 'Roll Student 1',
      roll_number: 'RS-01',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/rs1.jpg',
      is_active: true,
    });

    const s2 = LocalDatabase.createStudent({
      full_name: 'Roll Student 2',
      roll_number: 'RS-02',
      course: section.programme,
      batch: section.batch,
      academic_year: section.academic_year,
      section: 'A',
      section_id: section.id,
      photo_path: 'photos/rs2.jpg',
      is_active: true,
    });

    const cllClass = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      section_id: section.id,
      is_active: true,
    });

    const session = LocalDatabase.createAttendanceSession({
      class_id: cllClass.id,
      title: 'Presence Key Verification Session',
      session_date: '2026-10-15',
      start_time: '11:00',
      end_time: '12:00',
    });

    // Generate presence key for session
    const presenceKeyObj = await LocalDatabase.generatePresenceKey(session.id);
    expect(presenceKeyObj).toBeDefined();
    expect(presenceKeyObj.plain_key).toBeDefined();
    expect(presenceKeyObj.plain_key!.length).toBeGreaterThan(4);

    // Verify session attendance roll sheet is loaded with both section students
    const rollRecords = LocalDatabase.getAttendanceRecords(session.id);
    expect(rollRecords.length).toBe(2);

    // Student 1 submits presence key
    const checkInResult = await LocalDatabase.validateStudentCheckIn(presenceKeyObj.plain_key!, s1.id);
    expect(checkInResult.success).toBe(true);

    const updatedRecords = LocalDatabase.getAttendanceRecords(session.id);
    const s1Mark = updatedRecords.find((r) => r.student_id === s1.id);
    expect(s1Mark?.status.toLowerCase()).toBe('present');

    const s2Mark = updatedRecords.find((r) => r.student_id === s2.id);
    expect(s2Mark?.status.toLowerCase()).toBe('unmarked');
  });

  // 13. Test multi-instructor isolation: section rosters and students belonging to instructor A are never visible to instructor B
  it('13. enforces instructor isolation so section rosters and students are scoped to each instructor', () => {
    // Instructor A
    LocalDatabase.setCurrentInstructor({
      id: 'instructor-a',
      email: 'inst-a@campus.edu',
      full_name: 'Instructor Alice',
      institution: 'Engineering Campus',
      department: 'Computer Science',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    const secA = LocalDatabase.createSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const studentA = LocalDatabase.createStudent({
      full_name: 'Instructor A Student',
      roll_number: 'INST-A-01',
      course: secA.programme,
      batch: secA.batch,
      academic_year: secA.academic_year,
      section: 'A',
      section_id: secA.id,
      photo_path: 'inst-a/student.jpg',
      is_active: true,
    });
    expect(studentA.id).toBeDefined();

    const classA = LocalDatabase.createClass({
      name: 'Class by Instructor A',
      code: 'CS-A',
      section: 'A',
      academic_year: '2026-2027',
      section_id: secA.id,
      is_active: true,
    });

    expect(LocalDatabase.getSections().length).toBe(1);
    expect(LocalDatabase.getStudents().length).toBe(1);
    expect(LocalDatabase.getClassEnrollments(classA.id).length).toBe(1);

    // Switch to Instructor B
    LocalDatabase.setCurrentInstructor({
      id: 'instructor-b',
      email: 'inst-b@campus.edu',
      full_name: 'Instructor Bob',
      institution: 'Engineering Campus',
      department: 'Computer Science',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    expect(LocalDatabase.getSections().length).toBe(0);
    expect(LocalDatabase.getStudents().length).toBe(0);
    expect(LocalDatabase.getClasses().length).toBe(0);

    // If Instructor B queries Class A, it should return an empty roster due to tenant boundary
    expect(LocalDatabase.getClassEnrollments(classA.id).length).toBe(0);

    // Reset back to default
    LocalDatabase.setCurrentInstructor(null);
  });

  // 14. Test B & C: Three subjects (Circular Linked List, Express.js, Data Structures and Algorithms)
  // for the same Section A with unicode dashes, verifying exact same students and Section B isolation
  it('14. shares the exact same student roster across Express.js, Circular Linked List, and Data Structures without manual enrollments, maintaining Section B isolation', () => {
    // Section A with unicode en-dash
    const sectionA = LocalDatabase.findOrCreateSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024–2028',
      academic_year: '2026–2027',
      section: 'Section A',
    });

    // Section B
    const sectionB = LocalDatabase.findOrCreateSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024–2028',
      academic_year: '2026–2027',
      section: 'Section B',
    });

    // 2 Students in Section A
    const studentA1 = LocalDatabase.createStudent({
      full_name: 'Alice Section A',
      roll_number: 'SE-A-01',
      course: 'B.Tech Software Engineering',
      batch: '2024-2028', // hyphen variant
      academic_year: '2026-2027',
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'photos/a1.jpg',
      is_active: true,
    });

    const studentA2 = LocalDatabase.createStudent({
      full_name: 'Bob Section A',
      roll_number: 'SE-A-02',
      course: 'B.Tech Software Engineering',
      batch: '2024–2028', // en-dash variant
      academic_year: '2026–2027',
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'photos/a2.jpg',
      is_active: true,
    });

    // 1 Student in Section B
    const studentB1 = LocalDatabase.createStudent({
      full_name: 'Charlie Section B',
      roll_number: 'SE-B-01',
      course: 'B.Tech Software Engineering',
      batch: '2024–2028',
      academic_year: '2026–2027',
      section: 'B',
      section_id: sectionB.id,
      photo_path: 'photos/b1.jpg',
      is_active: true,
    });

    // Create 3 subject offerings assigned to Section A
    const subject1 = LocalDatabase.createClass({
      name: 'Circular Linked List',
      code: 'CS202',
      section: 'A',
      academic_year: '2026-2027',
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      section_id: sectionA.id,
      enrollment_type: 'section',
      is_active: true,
    });

    const subject2 = LocalDatabase.createClass({
      name: 'Express.js',
      code: 'CS305',
      section: 'A',
      academic_year: '2026-2027',
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      section_id: sectionA.id,
      enrollment_type: 'section',
      is_active: true,
    });

    const subject3 = LocalDatabase.createClass({
      name: 'Data Structures and Algorithms',
      code: 'CS201',
      section: 'A',
      academic_year: '2026-2027',
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      section_id: sectionA.id,
      enrollment_type: 'section',
      is_active: true,
    });

    // Verify all 3 subjects return the EXACT same Section A students
    const roster1 = LocalDatabase.getClassEnrollments(subject1.id);
    const roster2 = LocalDatabase.getClassEnrollments(subject2.id);
    const roster3 = LocalDatabase.getClassEnrollments(subject3.id);

    expect(roster1.length).toBe(2);
    expect(roster2.length).toBe(2);
    expect(roster3.length).toBe(2);

    const ids1 = roster1.map((s) => s.id).sort();
    const ids2 = roster2.map((s) => s.id).sort();
    const ids3 = roster3.map((s) => s.id).sort();
    const expectedIds = [studentA1.id, studentA2.id].sort();

    expect(ids1).toEqual(expectedIds);
    expect(ids2).toEqual(expectedIds);
    expect(ids3).toEqual(expectedIds);

    // Verify Section B student is completely isolated and never in any of the 3 rosters
    expect(ids1).not.toContain(studentB1.id);
    expect(ids2).not.toContain(studentB1.id);
    expect(ids3).not.toContain(studentB1.id);
  });

  // 15. Test D: Face attendance retrieval for Express.js with 128-d face descriptors
  it('15. loads Express.js full section roster and 128-d face descriptors for face recognition attendance', () => {
    const sectionA = LocalDatabase.findOrCreateSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const faceDescriptor128 = Array.from({ length: 128 }, (_, i) => Math.sin(i));

    const studentWithFace = LocalDatabase.createStudent({
      full_name: 'Face Registered Student',
      roll_number: 'EXP-01',
      course: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'students/exp01.jpg',
      face_descriptor: faceDescriptor128,
      face_enrollment_status: 'enrolled',
      is_active: true,
    });

    const expressClass = LocalDatabase.createClass({
      name: 'Express.js',
      code: 'CS305',
      section: 'A',
      academic_year: '2026-2027',
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      section_id: sectionA.id,
      enrollment_type: 'section',
      is_active: true,
    });

    const enrolled = LocalDatabase.getClassEnrollments(expressClass.id);
    expect(enrolled.length).toBe(1);
    expect(enrolled[0].id).toBe(studentWithFace.id);
    expect(enrolled[0].face_descriptor).toHaveLength(128);
    expect(enrolled[0].face_enrollment_status).toBe('enrolled');
  });

  // 16. Legacy Class Self-Healing: Class created with only section = 'A' automatically resolves Section A students
  it('16. self-heals legacy classes that only specify section = "A" without section_id or programme', () => {
    // Instructor already has Section A students registered
    const sectionA = LocalDatabase.findOrCreateSection({
      programme: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
    });

    const student = LocalDatabase.createStudent({
      full_name: 'Existing Student',
      roll_number: 'LEG-01',
      course: 'B.Tech Software Engineering',
      batch: '2024-2028',
      academic_year: '2026-2027',
      section: 'A',
      section_id: sectionA.id,
      photo_path: 'photos/leg.jpg',
      is_active: true,
    });

    // Create a legacy class with ONLY name and section='A'
    const legacyClass = LocalDatabase.createClass({
      name: 'Legacy Subject Without Cohort',
      code: 'LEG101',
      section: 'A',
      academic_year: '2026-2027',
      is_active: true,
    });

    // At creation, legacyClass has no section_id
    expect(legacyClass.section_id).toBeFalsy();

    // Querying enrollments should auto-heal and return the Section A students
    const roster = LocalDatabase.getClassEnrollments(legacyClass.id);
    expect(roster.length).toBe(1);
    expect(roster[0].id).toBe(student.id);

    // Verify the class record in the database was healed with the section_id
    const healedClass = LocalDatabase.getClassById(legacyClass.id);
    expect(healedClass?.section_id).toBe(sectionA.id);
  });
});
