import React, { useState, useEffect } from 'react';
import { X, CheckCircle2, AlertCircle, RefreshCw, Users, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import type { ClassCourse, AcademicSection, Student } from '../../types';
import { ApiService } from '../../services/api';

interface ClassFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: Omit<ClassCourse, 'id' | 'instructor_id' | 'created_at' | 'updated_at' | 'enrolled_count'>) => Promise<void>;
  classToEdit?: ClassCourse | null;
}

export const ClassFormModal: React.FC<ClassFormModalProps> = ({
  isOpen,
  onClose,
  onSubmit,
  classToEdit,
}) => {
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [academicYear, setAcademicYear] = useState('2026-2027');
  const [section, setSection] = useState('A');
  const [programme, setProgramme] = useState('B.Tech Software Engineering');
  const [batch, setBatch] = useState('2024-2028');
  const [semester, setSemester] = useState('Semester 5');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [enrollmentType, setEnrollmentType] = useState<'section' | 'manual'>('section');
  const [selectedSectionId, setSelectedSectionId] = useState<string>('');

  // Sections and Live Roster Preview
  const [availableSections, setAvailableSections] = useState<AcademicSection[]>([]);
  const [rosterPreviewStudents, setRosterPreviewStudents] = useState<Student[]>([]);
  const [isLoadingSections, setIsLoadingSections] = useState(false);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [showRosterPreview, setShowRosterPreview] = useState(false);
  const [isCustomSection, setIsCustomSection] = useState(false);

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  // Load sections when modal opens
  useEffect(() => {
    if (isOpen) {
      setIsLoadingSections(true);
      ApiService.getSections()
        .then((secs) => {
          setAvailableSections(secs);
          if (!classToEdit && secs.length > 0) {
            const first = secs[0];
            setSelectedSectionId(first.id);
            setProgramme(first.programme);
            setBatch(first.batch);
            setAcademicYear(first.academic_year);
            setSection(first.section);
            if (first.semester) setSemester(first.semester);
          }
        })
        .catch((err) => console.error('Failed to load sections:', err))
        .finally(() => setIsLoadingSections(false));
    }
  }, [isOpen, classToEdit]);

  useEffect(() => {
    if (classToEdit) {
      setName(classToEdit.name);
      setCode(classToEdit.code);
      setAcademicYear(classToEdit.academic_year);
      setSection(classToEdit.section);
      setProgramme(classToEdit.programme || classToEdit.section_details?.programme || 'B.Tech Software Engineering');
      setBatch(classToEdit.batch || classToEdit.section_details?.batch || '2024-2028');
      setSemester(classToEdit.semester || classToEdit.section_details?.semester || 'Semester 5');
      setDescription(classToEdit.description || '');
      setIsActive(classToEdit.is_active);
      setEnrollmentType(classToEdit.enrollment_type || 'section');
      setSelectedSectionId(classToEdit.section_id || '');
      setIsCustomSection(!classToEdit.section_id);
    } else {
      setName('');
      setCode('');
      setDescription('');
      setIsActive(true);
      setEnrollmentType('section');
      setIsCustomSection(false);
    }
    setErrorMessage('');
    setShowRosterPreview(false);
  }, [classToEdit, isOpen]);

  // Update preview students when section details change
  useEffect(() => {
    if (!isOpen) return;

    let cancelled = false;
    const fetchPreview = async () => {
      setIsLoadingPreview(true);
      try {
        if (selectedSectionId && selectedSectionId !== 'custom') {
          const students = await ApiService.getSectionStudents(selectedSectionId);
          if (!cancelled) setRosterPreviewStudents(students);
        } else if (programme && section) {
          // If custom or no explicit id, query all active students matching cohort
          const allStudents = await ApiService.getStudents({ is_active: true });
          const matching = allStudents.filter((s) => {
            const sc = (s.course || '').trim().toLowerCase();
            const prog = programme.trim().toLowerCase();
            const sec = (s.section || '').replace(/section\s*/i, '').trim().toUpperCase();
            const targetSec = section.trim().toUpperCase();
            return (sc === prog || sc.includes(prog) || prog.includes(sc)) && (!targetSec || sec === targetSec);
          });
          if (!cancelled) setRosterPreviewStudents(matching);
        } else {
          if (!cancelled) setRosterPreviewStudents([]);
        }
      } catch (err) {
        console.error('Error fetching preview students:', err);
        if (!cancelled) setRosterPreviewStudents([]);
      } finally {
        if (!cancelled) setIsLoadingPreview(false);
      }
    };

    fetchPreview();
    return () => {
      cancelled = true;
    };
  }, [isOpen, selectedSectionId, programme, batch, section, academicYear]);

  const handleSectionSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'custom') {
      setIsCustomSection(true);
      setSelectedSectionId('');
    } else {
      setIsCustomSection(false);
      setSelectedSectionId(val);
      const matched = availableSections.find((s) => s.id === val);
      if (matched) {
        setProgramme(matched.programme);
        setBatch(matched.batch);
        setAcademicYear(matched.academic_year);
        setSection(matched.section);
        if (matched.semester) setSemester(matched.semester);
      }
    }
  };

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!name.trim()) {
      setErrorMessage('Class or course name is required.');
      return;
    }
    if (!code.trim()) {
      setErrorMessage('Course code is required (e.g. CS201).');
      return;
    }
    if (!section.trim()) {
      setErrorMessage('Section is required.');
      return;
    }
    if (!programme.trim()) {
      setErrorMessage('Academic Programme is required.');
      return;
    }
    if (!batch.trim()) {
      setErrorMessage('Batch cohort is required.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        name: name.trim(),
        code: code.trim().toUpperCase(),
        academic_year: academicYear.trim(),
        section: section.trim().toUpperCase(),
        description: description.trim() ? description.trim() : null,
        is_active: isActive,
        section_id: selectedSectionId || undefined,
        programme: programme.trim(),
        batch: batch.trim(),
        semester: semester.trim() || undefined,
        enrollment_type: enrollmentType,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to save class.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="bg-white rounded-3xl shadow-2xl max-w-xl w-full border border-slate-100 overflow-hidden my-6">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">
              {classToEdit ? 'Edit Class & Section' : 'Create New Class'}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Configure course details and institutional academic section mapping
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl transition cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error message */}
        {errorMessage && (
          <div className="mx-6 mt-5 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold">{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Basic Course Info */}
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="sm:col-span-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Course / Subject Title <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Circular Linked List"
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Course Code <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={code}
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  placeholder="e.g. CS202"
                  disabled={isSubmitting}
                  className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
                />
              </div>
            </div>
          </div>

          {/* Section Selection */}
          <div className="p-4 bg-slate-50/80 rounded-2xl border border-slate-200/80 space-y-3">
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

            {!isCustomSection && availableSections.length > 0 ? (
              <div>
                <select
                  value={selectedSectionId}
                  onChange={handleSectionSelect}
                  disabled={isSubmitting || isLoadingSections}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                >
                  {availableSections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.programme} &bull; Batch {s.batch} &bull; Sec {s.section} ({s.academic_year})
                    </option>
                  ))}
                  <option value="custom">+ Create New Custom Section...</option>
                </select>
              </div>
            ) : null}

            {/* Section Cohort Inputs */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1">
              <div className="col-span-2">
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Programme / Degree
                </label>
                <input
                  type="text"
                  required
                  value={programme}
                  onChange={(e) => setProgramme(e.target.value)}
                  placeholder="e.g. B.Tech Software Engineering"
                  disabled={isSubmitting || (!isCustomSection && availableSections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Batch Cohort
                </label>
                <input
                  type="text"
                  required
                  value={batch}
                  onChange={(e) => setBatch(e.target.value)}
                  placeholder="e.g. 2024-2028"
                  disabled={isSubmitting || (!isCustomSection && availableSections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Section
                </label>
                <input
                  type="text"
                  required
                  value={section}
                  onChange={(e) => setSection(e.target.value.toUpperCase())}
                  placeholder="e.g. A"
                  disabled={isSubmitting || (!isCustomSection && availableSections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs uppercase font-bold text-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Academic Year
                </label>
                <input
                  type="text"
                  required
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder="e.g. 2026-2027"
                  disabled={isSubmitting || (!isCustomSection && availableSections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-slate-600 mb-1">
                  Semester (Optional)
                </label>
                <input
                  type="text"
                  value={semester}
                  onChange={(e) => setSemester(e.target.value)}
                  placeholder="e.g. Semester 5"
                  disabled={isSubmitting || (!isCustomSection && availableSections.length > 0)}
                  className="w-full px-3 py-2 bg-white border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-slate-100 disabled:text-slate-600"
                />
              </div>
            </div>
          </div>

          {/* Enrollment Type Toggle */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700">
              Roster Enrollment Method
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <label
                className={`p-3 rounded-2xl border cursor-pointer transition flex items-start gap-2.5 ${
                  enrollmentType === 'section'
                    ? 'border-brand-500 bg-brand-50/50 text-brand-900 ring-1 ring-brand-500/30'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="enrollmentType"
                  value="section"
                  checked={enrollmentType === 'section'}
                  onChange={() => setEnrollmentType('section')}
                  className="mt-0.5 text-brand-600"
                />
                <div className="text-xs">
                  <span className="font-bold block">Automatic Section-based (Default)</span>
                  <span className="text-[11px] text-slate-500 leading-snug block mt-0.5">
                    Roster is populated automatically from active students in Section {section || 'A'}.
                  </span>
                </div>
              </label>

              <label
                className={`p-3 rounded-2xl border cursor-pointer transition flex items-start gap-2.5 ${
                  enrollmentType === 'manual'
                    ? 'border-brand-500 bg-brand-50/50 text-brand-900 ring-1 ring-brand-500/30'
                    : 'border-slate-200 bg-white hover:bg-slate-50 text-slate-700'
                }`}
              >
                <input
                  type="radio"
                  name="enrollmentType"
                  value="manual"
                  checked={enrollmentType === 'manual'}
                  onChange={() => setEnrollmentType('manual')}
                  className="mt-0.5 text-brand-600"
                />
                <div className="text-xs">
                  <span className="font-bold block">Elective / Cross-section</span>
                  <span className="text-[11px] text-slate-500 leading-snug block mt-0.5">
                    Allows custom manual enrollment for students across different cohorts.
                  </span>
                </div>
              </label>
            </div>
          </div>

          {/* Live Roster Preview Box */}
          {enrollmentType === 'section' && (
            <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-emerald-700" />
                  <span className="text-xs font-bold text-emerald-950">
                    Live Section Roster Preview
                  </span>
                </div>
                {rosterPreviewStudents.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowRosterPreview(!showRosterPreview)}
                    className="text-[11px] font-semibold text-emerald-800 hover:text-emerald-950 flex items-center gap-0.5 cursor-pointer"
                  >
                    {showRosterPreview ? 'Hide List' : 'View Students'}
                    {showRosterPreview ? (
                      <ChevronUp className="w-3.5 h-3.5" />
                    ) : (
                      <ChevronDown className="w-3.5 h-3.5" />
                    )}
                  </button>
                )}
              </div>

              <p className="text-xs text-emerald-800 mt-1 leading-relaxed">
                {isLoadingPreview ? (
                  <span className="flex items-center gap-1.5">
                    <RefreshCw className="w-3 h-3 animate-spin text-emerald-600" />
                    Calculating section roster...
                  </span>
                ) : (
                  <>
                    <strong className="font-bold">{rosterPreviewStudents.length} active students</strong> in{' '}
                    <span className="font-semibold">{programme}</span> &bull; Section{' '}
                    <span className="font-bold">{section || 'A'}</span> will be automatically included in this class roster.
                  </>
                )}
              </p>

              {showRosterPreview && rosterPreviewStudents.length > 0 && (
                <div className="mt-3 max-h-36 overflow-y-auto divide-y divide-emerald-100 bg-white/80 rounded-xl border border-emerald-200/80 p-2">
                  {rosterPreviewStudents.map((s) => (
                    <div key={s.id} className="py-1.5 px-2 flex items-center justify-between text-[11px]">
                      <span className="font-semibold text-slate-800">{s.full_name}</span>
                      <span className="font-mono text-[10px] text-slate-500 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                        {s.roll_number}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Description <span className="text-slate-400 font-normal">(Optional)</span>
            </label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Syllabus outline, lecture hall, or batch notes..."
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
            />
          </div>

          <div className="pt-1">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
                disabled={isSubmitting}
                className="w-4 h-4 text-brand-600 rounded border-slate-300 focus:ring-brand-500"
              />
              <span className="text-xs font-semibold text-slate-800">
                Active Course Status
              </span>
            </label>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2 cursor-pointer"
            >
              {isSubmitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  {classToEdit ? 'Save Changes' : 'Create Class'}
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
