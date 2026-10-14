import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';
import { ApiService } from '../services/api';
import { generateUploadToken, hashUploadToken, generateSalt } from '../services/crypto';
import type { AttendanceSession, ClassCourse, Student } from '../types';

describe('Sentinel Campus — QR-Based Classroom Photo Upload Test Suite (Phase 1)', () => {
  let sampleClass: ClassCourse;
  let enrolledStudent1: Student;
  let enrolledStudent2: Student;
  let sampleSession: AttendanceSession;

  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

    // 1. Create sample students
    enrolledStudent1 = LocalDatabase.createStudent({
      roll_number: 'CS2026-001',
      full_name: 'David Miller',
      email: 'david@sentinel.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/david.jpg',
      is_active: true,
    });

    enrolledStudent2 = LocalDatabase.createStudent({
      roll_number: 'CS2026-002',
      full_name: 'Elena Rostova',
      email: 'elena@sentinel.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/elena.jpg',
      is_active: true,
    });

    // 2. Create sample class and enroll students
    sampleClass = LocalDatabase.createClass({
      name: 'Distributed Systems & Cloud Computing',
      code: 'CS401',
      academic_year: '2026-2027',
      section: 'A',
      description: 'Advanced distributed consensus algorithms and cloud storage architecture.',
      is_active: true,
    });

    LocalDatabase.enrollStudentsInClass(sampleClass.id, [
      enrolledStudent1.id,
      enrolledStudent2.id,
    ]);

    // 3. Create active attendance session
    sampleSession = LocalDatabase.createAttendanceSession({
      class_id: sampleClass.id,
      title: 'Lecture 12: Raft Consensus & Byzantine Faults',
      session_date: '2026-10-14',
      start_time: '10:00',
      end_time: '11:30',
    });
  });

  // --------------------------------------------------------------------------
  // 1. Cryptographic Security & Hashing Tests
  // --------------------------------------------------------------------------
  describe('Cryptographic Security & Token Hashing', () => {
    it('generates high-entropy 256-bit cryptographically secure opaque tokens', () => {
      const token1 = generateUploadToken();
      const token2 = generateUploadToken();

      expect(token1).toHaveLength(64); // 32 bytes hex encoded = 64 hex chars
      expect(token2).toHaveLength(64);
      expect(token1).not.toBe(token2);
      expect(/^[0-9a-f]{64}$/.test(token1)).toBe(true);
    });

    it('generates deterministic SHA-256 hashes bound to salt and sessionId', async () => {
      const token = generateUploadToken();
      const salt = generateSalt();
      const sessionId = sampleSession.id;

      const hash1 = await hashUploadToken(salt, token, sessionId);
      const hash2 = await hashUploadToken(salt, token, sessionId);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);

      // Different session must yield completely different hash even with same token & salt
      const differentSessionId = 'diff-sess-uuid';
      const hashDiffSession = await hashUploadToken(salt, token, differentSessionId);
      expect(hashDiffSession).not.toBe(hash1);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Upload Session Lifecycle & QR Generation Tests
  // --------------------------------------------------------------------------
  describe('Upload Session Creation & QR Resolution', () => {
    it('creates an active photo upload session with valid QR code data URL', async () => {
      const result = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      expect(result).toBeDefined();
      expect(result.session).toBeDefined();
      expect(result.session.session_id).toBe(sampleSession.id);
      expect(result.session.status).toBe('awaiting_scan');
      expect(result.session.token_hash).toHaveLength(64);
      expect(result.session.token_salt).toBeDefined();
      expect(result.plain_token).toHaveLength(64);

      // Verify QR Code Data URL is a valid Base64 PNG image
      expect(result.qr_data_url).toMatch(/^data:image\/png;base64,/);

      // Verify expiration is set in the future (~10 minutes)
      const expiresAt = new Date(result.session.expires_at).getTime();
      const now = Date.now();
      expect(expiresAt - now).toBeGreaterThan(9 * 60 * 1000);
      expect(expiresAt - now).toBeLessThanOrEqual(10 * 60 * 1000 + 5000);
    });

    it('resolves LAN IP in upload URL for mobile phone scan accessibility', async () => {
      const result = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      // Upload URL must point to mobile capture route
      expect(result.upload_url).toContain('/attendance-upload?token=');
      expect(result.upload_url).toContain(result.plain_token);

      // In local dev, must use LAN IP (10.146.38.84:5173 or VITE_APP_URL)
      expect(result.upload_url).not.toContain('http://localhost');
      expect(result.upload_url).toContain('10.146.38.84:5173');
    });

    it('automatically revokes previous active session when generating a new QR code', async () => {
      const first = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      expect(first.session.status).toBe('awaiting_scan');

      const second = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      expect(second.session.status).toBe('awaiting_scan');
      expect(second.session.id).not.toBe(first.session.id);

      // The first session should now be revoked
      const firstSessionState = await ApiService.getPhotoUploadSessionById(first.session.id);
      expect(firstSessionState?.status).toBe('revoked');
      expect(firstSessionState?.revoked_at).toBeDefined();

      // Attempting to validate the first token must return revoked error
      const validationFirst = await ApiService.validatePhotoUploadToken(first.plain_token);
      expect(validationFirst.valid).toBe(false);
      expect(validationFirst.error).toContain('revoked');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Token Validation & Security Guard Tests
  // --------------------------------------------------------------------------
  describe('Token Validation & Constraints', () => {
    it('validates a freshly created token and returns session & course metadata', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      const validation = await ApiService.validatePhotoUploadToken(res.plain_token);

      expect(validation.valid).toBe(true);
      expect(validation.session).toBeDefined();
      expect(validation.session?.id).toBe(sampleSession.id);
      expect(validation.classCourse).toBeDefined();
      expect(validation.classCourse?.code).toBe('CS401');
      expect(validation.classCourse?.name).toBe('Distributed Systems & Cloud Computing');
    });

    it('rejects an invalid or forged token', async () => {
      const fakeToken = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      const validation = await ApiService.validatePhotoUploadToken(fakeToken);

      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('Invalid or expired');
    });

    it('rejects an expired token', async () => {
      // Create session
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      // Manually set expiration in past
      const stored = await ApiService.getPhotoUploadSessionById(res.session.id);
      if (stored) {
        stored.expires_at = new Date(Date.now() - 60000).toISOString();
        localStorage.setItem('sentinel_campus_photo_upload_sessions', JSON.stringify([stored]));
      }

      const validation = await ApiService.validatePhotoUploadToken(res.plain_token);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('expired');
    });

    it('rejects a token if the attendance session is closed or finalized', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      // Finalize the session
      LocalDatabase.finalizeAttendanceSession(sampleSession.id);

      const validation = await ApiService.validatePhotoUploadToken(res.plain_token);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('finalized or closed');
    });
  });

  // --------------------------------------------------------------------------
  // 4. Photo Submission, File Validation & Single-Use Tests
  // --------------------------------------------------------------------------
  describe('Photo Upload Submission & Single-Use Enforcement', () => {
    it('accepts valid JPEG classroom photograph and transitions session to photo_received', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      // Create dummy JPEG image File
      const dummyImageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
      const file = new File([dummyImageData], 'classroom-scan.jpg', { type: 'image/jpeg' });

      const submitRes = await ApiService.submitClassroomPhoto(
        res.plain_token,
        file,
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)'
      );

      expect(submitRes.success).toBe(true);
      expect(submitRes.session).toBeDefined();
      expect(submitRes.session.status).toBe('photo_received');
      expect(submitRes.session.photo_url).toBeDefined();
      expect(submitRes.session.photo_size_bytes).toBe(dummyImageData.length);
      expect(submitRes.session.photo_mime_type).toBe('image/jpeg');
      expect(submitRes.session.photo_uploaded_at).toBeDefined();
      expect(submitRes.session.photo_device_info).toContain('iPhone');

      // Verify active session lookup returns photo_received
      const active = await ApiService.getActivePhotoUploadSession(sampleSession.id);
      expect(active?.status).toBe('photo_received');
      expect(active?.photo_url).toBeDefined();
    });

    it('rejects unsupported MIME types (e.g., text or PDF)', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      const textFile = new File(['hello world'], 'doc.txt', { type: 'text/plain' });

      await expect(ApiService.submitClassroomPhoto(res.plain_token, textFile)).rejects.toThrow(
        /Invalid file format/
      );
    });

    it('rejects oversized image files exceeding 15MB', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);

      // Create dummy file representing 16MB
      const bigBlob = new Blob([new Uint8Array(100)], { type: 'image/jpeg' });
      const bigFile = new File([bigBlob], 'huge.jpg', { type: 'image/jpeg' });
      Object.defineProperty(bigFile, 'size', { value: 16 * 1024 * 1024 });

      await expect(ApiService.submitClassroomPhoto(res.plain_token, bigFile)).rejects.toThrow(
        /exceeds 15 MB/
      );
    });

    it('supports multi-photo session: permits multiple uploads and rejects once finalized or revoked', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      const dummyFile1 = new File([new Uint8Array([1, 2, 3])], 'first.jpg', { type: 'image/jpeg' });
      const dummyFile2 = new File([new Uint8Array([4, 5, 6])], 'second.jpg', { type: 'image/jpeg' });

      // First submission succeeds
      const firstRes = await ApiService.submitClassroomPhoto(res.plain_token, dummyFile1);
      expect(firstRes.success).toBe(true);

      // Second submission succeeds in multi-photo session
      const secondRes = await ApiService.submitClassroomPhoto(res.plain_token, dummyFile2);
      expect(secondRes.success).toBe(true);
      expect(secondRes.session.total_photos_count).toBe(2);

      // Once revoked or finalized, submission is rejected
      await ApiService.revokePhotoUploadSession(sampleSession.id);
      const dummyFile3 = new File([new Uint8Array([7, 8, 9])], 'third.jpg', { type: 'image/jpeg' });
      await expect(
        ApiService.submitClassroomPhoto(res.plain_token, dummyFile3)
      ).rejects.toThrow(/revoked|inactive|already been (received|uploaded)/i);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Strict Zero Auto-Marking Rule (Phase 1 Compliance)
  // --------------------------------------------------------------------------
  describe('Phase 1 Compliance — Zero Automatic Attendance Marking', () => {
    it('does NOT automatically mark any student Present or Absent upon photo upload', async () => {
      // Verify attendance records before upload
      const initialRecords = await ApiService.getAttendanceRecords(sampleSession.id);
      expect(initialRecords.length).toBe(2);
      expect(initialRecords.every((r) => r.status === 'unmarked')).toBe(true);

      // Create session & upload classroom photo
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      const dummyFile = new File([new Uint8Array([1, 2, 3, 4])], 'photo.jpg', { type: 'image/jpeg' });
      await ApiService.submitClassroomPhoto(res.plain_token, dummyFile);

      // Verify attendance records after photo upload remain strictly UNCHANGED
      const recordsAfterPhoto = await ApiService.getAttendanceRecords(sampleSession.id);
      expect(recordsAfterPhoto.length).toBe(2);
      expect(recordsAfterPhoto.every((r) => r.status === 'unmarked')).toBe(true);

      // Verify no student was marked present or absent
      const presentStudents = recordsAfterPhoto.filter((r) => r.status === 'present');
      const absentStudents = recordsAfterPhoto.filter((r) => r.status === 'absent');
      expect(presentStudents).toHaveLength(0);
      expect(absentStudents).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Manual Revocation
  // --------------------------------------------------------------------------
  describe('Manual Revocation', () => {
    it('allows the instructor to manually revoke an active upload session', async () => {
      const res = await ApiService.createPhotoUploadSession(sampleSession.id, 10);
      expect(res.session.status).toBe('awaiting_scan');

      const revoked = await ApiService.revokePhotoUploadSession(sampleSession.id);
      expect(revoked).toBeDefined();
      expect(revoked?.status).toBe('revoked');
      expect(revoked?.revoked_at).toBeDefined();

      // Validating token now returns revoked
      const validation = await ApiService.validatePhotoUploadToken(res.plain_token);
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('revoked');
    });
  });
});
