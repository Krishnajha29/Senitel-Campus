import { describe, it, expect, beforeEach } from 'vitest';
import { LocalDatabase } from '../services/localDb';
import { ApiService } from '../services/api';
import { FaceRecognitionService } from '../services/faceRecognition';
import type { AttendanceSession, Student, DetectedFace } from '../types';

describe('Sentinel Campus — Multi-Photo QR Attendance Test Suite', () => {
  let sampleClass: any;
  let sampleSession: AttendanceSession;
  let enrolledStudent1: Student;
  let enrolledStudent2: Student;
  let enrolledStudents: Student[];

  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

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

    sampleSession = LocalDatabase.createAttendanceSession({
      class_id: sampleClass.id,
      title: 'CS401 Multi-Angle Lecture Session',
      session_date: '2026-10-14',
      start_time: '14:00',
      end_time: '15:30',
    });

    enrolledStudents = [enrolledStudent1, enrolledStudent2];
  });

  // --------------------------------------------------------------------------
  // 1. Batch Photo Upload & Multi-Photo Accumulation
  // --------------------------------------------------------------------------
  describe('Multi-Photo Batch Upload & Accumulation', () => {
    it('accepts a batch of multiple classroom photographs in a single call', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);
      expect(qrRes.plain_token).toBeDefined();

      const files = [
        new File([new Uint8Array([1, 2, 3])], 'left_angle.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([4, 5, 6])], 'center_angle.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([7, 8, 9])], 'right_angle.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([10, 11, 12])], 'back_angle.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([13, 14, 15])], 'balcony_angle.jpg', { type: 'image/jpeg' }),
      ];

      const batchResult = await ApiService.submitClassroomPhotoBatch(
        qrRes.plain_token,
        files,
        'iPhone 16 Pro Max'
      );

      expect(batchResult.success).toBe(true);
      expect(batchResult.successful_count).toBe(5);
      expect(batchResult.failed_count).toBe(0);
      expect(batchResult.photos.length).toBe(5);
      expect(batchResult.session.status).toBe('photo_received');
      expect(batchResult.session.total_photos_count).toBe(5);
      expect(batchResult.session.photo_device_info).toBe('iPhone 16 Pro Max');
    });

    it('appends subsequently uploaded photos without overwriting earlier photos in session', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);

      // First batch: 2 photos
      const batch1 = [
        new File([new Uint8Array([1, 1, 1])], 'view_1.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([2, 2, 2])], 'view_2.jpg', { type: 'image/jpeg' }),
      ];
      const res1 = await ApiService.submitClassroomPhotoBatch(qrRes.plain_token, batch1);
      expect(res1.success).toBe(true);
      expect(res1.session.total_photos_count).toBe(2);

      // Second batch: 3 more photos with same token
      const batch2 = [
        new File([new Uint8Array([3, 3, 3])], 'view_3.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([4, 4, 4])], 'view_4.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([5, 5, 5])], 'view_5.jpg', { type: 'image/jpeg' }),
      ];
      const res2 = await ApiService.submitClassroomPhotoBatch(qrRes.plain_token, batch2);
      expect(res2.success).toBe(true);
      expect(res2.session.total_photos_count).toBe(5);

      // Verify active session retrieves all 5 photos
      const activeSession = await ApiService.getActivePhotoUploadSession(sampleSession.id);
      expect(activeSession?.photos?.length).toBe(5);
      expect(activeSession?.photos?.map((p) => p.file_name)).toEqual([
        'view_1.jpg',
        'view_2.jpg',
        'view_3.jpg',
        'view_4.jpg',
        'view_5.jpg',
      ]);
    });

    it('enforces maximum batch limit (20 photos) and rejects overflow', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);

      // Create 21 files (exceeding limit of 20)
      const excessiveFiles: File[] = [];
      for (let i = 1; i <= 21; i++) {
        excessiveFiles.push(
          new File([new Uint8Array([i])], `photo_${i}.jpg`, { type: 'image/jpeg' })
        );
      }

      await expect(
        ApiService.submitClassroomPhotoBatch(qrRes.plain_token, excessiveFiles)
      ).rejects.toThrow(/batch limit exceeded/i);
    });

    it('allows deleting an individual uploaded photo from the session', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);
      const files = [
        new File([new Uint8Array([1])], 'keep_1.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([2])], 'delete_me.jpg', { type: 'image/jpeg' }),
        new File([new Uint8Array([3])], 'keep_2.jpg', { type: 'image/jpeg' }),
      ];

      const batch = await ApiService.submitClassroomPhotoBatch(qrRes.plain_token, files);
      expect(batch.photos.length).toBe(3);

      const targetToDelete = batch.photos[1];
      const deleted = await ApiService.deleteUploadedPhoto(targetToDelete.id);
      expect(deleted).toBe(true);

      const remaining = await ApiService.getUploadedPhotos(qrRes.session.id);
      expect(remaining.length).toBe(2);
      expect(remaining.map((p) => p.file_name)).toEqual(['keep_1.jpg', 'keep_2.jpg']);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Token Lifecycle in Multi-Photo Mode
  // --------------------------------------------------------------------------
  describe('Multi-Photo QR Token Lifecycle', () => {
    it('keeps token active after photo upload so multiple photos can be sent', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);

      // Validate token before any upload
      const valBefore = await ApiService.validatePhotoUploadToken(qrRes.plain_token);
      expect(valBefore.valid).toBe(true);

      // Upload one photo
      await ApiService.submitClassroomPhoto(
        qrRes.plain_token,
        new File([new Uint8Array([1])], 'shot1.jpg', { type: 'image/jpeg' })
      );

      // Token must STILL be valid for appending more photos
      const valAfter = await ApiService.validatePhotoUploadToken(qrRes.plain_token);
      expect(valAfter.valid).toBe(true);

      const activeUpload = await ApiService.getActivePhotoUploadSession(sampleSession.id);
      expect(activeUpload?.status).toBe('photo_received');
      expect(activeUpload?.total_photos_count).toBe(1);
    });

    it('rejects upload when session is revoked', async () => {
      const qrRes = await ApiService.createPhotoUploadSession(sampleSession.id, 15);
      await ApiService.revokePhotoUploadSession(sampleSession.id);

      const file = new File([new Uint8Array([1])], 'shot.jpg', { type: 'image/jpeg' });
      await expect(ApiService.submitClassroomPhoto(qrRes.plain_token, file)).rejects.toThrow(
        /revoked|inactive/i
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Multi-Photo Face Recognition Matching & Deduplication
  // --------------------------------------------------------------------------
  describe('Multi-Photo Face Recognition & Deduplication Algorithm', () => {
    it('deduplicates a student detected across multiple photos and selects the highest confidence match', async () => {
      // Enroll two students with synthetic 128-d reference descriptors
      const studentAlice = enrolledStudents[0];
      const studentBob = enrolledStudents[1];

      const aliceDescriptor = FaceRecognitionService.generateSyntheticDescriptor('alice_seed_100');
      const bobDescriptor = FaceRecognitionService.generateSyntheticDescriptor('bob_seed_200');

      await ApiService.enrollStudentFaceDescriptor(studentAlice.id, aliceDescriptor);
      await ApiService.enrollStudentFaceDescriptor(studentBob.id, bobDescriptor);

      const refreshedStudents = await ApiService.getClassEnrollments(sampleSession.class_id);

      // Simulate Alice detected in Photo 1 (distance ~0.35, high confidence)
      // and Alice detected in Photo 2 from closer angle (distance ~0.15, higher confidence!)
      const aliceFaceInPhoto1: DetectedFace & { sourcePhotoId: string; sourcePhotoName: string } = {
        id: 'det_alice_p1',
        box: { x: 100, y: 100, width: 80, height: 80 },
        confidence: 0.88,
        descriptor: aliceDescriptor.map((v, i) => (i === 0 ? v + 0.35 : v)), // small perturbation: dist ~0.35
        sourcePhotoId: 'photo_01',
        sourcePhotoName: 'photo_left_row.jpg',
      };

      const aliceFaceInPhoto2: DetectedFace & { sourcePhotoId: string; sourcePhotoName: string } = {
        id: 'det_alice_p2',
        box: { x: 120, y: 90, width: 110, height: 110 },
        confidence: 0.96,
        descriptor: aliceDescriptor.map((v, i) => (i === 0 ? v + 0.15 : v)), // closer match: dist ~0.15
        sourcePhotoId: 'photo_02',
        sourcePhotoName: 'photo_center_close.jpg',
      };

      // Bob detected only in Photo 3
      const bobFaceInPhoto3: DetectedFace & { sourcePhotoId: string; sourcePhotoName: string } = {
        id: 'det_bob_p3',
        box: { x: 300, y: 200, width: 95, height: 95 },
        confidence: 0.92,
        descriptor: bobDescriptor.map((v, i) => (i === 0 ? v + 0.18 : v)), // dist ~0.18
        sourcePhotoId: 'photo_03',
        sourcePhotoName: 'photo_right_row.jpg',
      };

      // Run pure multi-photo deduplication algorithm
      const summary = FaceRecognitionService.matchMultiPhotoDetectedFacesAgainstRoster(
        [aliceFaceInPhoto1, aliceFaceInPhoto2, bobFaceInPhoto3],
        refreshedStudents,
        sampleSession.id
      );

      // 1. Total faces across all photos
      expect(summary.totalFacesDetected).toBe(3);

      // 2. High confidence matches must contain Alice ONCE and Bob ONCE!
      expect(summary.highConfidenceMatches.length).toBe(2);

      const aliceMatch = summary.highConfidenceMatches.find(
        (m) => m.matchedStudent?.id === studentAlice.id
      );
      expect(aliceMatch).toBeDefined();

      // Alice's best detection (from photo 2, lowest distance) must win
      expect(aliceMatch?.detectionId).toBe('det_alice_p2');
      expect(aliceMatch?.sourcePhotoName).toBe('photo_center_close.jpg');
      expect(aliceMatch?.distance).toBeLessThan(0.30);

      // Bob's match
      const bobMatch = summary.highConfidenceMatches.find(
        (m) => m.matchedStudent?.id === studentBob.id
      );
      expect(bobMatch).toBeDefined();
      expect(bobMatch?.sourcePhotoName).toBe('photo_right_row.jpg');

      // 3. No bogus duplicates or conflict warnings for Alice's secondary detection in Photo 1
      const aliceReviewEntries = summary.needsReviewMatches.filter(
        (m) => m.matchedStudent?.id === studentAlice.id
      );
      expect(aliceReviewEntries.length).toBe(0);
    });

    it('strictly enforces Zero Auto-Absent Rule for enrolled students not detected in any photo', async () => {
      const studentAlice = enrolledStudents[0];
      const studentBob = enrolledStudents[1];

      const aliceDescriptor = FaceRecognitionService.generateSyntheticDescriptor('alice_desc');
      await ApiService.enrollStudentFaceDescriptor(studentAlice.id, aliceDescriptor);

      const refreshedStudents = await ApiService.getClassEnrollments(sampleSession.class_id);

      // Photo only detects Alice
      const aliceFace: DetectedFace & { sourcePhotoId: string; sourcePhotoName: string } = {
        id: 'det_alice_only',
        box: { x: 50, y: 50, width: 80, height: 80 },
        confidence: 0.95,
        descriptor: aliceDescriptor,
        sourcePhotoId: 'p_single',
        sourcePhotoName: 'classroom_wide.jpg',
      };

      const summary = FaceRecognitionService.matchMultiPhotoDetectedFacesAgainstRoster(
        [aliceFace],
        refreshedStudents,
        sampleSession.id
      );

      // Alice is high confidence
      expect(summary.highConfidenceMatches.length).toBe(1);
      expect(summary.highConfidenceMatches[0].matchedStudent?.id).toBe(studentAlice.id);

      // Bob was NOT detected
      const notDetected = summary.notDetectedEnrolledStudents;
      expect(notDetected.some((s) => s.id === studentBob.id)).toBe(true);

      // Verify records in database before manual submission:
      // None of the not detected students are automatically marked Absent!
      const initialRecords = await ApiService.getAttendanceRecords(sampleSession.id);
      const bobRecord = initialRecords.find((r) => r.student_id === studentBob.id);
      expect(bobRecord?.status).not.toBe('absent');

      // Now submit attendance confirming ONLY detected Alice
      const submitRes = await ApiService.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          status: 'present',
          detectionId: aliceFace.id,
          confidenceScore: 0.95,
          matchType: 'high_confidence',
        },
      ]);

      expect(submitRes.success).toBe(true);
      expect(submitRes.markedPresentCount).toBe(1);

      // Check database: Alice is Present, Bob remains unmarked / not auto-marked absent!
      const finalRecords = await ApiService.getAttendanceRecords(sampleSession.id);
      const finalAlice = finalRecords.find((r) => r.student_id === studentAlice.id);
      const finalBob = finalRecords.find((r) => r.student_id === studentBob.id);

      expect(finalAlice?.status).toBe('present');
      expect(finalBob?.status).not.toBe('absent'); // Zero auto-absent rule verified
    });

    it('flags unknown faces detected in any photo for instructor inspection', async () => {
      const refreshedStudents = await ApiService.getClassEnrollments(sampleSession.class_id);

      // Create an unknown face embedding orthogonal to any enrolled student
      const unknownDescriptor = new Array(128).fill(0).map((_, i) => (i % 2 === 0 ? 0.8 : -0.8));
      const mag = Math.sqrt(unknownDescriptor.reduce((a, b) => a + b * b, 0));
      const normalizedUnknown = unknownDescriptor.map((x) => x / mag);

      const unknownFace: DetectedFace & { sourcePhotoId: string; sourcePhotoName: string } = {
        id: 'det_stranger',
        box: { x: 500, y: 400, width: 70, height: 70 },
        confidence: 0.82,
        descriptor: normalizedUnknown,
        sourcePhotoId: 'p_extra',
        sourcePhotoName: 'photo_hallway_door.jpg',
      };

      const summary = FaceRecognitionService.matchMultiPhotoDetectedFacesAgainstRoster(
        [unknownFace],
        refreshedStudents,
        sampleSession.id
      );

      expect(summary.unknownFaces.length).toBe(1);
      expect(summary.unknownFaces[0].detectionId).toBe('det_stranger');
      expect(summary.unknownFaces[0].sourcePhotoName).toBe('photo_hallway_door.jpg');
    });
  });
});
