import React, { useState, useEffect } from 'react';
import {
  X,
  UserPlus,
  Trash2,
  Search,
  CheckCircle2,
  Users,
  RefreshCw,
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

  // Search enrolled
  const [enrolledSearch, setEnrolledSearch] = useState('');

  // Enroll new students drawer/mode
  const [isEnrollMode, setIsEnrollMode] = useState(false);
  const [candidateSearch, setCandidateSearch] = useState('');
  const [selectedStudentIds, setSelectedStudentIds] = useState<Set<string>>(new Set());
  const [isEnrolling, setIsEnrolling] = useState(false);

  const toast = useToast();

  const loadRoster = async () => {
    if (!classObj) return;
    try {
      setIsLoading(true);
      const [roster, directory] = await Promise.all([
        ApiService.getClassEnrollments(classObj.id),
        ApiService.getStudents({ is_active: true }),
      ]);
      setEnrolledStudents(roster);
      setAllStudents(directory);
    } catch (err: any) {
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
  const filteredEnrolled = enrolledStudents.filter(
    (s) =>
      s.full_name.toLowerCase().includes(enrolledSearch.toLowerCase()) ||
      s.roll_number.toLowerCase().includes(enrolledSearch.toLowerCase())
  );

  // Available students for enrollment (active and not already enrolled)
  const enrolledIds = new Set(enrolledStudents.map((s) => s.id));
  const candidateStudents = allStudents.filter(
    (s) =>
      !enrolledIds.has(s.id) &&
      (candidateSearch.trim() === '' ||
        s.full_name.toLowerCase().includes(candidateSearch.toLowerCase()) ||
        s.roll_number.toLowerCase().includes(candidateSearch.toLowerCase()))
  );

  const toggleSelectStudent = (id: string) => {
    const next = new Set(selectedStudentIds);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelectedStudentIds(next);
  };

  const handleEnrollSelected = async () => {
    if (selectedStudentIds.size === 0) return;
    try {
      setIsEnrolling(true);
      const ids = Array.from(selectedStudentIds);
      await ApiService.enrollStudentsInClass(classObj.id, ids);
      toast.success(
        'Students Enrolled',
        `Successfully added ${ids.length} student(s) to ${classObj.code}.`
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

  const handleRemoveStudent = async (student: Student) => {
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
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-100 overflow-hidden my-8">
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
              Class Roster &bull; {enrolledStudents.length} Students Currently Enrolled
            </p>
          </div>

          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6">
          {!isEnrollMode ? (
            /* View Roster Mode */
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={enrolledSearch}
                    onChange={(e) => setEnrolledSearch(e.target.value)}
                    placeholder="Search enrolled students..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                  />
                </div>

                <button
                  onClick={() => setIsEnrollMode(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-sm flex items-center gap-1.5"
                >
                  <UserPlus className="w-4 h-4" />
                  Enroll Students
                </button>
              </div>

              {isLoading ? (
                <div className="p-8 text-center text-slate-400">
                  <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
                  <p className="text-xs">Loading roster...</p>
                </div>
              ) : filteredEnrolled.length === 0 ? (
                <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-100 space-y-2">
                  <Users className="w-8 h-8 text-slate-300 mx-auto" />
                  <p className="text-xs font-semibold text-slate-700">No students enrolled</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Add registered students from your institution directory to conduct attendance for this class.
                  </p>
                  <button
                    onClick={() => setIsEnrollMode(true)}
                    className="mt-2 px-3 py-1.5 text-xs font-semibold text-brand-600 bg-white border border-brand-200 rounded-xl hover:bg-brand-50 transition"
                  >
                    Add Students Now
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
                  {filteredEnrolled.map((student) => (
                    <div
                      key={student.id}
                      className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 px-2 rounded-xl transition"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0">
                          {student.photo_url ? (
                            <img
                              src={student.photo_url}
                              alt={student.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center font-bold text-xs text-brand-700 bg-brand-50">
                              {student.full_name.charAt(0)}
                            </div>
                          )}
                        </div>

                        <div>
                          <p className="text-xs font-bold text-slate-900">{student.full_name}</p>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span className="font-mono">{student.roll_number}</span>
                            <span>&bull;</span>
                            <span>{student.section}</span>
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveStudent(student)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition"
                        title="Remove from class"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            /* Enroll Candidates Picker Mode */
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Select Students to Enroll
                  </h3>
                  <p className="text-[11px] text-slate-500">
                    Showing available registered students not currently in this class.
                  </p>
                </div>

                <button
                  onClick={() => setIsEnrollMode(false)}
                  className="text-xs font-semibold text-slate-500 hover:text-slate-800 px-2.5 py-1 rounded-lg hover:bg-slate-100 transition"
                >
                  Back to Roster
                </button>
              </div>

              {/* Candidate Search */}
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={candidateSearch}
                  onChange={(e) => setCandidateSearch(e.target.value)}
                  placeholder="Filter available students by name or roll number..."
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

                    return (
                      <div
                        key={student.id}
                        onClick={() => toggleSelectStudent(student.id)}
                        className={`pt-2 pb-2 px-3 rounded-xl flex items-center justify-between cursor-pointer transition border ${
                          isSelected
                            ? 'bg-brand-50/60 border-brand-200'
                            : 'hover:bg-slate-50 border-transparent'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectStudent(student.id)}
                            className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
                          />

                          <div className="w-8 h-8 rounded-lg overflow-hidden bg-slate-100 shrink-0">
                            {student.photo_url ? (
                              <img
                                src={student.photo_url}
                                alt={student.full_name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <div className="w-full h-full flex items-center justify-center font-bold text-xs text-brand-700 bg-brand-50">
                                {student.full_name.charAt(0)}
                              </div>
                            )}
                          </div>

                          <div>
                            <p className="text-xs font-bold text-slate-900">{student.full_name}</p>
                            <p className="text-[10px] text-slate-500 font-mono">
                              {student.roll_number} &bull; {student.course} ({student.section})
                            </p>
                          </div>
                        </div>

                        <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                          {student.academic_year}
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
                    onClick={() => setIsEnrollMode(false)}
                    className="px-3.5 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
                  >
                    Cancel
                  </button>

                  <button
                    onClick={handleEnrollSelected}
                    disabled={selectedStudentIds.size === 0 || isEnrolling}
                    className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                  >
                    {isEnrolling ? (
                      <>
                        <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                        Enrolling...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
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
