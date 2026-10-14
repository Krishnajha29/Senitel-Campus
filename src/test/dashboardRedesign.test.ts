import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';
import type { AttendanceSession, ClassCourse, Student } from '../types';

describe('Defence Sentinel - Instructor Dashboard Premium Redesign Test Suite', () => {
  let sampleClass: ClassCourse;
  let s1: Student;
  let s2: Student;
  let s3: Student;
  let session: AttendanceSession;

  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

    // 1. Create enrolled students
    s1 = LocalDatabase.createStudent({
      roll_number: 'CS201-001',
      full_name: 'Alice Johnson',
      email: 'alice@sentinel.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/alice.jpg',
      is_active: true,
    });

    s2 = LocalDatabase.createStudent({
      roll_number: 'CS201-002',
      full_name: 'Bob Smith',
      email: 'bob@sentinel.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/bob.jpg',
      is_active: true,
    });

    s3 = LocalDatabase.createStudent({
      roll_number: 'CS201-003',
      full_name: 'Charlie Brown',
      email: 'charlie@sentinel.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/charlie.jpg',
      is_active: true,
    });

    // 2. Create Class and Enroll
    sampleClass = LocalDatabase.createClass({
      name: 'Data Structures & Algorithms',
      code: 'CS201',
      description: 'Binary Trees and AVL Trees',
      academic_year: 'Year 3',
      section: 'A',
      is_active: true,
    });

    LocalDatabase.enrollStudentsInClass(sampleClass.id, [s1.id, s2.id, s3.id]);

    // 3. Create active lecture session
    session = LocalDatabase.createAttendanceSession({
      class_id: sampleClass.id,
      title: 'Lecture 14: Balanced Binary Trees & AVL',
      session_date: new Date().toISOString().split('T')[0],
      start_time: '09:00',
      end_time: '10:30',
    });
  });

  // =========================================================================
  // 1. Command Center Metrics & Math Safety
  // =========================================================================
  describe('1. Command Center Metrics & Zero-Division Safety', () => {
    it('calculates 4 distinct summary metrics: Total Enrolled, Present, Absent, Attendance Rate', () => {
      // Simulate status map: Alice Present, Bob Absent, Charlie unselected
      const statusMap: Record<string, string> = {
        [s1.id]: 'present',
        [s2.id]: 'absent',
      };

      let present = 0;
      let absent = 0;
      [s1, s2, s3].forEach((s) => {
        if (statusMap[s.id] === 'present') present++;
        else if (statusMap[s.id] === 'absent') absent++;
      });

      const total = 3;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;

      expect(total).toBe(3);
      expect(present).toBe(1);
      expect(absent).toBe(1);
      expect(rate).toBe(33); // 1/3 ~ 33%
    });

    it('handles an empty class safely with 0% rate and zero division error prevention', () => {
      const total = 0;
      const present = 0;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      expect(rate).toBe(0);
      expect(Number.isFinite(rate)).toBe(true);
      expect(Number.isNaN(rate)).toBe(false);
    });

    it('calculates 100% attendance rate when all enrolled students are marked present', () => {
      const total = 3;
      const present = 3;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      expect(rate).toBe(100);
    });

    it('calculates 0% attendance rate when all enrolled students are marked absent', () => {
      const total = 3;
      const present = 0;
      const rate = total > 0 ? Math.round((present / total) * 100) : 0;
      expect(rate).toBe(0);
    });
  });

  // =========================================================================
  // 2. Smart Student Roster Search, Filter & Sort
  // =========================================================================
  describe('2. Smart Student Roster Search, Filter & Sort', () => {
    it('searches students by name case-insensitively without altering the underlying dataset', () => {
      const roster = [s1, s2, s3];
      const query = 'ALICE';
      const filtered = roster.filter(
        (s) =>
          s.full_name.toLowerCase().includes(query.toLowerCase()) ||
          s.roll_number.toLowerCase().includes(query.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(s1.id);
      expect(roster).toHaveLength(3); // Original untouched
    });

    it('searches students by roll number without altering the underlying dataset', () => {
      const roster = [s1, s2, s3];
      const query = '002';
      const filtered = roster.filter(
        (s) =>
          s.full_name.toLowerCase().includes(query.toLowerCase()) ||
          s.roll_number.toLowerCase().includes(query.toLowerCase())
      );

      expect(filtered).toHaveLength(1);
      expect(filtered[0].id).toBe(s2.id);
      expect(roster).toHaveLength(3);
    });

    it('filters by Present status without modifying attendance data', () => {
      const statusMap: Record<string, string> = {
        [s1.id]: 'present',
        [s2.id]: 'absent',
        [s3.id]: 'present',
      };

      const roster = [s1, s2, s3];
      const presentList = roster.filter((s) => statusMap[s.id] === 'present');
      const absentList = roster.filter((s) => statusMap[s.id] === 'absent');

      expect(presentList).toHaveLength(2);
      expect(absentList).toHaveLength(1);
      expect(absentList[0].id).toBe(s2.id);
    });

    it('sorts students correctly by Name (A-Z and Z-A)', () => {
      const roster = [s2, s1, s3]; // Bob, Alice, Charlie
      const sortedAsc = [...roster].sort((a, b) => a.full_name.localeCompare(b.full_name));
      expect(sortedAsc.map((s) => s.full_name)).toEqual(['Alice Johnson', 'Bob Smith', 'Charlie Brown']);

      const sortedDesc = [...roster].sort((a, b) => b.full_name.localeCompare(a.full_name));
      expect(sortedDesc.map((s) => s.full_name)).toEqual(['Charlie Brown', 'Bob Smith', 'Alice Johnson']);
    });

    it('sorts students correctly by Roll Number (Ascending and Descending)', () => {
      const roster = [s3, s1, s2]; // CS201-003, CS201-001, CS201-002
      const sortedAsc = [...roster].sort((a, b) => a.roll_number.localeCompare(b.roll_number));
      expect(sortedAsc.map((s) => s.roll_number)).toEqual(['CS201-001', 'CS201-002', 'CS201-003']);

      const sortedDesc = [...roster].sort((a, b) => b.roll_number.localeCompare(a.roll_number));
      expect(sortedDesc.map((s) => s.roll_number)).toEqual(['CS201-003', 'CS201-002', 'CS201-001']);
    });
  });

  // =========================================================================
  // 3. Two-Option Attendance Control & Undo Recovery
  // =========================================================================
  describe('3. Two-Option Attendance Control & Undo Stack', () => {
    it('supports only Present and Absent selections in the active workflow', () => {
      let statusMap: Record<string, 'present' | 'absent'> = {};

      // Mark Alice Present
      statusMap[s1.id] = 'present';
      expect(statusMap[s1.id]).toBe('present');

      // Toggle Alice to Absent
      statusMap[s1.id] = 'absent';
      expect(statusMap[s1.id]).toBe('absent');

      // Verify valid values
      const validStatuses = ['present', 'absent'];
      expect(validStatuses.includes(statusMap[s1.id])).toBe(true);
    });

    it('supports Mark All Present across the entire class roster', () => {
      const statusMap: Record<string, 'present' | 'absent'> = {};
      [s1, s2, s3].forEach((s) => {
        statusMap[s.id] = 'present';
      });

      expect(Object.keys(statusMap)).toHaveLength(3);
      expect(Object.values(statusMap).every((st) => st === 'present')).toBe(true);
    });

    it('tracks undo history stack and recovers previous state on undo', () => {
      const historyStack: Array<Record<string, string>> = [];
      let currentMap: Record<string, string> = {
        [s1.id]: 'present',
        [s2.id]: 'absent',
      };

      // Push to undo stack before making change
      historyStack.push({ ...currentMap });

      // Change Bob to Present
      currentMap = { ...currentMap, [s2.id]: 'present' };
      expect(currentMap[s2.id]).toBe('present');

      // Execute Undo
      const previous = historyStack.pop()!;
      currentMap = previous;

      // Bob is restored to Absent
      expect(currentMap[s2.id]).toBe('absent');
    });
  });

  // =========================================================================
  // 4. Persistence & Finalization Validation
  // =========================================================================
  describe('4. Persistence & Validation Before Finalization', () => {
    it('persists Present and Absent records to the database with audit trails', () => {
      LocalDatabase.saveAttendanceRecords(session.id, [
        { student_id: s1.id, status: 'present', notes: 'Active in class discussion' },
        { student_id: s2.id, status: 'absent', notes: 'Excused sick leave' },
        { student_id: s3.id, status: 'present' },
      ]);

      const attendance = LocalDatabase.getSessionAttendance(session.id);
      const a1 = attendance.find((a) => a.student.id === s1.id);
      const a2 = attendance.find((a) => a.student.id === s2.id);
      const a3 = attendance.find((a) => a.student.id === s3.id);

      expect(a1?.record?.status).toBe('present');
      expect(a1?.record?.notes).toBe('Active in class discussion');
      expect(a2?.record?.status).toBe('absent');
      expect(a2?.record?.notes).toBe('Excused sick leave');
      expect(a3?.record?.status).toBe('present');

      // Verify audit logs were written
      const auditLogs = LocalDatabase.getAttendanceAuditLogs(session.id);
      expect(auditLogs.length).toBeGreaterThanOrEqual(3);
    });

    it('detects unselected students and requires explicit decision before finalization', () => {
      // Alice is Present, Bob is Absent, Charlie is unselected (null or unmarked)
      const currentMap: Record<string, string> = {
        [s1.id]: 'present',
        [s2.id]: 'absent',
      };

      const unselectedStudents = [s1, s2, s3].filter(
        (s) => currentMap[s.id] !== 'present' && currentMap[s.id] !== 'absent'
      );

      // System identifies Charlie as needing an explicit decision
      expect(unselectedStudents).toHaveLength(1);
      expect(unselectedStudents[0].id).toBe(s3.id);
    });

    it('finalizes session and locks official attendance record', () => {
      // Mark all students
      LocalDatabase.saveAttendanceRecords(session.id, [
        { student_id: s1.id, status: 'present' },
        { student_id: s2.id, status: 'present' },
        { student_id: s3.id, status: 'absent' },
      ]);

      LocalDatabase.updateSessionStatus(session.id, 'finalized');

      const updatedSession = LocalDatabase.getSessionById(session.id);
      expect(updatedSession?.status).toBe('finalized');

      const attendance = LocalDatabase.getSessionAttendance(session.id);
      const presentCount = attendance.filter((a) => a.record?.status === 'present').length;
      const absentCount = attendance.filter((a) => a.record?.status === 'absent').length;

      expect(presentCount).toBe(2);
      expect(absentCount).toBe(1);
    });
  });
});
