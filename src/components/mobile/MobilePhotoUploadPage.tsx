import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  Image as ImageIcon,
  CheckCircle,
  Clock,
  Shield,
  Upload,
  RefreshCw,
  XCircle,
  Info,
  Trash2,
  Plus,
  Layers,
} from 'lucide-react';
import { ApiService } from '../../services/api';
import type { PhotoUploadValidationResult, UploadedPhotoItem } from '../../types';

interface PhotoItem {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
}

const MAX_BATCH_PHOTOS = 20;

export const MobilePhotoUploadPage: React.FC = () => {
  const [token, setToken] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [validationResult, setValidationResult] = useState<PhotoUploadValidationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Multi-photo collection state
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [uploadSuccess, setUploadSuccess] = useState<boolean>(false);
  const [uploadTimestamp, setUploadTimestamp] = useState<string | null>(null);
  const [submittedPhotos, setSubmittedPhotos] = useState<UploadedPhotoItem[]>([]);

  // Countdown timer
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);

  // File input refs
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  // Extract and strip token on mount
  useEffect(() => {
    let extractedToken = '';
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.has('token')) {
      extractedToken = searchParams.get('token') || '';
    } else if (window.location.hash) {
      const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
      if (hashParams.has('token')) {
        extractedToken = hashParams.get('token') || '';
      }
    }

    if (!extractedToken) {
      setIsLoading(false);
      setErrorMessage('No upload token provided. Please scan the QR code displayed on the instructor dashboard.');
      return;
    }

    setToken(extractedToken);

    // Validate token with backend
    ApiService.validatePhotoUploadToken(extractedToken)
      .then((res) => {
        setValidationResult(res);
        if (!res.valid) {
          setErrorMessage(res.error || 'This upload link is invalid or expired.');
        } else if (res.session && res.session.expires_at) {
          const expTime = new Date(res.session.expires_at).getTime();
          const diff = Math.max(0, Math.floor((expTime - Date.now()) / 1000));
          setRemainingSeconds(diff);
        }
      })
      .catch((err) => {
        setErrorMessage(err.message || 'Failed to validate upload session.');
      })
      .finally(() => {
        setIsLoading(false);
      });

    // Strip token from browser address bar to avoid token leakage
    try {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.searchParams.delete('token');
      window.history.replaceState({}, document.title, cleanUrl.toString());
    } catch {
      // Ignore if history API restricted
    }
  }, []);

  // Expiration countdown
  useEffect(() => {
    if (remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setRemainingSeconds((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          setErrorMessage('This upload session has expired. Please ask the instructor for a new QR code.');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [remainingSeconds]);

  // Clean up object preview URLs on unmount
  useEffect(() => {
    return () => {
      photos.forEach((p) => {
        if (p.previewUrl.startsWith('blob:')) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
    };
  }, [photos]);

  const addFilesToCollection = (newFiles: FileList | File[]) => {
    const fileArray = Array.from(newFiles);
    if (fileArray.length === 0) return;

    const availableSlots = MAX_BATCH_PHOTOS - photos.length;
    if (availableSlots <= 0) {
      alert(`Maximum collection limit of ${MAX_BATCH_PHOTOS} photos reached.`);
      return;
    }

    const filesToProcess = fileArray.slice(0, availableSlots);
    if (fileArray.length > availableSlots) {
      alert(`Only adding ${availableSlots} photos. Maximum limit is ${MAX_BATCH_PHOTOS} photos.`);
    }

    const validNewPhotos: PhotoItem[] = [];
    const MAX_SIZE = 15 * 1024 * 1024;

    for (const file of filesToProcess) {
      if (!file.type.startsWith('image/')) {
        alert(`File "${file.name}" is not an image (JPEG, PNG, or WebP).`);
        continue;
      }
      if (file.size > MAX_SIZE) {
        alert(`File "${file.name}" is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum limit is 15 MB.`);
        continue;
      }

      validNewPhotos.push({
        id: `photo_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        file,
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        size: file.size,
      });
    }

    if (validNewPhotos.length > 0) {
      // APPEND to collection - never overwrite
      setPhotos((prev) => [...prev, ...validNewPhotos]);
    }
  };

  const handleCameraCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFilesToCollection(e.target.files);
    }
    if (cameraInputRef.current) {
      cameraInputRef.current.value = '';
    }
  };

  const handleGallerySelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      addFilesToCollection(e.target.files);
    }
    if (galleryInputRef.current) {
      galleryInputRef.current.value = '';
    }
  };

  const handleRemovePhoto = (id: string) => {
    setPhotos((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target && target.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(target.previewUrl);
      }
      return prev.filter((p) => p.id !== id);
    });
  };

  const handleClearAll = () => {
    photos.forEach((p) => {
      if (p.previewUrl.startsWith('blob:')) {
        URL.revokeObjectURL(p.previewUrl);
      }
    });
    setPhotos([]);
  };

  const handleSubmitBatch = async () => {
    if (photos.length === 0 || !token) return;

    setIsUploading(true);
    setUploadProgress(15);

    try {
      const progressTimer = setInterval(() => {
        setUploadProgress((p) => (p < 85 ? p + 15 : p));
      }, 250);

      const userAgent = navigator.userAgent || 'Mobile Browser';
      const fileObjects = photos.map((p) => p.file);
      const result = await ApiService.submitClassroomPhotoBatch(token, fileObjects, userAgent);

      clearInterval(progressTimer);
      setUploadProgress(100);

      if (result.success) {
        setUploadSuccess(true);
        setSubmittedPhotos(result.photos || []);
        setUploadTimestamp(result.session.photo_uploaded_at || new Date().toISOString());
      } else {
        alert(result.error || 'Failed to submit classroom photo batch.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error occurred during photo submission.');
    } finally {
      setIsUploading(false);
    }
  };

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col antialiased selection:bg-brand-500 selection:text-white">
      {/* Top Branding Header */}
      <header className="bg-slate-900 border-b border-slate-800 px-4 py-3.5 sticky top-0 z-20 flex items-center justify-between shadow-md">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-brand-500/20">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold tracking-tight text-white flex items-center gap-1.5">
              SENTINEL CAMPUS
              <span className="text-[10px] uppercase font-semibold px-1.5 py-0.5 rounded bg-brand-500/10 text-brand-400 border border-brand-500/20">
                Multi-Photo QR
              </span>
            </h1>
            <p className="text-[11px] text-slate-400">Classroom Attendance Capture</p>
          </div>
        </div>

        {validationResult?.valid && !uploadSuccess && remainingSeconds > 0 && (
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/25 text-xs font-mono font-medium">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatSeconds(remainingSeconds)}</span>
          </div>
        )}
      </header>

      {/* Main Content Area */}
      <main className="flex-1 p-4 max-w-lg mx-auto w-full flex flex-col justify-start">
        {/* Hidden File Inputs */}
        <input
          ref={cameraInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleCameraCapture}
          className="hidden"
          disabled={isUploading || uploadSuccess}
        />
        <input
          ref={galleryInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleGallerySelect}
          className="hidden"
          disabled={isUploading || uploadSuccess}
        />

        {/* 1. Loading State */}
        {isLoading && (
          <div className="flex-1 flex flex-col items-center justify-center py-16 text-center">
            <RefreshCw className="w-10 h-10 text-brand-500 animate-spin mb-4" />
            <h2 className="text-base font-semibold text-white">Validating Upload Session</h2>
            <p className="text-xs text-slate-400 mt-1">Connecting to Sentinel Campus...</p>
          </div>
        )}

        {/* 2. Error State */}
        {!isLoading && (errorMessage || !validationResult?.valid) && (
          <div className="flex-1 flex flex-col items-center justify-center py-12 text-center">
            <div className="w-16 h-16 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/30 flex items-center justify-center mb-4">
              <XCircle className="w-8 h-8" />
            </div>
            <h2 className="text-lg font-bold text-white mb-2">Upload Link Unavailable</h2>
            <p className="text-sm text-slate-400 max-w-xs mb-6">
              {errorMessage || validationResult?.error || 'This upload link is no longer valid or has expired.'}
            </p>
            <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-left text-xs text-slate-300 w-full max-w-xs space-y-1.5">
              <p className="font-semibold text-white flex items-center gap-1.5">
                <Info className="w-4 h-4 text-brand-400 shrink-0" />
                What should I do?
              </p>
              <p className="text-slate-400">1. Return to the instructor's laptop screen.</p>
              <p className="text-slate-400">2. Click <strong>Regenerate QR Code</strong> in the Face Attendance window.</p>
              <p className="text-slate-400">3. Scan the new QR code with your phone camera.</p>
            </div>
          </div>
        )}

        {/* 3. Success State */}
        {!isLoading && uploadSuccess && (
          <div className="flex-1 flex flex-col items-center justify-center py-6 text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-emerald-500/10 text-emerald-400 border-2 border-emerald-500/40 flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/10">
              <CheckCircle className="w-9 h-9" />
            </div>

            <h2 className="text-xl font-bold text-white mb-1">
              {submittedPhotos.length || photos.length} Photos Uploaded!
            </h2>
            <p className="text-xs text-slate-400 max-w-xs mb-4">
              The classroom photo collection has been securely transferred to the instructor dashboard.
            </p>

            {/* Thumbnail Gallery of Uploaded Photos */}
            <div className="w-full max-w-md bg-slate-900/80 border border-slate-800 rounded-2xl p-3 mb-5">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2 px-1">
                <span className="flex items-center gap-1 font-semibold text-slate-300">
                  <Layers className="w-3.5 h-3.5 text-brand-400" />
                  Uploaded Batch ({submittedPhotos.length || photos.length})
                </span>
                {uploadTimestamp && (
                  <span className="text-[10px]">
                    {new Date(uploadTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
                {(submittedPhotos.length > 0 ? submittedPhotos : photos).map((p, idx) => (
                  <div key={'id' in p ? p.id : idx} className="relative rounded-xl overflow-hidden aspect-video bg-black border border-slate-800">
                    <img
                      src={'preview_url' in p ? p.preview_url : p.previewUrl}
                      alt={`Uploaded photo ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-1 left-1 px-1.5 py-0.5 rounded bg-black/60 text-[9px] font-mono text-white">
                      #{idx + 1}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="p-4 rounded-xl bg-brand-500/10 border border-brand-500/20 text-left text-xs text-brand-200 w-full max-w-md mb-5">
              <p className="font-semibold text-white mb-1">Next Step on Laptop:</p>
              <p className="text-slate-300">
                Return to your laptop workstation. The Face Attendance window will combine and deduplicate student matches across all photos with zero auto-absent marking.
              </p>
            </div>

            <button
              onClick={() => {
                handleClearAll();
                setUploadSuccess(false);
                setSubmittedPhotos([]);
              }}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 font-medium transition-colors cursor-pointer"
            >
              Add more photos to this session
            </button>
          </div>
        )}

        {/* 4. Active Multi-Photo Upload Form */}
        {!isLoading && !errorMessage && validationResult?.valid && !uploadSuccess && (
          <div className="flex flex-col gap-4 py-2">
            {/* Session Info Header Card */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-2xl p-4 shadow-sm backdrop-blur-sm">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30">
                  {validationResult.classCourse?.code || 'CLASS'}
                </span>
                <span className="text-xs text-slate-400">
                  {validationResult.session?.session_date}
                </span>
              </div>
              <h2 className="text-base font-bold text-white line-clamp-1">
                {validationResult.session?.title || 'Lecture Attendance'}
              </h2>
              <p className="text-xs text-slate-400 line-clamp-1 mt-0.5">
                {validationResult.classCourse?.name || 'Enrolled Course'}
              </p>
            </div>

            {/* Collection Summary & Controls */}
            {photos.length === 0 ? (
              <div className="flex flex-col gap-3">
                <div className="border-2 border-dashed border-slate-800 rounded-2xl p-6 text-center bg-slate-900/40">
                  <div className="w-14 h-14 rounded-2xl bg-slate-800/80 text-brand-400 flex items-center justify-center mx-auto mb-3">
                    <Camera className="w-7 h-7" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">Capture Classroom Photos</h3>
                  <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto leading-relaxed">
                    Take multiple photos from different angles (left, center, right, back) to capture all seated students.
                  </p>
                </div>

                {/* Primary Action: Camera Capture */}
                <button
                  type="button"
                  onClick={() => cameraInputRef.current?.click()}
                  className="w-full py-3.5 px-4 rounded-xl bg-brand-600 hover:bg-brand-500 active:bg-brand-700 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-brand-600/30 transition-all cursor-pointer"
                >
                  <Camera className="w-5 h-5" />
                  Take Classroom Photo
                </button>

                {/* Secondary Action: Choose from Gallery (Multi-select) */}
                <button
                  type="button"
                  onClick={() => galleryInputRef.current?.click()}
                  className="w-full py-3 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 active:bg-slate-850 text-slate-200 font-medium text-xs flex items-center justify-center gap-2 border border-slate-700/60 transition-colors cursor-pointer"
                >
                  <ImageIcon className="w-4 h-4 text-slate-400" />
                  Add Multiple from Gallery
                </button>
              </div>
            ) : (
              /* Photo Collection Grid & Action Bar */
              <div className="flex flex-col gap-4">
                {/* Collection Header Bar */}
                <div className="flex items-center justify-between bg-slate-900/90 border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2">
                    <Layers className="w-4 h-4 text-brand-400" />
                    <span className="font-semibold text-white">
                      Collection ({photos.length} / {MAX_BATCH_PHOTOS})
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleClearAll}
                    disabled={isUploading}
                    className="text-rose-400 hover:text-rose-300 font-medium text-xs transition cursor-pointer"
                  >
                    Clear All
                  </button>
                </div>

                {/* Thumbnails Grid */}
                <div className="grid grid-cols-2 gap-3 max-h-[44vh] overflow-y-auto pr-1">
                  {photos.map((item, index) => (
                    <div
                      key={item.id}
                      className="group relative rounded-xl overflow-hidden border border-slate-800 bg-slate-900 aspect-video shadow-md"
                    >
                      <img
                        src={item.previewUrl}
                        alt={`Photo ${index + 1}`}
                        className="w-full h-full object-cover"
                      />

                      {/* Index Badge */}
                      <div className="absolute top-1.5 left-1.5 px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[10px] font-mono text-white font-semibold">
                        #{index + 1}
                      </div>

                      {/* Remove Button */}
                      <button
                        type="button"
                        onClick={() => handleRemovePhoto(item.id)}
                        disabled={isUploading}
                        className="absolute top-1.5 right-1.5 p-1 rounded-md bg-rose-600/90 hover:bg-rose-500 text-white shadow-sm transition cursor-pointer"
                        title="Remove photo"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>

                      {/* Info Footer */}
                      <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/90 to-transparent p-2 text-left">
                        <p className="text-[10px] text-white font-medium truncate">{item.name}</p>
                        <p className="text-[9px] text-slate-400">
                          {(item.size / (1024 * 1024)).toFixed(1)} MB
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Add More Controls (Appending) */}
                {photos.length < MAX_BATCH_PHOTOS && (
                  <div className="grid grid-cols-2 gap-2 pt-1">
                    <button
                      type="button"
                      onClick={() => cameraInputRef.current?.click()}
                      disabled={isUploading}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700/60 transition cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-brand-400" />
                      Take Another
                    </button>
                    <button
                      type="button"
                      onClick={() => galleryInputRef.current?.click()}
                      disabled={isUploading}
                      className="py-2.5 px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 border border-slate-700/60 transition cursor-pointer"
                    >
                      <Plus className="w-4 h-4 text-brand-400" />
                      Add More
                    </button>
                  </div>
                )}

                {/* Upload Progress Bar */}
                {isUploading && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex justify-between text-xs text-slate-400">
                      <span>Uploading {photos.length} photos to Sentinel Campus...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-brand-500 transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Primary Submit Batch Button */}
                <button
                  type="button"
                  onClick={handleSubmitBatch}
                  disabled={isUploading}
                  className="w-full py-3.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700 disabled:opacity-50 text-white font-semibold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer"
                >
                  {isUploading ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      Uploading {photos.length} Photos...
                    </>
                  ) : (
                    <>
                      <Upload className="w-5 h-5" />
                      Submit Collection ({photos.length} Photo{photos.length > 1 ? 's' : ''})
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Helpful Notice */}
            <div className="mt-1 p-3 rounded-xl bg-slate-900/50 border border-slate-800/80 text-[11px] text-slate-400 flex items-start gap-2">
              <Info className="w-4 h-4 text-brand-400 shrink-0 mt-0.5" />
              <span>
                You can capture up to {MAX_BATCH_PHOTOS} photos. Take shots from different angles to ensure all students are visible. The facial recognition engine will aggregate and deduplicate attendance automatically.
              </span>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="p-3 text-center border-t border-slate-900 text-[10px] text-slate-400">
        Sentinel Campus Security Engine • Multi-Photo Batch Channel
      </footer>
    </div>
  );
};

