import React, { useState, useEffect } from 'react';
import {
  CalendarCheck,
  Plus,
  Calendar,
  Clock,
  ArrowRight,
} from 'lucide-react';
import type { AttendanceSession, ClassCourse } from '../../types';
import { ApiService } from '../../services/api';
import { SessionFormModal } from './SessionFormModal';
import { SessionAttendanceSheet } from './SessionAttendanceSheet';
import { useToast } from '../common/ToastContext';

interface SessionListProps {
  initialClassId?: string;
}

export const SessionList: React.FC<SessionListProps> = ({ initialClassId }) => {
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [classes, setClasses] = useState<ClassCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [selectedClassId, setSelectedClassId] = useState<string>(initialClassId || 'ALL');
  const [selectedDate, setSelectedDate] = useState<string>('');
  const [selectedStatus, setSelectedStatus] = useState<string>('ALL');

  // Active Session Sheet Mode
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  // Modal
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const toast = useToast();

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [sessionList, classList] = await Promise.all([
        ApiService.getAttendanceSessions(),
        ApiService.getClasses(),
      ]);
      setSessions(sessionList);
      setClasses(classList);
    } catch (err: any) {
      toast.error('Failed to load sessions', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleCreateSession = async (data: {
    class_id: string;
    title: string;
    session_date: string;
    start_time: string;
    end_time: string;
  }) => {
    const created = await ApiService.createAttendanceSession(data);
    toast.success('Session Created', `${created.title} is ready for attendance.`);
    await loadData();
    setActiveSessionId(created.id);
  };

  // If a session is actively opened in attendance sheet mode
  if (activeSessionId) {
    return (
      <SessionAttendanceSheet
        sessionId={activeSessionId}
        onBack={() => setActiveSessionId(null)}
        onSessionUpdated={loadData}
      />
    );
  }

  const filteredSessions = sessions.filter((s) => {
    if (selectedClassId !== 'ALL' && s.class_id !== selectedClassId) return false;
    if (selectedDate && s.session_date !== selectedDate) return false;
    if (selectedStatus !== 'ALL' && s.status !== selectedStatus) return false;
    return true;
  });

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <CalendarCheck className="w-6 h-6 text-brand-600" />
            Attendance Lecture Sessions
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Conduct live attendance rolls, inspect past session logs, and finalize records.
          </p>
        </div>

        <button
          onClick={() => setIsCreateModalOpen(true)}
          className="px-4 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create Attendance Session
        </button>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Filter by Class
          </label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="ALL">All Classes & Courses</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name} ({cls.code})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Lecture Date
          </label>
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
            Session Status
          </label>
          <div className="flex items-center gap-2">
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="flex-1 px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">All Statuses</option>
              <option value="active">Active Sessions</option>
              <option value="finalized">Finalized Records</option>
              <option value="scheduled">Scheduled</option>
            </select>

            {(selectedClassId !== 'ALL' || selectedDate || selectedStatus !== 'ALL') && (
              <button
                onClick={() => {
                  setSelectedClassId('ALL');
                  setSelectedDate('');
                  setSelectedStatus('ALL');
                }}
                className="px-2.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Sessions List Cards */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-500">
          <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-medium">Loading attendance sessions...</p>
        </div>
      ) : filteredSessions.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-sm space-y-4">
          <CalendarCheck className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">No attendance sessions found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              {selectedDate || selectedClassId !== 'ALL'
                ? 'No sessions match your applied filters.'
                : 'Create an attendance session for any of your active classes to record attendance.'}
            </p>
          </div>
          <button
            onClick={() => setIsCreateModalOpen(true)}
            className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create Session
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredSessions.map((session) => {
            const isFinalized = session.status === 'finalized';
            const stats = session.stats || { present: 0, absent: 0, late: 0, unmarked: 0, total: 0 };

            return (
              <div
                key={session.id}
                onClick={() => setActiveSessionId(session.id)}
                className="bg-white rounded-2xl border border-slate-200/80 p-5 hover:border-brand-300 hover:shadow-md transition cursor-pointer flex flex-col md:flex-row items-start md:items-center justify-between gap-4 group"
              >
                {/* Left meta */}
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-brand-50 text-brand-700 border border-brand-200">
                      {session.class_code || 'CLASS'}
                    </span>

                    <span
                      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                        isFinalized
                          ? 'bg-slate-100 text-slate-700 border-slate-300'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          isFinalized ? 'bg-slate-500' : 'bg-emerald-500 animate-pulse'
                        }`}
                      />
                      {isFinalized ? 'Finalized' : 'Active'}
                    </span>

                    <span className="text-xs text-slate-500 truncate">{session.class_name}</span>
                  </div>

                  <h3 className="text-base font-bold text-slate-900 group-hover:text-brand-600 transition truncate">
                    {session.title}
                  </h3>

                  <div className="flex items-center gap-3 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{session.session_date}</span>
                    </div>
                    <span>&bull;</span>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3.5 h-3.5 text-slate-400" />
                      <span>
                        {session.start_time} - {session.end_time}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Right stats & action */}
                <div className="flex flex-wrap items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                  {/* Attendance Stats Pills */}
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-50 text-emerald-700 font-bold border border-emerald-200">
                      {stats.present} Present
                    </span>
                    <span className="px-2.5 py-1 rounded-lg bg-rose-50 text-rose-700 font-bold border border-rose-200">
                      {stats.absent} Absent
                    </span>
                    {stats.total > 0 && (
                      <span className="px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 font-bold border border-indigo-200">
                        {Math.round((stats.present / stats.total) * 100)}% Rate
                      </span>
                    )}
                  </div>

                  <button className="px-3.5 py-2 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-xl transition flex items-center gap-1 border border-brand-200 shrink-0">
                    Open Roll
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <SessionFormModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        classes={classes.filter((c) => c.is_active)}
        onSubmit={handleCreateSession}
      />
    </div>
  );
};
