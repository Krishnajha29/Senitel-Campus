import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, CheckCircle2, AlertCircle } from 'lucide-react';
import type { ClassCourse } from '../../types';

interface SessionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  classes: ClassCourse[];
  defaultClassId?: string;
  onSubmit: (data: {
    class_id: string;
    title: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }) => Promise<void>;
}

export const SessionFormModal: React.FC<SessionFormModalProps> = ({
  isOpen,
  onClose,
  classes,
  defaultClassId,
  onSubmit,
}) => {
  const [classId, setClassId] = useState(defaultClassId || (classes[0]?.id ?? ''));
  const [title, setTitle] = useState('');
  const [sessionDate, setSessionDate] = useState(new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('10:30');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (defaultClassId) {
      setClassId(defaultClassId);
    } else if (classes.length > 0 && !classId) {
      setClassId(classes[0].id);
    }
  }, [defaultClassId, classes]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!classId) {
      setErrorMessage('Please select a class for this attendance session.');
      return;
    }
    if (!title.trim()) {
      setErrorMessage('Session title or topic is required.');
      return;
    }
    if (!sessionDate) {
      setErrorMessage('Lecture date is required.');
      return;
    }
    if (!startTime || !endTime) {
      setErrorMessage('Start and end time are required.');
      return;
    }

    try {
      setIsSubmitting(true);
      await onSubmit({
        class_id: classId,
        title: title.trim(),
        session_date: sessionDate,
        start_time: startTime,
        end_time: endTime,
      });
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to create attendance session.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-lg w-full border border-slate-100 overflow-hidden">
        {/* Header */}
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
          <div>
            <h2 className="text-xl font-bold text-slate-900">Create Attendance Session</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Launch a lecture session and initialize the attendance roll
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

        {errorMessage && (
          <div className="mx-6 mt-5 p-4 rounded-2xl bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
            <p className="text-xs font-semibold">{errorMessage}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Select Class / Course <span className="text-rose-500">*</span>
            </label>
            <select
              required
              value={classId}
              onChange={(e) => setClassId(e.target.value)}
              disabled={isSubmitting || classes.length === 0}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              {classes.length === 0 ? (
                <option value="">No classes available. Create a class first.</option>
              ) : (
                classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>
                    {cls.name} ({cls.code} - Sec {cls.section})
                  </option>
                ))
              )}
            </select>
          </div>

          {(() => {
            const selectedClass = classes.find((c) => c.id === classId);
            if (!selectedClass) return null;
            return (
              <div className="p-3.5 bg-slate-50 border border-slate-200/80 rounded-2xl space-y-1.5 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-800">
                    Section {selectedClass.section} Cohort Details
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    {selectedClass.enrolled_count ?? 0} Eligible Students
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-600">
                  <div>
                    <span className="text-slate-400">Programme: </span>
                    <span className="font-medium text-slate-800">{selectedClass.section_details?.programme || selectedClass.programme || 'Core Curriculum'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Batch: </span>
                    <span className="font-medium text-slate-800">Batch {selectedClass.section_details?.batch || selectedClass.batch || '2024-2028'}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Academic Year: </span>
                    <span className="font-medium text-slate-800">{selectedClass.academic_year}</span>
                  </div>
                  <div>
                    <span className="text-slate-400">Section: </span>
                    <span className="font-bold text-brand-700">Section {selectedClass.section}</span>
                  </div>
                </div>
                <p className="text-[10px] text-slate-500 pt-1 border-t border-slate-200/60">
                  {selectedClass.enrolled_count ?? 0} active students in Section {selectedClass.section} will be automatically initialized in this session roster.
                </p>
              </div>
            );
          })()}

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Lecture Title / Topic <span className="text-rose-500">*</span>
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lecture 12: Binary Search Trees"
              disabled={isSubmitting}
              className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">
              Lecture Date <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <Calendar className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="date"
                required
                value={sessionDate}
                onChange={(e) => setSessionDate(e.target.value)}
                disabled={isSubmitting}
                className="w-full pl-10 pr-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Start Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  required
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full pl-9 pr-2 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                End Time <span className="text-rose-500">*</span>
              </label>
              <div className="relative">
                <Clock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="time"
                  required
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  disabled={isSubmitting}
                  className="w-full pl-9 pr-2 py-2.5 bg-white border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || classes.length === 0}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2 disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              Create Session
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
