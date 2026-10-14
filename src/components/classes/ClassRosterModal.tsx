import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Trash2,
  Search,
  CheckCircle2,
  Users,
  RefreshCw,
  Sparkles,
  AlertCircle,
  ShieldCheck,
  Check,
} from 'lucide-react';
import type { ClassCourse, Student } from '../../types';
import { ApiService } from '../../services/api';
import { useToast } from '../common/ToastContext';

interface ClassRosterModalProps {
  isOpen: boolean;
  classObj: ClassCourse | null;
  onClose: () => void;
  onRosterUpdated: () => void;
}

export const ClassRosterModal: React.FC<ClassRosterModalProps> = ({
  isOpen,
  classObj,
  onClose,
  onRosterUpdated,
}) => {
  const [enrolledStudents, setEnrolledStudents] = useState<Student[]>([]);
  const [allStudents, setAllStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Search enrolled
  const [enrolledSearch, setEnrolledSearch] = useState('');

  // Enroll new students drawer/mode
  const [isEnrollMode, setIsEnrollMode] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [isRepairing, setIsRepairing] = useState(false);

  const toast = useToast();

  const loadRoster = async () => {
    if (!classObj) return;
    try {
      setIsLoading(true);
      setLoadError(null);
      const [roster, directory] = await Promise.all([
        ApiService.getClassEnrollments(classObj.id),
        ApiService.getStudents({ is_active: true }),
      ]);
      setEnrolledStudents(roster);
      setAllStudents(directory);
    } catch (err: any) {
      console.error('Failed to load roster:', err);
      setLoadError(err.message || 'Database error occurred while loading class roster.');
      toast.error('Failed to load roster', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && classObj) {
      loadRoster();
      setIsEnrollMode(false);
      setSelectedStudentIds(new Set());
    }
  }, [isOpen, classObj]);

  if (!isOpen || !classObj) return null;

  // Enrolled filter
  const filteredEnrolled = enrolledStudents.filter((s) => {
    const q = enrolledSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q) ||
      (s.course && s.course.toLowerCase().includes(q)) ||
      (s.batch && s.batch.toLowerCase().includes(q)) ||
      (s.section && s.section.toLowerCase().includes(q))
    );
  });

  // Available students for enrollment (active and not already enrolled in this class)
  const enrolledIds = new Set(enrolledStudents.map((s) => s.id));
  const candidateStudents = allStudents.filter((s) => {
    if (enrolledIds.has(s.id)) return false;
    const q = candidateSearch.toLowerCase().trim();
    if (!q) return true;
    return (
      s.full_name.toLowerCase().includes(q) ||
      s.roll_number.toLowerCase().includes(q) ||
      (s.course && s.course.toLowerCase().includes(q)) ||
      (s.batch && s.batch.toLowerCase().includes(q)) ||
      (s.section && s.section.toLowerCase().includes(q))
    );
  });

  // Identify matching candidates whose course or batch text matches this class name or code
  const matchingCandidates = candidateStudents.filter((s) => {
    const clsName = classObj.name.trim().toLowerCase();
    const clsCode = classObj.code.trim().toLowerCase();
    const studentCourse = (s.course || '').trim().toLowerCase();
    const studentBatch = (s.batch || '').trim().toLowerCase();
    return (
      studentCourse === clsName ||
      studentCourse === clsCode ||
      clsName.includes(studentCourse) ||
      studentCourse.includes(clsName) ||
      studentBatch.includes(clsName) ||
      studentBatch.includes(clsCode)
    );
  });

  const toggleSelectStudent = (id: string) => {
    const next = new Set(selectedStudentIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedStudentIds(next);
  };

  const handleSelectAllCandidates = () => {
    const allFilteredIds = candidateStudents.map((s) => s.id);
    setSelectedStudentIds(new Set(allFilteredIds));
  };

  const handleClearCandidateSelection = () => {
    setSelectedStudentIds(new Set());
  };

  const handleSelectMatchingCandidates = () => {
    const matchingIds = matchingCandidates.map((s) => s.id);
    setSelectedStudentIds(new Set(matchingIds));
  };

  const handleEnrollSelected = async () => {
    if (selectedStudentIds.size === 0) return;
    try {
      setIsEnrolling(true);
      const ids = Array.from(selectedStudentIds);
      await ApiService.enrollStudentsInClass(classObj.id, ids);
      toast.success(
        'Students Enrolled',
        `Successfully added ${ids.length} student(s) to ${classObj.code} (${classObj.name}).`
      );
      setSelectedStudentIds(new Set());
      setIsEnrollMode(false);
      await loadRoster();
      onRosterUpdated();
    } catch (err: any) {
      toast.error('Enrollment Failed', err.message);
    } finally {
      setIsEnrolling(false);
    }
  };

  // 1-Click Auto-Repair / Auto-Enroll for matching registered students
  const handleAutoEnrollMatching = async () => {
    if (matchingCandidates.length === 0) return;
    try {
      setIsRepairing(true);
      const ids = matchingCandidates.map((s) => s.id);
      await ApiService.enrollStudentsInClass(classObj.id, ids);
      toast.success(
        'Auto-Enrollment Complete',
        `Enrolled ${ids.length} matching student(s) into ${classObj.name}.`
      );
      await loadRoster();
      onRosterUpdated();
    } catch (err: any) {
      toast.error('Auto-Enrollment Failed', err.message);
    } finally {
      setIsRepairing(false);
    }
  };

  const handleRemoveStudent = async (student: Student) => {
    if (!confirm(`Are you sure you want to remove ${student.full_name} (${student.roll_number}) from ${classObj.name}?`)) {
      return;
    }
    try {
      await ApiService.removeStudentFromClass(classObj.id, student.id);
      toast.info(
        'Student Removed',
        `${student.full_name} (${student.roll_number}) removed from ${classObj.code}.`
      );
      await loadRoster();
      onRosterUpdated();
    } catch (err: any) {
      toast.error('Failed to remove student', err.message);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-3xl w-full border border-slate-100 overflow-hidden my-8">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                {classObj.code} - Sec {classObj.section}
              </span>
              <h2 className="text-lg font-bold text-slate-900">{classObj.name}</h2>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Class Roster &bull; {enrolledStudents.length} Students Currently Enrolled &bull; Academic Year: {classObj.academic_year}
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {/* Load Error State */}
          {loadError ? (
            <div className="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-rose-600 mx-auto" />
              <div>
                <h4 className="text-sm font-bold text-rose-900">Failed to Load Class Roster</h4>
                <p className="text-xs text-rose-700 mt-1">{loadError}</p>
              </div>
              <button
                type="button"
                onClick={loadRoster}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold rounded-xl transition shadow-sm inline-flex items-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Retry Query
              </button>
            </div>
          ) : !isEnrollMode ? (
            /* View Roster Mode */
            <div className="space-y-4">
              {/* Automatic Section Notice Banner */}
              {classObj.enrollment_type !== 'manual' && (
                <div className="p-4 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-start gap-3 shadow-xs">
                  <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="text-xs text-emerald-950">
                    <p className="font-bold">
                      Automatic Section Roster: All active students in {classObj.section_details?.programme || classObj.programme || classObj.name} &bull; Batch {classObj.section_details?.batch || classObj.batch || '2024-2028'} &bull; Section {classObj.section} are automatically included.
                    </p>
                    <p className="text-[11px] text-emerald-800 mt-0.5">
                      To add students to this class, register them in Student Management under Section {classObj.section}.
                    </p>
                  </div>
                </div>
              )}

              {/* Recommended Auto-Repair Banner if matching candidates exist in directory */}
              {matchingCandidates.length > 0 && (
                <div className="p-3.5 bg-gradient-to-r from-brand-50 to-indigo-50 border border-brand-200 rounded-2xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-xs">
                  <div className="flex items-center gap-2.5">
                    <Sparkles className="w-4 h-4 text-brand-600 shrink-0" />
                    <div>
                      <p className="text-xs font-bold text-brand-900">
                        {matchingCandidates.length} Matching Student(s) Found in Directory
                      </p>
                      <p className="text-[11px] text-brand-700">
                        Registered students with course/programme matching "{classObj.name}" can be enrolled automatically.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleAutoEnrollMatching}
                    disabled={isRepairing}
                    className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-bold rounded-xl transition shadow-sm flex items-center gap-1.5 shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isRepairing ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                    Auto-Enroll All {matchingCandidates.length} Students
                  </button>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={enrolledSearch}
                    onChange={(e) => setEnrolledSearch(e.target.value)}
                    placeholder="Search enrolled students by name, roll number, course, batch..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>

                <button
                  type="button"
                  onClick={() => setIsEnrollMode(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-sm flex items-center gap-1.5 cursor-pointer shrink-0"
                >
                  <UserPlus className="w-4 h-4" />
                  {classObj.enrollment_type === 'manual' ? 'Enroll Students' : 'Add Cross-Section Student'}
                </button>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-slate-400">
                  <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs font-medium">Loading roster from database...</p>
                </div>
              ) : filteredEnrolled.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 space-y-3">
                  <Users className="w-10 h-10 text-slate-300 mx-auto" />
                  <div>
                    <p className="text-xs font-bold text-slate-700">No students currently enrolled</p>
                    <p className="text-[11px] text-slate-400 max-w-sm mx-auto mt-1 leading-relaxed">
                      {candidateStudents.length > 0
                        ? `You have ${candidateStudents.length} registered students in your institution directory available to enroll in this class.`
                        : 'No registered students found in your directory. Register students under the Students tab first.'}
                    </p>
                  </div>
                  {candidateStudents.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsEnrollMode(true)}
                      className="mt-1 px-4 py-2 text-xs font-bold text-brand-600 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 transition shadow-xs cursor-pointer inline-flex items-center gap-1.5"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      Enroll Students Now ({candidateStudents.length} Available)
                    </button>
                  )}
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                  {filteredEnrolled.map((student) => {
                    const has128dVector =
                      student.face_descriptor &&
                      Array.isArray(student.face_descriptor) &&
                      student.face_descriptor.length === 128;

                    return (
                      <div
                        key={student.id}
                        className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/70 px-2 rounded-xl transition"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Student Profile Picture */}
                          <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                            {student.photo_url || student.photo_path ? (
                              <img
                                src={student.photo_url || student.photo_path}
                                alt={student.full_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-bold text-xs text-brand-700 bg-brand-50">
                                {student.full_name.charAt(0)}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-bold text-slate-900 truncate">{student.full_name}</p>
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.5 rounded font-semibold">
                                {student.roll_number}
                              </span>
                              {(classObj.section_id && student.section_id === classObj.section_id) ||
                              (student.section && student.section.replace(/section\s*/i, '').trim().toUpperCase() === classObj.section.trim().toUpperCase()) ? (
                                <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.5 rounded">
                                  Section Cohort
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.5 rounded">
                                  Cross-Section / Elective
                                </span>
                              )}
                              <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded border ${
                                student.is_active ? 'text-slate-700 bg-slate-100 border-slate-200' : 'text-rose-700 bg-rose-50 border-rose-200'
                              }`}>
                                {student.is_active ? 'Active' : 'Inactive'}
                              </span>
                            </div>

                            <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5 truncate">
                              <span className="font-medium text-slate-700 truncate">{student.course}</span>
                              {student.batch && <span>&bull; {student.batch}</span>}
                              {student.section && <span>&bull; {student.section}</span>}
                              {student.academic_year && <span>&bull; {student.academic_year}</span>}
                            </div>

                            {/* Biometrics Status Indicator */}
                            <div className="mt-1 flex items-center gap-2">
                              {has128dVector ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-emerald-700 font-medium">
                                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                                  128-d Biometrics Enrolled
                                </span>
                              ) : student.photo_path || student.photo_url ? (
                                <span className="inline-flex items-center gap-1 text-[10px] text-amber-700 font-medium">
                                  <AlertCircle className="w-3 h-3 text-amber-600" />
                                  Photo Registered (Embedding Pending)
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">
                                  No Profile Photo
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRemoveStudent(student)}
                          className="p-2 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-xl transition cursor-pointer shrink-0"
                          title="Remove student from class"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Enroll Candidates Picker Mode */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Select Students to Enroll in {classObj.code}
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Showing {candidateStudents.length} registered students in your institution not currently in this class.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => setIsEnrollMode(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition cursor-pointer"
                >
                  Back to Roster
                </button>
              </div>

              {/* Convenience selection controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-xs">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSelectAllCandidates}
                    className="text-xs text-brand-600 hover:text-brand-700 font-semibold cursor-pointer"
                  >
                    Select All ({candidateStudents.length})
                  </button>
                  {matchingCandidates.length > 0 && (
                    <>
                      <span className="text-slate-300">&bull;</span>
                      <button
                        type="button"
                        onClick={handleSelectMatchingCandidates}
                        className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold flex items-center gap-1 cursor-pointer"
                      >
                        <Sparkles className="w-3 h-3" />
                        Select Matching Course ({matchingCandidates.length})
                      </button>
                    </>
                  )}
                  {selectedStudentIds.size > 0 && (
                    <>
                      <span className="text-slate-300">&bull;</span>
                      <button
                        type="button"
                        onClick={handleClearCandidateSelection}
                        className="text-xs text-slate-500 hover:text-slate-700 cursor-pointer"
                      >
                        Clear Selection
                      </button>
                    </>
                  )}
                </div>

                <span className="font-semibold text-slate-700 text-xs">
                  {selectedStudentIds.size} student(s) selected
                </span>
              </div>

              {/* Candidate Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Filter available students by name, roll number, course, batch..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>

              {/* Candidates list */}
              {candidateStudents.length === 0 ? (
                <div className="p-6 text-center bg-slate-50 rounded-2xl text-slate-400 text-xs">
                  {candidateSearch
                    ? 'No matching unenrolled students found.'
                    : 'All registered active students are already enrolled in this class!'}
                </div>
              ) : (
                <div className="max-h-80 overflow-y-auto space-y-1.5 divide-y divide-slate-100 pr-1">
                  {candidateStudents.map((student) => {
                    const isSelected = selectedStudentIds.has(student.id);
                    const isMatchingCourse = matchingCandidates.some((m) => m.id === student.id);
                    const has128dVector =
                      student.face_descriptor &&
                      Array.isArray(student.face_descriptor) &&
                      student.face_descriptor.length === 128;

                    return (
                      <div
                        key={student.id}
                        onClick={() => toggleSelectStudent(student.id)}
                        className={`pt-2.5 pb-2.5 px-3 rounded-xl flex items-center justify-between cursor-pointer transition border ${
                          isSelected
                            ? 'bg-brand-50/70 border-brand-300 ring-1 ring-brand-400/40'
                            : 'hover:bg-slate-50 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectStudent(student.id)}
                            className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500 cursor-pointer"
                          />

                          <div className="w-9 h-9 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                            {student.photo_url || student.photo_path ? (
                              <img
                                src={student.photo_url || student.photo_path}
                                alt={student.full_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-bold text-xs text-brand-700 bg-brand-50">
                                {student.full_name.charAt(0)}
                              </div>
                            )}
                          </div>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-xs font-bold text-slate-900 truncate">{student.full_name}</p>
                              <span className="font-mono text-[10px] bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-semibold">
                                {student.roll_number}
                              </span>
                              {isMatchingCourse && (
                                <span className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-200 px-1.5 py-0.2 rounded">
                                  <Sparkles className="w-2.5 h-2.5" />
                                  Course Match
                                </span>
                              )}
                            </div>

                            <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                              {student.course} {student.batch ? `(${student.batch})` : ''} {student.section ? `• Sec ${student.section}` : ''}
                            </p>

                            <div className="mt-0.5 flex items-center gap-2">
                              {has128dVector ? (
                                <span className="text-[10px] text-emerald-700 font-medium">
                                  ✓ Biometrics Ready
                                </span>
                              ) : (
                                <span className="text-[10px] text-slate-400">
                                  {student.photo_path ? 'Photo attached' : 'No photo'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded shrink-0">
                          {student.academic_year || 'Year N/A'}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action buttons */}
              <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs text-slate-500 font-medium">
                  {selectedStudentIds.size} student(s) selected
                </span>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsEnrollMode(false)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
                  >
                    Cancel
                  </button>

                  <button
                    type="button"
                    onClick={handleEnrollSelected}
                    disabled={selectedStudentIds.size === 0 || isEnrolling}
                    className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition flex items-center gap-1.5 shadow-sm disabled:opacity-50 cursor-pointer"
                  >
                    {isEnrolling ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Enrolling...
                      </>
                    ) : (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        Enroll Selected ({selectedStudentIds.size})
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
