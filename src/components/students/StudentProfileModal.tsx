import React, { useEffect, useState } from 'react';
import {
  X,
  Edit2,
  Power,
  UserCheck,
  Camera,
  RefreshCw,
  Trash2,
  Loader2,
} from 'lucide-react';
import type { Student, ClassCourse } from '../../types';
import { ApiService } from '../../services/api';
import { FaceRecognitionService } from '../../services/faceRecognition';
import { useToast } from '../common/ToastContext';

interface StudentProfileModalProps {
  isOpen: boolean;
  student: Student | null;
  onClose: () => void;
  onEdit: (student: Student) => void;
  onToggleStatus: (student: Student) => void;
}

export const StudentProfileModal: React.FC<StudentProfileModalProps> = ({
  isOpen,
  student,
  onClose,
  onEdit,
  onToggleStatus,
}) => {
  const [currentStudent, setCurrentStudent] = useState<Student | null>(student);
  const [isRebuildingFace, setIsRebuildingFace] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setCurrentStudent(student);
  }, [student]);

  const [summary, setSummary] = useState<{
    total: number;
    present: number;
    absent: number;
    late: number;
    unmarked: number;
    percentage: number;
  }>({ total: 0, present: 0, absent: 0, late: 0, unmarked: 0, percentage: 0 });

  const [enrolledClasses, setEnrolledClasses] = useState<ClassCourse[]>([]);

  useEffect(() => {
    if (student) {
      Promise.all([
        ApiService.getStudentAttendanceSummary(student.id),
        ApiService.getClasses(),
      ])
        .then(async ([stats, allClasses]) => {
          setSummary(stats);

          // Find classes student is enrolled in
          const enrolled: ClassCourse[] = [];
          for (const cls of allClasses) {
            const roster = await ApiService.getClassEnrollments(cls.id);
            if (roster.some((s) => s.id === student.id)) {
              enrolled.push(cls);
            }
          }
          setEnrolledClasses(enrolled);
        });
    }
  }, [student]);

  const handleRebuildFaceBiometrics = async () => {
    if (!currentStudent) return;
    setIsRebuildingFace(true);
    try {
      const photoSrc = currentStudent.photo_url || currentStudent.photo_path;
      if (!photoSrc) {
        toast.error('Missing Photo', 'No reference photo found for this student. Please upload a photo first.');
        return;
      }

      await FaceRecognitionService.loadModels();

      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = photoSrc;
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('Could not load student photo file.'));
      });

      const validation = await FaceRecognitionService.validateAndExtractReferenceDescriptor(img);

      if (!validation.valid || !validation.descriptor) {
        toast.error('Enrollment Rejected', validation.error || 'Failed to detect a usable face in the photo.');
        return;
      }

      const updated = await ApiService.enrollStudentFaceDescriptor(
        currentStudent.id,
        validation.descriptor,
        validation.qualityScore || 0.95
      );

      setCurrentStudent(updated);
      toast.success('Face Enrolled', 'Face representation successfully rebuilt and enrolled!');
    } catch (err: any) {
      console.error('Rebuild face error:', err);
      toast.error('Build Failed', err.message || 'Failed to build face biometric representation.');
    } finally {
      setIsRebuildingFace(false);
    }
  };

  const handleRemoveFaceBiometrics = async () => {
    if (!currentStudent) return;
    try {
      const updated = await ApiService.removeStudentFaceDescriptor(currentStudent.id);
      setCurrentStudent(updated);
      toast.info('Biometrics Cleared', 'Biometric face representation removed.');
    } catch (err: any) {
      toast.error('Removal Failed', err.message || 'Failed to remove face biometrics.');
    }
  };

  if (!isOpen || !student) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-100 my-8 overflow-hidden">
        {/* Header Cover */}
        <div className="h-28 bg-gradient-to-r from-slate-900 via-brand-900 to-indigo-900 relative p-6 flex justify-between items-start">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-white/20 text-white backdrop-blur-md">
            <span
              className={`w-2 h-2 rounded-full ${
                student.is_active ? 'bg-emerald-400' : 'bg-slate-400'
              }`}
            />
            {student.is_active ? 'Active Enrolled Student' : 'Inactive / On Leave'}
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition backdrop-blur-md"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Profile Card Body */}
        <div className="px-6 pb-6 pt-0 relative">
          {/* Avatar & Title Row */}
          <div className="flex flex-col sm:flex-row items-center sm:items-end justify-between gap-4 -mt-14 mb-6">
            <div className="flex flex-col sm:flex-row items-center sm:items-end gap-4 text-center sm:text-left">
              <div className="w-28 h-28 rounded-3xl overflow-hidden border-4 border-white shadow-xl bg-slate-100 shrink-0">
                {student.photo_url ? (
                  <img
                    src={student.photo_url}
                    alt={student.full_name}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center bg-brand-50 text-brand-700 font-bold text-3xl">
                    {student.full_name.charAt(0)}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-xl font-bold text-slate-900">{student.full_name}</h3>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 mt-1">
                  <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 border border-slate-200">
                    {student.roll_number}
                  </span>
                  <span className="text-xs text-slate-500">
                    {student.course} &bull; {student.batch}
                  </span>
                </div>
              </div>
            </div>

            {/* Top Action Buttons */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => onEdit(student)}
                className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1.5"
              >
                <Edit2 className="w-3.5 h-3.5" />
                Edit Profile
              </button>

              <button
                onClick={() => onToggleStatus(student)}
                className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 ${
                  student.is_active
                    ? 'text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200'
                    : 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200'
                }`}
              >
                <Power className="w-3.5 h-3.5" />
                {student.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>

          {/* Attendance Stats Cards */}
          <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <UserCheck className="w-4 h-4 text-brand-600" />
                Attendance Performance Summary
              </h4>
              <span className="text-xs text-slate-400 font-medium">
                Finalized Sessions Only
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
              <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-center">
                <p className="text-[11px] text-slate-500 font-medium">Attendance</p>
                <p
                  className={`text-xl font-bold mt-1 ${
                    summary.percentage >= 75
                      ? 'text-emerald-600'
                      : summary.percentage >= 60
                      ? 'text-amber-600'
                      : 'text-rose-600'
                  }`}
                >
                  {summary.percentage}%
                </p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-center">
                <p className="text-[11px] text-slate-500 font-medium">Total Sessions</p>
                <p className="text-xl font-bold text-slate-800 mt-1">{summary.total}</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-center">
                <p className="text-[11px] text-slate-500 font-medium">Present</p>
                <p className="text-xl font-bold text-emerald-600 mt-1">{summary.present}</p>
              </div>

              <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-center">
                <p className="text-[11px] text-slate-500 font-medium">Absent</p>
                <p className="text-xl font-bold text-rose-600 mt-1">{summary.absent}</p>
              </div>
            </div>
          </div>

          {/* Academic & Contact Details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/60 space-y-3">
              <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Academic Information
              </h5>
              <div className="text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-slate-500">Programme:</span>
                  <span className="font-semibold text-slate-800">{student.course}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Batch / Class:</span>
                  <span className="font-semibold text-slate-800">{student.batch}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Academic Year:</span>
                  <span className="font-semibold text-slate-800">{student.academic_year}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Section:</span>
                  <span className="font-semibold text-slate-800">{student.section}</span>
                </div>
              </div>
            </div>

            <div className="bg-slate-50/70 p-4 rounded-2xl border border-slate-200/60 space-y-3">
              <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                Contact & Identity
              </h5>
              <div className="text-xs space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Roll Number:</span>
                  <span className="font-mono font-bold text-slate-900">{student.roll_number}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Email:</span>
                  <span className="font-medium text-slate-800">
                    {student.email || 'Not provided'}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Biometric Reference:</span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                    Photo Indexed
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Enrolled Since:</span>
                  <span className="text-slate-700">
                    {new Date(student.created_at).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Biometric Face ID & AI Recognition Card */}
          <div className="bg-slate-50/80 rounded-2xl p-4 border border-slate-200 mb-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div
                  className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 border ${
                    currentStudent?.face_enrollment_status === 'enrolled'
                      ? 'bg-emerald-50 text-emerald-600 border-emerald-200'
                      : 'bg-amber-50 text-amber-600 border-amber-200'
                  }`}
                >
                  <Camera className="w-5 h-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h5 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                      Biometric Face ID Representation
                    </h5>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        currentStudent?.face_enrollment_status === 'enrolled'
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {currentStudent?.face_enrollment_status === 'enrolled'
                        ? 'Active 128-d Neural Representation'
                        : 'Biometrics Pending'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {currentStudent?.face_enrollment_status === 'enrolled'
                      ? `Enrolled with quality score ${currentStudent.face_quality_score || 0.95}. Ready for multi-face classroom attendance.`
                      : 'Reference photo has not yet been processed into a facial embedding.'}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <button
                  type="button"
                  disabled={isRebuildingFace}
                  onClick={handleRebuildFaceBiometrics}
                  className="px-3 py-1.5 rounded-xl bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition disabled:opacity-50"
                  title="Re-run neural face extraction and rebuild 128-d descriptor"
                >
                  {isRebuildingFace ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Analyzing...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 text-brand-600" />
                      Rebuild Face ID
                    </>
                  )}
                </button>

                {currentStudent?.face_enrollment_status === 'enrolled' && (
                  <button
                    type="button"
                    onClick={handleRemoveFaceBiometrics}
                    className="px-3 py-1.5 rounded-xl bg-white border border-rose-200 hover:bg-rose-50 text-rose-600 text-xs font-semibold flex items-center gap-1.5 shadow-sm transition"
                    title="Remove biometric descriptor to respect student privacy"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                    Opt Out / Clear
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Enrolled Classes List */}
          <div>
            <h5 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-2">
              Enrolled Courses & Classes ({enrolledClasses.length})
            </h5>
            {enrolledClasses.length === 0 ? (
              <p className="text-xs text-slate-400 bg-slate-50 p-3 rounded-xl border border-slate-100 text-center">
                Student is not currently enrolled in any courses.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {enrolledClasses.map((cls) => (
                  <div
                    key={cls.id}
                    className="p-3 bg-white rounded-xl border border-slate-200/80 flex items-center justify-between"
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-800">{cls.name}</p>
                      <p className="text-[11px] text-slate-500">
                        {cls.code} &bull; Section {cls.section}
                      </p>
                    </div>
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                      {cls.academic_year}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
