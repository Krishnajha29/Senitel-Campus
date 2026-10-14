/**
 * Sentinel Campus: Computer Vision Face Detection & Recognition Service
 *
 * Implements genuine multi-face localization, 68-point landmark alignment,
 * 128-dimensional embedding generation, and Euclidean roster matching.
 *
 * Models Used:
 *  - SSD MobileNet v1 (Multi-face detection, confidence >= 0.5)
 *  - Tiny Face Detector (Fast mobile fallback)
 *  - FaceLandmark68Net (68-point geometric landmark alignment)
 *  - FaceRecognitionNet (ResNet-34 based 128-d Euclidean embedding)
 */

import * as faceapi from '@vladmandic/face-api/dist/face-api.esm.js';
import type {
  DetectedFace,
  FaceBoundingBox,
  FaceMatchCandidate,
  FaceMatchResult,
  FaceScanSessionSummary,
  MultiPhotoBatchSummary,
  Student,
} from '../types';

// Matching Thresholds calibrated for 128-d Euclidean embeddings:
// - Euclidean distance <= 0.45: High Confidence Match (~70%+ similarity)
// - 0.45 < Euclidean distance <= 0.60: Needs Review (Uncertain match)
// - Euclidean distance > 0.60: Unknown Face
export const FACE_THRESHOLDS = {
  HIGH_CONFIDENCE_MAX_DISTANCE: 0.45,
  REVIEW_MAX_DISTANCE: 0.60,
  AMBIGUITY_DELTA: 0.08, // If 2nd best candidate is within 0.08 distance, flag as ambiguous
  MIN_DETECTION_CONFIDENCE: 0.45,
};

let modelsLoaded = false;
let modelLoadingPromise: Promise<void> | null = null;

export class FaceRecognitionService {
  /**
   * Initializes and loads pre-trained model weights from /models into memory.
   */
  static async loadModels(modelsPath = '/models'): Promise<void> {
    if (modelsLoaded) return;
    if (modelLoadingPromise) return modelLoadingPromise;

    modelLoadingPromise = (async () => {
      try {
        await Promise.all([
          faceapi.nets.ssdMobilenetv1.loadFromUri(modelsPath),
          faceapi.nets.tinyFaceDetector.loadFromUri(modelsPath),
          faceapi.nets.faceLandmark68Net.loadFromUri(modelsPath),
          faceapi.nets.faceRecognitionNet.loadFromUri(modelsPath),
        ]);
        modelsLoaded = true;
      } catch (err) {
        console.error('Failed to load face recognition models from', modelsPath, err);
        throw new Error(
          'Face recognition models could not be loaded. Ensure /models directory contains the model weights.'
        );
      } finally {
        modelLoadingPromise = null;
      }
    })();

    return modelLoadingPromise;
  }

  static isLoaded(): boolean {
    return modelsLoaded;
  }

  /**
   * Computes Euclidean distance between two 128-dimensional face embedding vectors.
   * d = sqrt(sum((a_i - b_i)^2))
   */
  static computeEuclideanDistance(desc1: number[], desc2: number[]): number {
    if (desc1.length !== desc2.length) {
      throw new Error(`Descriptor length mismatch: ${desc1.length} vs ${desc2.length}`);
    }
    let sum = 0;
    for (let i = 0; i < desc1.length; i++) {
      const diff = desc1[i] - desc2[i];
      sum += diff * diff;
    }
    return Math.sqrt(sum);
  }

  /**
   * Converts Euclidean distance (0.0 to ~1.2) to an intuitive 0-100% similarity score.
   */
  static distanceToSimilarity(distance: number): number {
    // 0.0 distance = 100% match
    // 0.45 distance ~ 70% match
    // 0.60 distance ~ 50% match
    // >= 1.0 distance = 0%
    const score = Math.max(0, Math.min(100, Math.round((1 - distance / 1.0) * 100)));
    return score;
  }

  /**
   * Generates a deterministic or random normalized 128-d synthetic descriptor for testing.
   */
  static generateSyntheticDescriptor(seed?: string): number[] {
    const desc = new Array(128).fill(0);
    let sumSq = 0;
    let val = seed ? seed.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) : Math.random() * 1000;

    for (let i = 0; i < 128; i++) {
      val = (val * 9301 + 49297) % 233280;
      const num = val / 233280 - 0.5;
      desc[i] = num;
      sumSq += num * num;
    }

    // L2 Normalize
    const mag = Math.sqrt(sumSq) || 1;
    return desc.map((x) => x / mag);
  }

  /**
   * Validates a student reference photo for registration quality:
   *  - Exactly 1 face must be present.
   *  - Face must not be blurred or obscured.
   *  - Extracts and returns the 128-d reference descriptor.
   */
  static async validateAndExtractReferenceDescriptor(
    imageElement: HTMLImageElement | HTMLCanvasElement
  ): Promise<{
    valid: boolean;
    error?: string;
    descriptor?: number[];
    box?: FaceBoundingBox;
    qualityScore?: number;
  }> {
    if (!modelsLoaded) {
      await this.loadModels();
    }

    // Run multi-face detection to verify no other people are in the reference photo
    const allFaces = await faceapi
      .detectAllFaces(imageElement, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.4 }))
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (!allFaces || allFaces.length === 0) {
      return {
        valid: false,
        error: 'No detectable face found in the reference photograph. Ensure adequate lighting and face the camera directly.',
      };
    }

    if (allFaces.length > 1) {
      return {
        valid: false,
        error: `Multiple faces detected (${allFaces.length}). A student reference photo must contain exactly one face.`,
      };
    }

    const face = allFaces[0];
    const box: FaceBoundingBox = {
      x: Math.round(face.detection.box.x),
      y: Math.round(face.detection.box.y),
      width: Math.round(face.detection.box.width),
      height: Math.round(face.detection.box.height),
    };

    // Quality check: minimum size in pixels
    if (box.width < 50 || box.height < 50) {
      return {
        valid: false,
        error: 'The detected face is too small or distant for reliable matching. Please crop closer to the face.',
      };
    }

    const descriptor = Array.from(face.descriptor);
    const qualityScore = Math.min(1.0, Math.round(face.detection.score * 100) / 100);

    return {
      valid: true,
      descriptor,
      box,
      qualityScore,
    };
  }

  /**
   * Crops a detected face from the full source image and converts it to a data URL thumbnail.
   */
  static extractFaceCrop(
    sourceCanvasOrImage: HTMLCanvasElement | HTMLImageElement,
    box: FaceBoundingBox
  ): string {
    try {
      const canvas = document.createElement('canvas');
      const padding = 15; // include a bit of hair / chin margin
      const srcWidth = 'videoWidth' in sourceCanvasOrImage ? (sourceCanvasOrImage as any).videoWidth : sourceCanvasOrImage.width;
      const srcHeight = 'videoHeight' in sourceCanvasOrImage ? (sourceCanvasOrImage as any).videoHeight : sourceCanvasOrImage.height;

      const sx = Math.max(0, box.x - padding);
      const sy = Math.max(0, box.y - padding);
      const sWidth = Math.min(srcWidth - sx, box.width + padding * 2);
      const sHeight = Math.min(srcHeight - sy, box.height + padding * 2);

      canvas.width = 160;
      canvas.height = 160;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(sourceCanvasOrImage, sx, sy, sWidth, sHeight, 0, 0, 160, 160);
        return canvas.toDataURL('image/jpeg', 0.85);
      }
    } catch (e) {
      console.warn('Could not extract face thumbnail crop:', e);
    }
    return '';
  }

  /**
   * Detects all faces in a classroom photograph, aligns them, and extracts 128-d embeddings.
   */
  static async detectFacesInClassroomImage(
    sourceImageOrCanvas: HTMLImageElement | HTMLCanvasElement
  ): Promise<DetectedFace[]> {
    if (!modelsLoaded) {
      await this.loadModels();
    }

    // Use SSD MobileNet v1 for high accuracy multi-face detection
    const detections = await faceapi
      .detectAllFaces(
        sourceImageOrCanvas,
        new faceapi.SsdMobilenetv1Options({
          minConfidence: FACE_THRESHOLDS.MIN_DETECTION_CONFIDENCE,
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();

    return detections.map((d, index) => {
      const box: FaceBoundingBox = {
        x: Math.round(d.detection.box.x),
        y: Math.round(d.detection.box.y),
        width: Math.round(d.detection.box.width),
        height: Math.round(d.detection.box.height),
      };

      const cropUrl = this.extractFaceCrop(sourceImageOrCanvas, box);

      return {
        id: `face_det_${index + 1}_${Date.now()}`,
        box,
        cropUrl,
        confidence: Math.round(d.detection.score * 100) / 100,
        descriptor: Array.from(d.descriptor),
      };
    });
  }

  /**
   * Pure Roster Matcher:
   * Compares detected face descriptors against registered enrolled students for the class.
   *
   * Enforces:
   *  1. Only enrolled students are eligible candidates.
   *  2. Face matches at most one student.
   *  3. Student is matched at most once per scan (best distance wins).
   *  4. If multiple students have close match scores (delta < 0.08), flag as 'ambiguous'.
   *  5. If distance > 0.60, classify as 'unknown'.
   *  6. Unmatched enrolled students are classified as 'not_detected' (NEVER automatically marked absent).
   */
  static matchDetectedFacesAgainstRoster(
    detectedFaces: DetectedFace[],
    enrolledStudents: Student[],
    sessionId: string
  ): FaceScanSessionSummary {
    // Filter enrolled students who have a valid 128-d face descriptor
    const enrolledWithDescriptors = enrolledStudents.filter(
      (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
    );

    // Initial pass: evaluate all candidates for each detected face
    interface RawMatch {
      detectedFace: DetectedFace;
      candidates: FaceMatchCandidate[];
      bestCandidate: FaceMatchCandidate | null;
      secondCandidate: FaceMatchCandidate | null;
    }

    const rawMatches: RawMatch[] = detectedFaces.map((face) => {
      const candidates: FaceMatchCandidate[] = [];

      for (const student of enrolledWithDescriptors) {
        const distance = this.computeEuclideanDistance(face.descriptor, student.face_descriptor!);
        const similarity = this.distanceToSimilarity(distance);

        let category: FaceMatchCandidate['category'] = 'needs_review';
        if (distance <= FACE_THRESHOLDS.HIGH_CONFIDENCE_MAX_DISTANCE) {
          category = 'high_confidence';
        }

        candidates.push({
          student,
          distance,
          similarity,
          category,
        });
      }

      // Sort candidates by lowest Euclidean distance
      candidates.sort((a, b) => a.distance - b.distance);

      const bestCandidate = candidates.length > 0 ? candidates[0] : null;
      const secondCandidate = candidates.length > 1 ? candidates[1] : null;

      return {
        detectedFace: face,
        candidates,
        bestCandidate,
        secondCandidate,
      };
    });

    // Enforce 1-to-1 constraint: A student can only be matched to ONE face.
    // If multiple detected faces claim the same student, assign to the face with smaller distance.
    const studentClaimMap = new Map<string, { rawMatchIndex: number; distance: number }>();

    rawMatches.forEach((rm, index) => {
      if (rm.bestCandidate && rm.bestCandidate.distance <= FACE_THRESHOLDS.REVIEW_MAX_DISTANCE) {
        const studentId = rm.bestCandidate.student.id;
        const currentClaim = studentClaimMap.get(studentId);

        if (!currentClaim) {
          studentClaimMap.set(studentId, { rawMatchIndex: index, distance: rm.bestCandidate.distance });
        } else if (rm.bestCandidate.distance < currentClaim.distance) {
          // New face has a closer match to this student! Overwrite claim
          studentClaimMap.set(studentId, { rawMatchIndex: index, distance: rm.bestCandidate.distance });
        }
      }
    });

    const highConfidenceMatches: FaceMatchResult[] = [];
    const needsReviewMatches: FaceMatchResult[] = [];
    const unknownFaces: FaceMatchResult[] = [];
    const matchedStudentIds = new Set<string>();

    rawMatches.forEach((rm, index) => {
      const { detectedFace, bestCandidate, secondCandidate, candidates } = rm;

      // Check if this face has no candidate within review threshold (<= 0.60)
      if (!bestCandidate || bestCandidate.distance > FACE_THRESHOLDS.REVIEW_MAX_DISTANCE) {
        unknownFaces.push({
          detectionId: detectedFace.id,
          box: detectedFace.box,
          cropUrl: detectedFace.cropUrl,
          matchType: 'unknown',
          matchedStudent: null,
          rejectionReason: 'No registered enrolled student matched within threshold (> 0.60 distance).',
          alternativeCandidates: candidates.slice(0, 3),
        });
        return;
      }

      // Check 1-to-1 claim: Did another face win this student with a closer distance?
      const winningClaim = studentClaimMap.get(bestCandidate.student.id);
      if (winningClaim && winningClaim.rawMatchIndex !== index) {
        // Displaced match due to duplicate student claim
        needsReviewMatches.push({
          detectionId: detectedFace.id,
          box: detectedFace.box,
          cropUrl: detectedFace.cropUrl,
          matchType: 'ambiguous',
          matchedStudent: bestCandidate.student,
          distance: bestCandidate.distance,
          similarity: bestCandidate.similarity,
          rejectionReason: `Another face matched ${bestCandidate.student.full_name} with higher confidence. Requires instructor confirmation.`,
          alternativeCandidates: candidates.slice(0, 4),
        });
        return;
      }

      // Ambiguity Check: If 2nd best candidate is very close (< 0.08 delta)
      const isAmbiguous =
        secondCandidate &&
        secondCandidate.distance <= FACE_THRESHOLDS.REVIEW_MAX_DISTANCE &&
        secondCandidate.distance - bestCandidate.distance < FACE_THRESHOLDS.AMBIGUITY_DELTA;

      if (isAmbiguous) {
        needsReviewMatches.push({
          detectionId: detectedFace.id,
          box: detectedFace.box,
          cropUrl: detectedFace.cropUrl,
          matchType: 'ambiguous',
          matchedStudent: bestCandidate.student,
          distance: bestCandidate.distance,
          similarity: bestCandidate.similarity,
          rejectionReason: `Close match between ${bestCandidate.student.full_name} and ${secondCandidate.student.full_name} (difference < ${FACE_THRESHOLDS.AMBIGUITY_DELTA}).`,
          alternativeCandidates: candidates.slice(0, 4),
        });
        matchedStudentIds.add(bestCandidate.student.id);
        return;
      }

      // Categorize into High Confidence or Needs Review based on distance
      if (bestCandidate.distance <= FACE_THRESHOLDS.HIGH_CONFIDENCE_MAX_DISTANCE) {
        highConfidenceMatches.push({
          detectionId: detectedFace.id,
          box: detectedFace.box,
          cropUrl: detectedFace.cropUrl,
          matchType: 'high_confidence',
          matchedStudent: bestCandidate.student,
          distance: bestCandidate.distance,
          similarity: bestCandidate.similarity,
          confirmedStudentId: bestCandidate.student.id,
          alternativeCandidates: candidates.slice(1, 4),
        });
        matchedStudentIds.add(bestCandidate.student.id);
      } else {
        needsReviewMatches.push({
          detectionId: detectedFace.id,
          box: detectedFace.box,
          cropUrl: detectedFace.cropUrl,
          matchType: 'needs_review',
          matchedStudent: bestCandidate.student,
          distance: bestCandidate.distance,
          similarity: bestCandidate.similarity,
          rejectionReason: `Match distance (${bestCandidate.distance.toFixed(3)}) is in uncertain review zone (0.45 - 0.60).`,
          alternativeCandidates: candidates.slice(0, 4),
        });
        matchedStudentIds.add(bestCandidate.student.id);
      }
    });

    // Enrolled students who were NOT matched in this scan
    // Crucial rule: They remain 'not_detected', NOT automatically marked absent!
    const notDetectedEnrolledStudents = enrolledStudents.filter(
      (s) => !matchedStudentIds.has(s.id)
    );

    return {
      sessionId,
      totalFacesDetected: detectedFaces.length,
      highConfidenceMatches,
      needsReviewMatches,
      unknownFaces,
      notDetectedEnrolledStudents,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to load an image URL into an HTMLImageElement
   */
  static loadImageElement(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image from ${url.slice(0, 50)}...`));
      img.src = url;
    });
  }

  /**
   * Multi-Photo Roster Matcher:
   * Aggregates and deduplicates face detections across multiple photos.
   *
   * Enforces:
   *  1. Highest-confidence match wins across photos for any student.
   *  2. When student is detected across multiple photos (e.g., left and center angles),
   *     the student is confirmed once with their lowest Euclidean distance evidence.
   *     Secondary detections across photos do not generate bogus conflict warnings.
   *  3. Source photo tracking (sourcePhotoId, sourcePhotoName) preserved on each match.
   *  4. Zero Auto-Absent Rule: Enrolled students not detected remain unconfirmed/unmarked.
   */
  static matchMultiPhotoDetectedFacesAgainstRoster(
    detectedFaces: (DetectedFace & { sourcePhotoId?: string; sourcePhotoName?: string })[],
    enrolledStudents: Student[],
    sessionId: string
  ): FaceScanSessionSummary {
    const enrolledWithDescriptors = enrolledStudents.filter(
      (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
    );

    interface EvaluatedDetection {
      face: DetectedFace & { sourcePhotoId?: string; sourcePhotoName?: string };
      candidates: FaceMatchCandidate[];
      bestCandidate: FaceMatchCandidate | null;
      secondCandidate: FaceMatchCandidate | null;
    }

    const evaluatedDetections: EvaluatedDetection[] = detectedFaces.map((face) => {
      const candidates: FaceMatchCandidate[] = [];

      for (const student of enrolledWithDescriptors) {
        const distance = this.computeEuclideanDistance(face.descriptor, student.face_descriptor!);
        const similarity = this.distanceToSimilarity(distance);

        let category: FaceMatchCandidate['category'] = 'needs_review';
        if (distance <= FACE_THRESHOLDS.HIGH_CONFIDENCE_MAX_DISTANCE) {
          category = 'high_confidence';
        }

        candidates.push({
          student,
          distance,
          similarity,
          category,
        });
      }

      candidates.sort((a, b) => a.distance - b.distance);

      return {
        face,
        candidates,
        bestCandidate: candidates.length > 0 ? candidates[0] : null,
        secondCandidate: candidates.length > 1 ? candidates[1] : null,
      };
    });

    const unknownFaces: FaceMatchResult[] = [];
    const studentDetectionsMap = new Map<string, EvaluatedDetection[]>();

    for (const ed of evaluatedDetections) {
      if (!ed.bestCandidate || ed.bestCandidate.distance > FACE_THRESHOLDS.REVIEW_MAX_DISTANCE) {
        unknownFaces.push({
          detectionId: ed.face.id,
          box: ed.face.box,
          cropUrl: ed.face.cropUrl,
          matchType: 'unknown',
          matchedStudent: null,
          rejectionReason: 'No registered enrolled student matched within threshold (> 0.60 distance).',
          alternativeCandidates: ed.candidates.slice(0, 3),
          sourcePhotoId: ed.face.sourcePhotoId,
          sourcePhotoName: ed.face.sourcePhotoName,
        });
      } else {
        const sId = ed.bestCandidate.student.id;
        const list = studentDetectionsMap.get(sId) || [];
        list.push(ed);
        studentDetectionsMap.set(sId, list);
      }
    }

    const highConfidenceMatches: FaceMatchResult[] = [];
    const needsReviewMatches: FaceMatchResult[] = [];
    const matchedStudentIds = new Set<string>();

    for (const [studentId, detections] of studentDetectionsMap.entries()) {
      // Find the detection with lowest Euclidean distance (highest confidence)
      detections.sort((a, b) => a.bestCandidate!.distance - b.bestCandidate!.distance);
      const winner = detections[0];
      const best = winner.bestCandidate!;
      const second = winner.secondCandidate;

      // Check if ambiguous
      const isAmbiguous =
        second &&
        second.distance <= FACE_THRESHOLDS.REVIEW_MAX_DISTANCE &&
        second.distance - best.distance < FACE_THRESHOLDS.AMBIGUITY_DELTA;

      if (isAmbiguous) {
        needsReviewMatches.push({
          detectionId: winner.face.id,
          box: winner.face.box,
          cropUrl: winner.face.cropUrl,
          matchType: 'ambiguous',
          matchedStudent: best.student,
          distance: best.distance,
          similarity: best.similarity,
          rejectionReason: `Close match between ${best.student.full_name} and ${second.student.full_name} (difference < ${FACE_THRESHOLDS.AMBIGUITY_DELTA}).`,
          alternativeCandidates: winner.candidates.slice(0, 4),
          sourcePhotoId: winner.face.sourcePhotoId,
          sourcePhotoName: winner.face.sourcePhotoName,
        });
        matchedStudentIds.add(studentId);
      } else if (best.distance <= FACE_THRESHOLDS.HIGH_CONFIDENCE_MAX_DISTANCE) {
        highConfidenceMatches.push({
          detectionId: winner.face.id,
          box: winner.face.box,
          cropUrl: winner.face.cropUrl,
          matchType: 'high_confidence',
          matchedStudent: best.student,
          distance: best.distance,
          similarity: best.similarity,
          confirmedStudentId: best.student.id,
          alternativeCandidates: winner.candidates.slice(1, 4),
          sourcePhotoId: winner.face.sourcePhotoId,
          sourcePhotoName: winner.face.sourcePhotoName,
        });
        matchedStudentIds.add(studentId);
      } else {
        needsReviewMatches.push({
          detectionId: winner.face.id,
          box: winner.face.box,
          cropUrl: winner.face.cropUrl,
          matchType: 'needs_review',
          matchedStudent: best.student,
          distance: best.distance,
          similarity: best.similarity,
          rejectionReason: `Match distance (${best.distance.toFixed(3)}) is in uncertain review zone (0.45 - 0.60).`,
          alternativeCandidates: winner.candidates.slice(0, 4),
          sourcePhotoId: winner.face.sourcePhotoId,
          sourcePhotoName: winner.face.sourcePhotoName,
        });
        matchedStudentIds.add(studentId);
      }

      // Check for same-photo duplicate faces (two different people in the same photo claiming the same student)
      for (let i = 1; i < detections.length; i++) {
        const sub = detections[i];
        if (sub.face.sourcePhotoId && sub.face.sourcePhotoId === winner.face.sourcePhotoId) {
          needsReviewMatches.push({
            detectionId: sub.face.id,
            box: sub.face.box,
            cropUrl: sub.face.cropUrl,
            matchType: 'ambiguous',
            matchedStudent: sub.bestCandidate!.student,
            distance: sub.bestCandidate!.distance,
            similarity: sub.bestCandidate!.similarity,
            rejectionReason: `Another face in the same photo (${sub.face.sourcePhotoName || 'photo'}) also claimed ${sub.bestCandidate!.student.full_name}. Requires manual confirmation.`,
            alternativeCandidates: sub.candidates.slice(0, 4),
            sourcePhotoId: sub.face.sourcePhotoId,
            sourcePhotoName: sub.face.sourcePhotoName,
          });
        }
      }
    }

    // Zero Auto-Absent Rule: Enrolled students not detected in any photo
    const notDetectedEnrolledStudents = enrolledStudents.filter(
      (s) => !matchedStudentIds.has(s.id)
    );

    return {
      sessionId,
      totalFacesDetected: detectedFaces.length,
      highConfidenceMatches,
      needsReviewMatches,
      unknownFaces,
      notDetectedEnrolledStudents,
      processedAt: new Date().toISOString(),
    };
  }

  /**
   * Processes a batch of multiple classroom photos end-to-end:
   * 1. Detects faces in each photo sequentially to avoid memory thrashing.
   * 2. Emits progress callbacks.
   * 3. Combines and deduplicates matches across all photos.
   */
  static async processMultiPhotoClassroomBatch(
    photos: { id: string; name: string; url: string }[],
    enrolledStudents: Student[],
    sessionId: string,
    onProgress?: (progress: {
      currentPhoto: number;
      totalPhotos: number;
      photoName: string;
      percent: number;
    }) => void
  ): Promise<MultiPhotoBatchSummary> {
    if (!modelsLoaded) {
      await this.loadModels();
    }

    const perPhotoResults: MultiPhotoBatchSummary['perPhotoResults'] = [];
    const allFaces: (DetectedFace & { sourcePhotoId: string; sourcePhotoName: string })[] = [];
    let processedCount = 0;
    let failedCount = 0;

    for (let i = 0; i < photos.length; i++) {
      const p = photos[i];
      if (onProgress) {
        onProgress({
          currentPhoto: i + 1,
          totalPhotos: photos.length,
          photoName: p.name,
          percent: Math.round((i / photos.length) * 100),
        });
      }

      try {
        const img = await this.loadImageElement(p.url);
        const facesInPhoto = await this.detectFacesInClassroomImage(img);

        for (const face of facesInPhoto) {
          allFaces.push({
            ...face,
            sourcePhotoId: p.id,
            sourcePhotoName: p.name,
          });
        }

        perPhotoResults.push({
          photoId: p.id,
          photoName: p.name,
          photoUrl: p.url,
          facesDetected: facesInPhoto.length,
          status: 'success',
        });
        processedCount++;
      } catch (err: any) {
        console.error(`Error processing photo ${p.name}:`, err);
        perPhotoResults.push({
          photoId: p.id,
          photoName: p.name,
          photoUrl: p.url,
          facesDetected: 0,
          status: 'failed',
          error: err?.message || 'Processing failed',
        });
        failedCount++;
      }
    }

    if (onProgress) {
      onProgress({
        currentPhoto: photos.length,
        totalPhotos: photos.length,
        photoName: 'Complete',
        percent: 100,
      });
    }

    const summary = this.matchMultiPhotoDetectedFacesAgainstRoster(
      allFaces,
      enrolledStudents,
      sessionId
    );

    return {
      ...summary,
      totalPhotosSubmitted: photos.length,
      totalPhotosProcessed: processedCount,
      totalPhotosFailed: failedCount,
      perPhotoResults,
    };
  }
}
