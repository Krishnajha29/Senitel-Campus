import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';
import {
  generateCryptographicKey,
  generateSalt,
  hashPresenceKey,
  timingSafeEqual,
} from '../services/crypto';
import type { AttendanceSession, ClassCourse, Student } from '../types';

describe('Sentinel Campus - Step 2: Secure Presence Keys & Check-in Test Suite', () => {
  let sampleClass: ClassCourse;
  let enrolledStudent1: Student;
  let enrolledStudent2: Student;
  let unenrolledStudent: Student;
  let sampleSession: AttendanceSession;

  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

    // 1. Create Students
    enrolledStudent1 = LocalDatabase.createStudent({
      roll_number: 'CS2026-001',
      full_name: 'Alice Cooper',
      email: 'alice@campus.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/alice.jpg',
      is_active: true,
    });

    enrolledStudent2 = LocalDatabase.createStudent({
      roll_number: 'CS2026-002',
      full_name: 'Bob Martin',
      email: 'bob@campus.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/bob.jpg',
      is_active: true,
    });

    unenrolledStudent = LocalDatabase.createStudent({
      roll_number: 'ME2026-099',
      full_name: 'Charlie Brown',
      email: 'charlie@campus.edu',
      course: 'B.Tech ME',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'B',
      photo_path: 'students/charlie.jpg',
      is_active: true,
    });

    // 2. Create Class and Enroll Alice and Bob
    sampleClass = LocalDatabase.createClass({
      name: 'Distributed Systems & Cloud Security',
      code: 'CS-401',
      academic_year: '2026-2027',
      section: 'Sec-A',
      is_active: true,
    });

    LocalDatabase.enrollStudentsInClass(sampleClass.id, [enrolledStudent1.id, enrolledStudent2.id]);

    // 3. Create Open Attendance Session
    sampleSession = LocalDatabase.createAttendanceSession({
      class_id: sampleClass.id,
      title: 'Lecture 12: Byzantine Fault Tolerance',
      session_date: new Date().toISOString().split('T')[0],
      start_time: '10:00',
      end_time: '11:30',
    });
  });

  describe('1. Cryptographic Key Generation & Hashing', () => {
    it('generates a 6-digit numeric cryptographic key between 100000 and 999999', () => {
      for (let i = 0; i < 50; i++) {
        const key = generateCryptographicKey();
        expect(key).toMatch(/^[1-9][0-9]{5}$/);
        const num = parseInt(key, 10);
        expect(num).toBeGreaterThanOrEqual(100000);
        expect(num).toBeLessThanOrEqual(999999);
      }
    });

    it('generates unpredictable non-sequential keys', () => {
      const keys = new Set<string>();
      for (let i = 0; i < 20; i++) {
        keys.add(generateCryptographicKey());
      }
      expect(keys.size).toBeGreaterThanOrEqual(19);
    });

    it('generates distinct random salts', () => {
      const salt1 = generateSalt();
      const salt2 = generateSalt();
      expect(salt1).not.toBe(salt2);
      expect(salt1.length).toBeGreaterThanOrEqual(16);
    });

    it('binds hash cryptographically to the sessionId (prevents replay across lectures)', async () => {
      const salt = generateSalt();
      const key = '654321';

      const hashSessionA = await hashPresenceKey(salt, key, 'session-A');
      const hashSessionB = await hashPresenceKey(salt, key, 'session-B');

      expect(hashSessionA).not.toBe(hashSessionB);
    });

    it('verifies constant-time comparison helper', () => {
      expect(timingSafeEqual('abcdef', 'abcdef')).toBe(true);
      expect(timingSafeEqual('abcdef', 'abcdeg')).toBe(false);
      expect(timingSafeEqual('abcdef', 'abcde')).toBe(false);
    });
  });

  describe('2. Instructor Key Lifecycle Management', () => {
    it('generates an active presence key with configured expiration', async () => {
      const presenceKey = await LocalDatabase.generatePresenceKey(
        sampleSession.id,
        15 // 15 minutes
      );

      expect(presenceKey.plain_key).toMatch(/^[1-9][0-9]{5}$/);
      expect(presenceKey.session_id).toBe(sampleSession.id);
      expect(presenceKey.status).toBe('active');
      expect(presenceKey.key_salt).toBeDefined();
      expect(presenceKey.key_hash).toBeDefined();

      const expires = new Date(presenceKey.expires_at).getTime();
      const created = new Date(presenceKey.created_at).getTime();
      const diffMinutes = Math.round((expires - created) / (60 * 1000));
      expect(diffMinutes).toBe(15);
    });

    it('retrieves active presence key for a session', async () => {
      await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const active = LocalDatabase.getActivePresenceKey(sampleSession.id);

      expect(active).not.toBeNull();
      expect(active?.session_id).toBe(sampleSession.id);
      expect(active?.status).toBe('active');
    });

    it('immediately invalidates previous key when a new key is regenerated', async () => {
      const firstKey = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      expect(firstKey.status).toBe('active');

      // Regenerate key
      const secondKey = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);

      // Check all keys in store
      const allKeys = LocalDatabase.getPresenceKeys();
      const oldKeyRecord = allKeys.find((k) => k.id === firstKey.id);

      expect(oldKeyRecord?.status).toBe('revoked');
      expect(secondKey.status).toBe('active');

      const currentActive = LocalDatabase.getActivePresenceKey(sampleSession.id);
      expect(currentActive?.id).toBe(secondKey.id);
    });

    it('revokes active key manually on instructor request', async () => {
      const presenceKey = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      expect(presenceKey.status).toBe('active');

      const revoked = LocalDatabase.revokePresenceKey(sampleSession.id);
      expect(revoked).not.toBeNull();
      expect(revoked?.status).toBe('revoked');

      const activeAfterRevoke = LocalDatabase.getActivePresenceKey(sampleSession.id);
      expect(activeAfterRevoke).toBeNull();

      const allKeys = LocalDatabase.getPresenceKeys();
      const keyRecord = allKeys.find((k) => k.id === presenceKey.id);
      expect(keyRecord?.status).toBe('revoked');
    });
  });

  describe('3. Student Presence Check-in Validation', () => {
    it('successfully checks in an enrolled student using the active key', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      const result = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);

      expect(result.success).toBe(true);
      expect(result.code).toBe('CHECKIN_SUCCESS');
      expect(result.session?.id).toBe(sampleSession.id);
      expect(result.student?.id).toBe(enrolledStudent1.id);

      // Check attendance record created
      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      const studentEntry = roster.find((entry) => entry.student.id === enrolledStudent1.id);

      expect(studentEntry).toBeDefined();
      expect(studentEntry?.record?.status).toBe('present');
      expect(studentEntry?.record?.method).toBe('presence_key');
      expect(studentEntry?.record?.marked_at).toBeDefined();
    });

    it('handles idempotent duplicate check-in gracefully without duplicate records', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // First check-in
      const firstResult = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(firstResult.success).toBe(true);
      expect(firstResult.already_checked_in).toBeFalsy();

      // Second check-in (same student, same key)
      const secondResult = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(secondResult.success).toBe(true);
      expect(secondResult.already_checked_in).toBe(true);
      expect(secondResult.message).toContain('already been recorded');

      // Verify still only ONE attendance record exists for this student
      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      const matching = roster.filter((entry) => entry.student.id === enrolledStudent1.id);
      expect(matching.length).toBe(1);
    });

    it('safely transitions a student previously marked Absent to Present with audit log', async () => {
      // Pre-mark Alice as absent manually
      LocalDatabase.saveAttendanceRecords(sampleSession.id, [
        { student_id: enrolledStudent1.id, status: 'absent' },
      ]);

      const initialRoster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(initialRoster.find((entry) => entry.student.id === enrolledStudent1.id)?.record?.status).toBe('absent');

      // Now student checks in with presence key
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;
      const result = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);

      expect(result.success).toBe(true);

      // Verify status transitioned to present
      const updatedRoster = LocalDatabase.getSessionAttendance(sampleSession.id);
      const updatedAlice = updatedRoster.find((entry) => entry.student.id === enrolledStudent1.id);
      expect(updatedAlice?.record?.status).toBe('present');
      expect(updatedAlice?.record?.method).toBe('presence_key');

      // Verify audit trail logged the transition
      const auditLogs = LocalDatabase.getAttendanceAuditLogs(sampleSession.id);
      const transitionLog = auditLogs.find(
        (log) =>
          log.student_id === enrolledStudent1.id &&
          log.previous_status === 'absent' &&
          log.new_status === 'present'
      );
      expect(transitionLog).toBeDefined();
      expect(transitionLog?.reason).toContain('presence key');
    });

    it('rejects check-in from a student not enrolled in the class (403 NOT_ENROLLED)', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Charlie Brown is enrolled in ME, not this CS class
      const result = await LocalDatabase.validateStudentCheckIn(plainKey, unenrolledStudent.id);

      expect(result.success).toBe(false);
      expect(result.code).toBe('NOT_ENROLLED');
      expect(result.message).toContain('not enrolled');

      // Ensure Charlie is not in this class's roster
      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(roster.find((entry) => entry.student.id === unenrolledStudent.id)).toBeUndefined();
    });

    it('rejects an incorrect presence key (INVALID_OR_EXPIRED_KEY)', async () => {
      await LocalDatabase.generatePresenceKey(sampleSession.id, 10);

      const result = await LocalDatabase.validateStudentCheckIn('999999', enrolledStudent1.id);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_OR_EXPIRED_KEY');
    });

    it('rejects check-in if presence key has expired', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Manually simulate expiration in past
      const allKeys = LocalDatabase.getPresenceKeys();
      const updatedKeys = allKeys.map((k) =>
        k.id === keyObj.id
          ? { ...k, expires_at: new Date(Date.now() - 1000).toISOString() }
          : k
      );
      localStorage.setItem('sentinel_campus_presence_keys', JSON.stringify(updatedKeys));

      const result = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_OR_EXPIRED_KEY');
    });

    it('rejects check-in if presence key was revoked', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;
      LocalDatabase.revokePresenceKey(sampleSession.id);

      const result = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);

      expect(result.success).toBe(false);
      expect(result.code).toBe('INVALID_OR_EXPIRED_KEY');
    });

    it('rejects check-in if attendance session was finalized/closed (SESSION_CLOSED)', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Finalize session
      LocalDatabase.updateSessionStatus(sampleSession.id, 'finalized');

      const result = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);

      expect(result.success).toBe(false);
      expect(result.code).toBe('SESSION_CLOSED');
      expect(result.message).toContain('finalized');
    });

    it('rejects unauthenticated student check-in attempts', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      const result = await LocalDatabase.validateStudentCheckIn(plainKey, '');

      expect(result.success).toBe(false);
      expect(result.code).toBe('UNAUTHENTICATED');
    });
  });

  describe('4. Rate Limiting & Brute Force Lockout', () => {
    it('locks out student after 5 consecutive failed key attempts within 5 minutes', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Submit 5 incorrect guesses
      for (let i = 0; i < 5; i++) {
        const attempt = await LocalDatabase.validateStudentCheckIn(`11111${i}`, enrolledStudent1.id);
        expect(attempt.success).toBe(false);
        expect(attempt.code).toBe('INVALID_OR_EXPIRED_KEY');
      }

      // 6th attempt with correct key must now be BLOCKED by rate limiter
      const lockedAttempt = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(lockedAttempt.success).toBe(false);
      expect(lockedAttempt.code).toBe('RATE_LIMITED');
      expect(lockedAttempt.message).toContain('Too many invalid attempts');
    });

    it('does not rate-limit different students when one student fails repeatedly', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Alice exhausts attempts
      for (let i = 0; i < 5; i++) {
        await LocalDatabase.validateStudentCheckIn(`00000${i}`, enrolledStudent1.id);
      }
      const aliceBlocked = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(aliceBlocked.code).toBe('RATE_LIMITED');

      // Bob uses correct key without being affected by Alice's lockout
      const bobAttempt = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent2.id);
      expect(bobAttempt.success).toBe(true);
      expect(bobAttempt.code).toBe('CHECKIN_SUCCESS');
    });
  });

  describe('5. Multi-Student Concurrent Check-In Support', () => {
    it('allows all legitimately enrolled students to use the same active key', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 15);
      const plainKey = keyObj.plain_key!;

      // Both Alice and Bob check in concurrently with the same valid key
      const [aliceRes, bobRes] = await Promise.all([
        LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id),
        LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent2.id),
      ]);

      expect(aliceRes.success).toBe(true);
      expect(bobRes.success).toBe(true);

      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(roster.filter((entry) => entry.record?.status === 'present').length).toBe(2);
    });
  });

  describe('6. Student Check-in API Endpoint Protocol Validation', () => {
    it('simulates API endpoint status codes accurately based on check-in results', async () => {
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 10);
      const plainKey = keyObj.plain_key!;

      // Success -> 200
      const okRes = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(okRes.success).toBe(true);

      // Duplicate -> 200 (Idempotent)
      const dupRes = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent1.id);
      expect(dupRes.success).toBe(true);
      expect(dupRes.already_checked_in).toBe(true);

      // Not enrolled -> 403
      const unenrolledRes = await LocalDatabase.validateStudentCheckIn(plainKey, unenrolledStudent.id);
      expect(unenrolledRes.code).toBe('NOT_ENROLLED');

      // Bad key -> 404 (INVALID_OR_EXPIRED_KEY)
      const badKeyRes = await LocalDatabase.validateStudentCheckIn('000000', enrolledStudent2.id);
      expect(badKeyRes.code).toBe('INVALID_OR_EXPIRED_KEY');

      // Finalized session -> 410 (SESSION_CLOSED)
      LocalDatabase.updateSessionStatus(sampleSession.id, 'finalized');
      const closedRes = await LocalDatabase.validateStudentCheckIn(plainKey, enrolledStudent2.id);
      expect(closedRes.code).toBe('SESSION_CLOSED');
    });
  });
});
