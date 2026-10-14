import { describe, it, expect, beforeEach } from 'vitest';
import { FaceRecognitionService, FACE_THRESHOLDS } from '../services/faceRecognition';
import { LocalDatabase } from '../services/localDb';
import type {
  AttendanceSession,
  ClassCourse,
  DetectedFace,
  Student,
} from '../types';

describe('Sentinel Campus - Step 3: Face Recognition & Attendance Test Suite', () => {
  let sampleClass: ClassCourse;
  let studentAlice: Student;
  let studentBob: Student;
  let studentCharlie: Student;
  let studentUnenrolled: Student;
  let sampleSession: AttendanceSession;

  beforeEach(() => {
    localStorage.clear();
    LocalDatabase.resetToEmpty();

    // 1. Create enrolled students with registered 128-d face descriptors
    studentAlice = LocalDatabase.createStudent({
      roll_number: 'CS2026-101',
      full_name: 'Alice Cooper',
      email: 'alice@campus.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/alice.jpg',
      is_active: true,
    });
    studentAlice = LocalDatabase.enrollStudentFaceDescriptor(
      studentAlice.id,
      FaceRecognitionService.generateSyntheticDescriptor('alice-seed-vector'),
      0.98
    );

    studentBob = LocalDatabase.createStudent({
      roll_number: 'CS2026-102',
      full_name: 'Bob Martin',
      email: 'bob@campus.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/bob.jpg',
      is_active: true,
    });
    studentBob = LocalDatabase.enrollStudentFaceDescriptor(
      studentBob.id,
      FaceRecognitionService.generateSyntheticDescriptor('bob-seed-vector'),
      0.96
    );

    studentCharlie = LocalDatabase.createStudent({
      roll_number: 'CS2026-103',
      full_name: 'Charlie Davis',
      email: 'charlie@campus.edu',
      course: 'B.Tech CS',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'A',
      photo_path: 'students/charlie.jpg',
      is_active: true,
    });
    studentCharlie = LocalDatabase.enrollStudentFaceDescriptor(
      studentCharlie.id,
      FaceRecognitionService.generateSyntheticDescriptor('charlie-seed-vector'),
      0.95
    );

    // 2. Create unenrolled student with registered face
    studentUnenrolled = LocalDatabase.createStudent({
      roll_number: 'EE2026-999',
      full_name: 'Dave Extraneous',
      email: 'dave@campus.edu',
      course: 'B.Tech Electrical',
      batch: '2026',
      academic_year: 'Year 3',
      section: 'B',
      photo_path: 'students/dave.jpg',
      is_active: true,
    });
    studentUnenrolled = LocalDatabase.enrollStudentFaceDescriptor(
      studentUnenrolled.id,
      FaceRecognitionService.generateSyntheticDescriptor('dave-seed-vector'),
      0.97
    );

    // 3. Create class and enroll Alice, Bob, and Charlie
    sampleClass = LocalDatabase.createClass({
      name: 'Advanced Machine Learning',
      code: 'CS-401',
      description: 'Computer Vision & Deep Learning',
      academic_year: 'Year 3',
      section: 'A',
      is_active: true,
    });

    LocalDatabase.enrollStudentsInClass(sampleClass.id, [
      studentAlice.id,
      studentBob.id,
      studentCharlie.id,
    ]);

    // 4. Create an active attendance session
    sampleSession = LocalDatabase.createAttendanceSession({
      class_id: sampleClass.id,
      title: 'Lecture 12: Multi-Face Detection and Embeddings',
      session_date: new Date().toISOString().split('T')[0],
      start_time: '10:00',
      end_time: '11:30',
    });
  });

  // =========================================================================
  // SUITE 1: 128-d Vector Mathematics & Metric Precision
  // =========================================================================
  describe('Vector Mathematics & Metric Precision', () => {
    it('calculates Euclidean distance of 0.0 for identical 128-d vectors', () => {
      const vec = FaceRecognitionService.generateSyntheticDescriptor('test-ident');
      const dist = FaceRecognitionService.computeEuclideanDistance(vec, vec);
      expect(dist).toBeCloseTo(0, 5);
    });

    it('calculates expected Euclidean distance between known geometric vectors', () => {
      const v1 = new Array(128).fill(0);
      const v2 = new Array(128).fill(0);
      v1[0] = 1;
      v2[1] = 1; // orthogonal unit vectors: distance is sqrt(1^2 + 1^2) = sqrt(2) ~ 1.4142
      const dist = FaceRecognitionService.computeEuclideanDistance(v1, v2);
      expect(dist).toBeCloseTo(Math.SQRT2, 4);
    });

    it('throws error when computing distance between vectors of mismatched lengths', () => {
      const v1 = new Array(128).fill(0);
      const v2 = new Array(64).fill(0);
      expect(() => FaceRecognitionService.computeEuclideanDistance(v1, v2)).toThrow(/mismatch/);
    });

    it('maps Euclidean distance to intuitive 0-100% similarity score correctly', () => {
      expect(FaceRecognitionService.distanceToSimilarity(0.0)).toBe(100);
      expect(FaceRecognitionService.distanceToSimilarity(0.30)).toBe(70);
      expect(FaceRecognitionService.distanceToSimilarity(0.45)).toBe(55);
      expect(FaceRecognitionService.distanceToSimilarity(1.0)).toBe(0);
      expect(FaceRecognitionService.distanceToSimilarity(1.5)).toBe(0); // Clamped at 0
    });

    it('generates 128-dimensional unit normalized synthetic descriptors', () => {
      const desc = FaceRecognitionService.generateSyntheticDescriptor('norm-check');
      expect(desc).toHaveLength(128);

      const sumSq = desc.reduce((acc, val) => acc + val * val, 0);
      expect(Math.sqrt(sumSq)).toBeCloseTo(1.0, 4); // Unit length L2 norm
    });

    it('produces deterministic descriptors for identical seeds and distinct for different seeds', () => {
      const desc1 = FaceRecognitionService.generateSyntheticDescriptor('repeatable-seed');
      const desc2 = FaceRecognitionService.generateSyntheticDescriptor('repeatable-seed');
      const desc3 = FaceRecognitionService.generateSyntheticDescriptor('different-seed');

      expect(desc1).toEqual(desc2);
      const distBetweenDifferent = FaceRecognitionService.computeEuclideanDistance(desc1, desc3);
      expect(distBetweenDifferent).toBeGreaterThan(0.5);
    });
  });

  // =========================================================================
  // SUITE 2: Multi-Face Roster Matching Engine
  // =========================================================================
  describe('Multi-Face Roster Matching Engine', () => {
    it('classifies matches with Euclidean distance <= 0.45 as high_confidence', () => {
      // Create a detected face descriptor very close to Alice (perturb slightly)
      const aliceVec = studentAlice.face_descriptor!;
      const perturbedAlice = aliceVec.map((v, i) => (i === 0 ? v + 0.05 : v));
      // Re-normalize
      const mag = Math.sqrt(perturbedAlice.reduce((s, x) => s + x * x, 0));
      const normalizedPerturbed = perturbedAlice.map((x) => x / mag);

      const detectedFace: DetectedFace = {
        id: 'det-alice-1',
        box: { x: 100, y: 120, width: 90, height: 95 },
        cropUrl: 'data:image/jpeg;base64,...',
        confidence: 0.94,
        descriptor: normalizedPerturbed,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      expect(summary.totalFacesDetected).toBe(1);
      expect(summary.highConfidenceMatches).toHaveLength(1);
      expect(summary.highConfidenceMatches[0].matchedStudent?.id).toBe(studentAlice.id);
      expect(summary.highConfidenceMatches[0].confirmedStudentId).toBe(studentAlice.id);
      expect(summary.highConfidenceMatches[0].distance).toBeLessThanOrEqual(FACE_THRESHOLDS.HIGH_CONFIDENCE_MAX_DISTANCE);
      expect(summary.needsReviewMatches).toHaveLength(0);
      expect(summary.unknownFaces).toHaveLength(0);
    });

    it('classifies matches with 0.45 < distance <= 0.60 as needs_review (uncertain)', () => {
      // Craft a vector with distance ~ 0.52 from Bob
      const bobVec = studentBob.face_descriptor!;
      const craftVec = bobVec.map((v, i) => (i < 20 ? v + 0.12 : v));
      const mag = Math.sqrt(craftVec.reduce((s, x) => s + x * x, 0));
      const normalizedCraft = craftVec.map((x) => x / mag);
      const actualDist = FaceRecognitionService.computeEuclideanDistance(normalizedCraft, bobVec);

      // Verify the distance falls in review range
      expect(actualDist).toBeGreaterThan(0.45);
      expect(actualDist).toBeLessThanOrEqual(0.60);

      const detectedFace: DetectedFace = {
        id: 'det-bob-uncertain',
        box: { x: 220, y: 150, width: 85, height: 90 },
        cropUrl: '',
        confidence: 0.88,
        descriptor: normalizedCraft,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      expect(summary.highConfidenceMatches).toHaveLength(0);
      expect(summary.needsReviewMatches).toHaveLength(1);
      expect(summary.needsReviewMatches[0].matchedStudent?.id).toBe(studentBob.id);
      expect(summary.needsReviewMatches[0].matchType).toBe('needs_review');
      expect(summary.needsReviewMatches[0].rejectionReason).toContain('uncertain review zone');
    });

    it('classifies matches with distance > 0.60 as unknown faces', () => {
      // An outsider face completely distinct from Alice, Bob, and Charlie
      const outsiderVec = FaceRecognitionService.generateSyntheticDescriptor('stranger-on-campus-xyz');

      const detectedFace: DetectedFace = {
        id: 'det-unknown-1',
        box: { x: 50, y: 50, width: 80, height: 80 },
        cropUrl: '',
        confidence: 0.91,
        descriptor: outsiderVec,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      expect(summary.unknownFaces).toHaveLength(1);
      expect(summary.unknownFaces[0].matchType).toBe('unknown');
      expect(summary.unknownFaces[0].matchedStudent).toBeNull();
      expect(summary.highConfidenceMatches).toHaveLength(0);
    });

    it('detects ambiguity when top two candidate students have distance delta < 0.08', () => {
      // Craft a detected face that is within review range of both Alice and Charlie, with delta < 0.08
      // Alice is baseline; Charlie will have a descriptor very close to Alice + tiny offset
      const aliceVec = studentAlice.face_descriptor!;
      const closeToBoth = aliceVec.map((v, i) => (i < 8 ? v + 0.04 : v));
      const mag = Math.sqrt(closeToBoth.reduce((s, x) => s + x * x, 0));
      const normalizedFace = closeToBoth.map((x) => x / mag);

      // Temporarily set Bob's descriptor to also be close to this face
      const bobCloseVec = aliceVec.map((v, i) => (i < 8 ? v + 0.07 : v));
      const magB = Math.sqrt(bobCloseVec.reduce((s, x) => s + x * x, 0));
      LocalDatabase.enrollStudentFaceDescriptor(studentBob.id, bobCloseVec.map((x) => x / magB), 0.95);

      const detectedFace: DetectedFace = {
        id: 'det-ambiguous-1',
        box: { x: 150, y: 150, width: 80, height: 80 },
        cropUrl: '',
        confidence: 0.9,
        descriptor: normalizedFace,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      // Should be routed to needsReviewMatches with ambiguous matchType
      expect(summary.highConfidenceMatches).toHaveLength(0);
      expect(summary.needsReviewMatches).toHaveLength(1);
      expect(summary.needsReviewMatches[0].matchType).toBe('ambiguous');
      expect(summary.needsReviewMatches[0].rejectionReason).toContain('Close match');
    });

    it('enforces one-to-one constraint: multiple detections claiming same student assigned to closer distance', () => {
      // Two faces detect in the same photo: face1 is very close to Alice (d ~ 0.05), face2 is somewhat close to Alice (d ~ 0.35)
      const aliceVec = studentAlice.face_descriptor!;

      const face1Desc = aliceVec.map((v, i) => (i === 0 ? v + 0.02 : v));
      const mag1 = Math.sqrt(face1Desc.reduce((s, x) => s + x * x, 0));
      const norm1 = face1Desc.map((x) => x / mag1);

      const face2Desc = aliceVec.map((v, i) => (i < 10 ? v + 0.08 : v));
      const mag2 = Math.sqrt(face2Desc.reduce((s, x) => s + x * x, 0));
      const norm2 = face2Desc.map((x) => x / mag2);

      const detectedFaces: DetectedFace[] = [
        {
          id: 'det-alice-far',
          box: { x: 10, y: 10, width: 70, height: 70 },
          cropUrl: '',
          confidence: 0.85,
          descriptor: norm2,
        },
        {
          id: 'det-alice-near',
          box: { x: 200, y: 200, width: 90, height: 90 },
          cropUrl: '',
          confidence: 0.96,
          descriptor: norm1,
        },
      ];

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        detectedFaces,
        enrolled,
        sampleSession.id
      );

      // The nearer face wins Alice as high_confidence
      expect(summary.highConfidenceMatches).toHaveLength(1);
      expect(summary.highConfidenceMatches[0].detectionId).toBe('det-alice-near');
      expect(summary.highConfidenceMatches[0].matchedStudent?.id).toBe(studentAlice.id);

      // The displaced face is flagged for review due to duplicate claim
      expect(summary.needsReviewMatches).toHaveLength(1);
      expect(summary.needsReviewMatches[0].detectionId).toBe('det-alice-far');
      expect(summary.needsReviewMatches[0].rejectionReason).toContain('Another face matched');
    });

    it('never matches an unenrolled student even if registered in global database', () => {
      // Provide Dave's face descriptor (who is registered but NOT enrolled in CS-401)
      const daveVec = studentUnenrolled.face_descriptor!;
      const detectedFace: DetectedFace = {
        id: 'det-dave',
        box: { x: 300, y: 300, width: 85, height: 85 },
        cropUrl: '',
        confidence: 0.95,
        descriptor: daveVec,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      // Dave must NOT be matched because he is not enrolled
      expect(summary.highConfidenceMatches.some((m) => m.matchedStudent?.id === studentUnenrolled.id)).toBe(false);
      expect(summary.needsReviewMatches.some((m) => m.matchedStudent?.id === studentUnenrolled.id)).toBe(false);
      // It should be treated as unknown relative to this class session
      expect(summary.unknownFaces).toHaveLength(1);
    });

    it('does NOT automatically mark undetected enrolled students as absent', () => {
      // Only Alice's face is in the photo
      const aliceVec = studentAlice.face_descriptor!;
      const detectedFace: DetectedFace = {
        id: 'det-alice-only',
        box: { x: 100, y: 100, width: 90, height: 90 },
        cropUrl: '',
        confidence: 0.95,
        descriptor: aliceVec,
      };

      const enrolled = LocalDatabase.getClassEnrolledStudents(sampleClass.id);
      const summary = FaceRecognitionService.matchDetectedFacesAgainstRoster(
        [detectedFace],
        enrolled,
        sampleSession.id
      );

      // Bob and Charlie were NOT detected
      expect(summary.notDetectedEnrolledStudents).toHaveLength(2);
      const missingIds = summary.notDetectedEnrolledStudents.map((s) => s.id);
      expect(missingIds).toContain(studentBob.id);
      expect(missingIds).toContain(studentCharlie.id);

      // Verifying rule: they are simply listed as not detected, awaiting manual teacher confirmation
    });
  });

  // =========================================================================
  // SUITE 3: Attendance Submission, Audit Trail & Coexistence
  // =========================================================================
  describe('Attendance Submission & Multi-Method Coexistence', () => {
    it('submits confirmed face attendance items and marks students present with face_scan method', () => {
      const result = LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          detectionId: 'det-alice-1',
          confidenceScore: 0.94,
          matchType: 'high_confidence',
          status: 'present',
        },
        {
          studentId: studentBob.id,
          detectionId: 'det-bob-1',
          confidenceScore: 0.89,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      expect(result.success).toBe(true);
      expect(result.markedPresentCount).toBe(2);
      expect(result.updatedRecords.filter((r) => r.status === 'present')).toHaveLength(2);

      // Verify records in database
      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      const aliceEntry = roster.find((e) => e.student.id === studentAlice.id);
      const bobEntry = roster.find((e) => e.student.id === studentBob.id);
      const charlieEntry = roster.find((e) => e.student.id === studentCharlie.id);

      expect(aliceEntry?.record?.status).toBe('present');
      expect(aliceEntry?.record?.method).toBe('face_scan');
      expect(aliceEntry?.record?.face_verification_metadata?.confidence).toBe(0.94);
      expect(aliceEntry?.record?.face_verification_metadata?.match_category).toBe('high_confidence');

      expect(bobEntry?.record?.status).toBe('present');
      expect(bobEntry?.record?.method).toBe('face_scan');

      // Charlie was NOT in the submitted items -> remained unmarked, NOT auto-marked absent
      expect(charlieEntry?.record?.status).toBe('unmarked');
    });

    it('is idempotent: resubmitting face attendance updates existing records without duplication', () => {
      LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          detectionId: 'det-alice-scan-1',
          confidenceScore: 0.95,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      let roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(roster.filter((e) => e.student.id === studentAlice.id && e.record?.status === 'present')).toHaveLength(1);

      // Resubmit with new photo scan
      LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          detectionId: 'det-alice-scan-2',
          confidenceScore: 0.98,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(roster.filter((e) => e.student.id === studentAlice.id && e.record?.status === 'present')).toHaveLength(1);
      const aliceEntry = roster.find((e) => e.student.id === studentAlice.id);
      expect(aliceEntry?.record?.status).toBe('present');
    });

    it('coexists seamlessly with Step 2 presence key check-ins', async () => {
      // 1. Bob checks in via presence key first
      const keyObj = await LocalDatabase.generatePresenceKey(sampleSession.id, 15);
      await LocalDatabase.validateStudentCheckIn(keyObj.plain_key!, studentBob.id);

      const rosterBefore = LocalDatabase.getSessionAttendance(sampleSession.id);
      const bobEntryBefore = rosterBefore.find((e) => e.student.id === studentBob.id);
      expect(bobEntryBefore?.record?.status).toBe('present');
      expect(bobEntryBefore?.record?.method).toBe('presence_key');

      // 2. Instructor runs Face Scan which detects Alice and confirms her
      LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          detectionId: 'det-alice-1',
          confidenceScore: 0.95,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      const rosterAfter = LocalDatabase.getSessionAttendance(sampleSession.id);
      const bobEntryAfter = rosterAfter.find((e) => e.student.id === studentBob.id);
      const aliceEntryAfter = rosterAfter.find((e) => e.student.id === studentAlice.id);

      // Bob's presence_key status is preserved
      expect(bobEntryAfter?.record?.status).toBe('present');
      expect(bobEntryAfter?.record?.method).toBe('presence_key');

      // Alice is present via face_scan
      expect(aliceEntryAfter?.record?.status).toBe('present');
      expect(aliceEntryAfter?.record?.method).toBe('face_scan');
    });

    it('records an audit log entry for face attendance submission', () => {
      LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentAlice.id,
          detectionId: 'det-alice-1',
          confidenceScore: 0.95,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      const auditLogs = LocalDatabase.getAttendanceAuditLogs(sampleSession.id);
      const faceAudit = auditLogs.find((l) => l.student_id === studentAlice.id);

      expect(faceAudit).toBeDefined();
      expect(faceAudit?.new_status).toBe('present');
      expect(faceAudit?.reason).toContain('Face');
    });

    it('rejects face attendance items for students not enrolled in the class', () => {
      const result = LocalDatabase.submitFaceAttendance(sampleSession.id, [
        {
          studentId: studentUnenrolled.id, // Dave is not enrolled in CS-401
          detectionId: 'det-dave-1',
          confidenceScore: 0.96,
          matchType: 'high_confidence',
          status: 'present',
        },
      ]);

      // Marked present count is 0 because student is not enrolled
      expect(result.markedPresentCount).toBe(0);
      const roster = LocalDatabase.getSessionAttendance(sampleSession.id);
      expect(roster.find((e) => e.student.id === studentUnenrolled.id)).toBeUndefined();
    });
  });

  // =========================================================================
  // SUITE 4: Biometric Enrollment & Privacy Opt-out Lifecycle
  // =========================================================================
  describe('Biometric Enrollment & Privacy Opt-out Lifecycle', () => {
    it('enrolls a student face descriptor with quality score and timestamp', () => {
      const newStudent = LocalDatabase.createStudent({
        roll_number: 'CS2026-900',
        full_name: 'Zoe Saldana',
        email: 'zoe@campus.edu',
        course: 'B.Tech CS',
        batch: '2026',
        academic_year: 'Year 3',
        section: 'A',
        photo_path: 'students/zoe.jpg',
        is_active: true,
      });

      expect(newStudent.face_enrollment_status).toBe('not_enrolled');
      expect(newStudent.face_descriptor).toBeUndefined();

      const descriptor = FaceRecognitionService.generateSyntheticDescriptor('zoe-face');
      const updated = LocalDatabase.enrollStudentFaceDescriptor(newStudent.id, descriptor, 0.97);

      expect(updated.face_enrollment_status).toBe('enrolled');
      expect(updated.face_descriptor).toHaveLength(128);
      expect(updated.face_quality_score).toBe(0.97);
      expect(updated.face_enrolled_at).toBeDefined();
    });

    it('clears biometrics when a student opts out of facial recognition', () => {
      expect(studentAlice.face_enrollment_status).toBe('enrolled');
      expect(studentAlice.face_descriptor).toBeDefined();

      const cleared = LocalDatabase.removeStudentFaceDescriptor(studentAlice.id);

      expect(cleared.face_enrollment_status).toBe('not_enrolled');
      expect(cleared.face_descriptor).toBeFalsy();
      expect(cleared.face_quality_score).toBeFalsy();
      expect(cleared.face_enrolled_at).toBeFalsy();

      // Ensure persistence
      const fetched = LocalDatabase.getStudentById(studentAlice.id);
      expect(fetched?.face_enrollment_status).toBe('not_enrolled');
      expect(fetched?.face_descriptor).toBeFalsy();
    });
  });
});
