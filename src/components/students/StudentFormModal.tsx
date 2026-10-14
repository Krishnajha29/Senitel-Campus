import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Upload,
  AlertCircle,
  CheckCircle2,
  Trash2,
  RefreshCw,
  Camera,
  Loader2,
  Layers,
} from 'lucide-react';
import type { Student, ClassCourse, FaceEnrollmentStatus, AcademicSection } from '../../types';
import { validatePhotoFile } from '../../services/storage';
import { ApiService } from '../../services/api';
import { FaceRecognitionService } from '../../services/faceRecognition';

interface StudentFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    data: Omit<Student, 'id' | 'instructor_id' | 'created_at' | 'updated_at'> & { class_id?: string; section_id?: string },
    photoFile?: File,
    onProgress?: (pct: number) => void
  ) => Promise<void>;
  studentToEdit?: Student | null;
}

export const StudentFormModal: React.FC<StudentFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  studentToEdit,
}) => {
  const [fullName, setFullName] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [email, setEmail] = useState('');
  const [course, setCourse] = useState('B.Tech Computer Science');
  const [batch, setBatch] = useState('Batch 2024-2028');
  const [academicYear, setAcademicYear] = useState('Year 2');
  const [section, setSection] = useState('Section A');
  const [isActive, setIsActive] = useState(true);

  // Section Assignment
  const [sections, setSections] = useState<AcademicSection[]>([]);
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');
  const [isCustomSection, setIsCustomSection] = useState(false);

  // Class enrollment assignment
  const [classes, setClasses] = useState<ClassCourse[]>([]);
  const [selectedClassId, setSelectedClassId] = useState<string>('');

  // Biometrics & Photo management state
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string>('');
  const [existingPhotoPath, setExistingPhotoPath] = useState<string>('');
  const [isExtractingFace, setIsExtractingFace] = useState<boolean>(false);
  const [faceDescriptor, setFaceDescriptor] = useState<number[] | null>(null);
  const [faceQualityScore, setFaceQualityScore] = useState<number | null>(null);
  const [faceStatus, setFaceStatus] = useState<FaceEnrollmentStatus>('not_enrolled');
  const [faceStatusMessage, setFaceStatusMessage] = useState<string>('');

  const [uploadProgress, setUploadProgress] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen) {
      Promise.all([
        ApiService.getClasses().catch(() => []),
        ApiService.getSections().catch(() => []),
      ]).then(([clsData, secData]) => {
        setClasses(clsData || []);
        setSections(secData || []);
      });
    }
  }, [isOpen]);

  useEffect(() => {
    if (studentToEdit) {
      setFullName(studentToEdit.full_name);
      setRollNumber(studentToEdit.roll_number);
      setEmail(studentToEdit.email || '');
      setCourse(studentToEdit.course);
      setBatch(studentToEdit.batch);
      setAcademicYear(studentToEdit.academic_year);
      setSection(studentToEdit.section);
      setIsActive(studentToEdit.is_active);
      setExistingPhotoPath(studentToEdit.photo_path);
      setPhotoPreview(studentToEdit.photo_url || '');
      setFaceDescriptor(studentToEdit.face_descriptor || null);
      setFaceQualityScore(studentToEdit.face_quality_score || null);
      setFaceStatus(studentToEdit.face_enrollment_status || (studentToEdit.face_descriptor ? 'enrolled' : 'not_enrolled'));
      setFaceStatusMessage(studentToEdit.face_descriptor ? 'Face biometrics enrolled' : '');
      setPhotoFile(null);
      setSelectedClassId('');
      if (studentToEdit.section_id) {
        setSelectedSectionId(studentToEdit.section_id);
        setIsCustomSection(false);
      } else {
        setSelectedSectionId('');
        setIsCustomSection(true);
      }

      // Fetch student's current class enrollment
      ApiService.getStudentEnrollments(studentToEdit.id)
        .then((enrs) => {
          if (enrs && enrs.length > 0) {
            setSelectedClassId(enrs[0]);
          }
        })
        .catch(() => {});
    } else {
      // Defaults for new student
      setFullName('');
      setRollNumber('');
      setEmail('');
      setCourse('B.Tech Software Engineering');
      setBatch('2024-2028');
      setAcademicYear('2026-2027');
      setSection('A');
      setIsActive(true);
      setExistingPhotoPath('');
      setPhotoPreview('');
      setFaceDescriptor(null);
      setFaceQualityScore(null);
      setFaceStatus('not_enrolled');
      setFaceStatusMessage('');
      setPhotoFile(null);
      setSelectedClassId('');
      setIsCustomSection(false);
      if (sections.length > 0) {
        setSelectedSectionId(sections[0].id);
        setCourse(sections[0].programme);
        setBatch(sections[0].batch);
        setAcademicYear(sections[0].academic_year);
        setSection(sections[0].section);
      } else {
        setSelectedSectionId('');
      }
    }
    setErrorMessage('');
    setUploadProgress(0);
  }, [studentToEdit, isOpen, sections]);

  const handleSectionSelect = (secId: string) => {
    if (secId === 'custom') {
      setIsCustomSection(true);
      setSelectedSectionId('');
    } else {
      setIsCustomSection(false);
      setSelectedSectionId(secId);
      const s = sections.find((sec) => sec.id === secId);
      if (s) {
        setCourse(s.programme);
        setBatch(s.batch);
        setAcademicYear(s.academic_year);
        setSection(s.section);
      }
    }
  };

  const handleClassSelect = (classId: string) => {
    setSelectedClassId(classId);
    if (classId) {
      const cls = classes.find((c) => c.id === classId);
      if (cls) {
        if (!studentToEdit) {
          setCourse(cls.name);
          setSection(cls.section ? `Section ${cls.section}` : section);
          if (cls.academic_year) {
            setAcademicYear(cls.academic_year);
          }
        }
      }
    }
  };

  const handleCourseChange = (newCourse: string) => {
    setCourse(newCourse);
    if (!selectedClassId && newCourse.trim()) {
      const q = newCourse.trim().toLowerCase();
      const match = classes.find(
        (c) =>
          c.name.toLowerCase() === q ||
          c.code.toLowerCase() === q ||
          c.name.toLowerCase().includes(q) ||
          q.includes(c.name.toLowerCase())
      );
      if (match) {
        setSelectedClassId(match.id);
      }
    }
  };

  if (!isOpen) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const validation = validatePhotoFile(file);
    if (!validation.valid) {
      setErrorMessage(validation.error || 'Invalid file format');
      return;
    }

    setErrorMessage('');
    setPhotoFile(file);
    const objectUrl = URL.createObjectURL(file);
    setPhotoPreview(objectUrl);

    // Asynchronously validate face biometrics and extract 128-d descriptor
    setIsExtractingFace(true);
    setFaceStatusMessage('Analyzing face biometrics...');

    const img = new Image();
    img.src = objectUrl;
    img.onload = async () => {
      try {
        await FaceRecognitionService.loadModels();
        const res = await FaceRecognitionService.validateAndExtractReferenceDescriptor(img);
        if (res.valid && res.descriptor) {
          setFaceDescriptor(res.descriptor);
          setFaceQualityScore(res.qualityScore || 0.95);
          setFaceStatus('enrolled');
          setFaceStatusMessage(`Face biometrics verified (${Math.round((res.qualityScore || 0.95) * 100)}% quality)`);
        } else {
          setFaceDescriptor(null);
          setFaceQualityScore(null);
          setFaceStatus('failed');
          setFaceStatusMessage(res.error || 'No single clear face detected in photo.');
        }
      } catch (err: any) {
        console.warn('Face biometric extraction warning:', err);
        setFaceDescriptor(null);
        setFaceQualityScore(null);
        setFaceStatus('pending');
        setFaceStatusMessage('Biometric extraction pending model initialization');
      } finally {
        setIsExtractingFace(false);
      }
    };
    img.onerror = () => {
      setIsExtractingFace(false);
      setFaceStatus('not_enrolled');
      setFaceStatusMessage('Could not load image for face detection');
    };
  };

  const handleRemovePhoto = () => {
    setPhotoFile(null);
    setPhotoPreview('');
    setExistingPhotoPath('');
    setFaceDescriptor(null);
    setFaceQualityScore(null);
    setFaceStatus('not_enrolled');
    setFaceStatusMessage('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    // Validations
    if (!fullName.trim()) {
      setErrorMessage('Full name is required.');
      return;
    }
    if (!rollNumber.trim()) {
      setErrorMessage('Roll number is required.');
      return;
    }
    if (!studentToEdit && !photoFile && !existingPhotoPath) {
      setErrorMessage('Profile picture is required for future face-based attendance.');
      return;
    }

    try {
      setIsSubmitting(true);
      setUploadProgress(10);

      await onSubmit(
        {
          full_name: fullName.trim(),
          roll_number: rollNumber.trim().toUpperCase(),
          email: email.trim() ? email.trim() : null,
          course: course.trim(),
          batch: batch.trim(),
          academic_year: academicYear.trim(),
          section: section.trim(),
          photo_path: existingPhotoPath || '',
          photo_url: photoPreview,
          is_active: isActive,
          face_descriptor: faceDescriptor,
          face_enrollment_status: faceStatus,
          face_quality_score: faceQualityScore,
          class_id: selectedClassId || undefined,
          section_id: selectedSectionId || undefined,
        },
        photoFile || undefined,
        (pct) => setUploadProgress(pct)
      );

      onClose();
    } catch (err: any) {
      console.error('Error saving student:', err);
      setErrorMessage(err.message || 'Failed to save student record.');
    } finally {
      setIsSubmitting(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-100 my-8 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {studentToEdit ? 'Edit Student Profile' : 'Register New Student'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {studentToEdit
                ? 'Update academic details and attendance photograph'
                : 'Enrolled in Sentinel Campus biometric directory'}
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="mx-6 mt-5 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3 animate-fade-in">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-semibold">{errorMessage}</p>
              <p className="text-rose-700 mt-0.5">
                Please check the input details and try again.
              </p>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-6">
          {/* Section 1: Profile Photo Upload */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Profile Photo <span className="text-rose-500">*</span>
              <span className="text-slate-400 font-normal lowercase ml-1">
                (required for face attendance, JPEG/PNG/WebP, max 5MB)
              </span>
            </label>

            <div className="flex flex-col sm:flex-row items-center gap-5 p-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
              {/* Photo Preview Circle */}
              <div className="relative group shrink-0">
                {photoPreview ? (
                  <div className="w-24 h-24 rounded-2xl overflow-hidden border-2 border-brand-500 shadow-md bg-white">
                    <img
                      src={photoPreview}
                      alt="Student Preview"
                      className="w-full h-full object-cover"
                    />
                  </div>
                ) : (
                  <div className="w-24 h-24 rounded-2xl bg-slate-200 border-2 border-slate-300 flex flex-col items-center justify-center text-slate-400">
                    <Camera className="w-8 h-8 stroke-[1.5]" />
                    <span className="text-[10px] font-medium mt-1">No Photo</span>
                  </div>
                )}
              </div>

              {/* Upload Controls */}
              <div className="flex-1 w-full text-center sm:text-left space-y-2">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                />

                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isSubmitting}
                    className="px-3.5 py-2 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-xl transition flex items-center gap-1.5 border border-brand-200"
                  >
                    <Upload className="w-3.5 h-3.5" />
                    {photoPreview ? 'Replace Photo' : 'Upload From Device'}
                  </button>

                  {photoPreview && (
                    <button
                      type="button"
                      onClick={handleRemovePhoto}
                      disabled={isSubmitting}
                      className="px-3 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 rounded-xl transition flex items-center gap-1.5 border border-rose-200"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Remove
                    </button>
                  )}
                </div>

                <p className="text-[11px] text-slate-500">
                  Images are stored in private access-controlled storage for facial verification.
                </p>

                {/* Face Biometric Status Badge */}
                {photoPreview && (
                  <div className="pt-1 flex items-center justify-center sm:justify-start">
                    {isExtractingFace ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-medium animate-pulse">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-indigo-600" />
                        <span>Analyzing facial biometrics...</span>
                      </div>
                    ) : faceStatus === 'enrolled' ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-semibold">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>{faceStatusMessage || 'Face Biometrics Enrolled (128-d Embedding Ready)'}</span>
                      </div>
                    ) : faceStatus === 'failed' ? (
                      <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-amber-50 border border-amber-300 text-amber-800 text-xs font-medium">
                        <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                        <span>{faceStatusMessage || 'Could not detect a clear single face in this photo.'}</span>
                      </div>
                    ) : null}
                  </div>
                )}

                {/* Upload Progress Bar */}
                {isSubmitting && uploadProgress > 0 && (
                  <div className="w-full bg-slate-200 rounded-full h-2 mt-2 overflow-hidden">
                    <div
                      className="bg-brand-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Section 2: Core Identification */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Full Legal Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. Jordan Hayes"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Roll Number / Student ID <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={rollNumber}
                onChange={(e) => setRollNumber(e.target.value.toUpperCase())}
                placeholder="e.g. CS2024-042"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
              />
              <span className="text-[10px] text-slate-400 mt-1 block">
                Must be unique within the institution.
              </span>
            </div>
          </div>

          {/* Section 3: Academic Details & Institutional Section */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-brand-600" />
                Institutional Academic Section
              </label>
              <button
                type="button"
                onClick={() => setIsCustomSection(!isCustomSection)}
                className="text-[11px] font-semibold text-brand-600 hover:text-brand-700 underline cursor-pointer"
              >
                {isCustomSection ? 'Select Existing Section' : '+ New Academic Section'}
              </button>
            </div>

            {!isCustomSection && sections.length > 0 ? (
              <div>
                <select
                  value={selectedSectionId}
                  onChange={(e) => handleSectionSelect(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.programme} &bull; Batch {s.batch} &bull; Sec {s.section} ({s.academic_year})
                    </option>
                  ))}
                  <option value="custom">+ Create New Custom Section...</option>
                </select>
                <p className="text-[11px] text-emerald-700 mt-1.5 flex items-center gap-1 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  Automatically enrolled in all courses matching Section {section} ({course}).
                </p>
              </div>
            ) : null}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Programme / Course <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={course}
                  onChange={(e) => handleCourseChange(e.target.value)}
                  placeholder="e.g. B.Tech Software Engineering"
                  disabled={isSubmitting || (!isCustomSection && sections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Batch Cohort <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder="e.g. 2024-2028"
                  disabled={isSubmitting || (!isCustomSection && sections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Academic Year <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder="e.g. 2026-2027"
                  disabled={isSubmitting || (!isCustomSection && sections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Section <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={section}
                  onChange={(e) => setSection(e.target.value)}
                  placeholder="e.g. A"
                  disabled={isSubmitting || (!isCustomSection && sections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs uppercase font-bold text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100"
                />
              </div>
            </div>

            {/* Optional Specific Class / Elective Assignment */}
            <div className="pt-2 border-t border-slate-200/70">
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Optional Elective / Specific Class Assignment
              </label>
              <select
                value={selectedClassId}
                onChange={(e) => handleClassSelect(e.target.value)}
                disabled={isSubmitting}
                className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value="">-- Standard Section Membership (Auto-enrolled in all section classes) --</option>
                {classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.code} - Sec {c.section}) [Manual / Elective]
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Section 4: Email & Status */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email Address <span className="text-slate-400 font-normal">(Optional)</span>
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="student@campus.edu"
                disabled={isSubmitting}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
              />
            </div>

            <div className="pt-2 sm:pt-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                  disabled={isSubmitting}
                  className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                />
                <span className="text-xs font-semibold text-slate-800">
                  Active Enrollment Status
                </span>
              </label>
              <p className="text-[11px] text-slate-400 ml-7 mt-0.5">
                Inactive students are hidden from active lecture rolls but keep historical records.
              </p>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2 disabled:opacity-50"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving Student...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {studentToEdit ? 'Save Changes' : 'Register Student'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
