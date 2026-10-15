import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Camera,
  Upload,
  RefreshCw,
  CheckCircle2,
  HelpCircle,
  Users,
  X,
  Sparkles,
  ShieldAlert,
  FlipHorizontal,
  ArrowLeft,
  Loader2,
  Check,
  UserX,
  ImageIcon,
  QrCode,
  Smartphone,
  Copy,
  Clock,
  CheckCircle,
  XCircle,
  Layers,
  AlertTriangle,
  AlertCircle,
} from 'lucide-react';
import type {
  AttendanceSession,
  FaceScanSessionSummary,
  Student,
  PhotoUploadSession,
  ClassCourse,
  AcademicSection,
  SharedMobileQRSession,
  SharedMobileQRSessionStatus,
} from '../../types';
import { FaceRecognitionService } from '../../services/faceRecognition';
import { ApiService } from '../../services/api';
import { useToast } from '../common/ToastContext';
import QRCode from 'qrcode';

interface FaceAttendanceModalProps {
  isOpen: boolean;
  session: AttendanceSession;
  enrolledStudents: Student[];
  onClose: () => void;
  onAttendanceSubmitted: () => void;
}

type Step = 'capture' | 'preview' | 'processing' | 'review' | 'confirming';
type ReviewTab = 'high_confidence' | 'needs_review' | 'not_detected' | 'face_required' | 'unknown_faces';
type CaptureSource = 'qr' | 'webcam';
type QrMode = 'mobile_app' | 'photo_upload';

export const FaceAttendanceModal: React.FC<FaceAttendanceModalProps> = ({
  isOpen,
  session,
  enrolledStudents,
  onClose,
  onAttendanceSubmitted,
}) => {
  const toast = useToast();

  // Workflow steps
  const [currentStep, setCurrentStep] = useState<Step>('capture');
  const [activeTab, setActiveTab] = useState<ReviewTab>('high_confidence');
  const [captureSource, setCaptureSource] = useState<CaptureSource>('qr');
  const [qrMode, setQrMode] = useState<QrMode>('mobile_app');

  // Shared Mobile App QR Session state (Student-by-student live scan)
  const [sharedMobileSession, setSharedMobileSession] = useState<SharedMobileQRSession | null>(null);
  const [sharedMobileQrDataUrl, setSharedMobileQrDataUrl] = useState<string | null>(null);
  const [sharedMobileStatus, setSharedMobileStatus] = useState<SharedMobileQRSessionStatus | null>(null);
  const [isGeneratingSharedMobileQr, setIsGeneratingSharedMobileQr] = useState<boolean>(false);
  const [copiedToken, setCopiedToken] = useState<boolean>(false);
  const [isFinalizingMobileSession, setIsFinalizingMobileSession] = useState<boolean>(false);

  // Photo Upload Session state (Multi-photo upload)
  const [uploadSession, setUploadSession] = useState<PhotoUploadSession | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [uploadUrl, setUploadUrl] = useState<string | null>(null);
  const [remainingSeconds, setRemainingSeconds] = useState<number>(600);
  const [isGeneratingQr, setIsGeneratingQr] = useState<boolean>(false);
  const [isRevokingQr, setIsRevokingQr] = useState<boolean>(false);
  const [copiedLink, setCopiedLink] = useState<boolean>(false);

  // Camera state (Laptop webcam & device camera)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [isCameraInitializing, setIsCameraInitializing] = useState<boolean>(false);
  const [isCameraReady, setIsCameraReady] = useState<boolean>(false);
  const [isCapturing, setIsCapturing] = useState<boolean>(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('user');
  const [capturedImage, setCapturedImage] = useState<string | null>(null);
  const [receivedPhotos, setReceivedPhotos] = useState<{ id: string; name: string; url: string; size?: number }[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; percent: number; photoName: string } | null>(null);

  // Processing state
  const [processingPhase, setProcessingPhase] = useState<string>('Initializing models...');
  const [scanSummary, setScanSummary] = useState<FaceScanSessionSummary | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Instructor review selections
  const [selectedHighConfidenceIds, setSelectedHighConfidenceIds] = useState<Set<string>>(new Set());
  const [resolvedReviewMap, setResolvedReviewMap] = useState<Map<string, string>>(new Map()); // detectionId -> studentId
  const [manualPresentIds, setManualPresentIds] = useState<Set<string>>(new Set());

  // Live Class Roster & Diagnostic State
  const [liveEnrolledStudents, setLiveEnrolledStudents] = useState<Student[]>(enrolledStudents || []);
  const [hasLoadedRoster, setHasLoadedRoster] = useState<boolean>(false);
  const [classObj, setClassObj] = useState<ClassCourse | null>(null);
  const [rosterLoading, setRosterLoading] = useState<boolean>(false);
  const [rosterState, setRosterState] = useState<'loading' | 'ready' | 'empty' | 'no_cohort' | 'unauthorized' | 'db_error'>('loading');
  const [rosterErrorMessage, setRosterErrorMessage] = useState<string | null>(null);
  const [availableSections, setAvailableSections] = useState<AcademicSection[]>([]);
  const [selectedSectionToAssign, setSelectedSectionToAssign] = useState<string>('');
  const [isAssigningSection, setIsAssigningSection] = useState<boolean>(false);
  const [isExtractingBiometrics, setIsExtractingBiometrics] = useState<boolean>(false);

  const effectiveRoster = hasLoadedRoster ? liveEnrolledStudents : (enrolledStudents && enrolledStudents.length > 0 ? enrolledStudents : liveEnrolledStudents);

  // Enrolled students with valid 128-d face descriptors
  const enrolledWithFaces = effectiveRoster.filter(
    (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
  );

  // Enrolled students with photos but missing 128-d face embedding
  const enrolledNeedingBiometrics = effectiveRoster.filter(
    (s) =>
      (!s.face_descriptor || !Array.isArray(s.face_descriptor) || s.face_descriptor.length !== 128) &&
      (s.photo_url || s.photo_path)
  );

  const loadClassRoster = useCallback(async () => {
    if (!session?.class_id) return;
    setRosterLoading(true);
    setRosterErrorMessage(null);
    try {
      // Automatically keep attendance session synchronized with latest active section students
      if (session.id) {
        await ApiService.refreshSessionRoster(session.id).catch(() => {});
      }

      const [classDetails, enrolled, sections] = await Promise.all([
        ApiService.getClassById(session.class_id),
        ApiService.getClassEnrollments(session.class_id),
        ApiService.getSections().catch(() => []),
      ]);
      setClassObj(classDetails);
      setLiveEnrolledStudents(enrolled);
      setAvailableSections(sections);
      if (sections.length > 0 && !selectedSectionToAssign) {
        setSelectedSectionToAssign(sections[0].id);
      }
      setHasLoadedRoster(true);

      if (enrolled.length === 0) {
        if (!classDetails?.section_id && !classDetails?.programme) {
          setRosterState('no_cohort');
        } else {
          setRosterState('empty');
        }
      } else {
        setRosterState('ready');
      }
    } catch (err: any) {
      console.error('Failed to load roster in FaceAttendanceModal:', err);
      const msg = err.message || '';
      if (
        msg.includes('permission denied') ||
        msg.includes('401') ||
        msg.includes('403') ||
        msg.includes('JWT') ||
        msg.includes('Unauthorized') ||
        msg.includes('unauthorized')
      ) {
        setRosterState('unauthorized');
        setRosterErrorMessage(msg);
      } else {
        setRosterState('db_error');
        setRosterErrorMessage(msg);
      }
      setHasLoadedRoster(true);
    } finally {
      setRosterLoading(false);
    }
  }, [session?.class_id, session?.id, selectedSectionToAssign]);

  useEffect(() => {
    if (isOpen) {
      loadClassRoster();
    }
  }, [isOpen, loadClassRoster]);

  const handleAssignClassSection = async (sectionId: string) => {
    if (!classObj?.id || !sectionId) return;
    try {
      setIsAssigningSection(true);
      const targetSec = availableSections.find((s) => s.id === sectionId);
      if (!targetSec) return;
      await ApiService.updateClass(classObj.id, {
        section_id: targetSec.id,
        programme: targetSec.programme,
        batch: targetSec.batch,
        academic_year: targetSec.academic_year,
        section: targetSec.section || targetSec.name,
        semester: targetSec.semester || undefined,
        enrollment_type: 'section',
      });
      toast.success(
        'Section Cohort Assigned',
        `Assigned ${classObj.name} to ${targetSec.programme} (Sec ${targetSec.section}). Section roster loaded.`
      );
      await loadClassRoster();
      if (onAttendanceSubmitted) {
        onAttendanceSubmitted();
      }
    } catch (err: any) {
      toast.error('Assignment Failed', err.message);
    } finally {
      setIsAssigningSection(false);
    }
  };


  const handleExtractMissingBiometrics = async () => {
    if (enrolledNeedingBiometrics.length === 0) return;
    setIsExtractingBiometrics(true);
    toast.info(
      'Analyzing Photos',
      `Extracting 128-d face biometrics for ${enrolledNeedingBiometrics.length} student(s)...`
    );

    try {
      await FaceRecognitionService.loadModels();
      let extractedCount = 0;
      for (const student of enrolledNeedingBiometrics) {
        const photoUrl = student.photo_url || student.photo_path;
        if (!photoUrl) continue;
        try {
          const img = await FaceRecognitionService.loadImageElement(photoUrl);
          const res = await FaceRecognitionService.validateAndExtractReferenceDescriptor(img);
          if (res.valid && res.descriptor) {
            await ApiService.enrollStudentFaceDescriptor(
              student.id,
              res.descriptor,
              res.qualityScore || 0.95
            );
            extractedCount++;
          }
        } catch (err) {
          console.warn(`Extraction error for ${student.full_name}:`, err);
        }
      }

      if (extractedCount > 0) {
        toast.success(
          'Biometrics Enrolled',
          `Extracted and persisted 128-d vectors for ${extractedCount} student(s).`
        );
        await loadClassRoster();
        onAttendanceSubmitted();
      } else {
        toast.info(
          'Verification Finished',
          'Could not detect single clear face features in registered photos.'
        );
      }
    } catch (err: any) {
      toast.error('Biometric Extraction Failed', err.message);
    } finally {
      setIsExtractingBiometrics(false);
    }
  };

  // -------------------------------------------------------------
  // QR Upload Session Management & Auto-Init
  // -------------------------------------------------------------
  const initOrFetchQrSession = useCallback(async () => {
    if (!session?.id) return;
    setIsGeneratingQr(true);
    try {
      const active = await ApiService.getActivePhotoUploadSession(session.id);
      if (active) {
        setUploadSession(active);
        const url = active.upload_url || `${window.location.origin}/attendance-upload`;
        setUploadUrl(url);
        try {
          const qr = await QRCode.toDataURL(url, { width: 320, margin: 2 });
          setQrDataUrl(qr);
        } catch {
          // Fallback if QRCode generation fails
        }

        const expMs = new Date(active.expires_at).getTime() - Date.now();
        setRemainingSeconds(Math.max(0, Math.floor(expMs / 1000)));

        if (active.photos && active.photos.length > 0) {
          setReceivedPhotos(
            active.photos.map((p) => ({
              id: p.id,
              name: p.file_name,
              url: p.preview_url || p.file_url || '',
              size: p.file_size || p.file_size_bytes || 0,
            }))
          );
          setCapturedImage(active.photos[0].preview_url || active.photos[0].file_url || null);
        } else if (active.photo_url && active.status === 'photo_received') {
          setReceivedPhotos([
            {
              id: 'single_photo',
              name: 'Classroom Photo',
              url: active.photo_url,
              size: active.photo_size_bytes || undefined,
            },
          ]);
          setCapturedImage(active.photo_url);
        }
      } else {
        // Create new session
        const res = await ApiService.createPhotoUploadSession(session.id, 10);
        setUploadSession(res.session);
        setQrDataUrl(res.qr_data_url);
        setUploadUrl(res.upload_url);
        setRemainingSeconds(600);
        setReceivedPhotos([]);
      }
    } catch (err: any) {
      console.error('Failed to initialize photo upload session:', err);
    } finally {
      setIsGeneratingQr(false);
    }
  }, [session?.id]);

  // Shared Mobile Session Initialization
  const initOrFetchSharedMobileSession = useCallback(async () => {
    if (!session?.id) return;
    setIsGeneratingSharedMobileQr(true);
    try {
      const res = await ApiService.createSharedMobileQRSession(session.id, 'checkpoint_1', 10);
      setSharedMobileSession(res.session);
      setSharedMobileQrDataUrl(res.qrDataUrl);
    } catch (err: any) {
      console.warn('[FaceAttendanceModal] Error creating shared mobile session:', err);
    } finally {
      setIsGeneratingSharedMobileQr(false);
    }
  }, [session?.id]);

  const handleCopyToken = () => {
    if (!sharedMobileSession?.token) return;
    navigator.clipboard.writeText(sharedMobileSession.token);
    setCopiedToken(true);
    toast.success('Token Copied', `Session token ${sharedMobileSession.token} copied to clipboard.`);
    setTimeout(() => setCopiedToken(false), 2500);
  };

  const handleFinalizeMobileSession = async () => {
    if (!sharedMobileSession?.token || !session?.id) return;
    setIsFinalizingMobileSession(true);
    try {
      await ApiService.closeSharedMobileQRSession(sharedMobileSession.token);
      await ApiService.refreshSessionRoster(session.id);
      const confirmedCount = sharedMobileStatus?.stats.identifiedCount || 0;
      toast.success(
        'Attendance Session Finalized',
        `${confirmedCount} student(s) marked present via mobile biometric capture.`
      );
      if (onAttendanceSubmitted) {
        onAttendanceSubmitted();
      }
      onClose();
    } catch (err: any) {
      toast.error('Finalization Error', err.message || 'Could not close mobile session.');
    } finally {
      setIsFinalizingMobileSession(false);
    }
  };

  // Load session when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentStep('capture');
      setCaptureSource('qr');
      setQrMode('mobile_app');
      setCapturedImage(null);
      setReceivedPhotos([]);
      setScanSummary(null);
      initOrFetchSharedMobileSession();
      initOrFetchQrSession();
    }
  }, [isOpen, initOrFetchSharedMobileSession, initOrFetchQrSession]);

  // Real-time Background Polling for Shared Mobile Session Captures
  useEffect(() => {
    if (!isOpen || !sharedMobileSession?.token || currentStep !== 'capture') return;
    if (captureSource !== 'qr' || qrMode !== 'mobile_app') return;

    const pollStatus = async () => {
      try {
        const status = await ApiService.getSharedMobileQRSessionStatus(sharedMobileSession.token);
        if (status) {
          setSharedMobileStatus(status);
        }
      } catch (err) {
        console.warn('Error polling shared mobile status:', err);
      }
    };

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => clearInterval(interval);
  }, [isOpen, sharedMobileSession?.token, currentStep, captureSource, qrMode]);

  // Expiration countdown timer
  useEffect(() => {
    if (!isOpen || remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen, remainingSeconds]);

  // Real-time Background Polling for Upload Status
  useEffect(() => {
    if (!isOpen || !session?.id) return;
    if (currentStep !== 'capture' && currentStep !== 'preview') return;

    // Stop polling if photos already received and confirmed
    if (uploadSession?.status === 'photo_received' && receivedPhotos.length > 0) return;

    const pollInterval = setInterval(async () => {
      try {
        const latest = await ApiService.getActivePhotoUploadSession(session.id);
        if (latest) {
          if (latest.status === 'photo_received') {
            const photosList =
              latest.photos && latest.photos.length > 0
                ? latest.photos.map((p) => ({
                    id: p.id,
                    name: p.file_name,
                    url: p.preview_url || p.file_url || '',
                    size: p.file_size || p.file_size_bytes || 0,
                  }))
                : latest.photo_url
                ? [
                    {
                      id: 'single_photo',
                      name: 'Classroom Photo',
                      url: latest.photo_url,
                      size: latest.photo_size_bytes || undefined,
                    },
                  ]
                : [];

            if (photosList.length > 0) {
              setUploadSession(latest);
              setReceivedPhotos(photosList);
              setCapturedImage(photosList[0].url);
              toast.success(
                photosList.length > 1
                  ? `${photosList.length} Classroom Photos Received!`
                  : 'Classroom Photo Received!',
                'Smartphone upload verified. Ready for face detection and roster matching.'
              );
            }
          } else {
            setUploadSession(latest);
          }
        }
      } catch (err) {
        // Silent background polling errors
      }
    }, 2000);

    return () => clearInterval(pollInterval);
  }, [isOpen, session?.id, currentStep, uploadSession?.status, receivedPhotos.length, toast]);

  // Regenerate QR Code
  const handleRegenerateQr = async () => {
    setIsGeneratingQr(true);
    try {
      const res = await ApiService.createPhotoUploadSession(session.id, 10);
      setUploadSession(res.session);
      setQrDataUrl(res.qr_data_url);
      setUploadUrl(res.upload_url);
      setRemainingSeconds(600);
      setCapturedImage(null);
      setReceivedPhotos([]);
      toast.info('New QR Code Generated', 'Previous upload session has been invalidated.');
    } catch (err: any) {
      toast.error('Regeneration Failed', err.message || 'Could not generate new QR code.');
    } finally {
      setIsGeneratingQr(false);
    }
  };

  // Revoke QR Session
  const handleRevokeQr = async () => {
    setIsRevokingQr(true);
    try {
      const res = await ApiService.revokePhotoUploadSession(session.id);
      if (res) {
        setUploadSession(res);
      }
      toast.info('Session Revoked', 'QR code upload is now deactivated.');
    } catch (err: any) {
      toast.error('Revocation Failed', err.message || 'Could not revoke session.');
    } finally {
      setIsRevokingQr(false);
    }
  };

  // Copy mobile link to clipboard
  const handleCopyLink = () => {
    if (!uploadUrl) return;
    navigator.clipboard.writeText(uploadUrl);
    setCopiedLink(true);
    toast.info('Link Copied', 'Mobile upload URL copied to clipboard.');
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // -------------------------------------------------------------
  // Camera Stream Management (Laptop webcam & device camera)
  // -------------------------------------------------------------
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {}
      });
      streamRef.current = null;
    }
    setStream(null);
    setIsCameraReady(false);
    setIsCameraInitializing(false);
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  const startCamera = useCallback(async (mode?: 'environment' | 'user') => {
    const targetMode = mode || facingMode;
    setCameraError(null);
    setIsCameraReady(false);
    setIsCameraInitializing(true);

    // Stop existing stream first to avoid hardware resource contention
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // 1. Insecure context check on remote deployments
    if (
      typeof window !== 'undefined' &&
      window.isSecureContext === false &&
      window.location.hostname !== 'localhost' &&
      window.location.hostname !== '127.0.0.1'
    ) {
      setCameraError(
        'Camera access requires a secure HTTPS connection or localhost. Please access Sentinel Campus over HTTPS or upload a photo instead.'
      );
      setIsCameraInitializing(false);
      return;
    }

    // 2. Browser API support check
    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError(
        'The camera API (navigator.mediaDevices.getUserMedia) is not supported by your current browser or device. Please upload a classroom photo instead.'
      );
      setIsCameraInitializing(false);
      return;
    }

    try {
      let mediaStream: MediaStream;
      try {
        // Try requested resolution and facing mode
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: targetMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 },
          },
          audio: false,
        });
      } catch (constraintErr: any) {
        console.warn('Overconstrained video constraints fallback:', constraintErr);
        // Fallback to unconstrained video
        mediaStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      }

      // Verify active video track
      const videoTracks = mediaStream.getVideoTracks();
      if (!videoTracks || videoTracks.length === 0 || videoTracks[0].readyState === 'ended') {
        throw new Error('Camera stream does not contain any active video tracks.');
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);

      // Attach stream to video element
      if (videoRef.current) {
        const video = videoRef.current;
        video.srcObject = mediaStream;
        video.muted = true;
        video.playsInline = true;

        video.onloadedmetadata = async () => {
          try {
            await video.play();
            // Verify nonzero dimensions
            if (video.videoWidth > 0 && video.videoHeight > 0) {
              setIsCameraReady(true);
              setIsCameraInitializing(false);
            } else {
              video.oncanplay = () => {
                setIsCameraReady(true);
                setIsCameraInitializing(false);
              };
            }
          } catch (playErr: any) {
            console.warn('Autoplay prevented:', playErr);
            setCameraError(
              'Camera stream is active, but video playback was prevented by your browser. Click anywhere on the video preview to resume, or upload a photo.'
            );
            setIsCameraInitializing(false);
          }
        };
      } else {
        setIsCameraInitializing(false);
      }
    } catch (err: any) {
      console.warn('Camera initialization error:', err);
      let msg = 'Could not access camera. Please check camera permissions or upload a classroom photo.';
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        msg =
          'Camera permission was denied. Please allow camera permissions in your browser address bar (lock/tune icon) or operating system settings, then click Retry Camera.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        msg =
          'No camera hardware detected on this device. Please connect a webcam or upload a classroom photo instead.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        msg =
          'Camera is already in use by another application or browser tab. Please close other camera apps and click Retry Camera.';
      } else if (err.name === 'OverconstrainedError') {
        msg = 'The requested camera resolution is not supported by your camera hardware. Please upload a photo instead.';
      }
      setCameraError(msg);
      setIsCameraInitializing(false);
      setIsCameraReady(false);
    }
  }, [facingMode]);

  // Manage webcam stream on step/source changes
  useEffect(() => {
    if (isOpen && currentStep === 'capture' && captureSource === 'webcam' && !capturedImage) {
      startCamera();
    } else {
      stopCamera();
    }
    return () => {
      stopCamera();
    };
  }, [isOpen, currentStep, captureSource, capturedImage, startCamera, stopCamera]);

  // Attach stream to video element when it mounts
  useEffect(() => {
    if (captureSource === 'webcam' && videoRef.current && streamRef.current && !videoRef.current.srcObject) {
      const video = videoRef.current;
      video.srcObject = streamRef.current;
      video.muted = true;
      video.playsInline = true;
      video.onloadedmetadata = async () => {
        try {
          await video.play();
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            setIsCameraReady(true);
            setIsCameraInitializing(false);
          }
        } catch (e) {
          console.warn('Video mount play error:', e);
        }
      };
    }
  }, [captureSource, stream]);

  const toggleFacingMode = () => {
    const nextMode = facingMode === 'environment' ? 'user' : 'environment';
    setFacingMode(nextMode);
    startCamera(nextMode);
  };

  const handleCaptureSnapshot = () => {
    if (!videoRef.current || isCapturing) return;
    const video = videoRef.current;

    if (video.videoWidth <= 0 || video.videoHeight <= 0) {
      toast.error('Camera Initializing', 'Please wait a moment for the live camera feed to render video frames.');
      return;
    }

    setIsCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Could not create capture canvas context');

      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/jpeg', 0.94);

      if (!dataUrl || dataUrl.length < 200) {
        throw new Error('Captured image is empty or invalid.');
      }

      stopCamera();
      setCapturedImage(dataUrl);
      setReceivedPhotos([{ id: 'webcam_snapshot', name: 'Webcam Capture', url: dataUrl }]);
      setCurrentStep('preview');
    } catch (err: any) {
      console.error('Capture snapshot error:', err);
      toast.error('Capture Failed', err.message || 'Could not capture photo from video feed.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      toast.error('Invalid Image', 'Please select a valid image file (JPEG, PNG, WebP)');
      return;
    }

    if (file.size > 15 * 1024 * 1024) {
      toast.error('File Too Large', 'Image exceeds 15MB limit. Please choose a smaller photo.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      stopCamera();
      const url = event.target?.result as string;
      setCapturedImage(url);
      setReceivedPhotos([{ id: 'laptop_file', name: file.name, url, size: file.size }]);
      setCurrentStep('preview');
    };
    reader.readAsDataURL(file);
  };

  const handleRetake = () => {
    setCapturedImage(null);
    setReceivedPhotos([]);
    setScanSummary(null);
    setCurrentStep('capture');
    handleRegenerateQr();
  };

  // -------------------------------------------------------------
  // Face Detection & Recognition Processing Pipeline (Multi-Photo)
  // -------------------------------------------------------------
  const processClassroomPhoto = async () => {
    const photosToProcess =
      receivedPhotos.length > 0
        ? receivedPhotos
        : capturedImage
        ? [{ id: 'captured_single', name: 'Classroom Photo', url: capturedImage }]
        : [];

    if (photosToProcess.length === 0) return;

    setCurrentStep('processing');
    setBatchProgress({
      current: 0,
      total: photosToProcess.length,
      percent: 0,
      photoName: photosToProcess[0].name,
    });

    try {
      setProcessingPhase('Initializing neural network models...');
      await FaceRecognitionService.loadModels();

      setProcessingPhase(
        `Analyzing classroom photos (${photosToProcess.length} total) for enrolled students...`
      );

      const summary = await FaceRecognitionService.processMultiPhotoClassroomBatch(
        photosToProcess,
        effectiveRoster,
        session.id,
        (prog) => {
          setBatchProgress({
            current: prog.currentPhoto,
            total: prog.totalPhotos,
            percent: prog.percent,
            photoName: prog.photoName,
          });
          setProcessingPhase(
            `Scanning photo ${prog.currentPhoto} of ${prog.totalPhotos}: ${prog.photoName}...`
          );
        }
      );

      if (summary.totalFacesDetected === 0) {
        toast.error('No Faces Found', 'No faces detected in the photos. Please capture clearer or closer shots.');
        setCurrentStep(receivedPhotos.length > 1 ? 'capture' : 'preview');
        return;
      }

      setScanSummary(summary);

      // Pre-select all high-confidence matches by default for instructor convenience
      const initialHighConfIds = new Set<string>();
      summary.highConfidenceMatches.forEach((m) => {
        if (m.matchedStudent) initialHighConfIds.add(m.matchedStudent.id);
      });
      setSelectedHighConfidenceIds(initialHighConfIds);

      // Clear review choices
      setResolvedReviewMap(new Map());
      setManualPresentIds(new Set());

      setCurrentStep('review');
      setActiveTab(
        summary.highConfidenceMatches.length > 0
          ? 'high_confidence'
          : summary.needsReviewMatches.length > 0
          ? 'needs_review'
          : 'not_detected'
      );
    } catch (err: any) {
      console.error('Face processing error:', err);
      toast.error('Face Scan Failed', err.message || 'Failed to process classroom image.');
      setCurrentStep('preview');
    }
  };

  // -------------------------------------------------------------
  // Instructor Review Actions
  // -------------------------------------------------------------
  const toggleHighConfidenceMatch = (studentId: string) => {
    setSelectedHighConfidenceIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  const resolveNeedsReviewMatch = (detectionId: string, chosenStudentId: string) => {
    setResolvedReviewMap((prev) => {
      const next = new Map(prev);
      next.set(detectionId, chosenStudentId);
      return next;
    });
  };

  const toggleManualPresent = (studentId: string) => {
    setManualPresentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) {
        next.delete(studentId);
      } else {
        next.add(studentId);
      }
      return next;
    });
  };

  // -------------------------------------------------------------
  // Attendance Final Confirmation & Submission
  // -------------------------------------------------------------
  const handleConfirmAndSubmit = async () => {
    if (!scanSummary) return;

    setIsSubmitting(true);
    try {
      const submissionsMap = new Map<
        string,
        {
          status: 'present';
          detectionId?: string;
          confidence?: number;
          matchType: 'high_confidence' | 'instructor_confirmed' | 'instructor_manual_override';
        }
      >();

      // 1. High confidence confirmed matches
      scanSummary.highConfidenceMatches.forEach((m) => {
        if (m.matchedStudent && selectedHighConfidenceIds.has(m.matchedStudent.id)) {
          submissionsMap.set(m.matchedStudent.id, {
            status: 'present',
            detectionId: m.detectionId,
            confidence: m.similarity,
            matchType: 'high_confidence',
          });
        }
      });

      // 2. Instructor-resolved review matches
      scanSummary.needsReviewMatches.forEach((m) => {
        const chosenStudentId = resolvedReviewMap.get(m.detectionId);
        if (chosenStudentId && chosenStudentId !== 'unknown') {
          submissionsMap.set(chosenStudentId, {
            status: 'present',
            detectionId: m.detectionId,
            confidence: m.similarity,
            matchType: 'instructor_confirmed',
          });
        }
      });

      // 3. Manually confirmed not-detected students
      manualPresentIds.forEach((studentId) => {
        if (!submissionsMap.has(studentId)) {
          submissionsMap.set(studentId, {
            status: 'present',
            matchType: 'instructor_manual_override',
          });
        }
      });

      const submissionItems = Array.from(submissionsMap.entries()).map(([studentId, meta]) => ({
        studentId,
        status: meta.status,
        detectionId: meta.detectionId,
        confidenceScore: meta.confidence,
        matchType: meta.matchType,
      }));

      if (submissionItems.length === 0) {
        toast.error('No Selection', 'No students selected for attendance confirmation.');
        setIsSubmitting(false);
        return;
      }

      const res = await ApiService.submitFaceAttendance(session.id, submissionItems);

      toast.success(
        'Face Attendance Recorded',
        `${res.markedPresentCount} marked present${
          res.alreadyPresentCount > 0 ? ` (${res.alreadyPresentCount} already present)` : ''
        }.`
      );

      // Clean up memory
      setCapturedImage(null);
      setScanSummary(null);
      stopCamera();

      onAttendanceSubmitted();
      onClose();
    } catch (err: any) {
      console.error('Error submitting face attendance:', err);
      toast.error('Submission Failed', err.message || 'Failed to submit face attendance.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-fadeIn">
      <div className="bg-white rounded-3xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                Classroom Photo Attendance
                <span className="text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full bg-brand-500/30 text-brand-300 border border-brand-500/40">
                  QR Capture Mode
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                {session.title} &bull; {session.class_name || session.class_code || 'CS201'} &bull;{' '}
                <span className="font-semibold text-white">{effectiveRoster.length} enrolled students</span>
              </p>
            </div>
          </div>

          <button
            onClick={() => {
              stopCamera();
              onClose();
            }}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Step 1 & 2: QR Capture View / Upload & Preview */}
        {(currentStep === 'capture' || currentStep === 'preview') && (
          <div className="p-6 flex-1 overflow-y-auto space-y-6">
            {/* Enrollment Status Notice & Diagnostics */}
            {rosterLoading ? (
              <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3 text-xs text-slate-600">
                <Loader2 className="w-5 h-5 text-brand-600 animate-spin shrink-0" />
                <span>Querying enrolled class roster from database...</span>
              </div>
            ) : rosterState === 'unauthorized' ? (
              <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 flex items-start gap-3.5 text-xs text-rose-950 shadow-sm">
                <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <p className="font-bold text-rose-900 text-sm">
                    Roster Request Unauthorized (RLS / Auth Policy)
                  </p>
                  <p className="text-rose-800 leading-relaxed">
                    PostgreSQL Row Level Security prevented reading student enrollments for this class. Please ensure your instructor account owns this class.
                  </p>
                  {rosterErrorMessage && (
                    <p className="text-[11px] font-mono bg-rose-100 p-2 rounded-lg text-rose-900">
                      {rosterErrorMessage}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={loadClassRoster}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Retry Query
                  </button>
                </div>
              </div>
            ) : rosterState === 'db_error' ? (
              <div className="p-4 rounded-2xl bg-rose-50 border-2 border-rose-300 flex items-start gap-3.5 text-xs text-rose-950 shadow-sm">
                <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                <div className="space-y-1.5 flex-1">
                  <p className="font-bold text-rose-900 text-sm">
                    Database Query Failed
                  </p>
                  <p className="text-rose-800 leading-relaxed">
                    Could not retrieve class enrollments due to an unexpected database error:
                  </p>
                  {rosterErrorMessage && (
                    <p className="text-[11px] font-mono bg-rose-100 p-2 rounded-lg text-rose-900">
                      {rosterErrorMessage}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={loadClassRoster}
                    className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs transition cursor-pointer"
                  >
                    Retry Query
                  </button>
                </div>
              </div>
            ) : rosterState === 'no_cohort' ? (
              <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 flex items-start gap-3.5 text-xs text-amber-950 shadow-sm">
                <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-3 flex-1">
                  <div>
                    <p className="font-bold text-amber-900 text-sm">
                      Academic Section Cohort Not Assigned
                    </p>
                    <p className="text-amber-800 leading-relaxed mt-0.5">
                      Subject offering <strong>{session.class_name || session.class_code || 'selected class'}</strong> has not yet been linked to an institutional academic section. Sentinel Campus rosters are automatically populated from academic sections.
                    </p>
                  </div>

                  {availableSections.length > 0 ? (
                    <div className="p-3 bg-white/90 border border-amber-300 rounded-xl space-y-2">
                      <p className="font-semibold text-amber-900">
                        Select an institutional section to automatically link and derive the student roster:
                      </p>
                      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                        <select
                          value={selectedSectionToAssign}
                          onChange={(e) => setSelectedSectionToAssign(e.target.value)}
                          className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-amber-500/20 flex-1"
                        >
                          {availableSections.map((sec) => (
                            <option key={sec.id} value={sec.id}>
                              {sec.programme} — Section {sec.section} ({sec.batch}, {sec.student_count || 0} students)
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => handleAssignClassSection(selectedSectionToAssign || availableSections[0]?.id)}
                          disabled={isAssigningSection}
                          className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white font-bold text-xs rounded-lg transition shadow-xs cursor-pointer shrink-0 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          {isAssigningSection ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                          )}
                          Assign Cohort &amp; Load Roster
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-amber-700 italic">
                      No institutional sections found. Please create an academic section in Classes &amp; Courses.
                    </p>
                  )}
                </div>
              </div>
            ) : effectiveRoster.length === 0 ? (
              <div className="p-4 rounded-2xl bg-amber-50/90 border border-amber-300 flex items-start gap-3.5 text-xs text-amber-950 shadow-sm">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1 flex-1">
                  <p className="font-bold text-amber-900 text-sm">
                    Class Has No Students Assigned (0 Enrolled Students)
                  </p>
                  <p className="text-amber-800 leading-relaxed">
                    This lecture is associated with <strong>{session.class_name || session.class_code || 'selected class'}</strong> ({classObj?.programme || 'Cohort'} — Section {classObj?.section || 'A'}), which currently has 0 registered active students in this section cohort.
                  </p>
                </div>
              </div>
            ) : (
              /* Compact Status Indicator (Requirement 5) */
              <div
                className={`p-3.5 rounded-2xl border flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs shadow-xs ${
                  enrolledWithFaces.length === effectiveRoster.length
                    ? 'bg-emerald-50/70 border-emerald-300 text-emerald-950'
                    : enrolledWithFaces.length > 0
                    ? 'bg-amber-50/70 border-amber-300 text-amber-950'
                    : 'bg-rose-50/70 border-rose-300 text-rose-950'
                }`}
              >
                <div className="flex items-center gap-3">
                  {enrolledWithFaces.length === effectiveRoster.length ? (
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  ) : enrolledWithFaces.length > 0 ? (
                    <AlertCircle className="w-5 h-5 text-amber-600 shrink-0" />
                  ) : (
                    <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0" />
                  )}
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">
                        {effectiveRoster.length} {effectiveRoster.length === 1 ? 'student' : 'students'} enrolled &middot; {enrolledWithFaces.length} face {enrolledWithFaces.length === 1 ? 'reference' : 'references'} ready
                      </span>
                      {enrolledWithFaces.length === effectiveRoster.length ? (
                        <span className="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[11px] font-semibold border border-emerald-300">
                          Ready for automated recognition
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[11px] font-semibold border border-amber-300">
                          {effectiveRoster.length - enrolledWithFaces.length} Face Enrollment Required
                        </span>
                      )}
                    </div>
                    <p className="text-slate-600 mt-0.5">
                      Section {classObj?.section || (session as any).class_section || 'A'} ({classObj?.programme || 'Cohort'}) roster automatically active for biometric face matching.
                      {enrolledNeedingBiometrics.length > 0 && (
                        <span className="text-amber-800 font-medium ml-1">
                          ({enrolledNeedingBiometrics.length} with photos awaiting 128-d descriptor extraction)
                        </span>
                      )}
                    </p>
                  </div>
                </div>

                {enrolledNeedingBiometrics.length > 0 && (
                  <button
                    type="button"
                    onClick={handleExtractMissingBiometrics}
                    disabled={isExtractingBiometrics}
                    className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-xl transition shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0 self-start sm:self-auto"
                  >
                    {isExtractingBiometrics ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5 text-amber-200" />
                    )}
                    Extract Biometrics ({enrolledNeedingBiometrics.length})
                  </button>
                )}
              </div>
            )}

            {currentStep === 'capture' ? (
              captureSource === 'qr' ? (
                /* QR-First Interface */
                <div className="space-y-6">
                  {/* QR Method Selector: Sentinel Campus Mobile App Live Scan vs Batch Photo Upload */}
                  <div className="flex flex-col sm:flex-row items-center gap-2 p-1.5 bg-slate-100 rounded-2xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => setQrMode('mobile_app')}
                      className={`w-full sm:flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        qrMode === 'mobile_app'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <Smartphone className="w-4 h-4 text-brand-600" />
                      <span>Live Mobile App Capture (Student-by-Student)</span>
                      <span className="px-1.5 py-0.5 rounded bg-brand-50 text-brand-700 text-[10px] font-semibold border border-brand-200">
                        Integrated
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setQrMode('photo_upload')}
                      className={`w-full sm:flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition cursor-pointer ${
                        qrMode === 'photo_upload'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      <ImageIcon className="w-4 h-4 text-slate-600" />
                      <span>Classroom Photo Upload (Multi-Photo Batch)</span>
                    </button>
                  </div>

                  {qrMode === 'mobile_app' ? (
                    /* Live Student-by-Student Mobile Capture Interface */
                    <div className="space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
                        {/* Left: Prominent QR Code for ClassQRScannerModal */}
                        <div className="md:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-900 rounded-3xl text-white shadow-md border border-slate-800">
                          <div className="mb-3 text-center">
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-medium">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                              Live Classroom Capture QR
                            </span>
                          </div>

                          {/* QR Code Container */}
                          <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-200">
                            {isGeneratingSharedMobileQr ? (
                              <div className="w-52 h-52 flex flex-col items-center justify-center text-slate-400">
                                <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-2" />
                                <span className="text-xs">Generating Session QR...</span>
                              </div>
                            ) : sharedMobileQrDataUrl ? (
                              <img
                                src={sharedMobileQrDataUrl}
                                alt="Scan with Sentinel Campus Mobile App"
                                className="w-52 h-52 object-contain rounded-lg"
                              />
                            ) : (
                              <div className="w-52 h-52 flex items-center justify-center text-slate-400 text-xs">
                                No QR Available
                              </div>
                            )}
                          </div>

                          {/* Token Pill with Copy */}
                          <div className="mt-4 w-full p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/80 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <QrCode className="w-4 h-4 text-brand-400" />
                              <span className="text-[11px] text-slate-400 font-medium">Token:</span>
                              <code className="text-xs font-mono font-bold text-white tracking-widest">
                                {sharedMobileSession?.token || '........'}
                              </code>
                            </div>
                            <button
                              type="button"
                              onClick={handleCopyToken}
                              className="px-2.5 py-1 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] font-bold text-slate-200 transition cursor-pointer flex items-center gap-1"
                            >
                              {copiedToken ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                              {copiedToken ? 'Copied' : 'Copy'}
                            </button>
                          </div>

                          {/* Expiration countdown & Regenerate */}
                          <div className="mt-3 flex items-center justify-between w-full text-xs text-slate-400 px-1">
                            <span className="flex items-center gap-1 text-[11px]">
                              <Clock className="w-3.5 h-3.5 text-brand-400" />
                              10-min window
                            </span>
                            <button
                              type="button"
                              onClick={initOrFetchSharedMobileSession}
                              disabled={isGeneratingSharedMobileQr}
                              className="text-[11px] font-semibold text-brand-400 hover:text-brand-300 flex items-center gap-1 cursor-pointer"
                            >
                              <RefreshCw className={`w-3 h-3 ${isGeneratingSharedMobileQr ? 'animate-spin' : ''}`} />
                              Regenerate
                            </button>
                          </div>
                        </div>

                        {/* Right: Real-time Stats & Capture Stream */}
                        <div className="md:col-span-7 space-y-4">
                          {/* Header & Instructions */}
                          <div className="space-y-1">
                            <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                              <Smartphone className="w-5 h-5 text-brand-600" />
                              Live Mobile Attendance Stream
                            </h4>
                            <p className="text-xs text-slate-600 leading-relaxed">
                              Open the <strong>Sentinel Campus</strong> mobile app, tap <strong>Scan Class Session QR</strong>, and scan students one-by-one at the doorway or podium.
                            </p>
                          </div>

                          {/* Live Counter Badges Grid */}
                          <div className="grid grid-cols-4 gap-2.5">
                            <div className="p-3 rounded-2xl bg-slate-50 border border-slate-200 text-center">
                              <span className="text-[11px] font-medium text-slate-500 block">Roster</span>
                              <span className="text-lg font-black text-slate-900">
                                {sharedMobileStatus?.stats.totalStudents ?? effectiveRoster.length}
                              </span>
                            </div>

                            <div className="p-3 rounded-2xl bg-emerald-50 border border-emerald-200 text-center">
                              <span className="text-[11px] font-medium text-emerald-700 block">Present</span>
                              <span className="text-lg font-black text-emerald-700">
                                {sharedMobileStatus?.stats.identifiedCount ?? 0}
                              </span>
                            </div>

                            <div className="p-3 rounded-2xl bg-amber-50 border border-amber-200 text-center">
                              <span className="text-[11px] font-medium text-amber-700 block">Review</span>
                              <span className="text-lg font-black text-amber-700">
                                {sharedMobileStatus?.stats.pendingCount ?? 0}
                              </span>
                            </div>

                            <div className="p-3 rounded-2xl bg-rose-50 border border-rose-200 text-center">
                              <span className="text-[11px] font-medium text-rose-700 block">Unmatched</span>
                              <span className="text-lg font-black text-rose-700">
                                {sharedMobileStatus?.stats.rejectedCount ?? 0}
                              </span>
                            </div>
                          </div>

                          {/* Real-Time Captures Feed */}
                          <div className="p-4 rounded-2xl bg-slate-900 text-white border border-slate-800 space-y-3">
                            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                              <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                                Live Captures Feed
                              </span>
                              <span className="text-[11px] text-slate-400">
                                {sharedMobileStatus?.recentCaptures.length || 0} event(s) recorded
                              </span>
                            </div>

                            {sharedMobileStatus?.recentCaptures && sharedMobileStatus.recentCaptures.length > 0 ? (
                              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                                {sharedMobileStatus.recentCaptures.map((capture, idx) => (
                                  <div
                                    key={capture.id || idx}
                                    className="flex items-center justify-between p-2.5 rounded-xl bg-slate-800/80 border border-slate-700/60"
                                  >
                                    <div className="flex items-center gap-2.5">
                                      {capture.thumbnailUrl ? (
                                        <img
                                          src={capture.thumbnailUrl}
                                          alt="Captured frame"
                                          className="w-8 h-8 rounded-lg object-cover border border-slate-600"
                                        />
                                      ) : (
                                        <div className="w-8 h-8 rounded-lg bg-slate-700 flex items-center justify-center text-xs font-bold text-slate-300">
                                          {capture.studentName.charAt(0)}
                                        </div>
                                      )}
                                      <div>
                                        <p className="text-xs font-bold text-white leading-tight">{capture.studentName}</p>
                                        <p className="text-[10px] text-slate-400 font-mono">{capture.identifierCode}</p>
                                      </div>
                                    </div>

                                    <div className="text-right">
                                      {capture.status === 'confirmed' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 text-[10px] font-bold border border-emerald-500/30">
                                          <CheckCircle2 className="w-3 h-3" />
                                          Verified
                                        </span>
                                      ) : capture.status === 'duplicate' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-300 text-[10px] font-bold border border-blue-500/30">
                                          Already Present
                                        </span>
                                      ) : capture.status === 'ambiguous' ? (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 text-[10px] font-bold border border-amber-500/30">
                                          <AlertTriangle className="w-3 h-3" />
                                          Ambiguous
                                        </span>
                                      ) : (
                                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 text-[10px] font-bold border border-rose-500/30">
                                          <UserX className="w-3 h-3" />
                                          Unrecognized
                                        </span>
                                      )}
                                      <span className="text-[9px] text-slate-400 block mt-0.5">
                                        {new Date(capture.capturedAt).toLocaleTimeString()}
                                      </span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="py-8 text-center text-slate-400 space-y-1">
                                <Camera className="w-6 h-6 mx-auto text-slate-500 mb-1" />
                                <p className="text-xs font-medium text-slate-300">Ready for Live Student Captures</p>
                                <p className="text-[11px] text-slate-500 max-w-sm mx-auto">
                                  Once the teacher or TA scans the QR code with the mobile app and captures students, real-time verification events will stream here automatically.
                                </p>
                              </div>
                            )}
                          </div>

                          {/* Action Controls */}
                          <div className="flex items-center justify-end gap-3 pt-2">
                            <button
                              type="button"
                              onClick={handleFinalizeMobileSession}
                              disabled={isFinalizingMobileSession}
                              className="px-5 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold flex items-center gap-2 shadow-md transition cursor-pointer disabled:opacity-50"
                            >
                              {isFinalizingMobileSession ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-4 h-4" />
                              )}
                              Complete & Sync Attendance
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* Photo Received Card vs QR Waiting Card (Multi-Photo Upload) */
                    (uploadSession?.status === 'photo_received' && (receivedPhotos.length > 0 || capturedImage)) ? (
                      /* Photo(s) Received State */
                      <div className="bg-slate-50 border-2 border-emerald-500/30 rounded-3xl p-6 text-center space-y-5 shadow-sm">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 text-xs font-semibold">
                        <CheckCircle className="w-4 h-4 text-emerald-600" />
                        {receivedPhotos.length > 1
                          ? `${receivedPhotos.length} Classroom Photos Received from Phone`
                          : 'Classroom Photo Received from Phone'}
                      </div>

                      {receivedPhotos.length > 1 ? (
                        /* Multi-Photo Grid */
                        <div className="max-w-2xl mx-auto space-y-2">
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto p-1">
                            {receivedPhotos.map((p, idx) => (
                              <div
                                key={p.id || idx}
                                className="relative aspect-video rounded-xl overflow-hidden border border-slate-300 shadow-sm bg-black group"
                              >
                                <img src={p.url} alt={p.name} className="w-full h-full object-cover" />
                                <div className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-black/75 text-[10px] font-mono text-white font-semibold">
                                  #{idx + 1}
                                </div>
                                <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/90 to-transparent p-1.5 text-left">
                                  <p className="text-[10px] text-white font-medium truncate">{p.name}</p>
                                  {p.size && (
                                    <p className="text-[9px] text-slate-300">
                                      {(p.size / (1024 * 1024)).toFixed(1)} MB
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          <p className="text-xs text-slate-500 text-center">
                            Face recognition will scan all {receivedPhotos.length} photos and combine matches into a unified attendance roster.
                          </p>
                        </div>
                      ) : (
                        /* Single Photo Thumbnail */
                        <div className="relative max-w-lg mx-auto aspect-video rounded-2xl overflow-hidden border border-slate-300 shadow-md bg-black">
                          <img
                            src={capturedImage || (receivedPhotos[0] ? receivedPhotos[0].url : '')}
                            alt="Received classroom"
                            className="w-full h-full object-contain"
                          />
                          <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-slate-950/80 to-transparent p-3 text-left">
                            <p className="text-xs text-white font-medium flex items-center gap-1.5">
                              <Smartphone className="w-3.5 h-3.5 text-emerald-400" />
                              {uploadSession?.photo_device_info || 'Mobile Device'}
                            </p>
                            <p className="text-[11px] text-slate-300">
                              {uploadSession?.photo_size_bytes
                                ? `${(uploadSession.photo_size_bytes / (1024 * 1024)).toFixed(2)} MB • `
                                : ''}
                              Uploaded at {uploadSession?.photo_uploaded_at ? new Date(uploadSession.photo_uploaded_at).toLocaleTimeString() : 'Just now'}
                            </p>
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
                        <button
                          type="button"
                          onClick={handleRegenerateQr}
                          disabled={isGeneratingQr}
                          className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                        >
                          <RefreshCw className={`w-4 h-4 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                          Retake / New QR Code
                        </button>

                        <button
                          type="button"
                          onClick={processClassroomPhoto}
                          disabled={effectiveRoster.length === 0}
                          className={`w-full sm:w-auto px-6 py-2.5 rounded-xl text-white text-xs font-bold flex items-center justify-center gap-2 shadow-md transition ${
                            effectiveRoster.length === 0
                              ? 'bg-slate-400 cursor-not-allowed opacity-60'
                              : 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 hover:scale-[1.02] cursor-pointer'
                          }`}
                        >
                          <Sparkles className="w-4 h-4" />
                          {effectiveRoster.length === 0
                            ? 'Cannot Match Faces (Roster Empty)'
                            : receivedPhotos.length > 1
                            ? `Proceed to Face Recognition (${receivedPhotos.length} Photos)`
                            : 'Proceed to Face Recognition'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    /* Awaiting QR Scan State */
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
                      {/* Left: Prominent QR Code */}
                      <div className="md:col-span-5 flex flex-col items-center justify-center p-6 bg-slate-900 rounded-3xl text-white shadow-md border border-slate-800">
                        {/* Status Badge */}
                        <div className="mb-4">
                          {uploadSession?.status === 'uploading' ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30 text-xs font-medium animate-pulse">
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              Receiving Photo from Phone...
                            </span>
                          ) : uploadSession?.status === 'revoked' ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-700 text-slate-300 text-xs font-medium">
                              <XCircle className="w-3.5 h-3.5" />
                              Session Revoked
                            </span>
                          ) : remainingSeconds <= 0 ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30 text-xs font-medium">
                              <Clock className="w-3.5 h-3.5" />
                              QR Code Expired
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-medium">
                              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                              Awaiting Phone Scan
                            </span>
                          )}
                        </div>

                        {/* QR Code Container */}
                        <div className="bg-white p-4 rounded-2xl shadow-inner border border-slate-200">
                          {isGeneratingQr ? (
                            <div className="w-52 h-52 flex flex-col items-center justify-center text-slate-400">
                              <Loader2 className="w-8 h-8 animate-spin text-brand-600 mb-2" />
                              <span className="text-xs">Generating QR...</span>
                            </div>
                          ) : qrDataUrl ? (
                            <img
                              src={qrDataUrl}
                              alt="Scan with phone"
                              className="w-52 h-52 object-contain rounded-lg"
                            />
                          ) : (
                            <div className="w-52 h-52 flex items-center justify-center text-slate-400 text-xs">
                              No QR Available
                            </div>
                          )}
                        </div>

                        {/* Expiration Timer */}
                        <div className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                          <Clock className="w-3.5 h-3.5 text-brand-400" />
                          <span>
                            Expires in:{' '}
                            <strong className="text-white font-mono">
                              {formatSeconds(remainingSeconds)}
                            </strong>
                          </span>
                        </div>
                      </div>

                      {/* Right: Instructions & Controls */}
                      <div className="md:col-span-7 space-y-4">
                        <div className="space-y-2">
                          <h4 className="text-base font-bold text-slate-900 flex items-center gap-2">
                            <Smartphone className="w-5 h-5 text-brand-600" />
                            Scan QR Code with Phone
                          </h4>
                          <p className="text-xs text-slate-600 leading-relaxed">
                            No laptop webcam required. Use your smartphone's high-resolution camera to photograph the classroom.
                          </p>
                        </div>

                        {/* Step-by-step checklist */}
                        <div className="space-y-2.5 p-4 rounded-2xl bg-slate-50 border border-slate-200 text-xs text-slate-700">
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center shrink-0 text-[11px]">
                              1
                            </span>
                            <span>Open your phone's default camera app or QR scanner.</span>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center shrink-0 text-[11px]">
                              2
                            </span>
                            <span>Point the camera at this QR code and tap the link to open the upload page.</span>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center shrink-0 text-[11px]">
                              3
                            </span>
                            <span>Take a clear, wide shot of the classroom and tap <strong>Submit</strong>.</span>
                          </div>
                          <div className="flex items-start gap-2.5">
                            <span className="w-5 h-5 rounded-full bg-brand-100 text-brand-700 font-bold flex items-center justify-center shrink-0 text-[11px]">
                              4
                            </span>
                            <span>This screen will automatically update with the received photo.</span>
                          </div>
                        </div>

                        {/* QR Actions */}
                        <div className="flex flex-wrap items-center gap-2.5 pt-1">
                          <button
                            type="button"
                            onClick={handleRegenerateQr}
                            disabled={isGeneratingQr}
                            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                          >
                            <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingQr ? 'animate-spin' : ''}`} />
                            Regenerate QR
                          </button>

                          <button
                            type="button"
                            onClick={handleCopyLink}
                            className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                          >
                            {copiedLink ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-600" />
                                <span className="text-emerald-700">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                Copy Link
                              </>
                            )}
                          </button>

                          {(uploadSession?.status === 'awaiting_scan' || uploadSession?.status === 'uploading') && (
                            <button
                              type="button"
                              onClick={handleRevokeQr}
                              disabled={isRevokingQr}
                              className="px-3 py-2 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-700 text-xs font-semibold flex items-center gap-1.5 transition cursor-pointer"
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Revoke
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Fallback Section: Upload from computer or try webcam */}
                  <div className="p-4 rounded-2xl border border-slate-200 bg-slate-50/50 flex flex-col sm:flex-row items-center justify-between gap-3">
                    <span className="text-xs text-slate-600">
                      Already have the photo saved on your computer?
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition cursor-pointer"
                      >
                        <Upload className="w-3.5 h-3.5 text-brand-600" />
                        Upload File from Laptop
                      </button>

                      <button
                        type="button"
                        onClick={() => setCaptureSource('webcam')}
                        className="px-3 py-1.5 rounded-xl text-slate-500 hover:text-slate-800 text-xs font-medium transition cursor-pointer"
                      >
                        Use Laptop Webcam
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                /* Optional Webcam Viewfinder fallback */
                <div className="space-y-4">
                  <div className="relative aspect-video sm:aspect-[16/9] bg-slate-950 rounded-2xl overflow-hidden border border-slate-800 shadow-inner flex items-center justify-center">
                    {cameraError ? (
                      <div className="p-6 text-center space-y-3 max-w-md">
                        <Camera className="w-10 h-10 text-slate-600 mx-auto" />
                        <p className="text-xs text-slate-300 font-medium">{cameraError}</p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          <button
                            type="button"
                            onClick={() => startCamera()}
                            className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-xl transition cursor-pointer"
                          >
                            Retry Camera
                          </button>
                          <button
                            type="button"
                            onClick={() => setCaptureSource('qr')}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                          >
                            Phone QR Code
                          </button>
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition cursor-pointer"
                          >
                            Upload File
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <video
                          ref={videoRef}
                          autoPlay
                          playsInline
                          muted
                          className="w-full h-full object-cover"
                        />

                        {isCameraInitializing && (
                          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center space-y-3 z-10">
                            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
                            <p className="text-xs text-slate-300 font-medium">Initializing camera stream...</p>
                          </div>
                        )}

                        {/* Viewfinder Target Overlay */}
                        <div className="absolute inset-4 sm:inset-8 border border-white/20 rounded-2xl pointer-events-none flex flex-col justify-between p-4">
                          <div className="flex justify-between items-start">
                            <div className="w-6 h-6 border-t-2 border-l-2 border-brand-400" />
                            <div className="w-6 h-6 border-t-2 border-r-2 border-brand-400" />
                          </div>
                          <div className="text-center">
                            <span className="inline-block px-3 py-1 rounded-full bg-slate-900/70 backdrop-blur-sm text-[11px] text-white border border-white/10 font-medium">
                              {isCameraReady ? 'Point webcam at classroom students' : 'Connecting to camera...'}
                            </span>
                          </div>
                          <div className="flex justify-between items-end">
                            <div className="w-6 h-6 border-b-2 border-l-2 border-brand-400" />
                            <div className="w-6 h-6 border-b-2 border-r-2 border-brand-400" />
                          </div>
                        </div>

                        {/* Camera Controls Overlay */}
                        <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between">
                          <button
                            type="button"
                            onClick={toggleFacingMode}
                            disabled={isCameraInitializing}
                            className="p-3 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-md border border-white/20 transition cursor-pointer disabled:opacity-50"
                            title="Switch camera"
                          >
                            <FlipHorizontal className="w-5 h-5" />
                          </button>

                          <button
                            type="button"
                            onClick={handleCaptureSnapshot}
                            disabled={!isCameraReady || isCapturing}
                            className={`px-6 py-3.5 rounded-full font-bold text-sm shadow-xl flex items-center gap-2 transition ${
                              isCameraReady && !isCapturing
                                ? 'bg-brand-600 hover:bg-brand-500 text-white hover:scale-105 active:scale-95 cursor-pointer'
                                : 'bg-slate-700 text-slate-400 cursor-not-allowed opacity-70'
                            }`}
                          >
                            {isCapturing ? (
                              <>
                                <Loader2 className="w-5 h-5 animate-spin" />
                                Capturing...
                              </>
                            ) : (
                              <>
                                <Camera className="w-5 h-5" />
                                Capture Photo
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() => setCaptureSource('qr')}
                            className="p-3 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-md border border-white/20 transition cursor-pointer"
                            title="Return to Phone QR Code"
                          >
                            <QrCode className="w-5 h-5" />
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setCaptureSource('qr')}
                      className="text-xs font-semibold text-brand-600 hover:text-brand-700 flex items-center gap-1.5 cursor-pointer"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" />
                      Back to Phone QR Code
                    </button>
                  </div>
                </div>
              )
            ) : (
              /* Preview Captured / Uploaded Image */
              <div className="space-y-4">
                <div className="relative aspect-video sm:aspect-[16/9] bg-slate-950 rounded-2xl overflow-hidden border border-slate-200 shadow-md">
                  <img
                    src={capturedImage!}
                    alt="Classroom preview"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-4 left-4">
                    <span className="px-3 py-1 rounded-full bg-slate-900/80 backdrop-blur-sm text-[11px] font-semibold text-white border border-white/10">
                      Classroom Photo Preview
                    </span>
                  </div>
                </div>

                {effectiveRoster.length === 0 && (
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-xs flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600" />
                    <span>
                      <strong>No students enrolled:</strong> Cannot match classroom faces because 0 students are enrolled in this class. Please enroll students before scanning attendance.
                    </span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleRetake}
                    className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                    Retake / Choose Another
                  </button>

                  <button
                    type="button"
                    onClick={processClassroomPhoto}
                    disabled={effectiveRoster.length === 0}
                    className={`w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition ${
                      effectiveRoster.length === 0
                        ? 'bg-slate-200 text-slate-400 border border-slate-300 cursor-not-allowed opacity-75'
                        : 'bg-brand-600 hover:bg-brand-700 text-white hover:scale-[1.02] active:scale-[0.98] cursor-pointer'
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                    Process Faces &amp; Match Roster
                  </button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={handleFileUpload}
            />
          </div>
        )}

        {/* Step 3: Neural Processing State */}
        {currentStep === 'processing' && (
          <div className="p-12 flex-1 flex flex-col items-center justify-center space-y-4 text-center">
            <div className="relative">
              <div className="w-16 h-16 rounded-full bg-brand-50 border-2 border-brand-200 flex items-center justify-center text-brand-600">
                <Loader2 className="w-8 h-8 animate-spin" />
              </div>
              <Sparkles className="w-5 h-5 text-amber-500 absolute -top-1 -right-1 animate-pulse" />
            </div>

            <div className="space-y-1 max-w-sm">
              <h4 className="text-sm font-bold text-slate-800">
                {batchProgress && batchProgress.total > 1
                  ? `Processing Photos (${batchProgress.current}/${batchProgress.total})`
                  : 'Processing Classroom Photo'}
              </h4>
              <p className="text-xs text-slate-500 font-medium">{processingPhase}</p>
            </div>

            {batchProgress && batchProgress.total > 1 && (
              <div className="w-full max-w-xs space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                  <span>Batch Progress</span>
                  <span>{batchProgress.percent}%</span>
                </div>
                <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden border border-slate-200">
                  <div
                    className="h-full bg-brand-600 transition-all duration-300"
                    style={{ width: `${batchProgress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <p className="text-[11px] text-slate-400 max-w-xs">
              Running SSD MobileNet face detection and ResNet-34 128-d Euclidean roster matching...
            </p>
          </div>
        )}

        {/* Step 4: Results & Review Screen (3 Categories) */}
        {currentStep === 'review' && scanSummary && (
          <div className="flex-1 flex flex-col min-h-0">
            {/* Summary Bar */}
            <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 shrink-0 text-xs">
              <div className="flex items-center gap-2 font-medium text-slate-700">
                <Users className="w-4 h-4 text-brand-600" />
                <span>
                  Detected <strong className="text-slate-900">{scanSummary.totalFacesDetected}</strong> visible
                  faces {receivedPhotos.length > 1 ? `across ${receivedPhotos.length} classroom photos` : 'in classroom photo'}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleRetake}
                  className="px-3 py-1 rounded-lg border border-slate-200 hover:bg-white text-slate-600 text-xs flex items-center gap-1.5 transition cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  New Photo
                </button>
              </div>
            </div>

            {/* Tab Navigation */}
            {(() => {
              const notDetectedWithFaces = (scanSummary.notDetectedEnrolledStudents || []).filter(
                (s) => s.face_descriptor && Array.isArray(s.face_descriptor) && s.face_descriptor.length === 128
              );
              const faceEnrollmentRequiredStudents = (scanSummary.notDetectedEnrolledStudents || []).filter(
                (s) => !s.face_descriptor || !Array.isArray(s.face_descriptor) || s.face_descriptor.length !== 128
              );

              return (
                <>
                  <div className="px-6 pt-3 bg-white border-b border-slate-200 shrink-0">
                    <div className="flex space-x-2 overflow-x-auto pb-1">
                      <button
                        type="button"
                        onClick={() => setActiveTab('high_confidence')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          activeTab === 'high_confidence'
                            ? 'border-emerald-600 text-emerald-700'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Matched ({scanSummary.highConfidenceMatches.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('needs_review')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          activeTab === 'needs_review'
                            ? 'border-amber-600 text-amber-700'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-amber-600" />
                        Needs Review ({scanSummary.needsReviewMatches.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('not_detected')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          activeTab === 'not_detected'
                            ? 'border-slate-800 text-slate-800'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <UserX className="w-3.5 h-3.5 text-slate-500" />
                        Not Detected ({notDetectedWithFaces.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('face_required')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          activeTab === 'face_required'
                            ? 'border-orange-600 text-orange-700'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <AlertTriangle className="w-3.5 h-3.5 text-orange-600" />
                        Face Enrollment Required ({faceEnrollmentRequiredStudents.length})
                      </button>

                      <button
                        type="button"
                        onClick={() => setActiveTab('unknown_faces')}
                        className={`pb-3 px-3 text-xs font-bold border-b-2 transition flex items-center gap-1.5 cursor-pointer whitespace-nowrap ${
                          activeTab === 'unknown_faces'
                            ? 'border-slate-600 text-slate-700'
                            : 'border-transparent text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <HelpCircle className="w-3.5 h-3.5 text-slate-400" />
                        Unknown Face ({scanSummary.unknownFaces.length})
                      </button>
                    </div>
                  </div>

                  {/* Tab Content */}
                  <div className="p-6 flex-1 overflow-y-auto space-y-4">
                    {/* TAB 1: Matched (High Confidence) */}
                    {activeTab === 'high_confidence' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <p>
                            Confidently matched registered students (Euclidean distance &le; 0.45):
                          </p>
                          <span className="font-semibold text-slate-700">
                            {selectedHighConfidenceIds.size} of {scanSummary.highConfidenceMatches.length} selected for Present
                          </span>
                        </div>

                        {scanSummary.highConfidenceMatches.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                            No high-confidence matches found. Check the "Needs Review" tab for ambiguous candidates.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {scanSummary.highConfidenceMatches.map((match) => {
                              const student = match.matchedStudent!;
                              const isSelected = selectedHighConfidenceIds.has(student.id);

                              return (
                                <div
                                  key={match.detectionId}
                                  onClick={() => toggleHighConfidenceMatch(student.id)}
                                  className={`p-3.5 rounded-2xl border transition cursor-pointer flex items-center gap-3.5 ${
                                    isSelected
                                      ? 'bg-emerald-50/60 border-emerald-300 ring-1 ring-emerald-400'
                                      : 'bg-white border-slate-200 opacity-60 hover:opacity-100'
                                  }`}
                                >
                                  {/* Comparison: Detected Face Crop vs Registered Photo */}
                                  <div className="relative shrink-0 flex items-center -space-x-2">
                                    {match.cropUrl ? (
                                      <img
                                        src={match.cropUrl}
                                        alt="Detected face crop"
                                        className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm"
                                        title="Detected Face in Classroom Photo"
                                      />
                                    ) : (
                                      <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-slate-500">
                                        <ImageIcon className="w-5 h-5" />
                                      </div>
                                    )}

                                    {student.photo_url || student.photo_path ? (
                                      <img
                                        src={student.photo_url || student.photo_path}
                                        alt={student.full_name}
                                        className="w-12 h-12 rounded-full object-cover border-2 border-white shadow-sm"
                                        title="Enrolled Student Reference Photo"
                                      />
                                    ) : (
                                      <div className="w-12 h-12 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center font-bold text-xs border-2 border-white">
                                        {student.full_name.charAt(0)}
                                      </div>
                                    )}
                                  </div>

                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-1">
                                      <h5 className="text-xs font-bold text-slate-800 truncate">
                                        {student.full_name}
                                      </h5>
                                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-300 shrink-0">
                                        Matched
                                      </span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 font-mono">{student.roll_number}</p>
                                    <div className="text-[10px] text-slate-400 mt-0.5 flex flex-wrap items-center gap-1.5">
                                      <span className="font-semibold text-emerald-700">
                                        {match.similarity !== undefined ? Math.round(match.similarity > 1 ? match.similarity : match.similarity * 100) : 0}% similarity
                                      </span>
                                      <span>(d: {match.distance !== undefined ? match.distance.toFixed(3) : 'N/A'})</span>
                                      {match.sourcePhotoName && (
                                        <span className="inline-flex items-center gap-1 text-[9px] text-brand-600 bg-brand-50 px-1.5 py-0.2 rounded border border-brand-200">
                                          <Layers className="w-2.5 h-2.5" />
                                          {match.sourcePhotoName}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div
                                    className={`w-6 h-6 rounded-full flex items-center justify-center transition shrink-0 ${
                                      isSelected
                                        ? 'bg-emerald-600 text-white'
                                        : 'border-2 border-slate-300 text-transparent'
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5" />
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 2: Needs Review Matches */}
                    {activeTab === 'needs_review' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">
                          Uncertain or ambiguous matches (distance between 0.45 and 0.60). Please confirm student identity:
                        </p>

                        {scanSummary.needsReviewMatches.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                            No ambiguous matches. All detected faces were either confidently matched or unidentified.
                          </div>
                        ) : (
                          <div className="space-y-3">
                            {scanSummary.needsReviewMatches.map((match) => {
                              const resolvedId = resolvedReviewMap.get(match.detectionId);

                              return (
                                <div
                                  key={match.detectionId}
                                  className="p-4 rounded-2xl border border-amber-200 bg-amber-50/40 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4"
                                >
                                  <div className="flex items-center gap-3">
                                    {match.cropUrl ? (
                                      <img
                                        src={match.cropUrl}
                                        alt="Candidate face crop"
                                        className="w-14 h-14 rounded-2xl object-cover border-2 border-amber-300 shadow-sm shrink-0"
                                      />
                                    ) : (
                                      <div className="w-14 h-14 rounded-2xl bg-amber-100 flex items-center justify-center text-amber-700 shrink-0">
                                        <ImageIcon className="w-6 h-6" />
                                      </div>
                                    )}

                                    <div>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-full">
                                          Needs Review
                                        </span>
                                        <span className="text-[11px] text-slate-500 font-mono">
                                          Distance: {match.distance !== undefined ? match.distance.toFixed(3) : 'N/A'}
                                        </span>
                                      </div>
                                      <p className="text-xs font-semibold text-slate-800 mt-1">
                                        Candidate: {match.matchedStudent?.full_name || 'Unknown Student'}
                                      </p>
                                      <p className="text-[11px] text-slate-500 font-mono">
                                        {match.matchedStudent?.roll_number} &bull; {match.similarity !== undefined ? Math.round(match.similarity > 1 ? match.similarity : match.similarity * 100) : 0}% resemblance
                                      </p>
                                      {match.sourcePhotoName && (
                                        <span className="inline-flex items-center gap-1 text-[10px] text-amber-800 bg-amber-100/90 px-1.5 py-0.5 rounded border border-amber-200 mt-1">
                                          <Layers className="w-3 h-3" />
                                          Photo: {match.sourcePhotoName}
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 w-full sm:w-auto">
                                    {match.matchedStudent && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          resolveNeedsReviewMatch(
                                            match.detectionId,
                                            resolvedId === match.matchedStudent!.id ? '' : match.matchedStudent!.id
                                          )
                                        }
                                        className={`flex-1 sm:flex-none px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                          resolvedId === match.matchedStudent.id
                                            ? 'bg-emerald-600 text-white shadow-sm'
                                            : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                        }`}
                                      >
                                        <Check className="w-3.5 h-3.5" />
                                        Confirm as {match.matchedStudent.full_name.split(' ')[0]}
                                      </button>
                                    )}

                                    <button
                                      type="button"
                                      onClick={() =>
                                        resolveNeedsReviewMatch(
                                          match.detectionId,
                                          resolvedId === 'unknown' ? '' : 'unknown'
                                        )
                                      }
                                      className={`flex-1 sm:flex-none px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition cursor-pointer ${
                                        resolvedId === 'unknown'
                                          ? 'bg-slate-800 text-white'
                                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-50'
                                      }`}
                                    >
                                      Mark as Unknown
                                    </button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 3: Enrolled Students Not Detected in Photo */}
                    {activeTab === 'not_detected' && (
                      <div className="space-y-4">
                        <div className="flex items-center justify-between text-xs text-slate-500">
                          <p>
                            Enrolled section students with valid face embeddings who were not identified in the photos:
                          </p>
                          <span className="font-semibold text-slate-700">
                            {notDetectedWithFaces.length} students
                          </span>
                        </div>

                        {notDetectedWithFaces.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                            All enrolled students with face references were detected and matched!
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {notDetectedWithFaces.map((student) => {
                              const isManuallyPresent = manualPresentIds.has(student.id);

                              return (
                                <div
                                  key={student.id}
                                  onClick={() => toggleManualPresent(student.id)}
                                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                                    isManuallyPresent
                                      ? 'bg-emerald-50/60 border-emerald-300'
                                      : 'bg-white border-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {student.photo_url || student.photo_path ? (
                                      <img
                                        src={student.photo_url || student.photo_path}
                                        alt={student.full_name}
                                        className="w-8 h-8 rounded-full object-cover shrink-0"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center font-bold text-xs shrink-0">
                                        {student.full_name.charAt(0)}
                                      </div>
                                    )}
                                    <div className="truncate">
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-semibold text-slate-800 truncate">
                                          {student.full_name}
                                        </p>
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-slate-100 text-slate-600 border border-slate-300 shrink-0">
                                          Not Detected
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 font-mono">
                                        {student.roll_number}
                                      </p>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition shrink-0 cursor-pointer ${
                                      isManuallyPresent
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {isManuallyPresent ? 'Present' : 'Mark Present'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 4: Face Enrollment Required */}
                    {activeTab === 'face_required' && (
                      <div className="space-y-4">
                        <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-900 text-xs">
                          <p className="font-semibold">Biometric Enrollment Required</p>
                          <p className="mt-0.5 text-orange-800 leading-relaxed">
                            These section students do not have registered 128-d face descriptors in the database. Automated matching could not evaluate them. You can manually confirm attendance if they are present in class:
                          </p>
                        </div>

                        {faceEnrollmentRequiredStudents.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                            All students in this section have valid 128-d biometric face descriptors registered.
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {faceEnrollmentRequiredStudents.map((student) => {
                              const isManuallyPresent = manualPresentIds.has(student.id);

                              return (
                                <div
                                  key={student.id}
                                  onClick={() => toggleManualPresent(student.id)}
                                  className={`p-3 rounded-xl border transition cursor-pointer flex items-center justify-between ${
                                    isManuallyPresent
                                      ? 'bg-emerald-50/60 border-emerald-300'
                                      : 'bg-white border-slate-200 hover:bg-slate-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    {student.photo_url || student.photo_path ? (
                                      <img
                                        src={student.photo_url || student.photo_path}
                                        alt={student.full_name}
                                        className="w-8 h-8 rounded-full object-cover shrink-0"
                                      />
                                    ) : (
                                      <div className="w-8 h-8 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs shrink-0">
                                        {student.full_name.charAt(0)}
                                      </div>
                                    )}
                                    <div className="truncate">
                                      <div className="flex items-center gap-1.5">
                                        <p className="text-xs font-semibold text-slate-800 truncate">
                                          {student.full_name}
                                        </p>
                                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-orange-100 text-orange-800 border border-orange-300 shrink-0">
                                          Face Enrollment Required
                                        </span>
                                      </div>
                                      <p className="text-[10px] text-slate-400 font-mono">
                                        {student.roll_number}
                                      </p>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition shrink-0 cursor-pointer ${
                                      isManuallyPresent
                                        ? 'bg-emerald-600 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                    }`}
                                  >
                                    {isManuallyPresent ? 'Present' : 'Mark Present'}
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}

                    {/* TAB 5: Unknown Faces Detected in Photo */}
                    {activeTab === 'unknown_faces' && (
                      <div className="space-y-4">
                        <p className="text-xs text-slate-500">
                          Faces detected in the photograph that could not be confidently matched to any student in this section:
                        </p>

                        {scanSummary.unknownFaces.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500 bg-slate-50 rounded-2xl border border-slate-200">
                            No unknown faces found. Every detected face matched an enrolled section student.
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-2.5">
                            {scanSummary.unknownFaces.map((face) => (
                              <div
                                key={face.detectionId}
                                className="p-3 rounded-2xl bg-slate-50 border border-slate-200 flex items-center gap-3"
                              >
                                {face.cropUrl ? (
                                  <img
                                    src={face.cropUrl}
                                    alt="Unknown face"
                                    className="w-12 h-12 rounded-xl object-cover border border-slate-300"
                                  />
                                ) : (
                                  <div className="w-12 h-12 rounded-xl bg-slate-200 flex items-center justify-center text-slate-500">
                                    <ImageIcon className="w-5 h-5" />
                                  </div>
                                )}
                                <div className="text-xs">
                                  <div className="flex items-center gap-1.5">
                                    <p className="font-bold text-slate-800">Unrecognized Face</p>
                                    <span className="text-[9px] font-bold px-1.5 py-0.2 rounded-full bg-slate-200 text-slate-700">
                                      Unknown Face
                                    </span>
                                  </div>
                                  <p className="text-slate-500 text-[11px]">Best Similarity: {face.similarity !== undefined ? Math.round(face.similarity > 1 ? face.similarity : face.similarity * 100) : 0}%</p>
                                  {face.sourcePhotoName && (
                                    <p className="text-[10px] text-slate-400 truncate max-w-[140px] mt-0.5">
                                      {face.sourcePhotoName}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              );
            })()}

            {/* Bottom Actions Footer */}
            <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
              <div className="text-xs text-slate-600">
                Confirming attendance for{' '}
                <strong className="text-slate-900 font-bold">
                  {selectedHighConfidenceIds.size +
                    Array.from(resolvedReviewMap.values()).filter((v) => v && v !== 'unknown').length +
                    manualPresentIds.size}
                </strong>{' '}
                students.
              </div>

              <div className="flex items-center gap-3 w-full sm:w-auto">
                <button
                  type="button"
                  onClick={() => {
                    stopCamera();
                    onClose();
                  }}
                  className="w-full sm:w-auto px-4 py-2.5 rounded-xl border border-slate-300 hover:bg-white text-slate-700 text-xs font-semibold transition cursor-pointer"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={handleConfirmAndSubmit}
                  disabled={isSubmitting}
                  className="w-full sm:w-auto px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-sm transition hover:scale-[1.02] cursor-pointer"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Saving Attendance Records...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm &amp; Update Attendance Records
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
