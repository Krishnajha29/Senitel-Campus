export type AttendanceStatus = 'present' | 'absent' | 'late' | 'unmarked';
export type SessionStatus = 'scheduled' | 'active' | 'finalized' | 'cancelled';
export type MarkingMethod = 'manual' | 'face_recognition' | 'face_scan' | 'presence_key' | 'admin_override';
export type PresenceKeyStatus = 'active' | 'expired' | 'revoked';
export type FaceEnrollmentStatus = 'enrolled' | 'pending' | 'failed' | 'not_enrolled';

export interface Instructor {
  id: string;
  full_name: string;
  email: string;
  institution: string;
  department: string;
  avatar_url?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Student {
  id: string;
  instructor_id: string;
  roll_number: string;
  full_name: string;
  email?: string | null;
  course: string;
  batch: string;
  academic_year: string;
  section: string;
  photo_path: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  photo_url?: string; // Resolved signed or object URL for display
  face_descriptor?: number[] | null; // 128-dimensional embedding
  face_enrolled_at?: string | null;
  face_enrollment_status?: FaceEnrollmentStatus;
  face_quality_score?: number | null;
}

export interface ClassCourse {
  id: string;
  instructor_id: string;
  name: string;
  code: string;
  academic_year: string;
  section: string;
  description?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  enrolled_count?: number;
}

export interface ClassEnrollment {
  id: string;
  class_id: string;
  student_id: string;
  enrolled_at: string;
}

export interface AttendanceSession {
  id: string;
  class_id: string;
  instructor_id: string;
  title: string;
  session_date: string;
  start_time: string;
  end_time: string;
  status: SessionStatus;
  created_at: string;
  updated_at: string;
  class_name?: string;
  class_code?: string;
  stats?: {
    present: number;
    absent: number;
    late: number;
    unmarked: number;
    total: number;
  };
}

export interface AttendanceRecord {
  id: string;
  session_id: string;
  student_id: string;
  status: AttendanceStatus;
  marked_by: string;
  marked_at: string;
  method: MarkingMethod;
  notes?: string | null;
  face_verification_metadata?: {
    detection_id?: string;
    confidence?: number;
    similarity?: number;
    match_category?: string;
  } | null;
  created_at: string;
  updated_at: string;
  student?: Student;
}

export interface AttendanceAuditLog {
  id: string;
  record_id?: string | null;
  session_id: string;
  student_id: string;
  action?: string | null;
  previous_status?: AttendanceStatus | null;
  new_status: AttendanceStatus;
  changed_by: string;
  changed_at: string;
  reason?: string | null;
}

export interface PresenceKey {
  id: string;
  session_id: string;
  instructor_id: string;
  key_hash: string;
  key_salt: string;
  expires_at: string;
  status: PresenceKeyStatus;
  created_at: string;
  revoked_at?: string | null;
  revoked_by?: string | null;
  plain_key?: string; // Transient in memory for display to authorized instructor
}

export interface CheckInRequest {
  presence_key: string;
  student_id?: string; // Only used when simulating or testing in mock mode; server extracts authenticated identity
}

export interface CheckInResult {
  success: boolean;
  message: string;
  code?: string;
  already_checked_in?: boolean;
  session?: {
    id: string;
    title: string;
    session_date?: string;
    class_name?: string;
  };
  record?: {
    id?: string;
    status: AttendanceStatus;
    marked_at: string;
    method: MarkingMethod;
  };
  student?: {
    id: string;
    full_name: string;
    roll_number: string;
  };
}

export interface DashboardStats {
  totalStudents: number;
  totalActiveClasses: number;
  totalSessions: number;
  selectedSessionPresent: number;
  selectedSessionAbsent: number;
  selectedSessionLate: number;
  selectedSessionTitle?: string;
  overallAttendancePct: number;
}

// -------------------------------------------------------------
// Face Recognition Domain Types
// -------------------------------------------------------------
export interface FaceBoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DetectedFace {
  id: string; // unique detection ID
  box: FaceBoundingBox;
  cropUrl?: string; // Base64 data URL crop of the detected face for instructor review
  confidence: number; // Detection confidence score (0.0 - 1.0)
  descriptor: number[]; // 128-d Float32Array face embedding converted to number[]
}

export interface FaceMatchCandidate {
  student: Student;
  distance: number; // Euclidean distance (lower is better, < 0.45 = high confidence)
  similarity: number; // Normalized similarity percentage (0 - 100%)
  category: 'high_confidence' | 'needs_review' | 'ambiguous';
}

export interface FaceMatchResult {
  detectionId: string;
  box: FaceBoundingBox;
  cropUrl?: string;
  matchType: 'high_confidence' | 'needs_review' | 'ambiguous' | 'unknown';
  matchedStudent?: Student | null;
  distance?: number;
  similarity?: number;
  alternativeCandidates?: FaceMatchCandidate[];
  rejectionReason?: string;
  confirmedStudentId?: string | null; // Set by instructor review
  sourcePhotoId?: string; // Multi-photo source tracking
  sourcePhotoName?: string;
}

export interface FaceScanSessionSummary {
  sessionId: string;
  totalFacesDetected: number;
  highConfidenceMatches: FaceMatchResult[];
  needsReviewMatches: FaceMatchResult[];
  unknownFaces: FaceMatchResult[];
  notDetectedEnrolledStudents: Student[];
  processedAt: string;
}

export interface MultiPhotoBatchSummary extends FaceScanSessionSummary {
  totalPhotosSubmitted: number;
  totalPhotosProcessed: number;
  totalPhotosFailed: number;
  perPhotoResults: {
    photoId: string;
    photoName: string;
    photoUrl: string;
    facesDetected: number;
    status: 'success' | 'failed';
    error?: string;
  }[];
}

export interface FaceAttendanceSubmissionItem {
  studentId: string;
  status: AttendanceStatus;
  detectionId?: string;
  confidenceScore?: number;
  matchType?: string;
}

export interface FaceAttendanceSubmissionResult {
  success: boolean;
  markedPresentCount: number;
  alreadyPresentCount: number;
  updatedRecords: AttendanceRecord[];
  auditLogIds: string[];
}

// -------------------------------------------------------------
// QR-Based Classroom Photo Upload Domain Types
// -------------------------------------------------------------
export type PhotoUploadStatus =
  | 'awaiting_scan'
  | 'uploading'
  | 'photo_received'
  | 'upload_failed'
  | 'expired'
  | 'revoked'
  | 'processing';

export interface UploadedPhotoItem {
  id: string; // unique photo item ID
  upload_session_id: string;
  session_id: string;
  storage_path: string;
  preview_url: string;
  file_url?: string; // alias
  file_name: string;
  file_size: number;
  file_size_bytes?: number; // alias
  mime_type: string;
  uploaded_at: string;
  device_info?: string;
  status: 'uploaded' | 'processing' | 'processed' | 'failed';
  error_message?: string;
  faces_detected_count?: number;
}

export interface PhotoUploadSession {
  id: string; // unique upload session ID
  session_id: string; // foreign key to attendance_sessions
  instructor_id: string; // foreign key to instructors
  token_hash: string; // secure hash of upload token
  token_salt: string;
  qr_url: string; // Full URL encoded in the QR code
  upload_url?: string; // alias for qr_url
  status: PhotoUploadStatus;
  expires_at: string; // ISO timestamp
  created_at: string;
  updated_at: string;
  photo_storage_path?: string | null; // private storage reference
  photo_preview_url?: string | null; // safe preview URL
  photo_url?: string | null; // alias for photo_preview_url
  photo_file_name?: string | null;
  photo_file_size?: number | null;
  photo_size_bytes?: number | null; // alias
  photo_mime_type?: string | null;
  photo_device_info?: string | null;
  photo_uploaded_at?: string | null;
  consumed_at?: string | null;
  revoked_at?: string | null;
  error_message?: string | null;
  photos?: UploadedPhotoItem[]; // Multi-photo collection for this batch session
  total_photos_count?: number;
}

export interface CreatePhotoUploadSessionResult {
  upload_session: PhotoUploadSession;
  session: PhotoUploadSession; // alias
  plain_token: string;
  qr_url: string;
  upload_url: string; // alias
  qr_data_url: string; // Data URL for rendering the real QR code
}

export interface PhotoUploadValidationResult {
  valid: boolean;
  error_code?: 'INVALID_TOKEN' | 'EXPIRED_TOKEN' | 'REVOKED_TOKEN' | 'ALREADY_CONSUMED' | 'SESSION_CLOSED';
  message?: string;
  error?: string; // alias
  session?: {
    id: string;
    title: string;
    class_name: string;
    class_code: string;
    session_date: string;
    start_time: string;
    end_time: string;
    instructor_name: string;
    expires_at?: string;
  };
  classCourse?: ClassCourse;
  photos?: UploadedPhotoItem[];
}

export interface SubmitClassroomPhotoResult {
  success: boolean;
  error_code?: string;
  message: string;
  error?: string; // alias
  upload_session_id?: string;
  photo_storage_path?: string;
  photo_preview_url?: string;
  photo_url?: string; // alias
  uploaded_at?: string;
  session: PhotoUploadSession;
}

export interface SubmitClassroomPhotoBatchResult {
  success: boolean;
  error_code?: string;
  message: string;
  error?: string; // alias
  upload_session_id?: string;
  total_submitted: number;
  successful_count: number;
  failed_count: number;
  photos: UploadedPhotoItem[];
  uploadedPhotos?: UploadedPhotoItem[]; // alias
  failed_items?: { fileName: string; error: string }[];
  session: PhotoUploadSession;
}

