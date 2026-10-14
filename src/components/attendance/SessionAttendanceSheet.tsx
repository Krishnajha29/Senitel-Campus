import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft,
  Save,
  Lock,
  Unlock,
  History,
  Search,
  Users,
  RefreshCw,
  KeyRound,
  Camera,
  CheckCircle2,
  XCircle,
  Undo2,
  AlertTriangle,
  Sparkles,
  ArrowUpDown,
  Calendar,
  Clock,
  BookOpen,
} from 'lucide-react';
import type {
  AttendanceSession,
  AttendanceRecord,
  AttendanceStatus,
  Student,
  Instructor,
} from '../../types';
import { ApiService } from '../../services/api';
import { AttendanceAuditModal } from './AttendanceAuditModal';
import { PresenceKeyPanel } from './PresenceKeyPanel';
import { FaceAttendanceModal } from './FaceAttendanceModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { useToast } from '../common/ToastContext';

interface SessionAttendanceSheetProps {
  sessionId: string;
  onBack: () => void;
  onSessionUpdated: () => void;
}

export const SessionAttendanceSheet: React.FC<SessionAttendanceSheetProps> = ({
  sessionId,
  onBack,
  onSessionUpdated,
}) => {
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [rows, setRows] = useState<{ student: Student; record: AttendanceRecord | null }[]>([]);
  const [statusMap, setStatusMap] = useState<Record<string, AttendanceStatus>>({});
  const [notesMap, setNotesMap] = useState<Record<string, string>>({});

  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'present' | 'absent' | 'unmarked'>('all');
  const [sortBy, setSortBy] = useState<'name_asc' | 'name_desc' | 'roll_asc' | 'roll_desc'>('name_asc');
  const [sheetView, setSheetView] = useState<'roll' | 'presence_key'>('roll');

  // History stack for undo recovery mechanism
  const [historyStack, setHistoryStack] = useState<Array<Record<string, AttendanceStatus>>>([]);

  // Modals
  const [isFaceModalOpen, setIsFaceModalOpen] = useState(false);
  const [isAuditModalOpen, setIsAuditModalOpen] = useState(false);
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isMarkAllPresentModalOpen, setIsMarkAllPresentModalOpen] = useState(false);
  const [isUnselectedWarningOpen, setIsUnselectedWarningOpen] = useState(false);

  const toast = useToast();

  const loadSessionData = async () => {
    try {
      setIsLoading(true);
      const [sessionData, attendanceData, currentInstructor] = await Promise.all([
        ApiService.getSessionById(sessionId),
        ApiService.getSessionAttendance(sessionId),
        ApiService.getCurrentInstructor(),
      ]);

      if (!sessionData) {
        toast.error('Session Not Found');
        onBack();
        return;
      }

      setSession(sessionData);
      setInstructor(currentInstructor);
      setRows(attendanceData);

      const sMap: Record<string, AttendanceStatus> = {};
      const nMap: Record<string, string> = {};

      attendanceData.forEach(({ student, record }) => {
        // Normalize: only present or absent are active selections; legacy unmarked remain unselected
        sMap[student.id] = record?.status === 'present' || record?.status === 'absent'
          ? record.status
          : 'unmarked';
        nMap[student.id] = record?.notes || '';
      });

      setStatusMap(sMap);
      setNotesMap(nMap);
      setHistoryStack([]);
      setHasUnsavedChanges(false);
    } catch (err: any) {
      toast.error('Error loading attendance', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadSessionData();
  }, [sessionId]);

  // Update status with undo stack tracking
  const handleStatusChange = (studentId: string, status: 'present' | 'absent') => {
    setHistoryStack((prev) => [...prev.slice(-20), { ...statusMap }]);
    setStatusMap((prev) => ({ ...prev, [studentId]: status }));
    setHasUnsavedChanges(true);
  };

  const handleNotesChange = (studentId: string, notes: string) => {
    setNotesMap((prev) => ({ ...prev, [studentId]: notes }));
    setHasUnsavedChanges(true);
  };

  // Safe undo recovery action
  const handleUndo = () => {
    if (historyStack.length === 0) return;
    const previous = historyStack[historyStack.length - 1];
    setStatusMap(previous);
    setHistoryStack((prev) => prev.slice(0, -1));
    setHasUnsavedChanges(true);
    toast.info('Reverted Last Attendance Change');
  };

  // Bulk: Mark All Present
  const handleConfirmMarkAllPresent = () => {
    setHistoryStack((prev) => [...prev.slice(-20), { ...statusMap }]);
    const next: Record<string, AttendanceStatus> = { ...statusMap };
    rows.forEach(({ student }) => {
      next[student.id] = 'present';
    });
    setStatusMap(next);
    setHasUnsavedChanges(true);
    setIsMarkAllPresentModalOpen(false);
    toast.success('Marked All Students as Present', 'Click "Save Changes" to persist.');
  };

  // Clear search and filter
  const handleClearFilters = () => {
    setSearchQuery('');
    setStatusFilter('all');
  };

  // Save changes
  const handleSaveAttendance = async () => {
    try {
      setIsSaving(true);
      const updates = rows.map(({ student }) => ({
        student_id: student.id,
        status: statusMap[student.id] || 'unmarked',
        notes: notesMap[student.id] || undefined,
      }));

      await ApiService.saveAttendanceRecords(sessionId, updates);
      setHasUnsavedChanges(false);
      setHistoryStack([]);
      toast.success('Attendance Saved', 'All records have been recorded successfully.');
      await loadSessionData();
      onSessionUpdated();
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  // Finalize Session click handler with strict unselected validation
  const handleFinalizeClick = () => {
    const unselectedCount = rows.filter(({ student }) => {
      const st = statusMap[student.id];
      return st !== 'present' && st !== 'absent';
    }).length;

    if (unselectedCount > 0) {
      setIsUnselectedWarningOpen(true);
      return;
    }

    setIsFinalizeModalOpen(true);
  };

  // Mark all unselected students as absent and proceed to finalize
  const handleMarkRemainingAbsentAndFinalize = async () => {
    setIsUnselectedWarningOpen(false);
    const next: Record<string, AttendanceStatus> = { ...statusMap };
    rows.forEach(({ student }) => {
      if (next[student.id] !== 'present') {
        next[student.id] = 'absent';
      }
    });
    setStatusMap(next);

    try {
      setIsFinalizing(true);
      const updates = rows.map(({ student }) => ({
        student_id: student.id,
        status: next[student.id],
        notes: notesMap[student.id] || undefined,
      }));
      await ApiService.saveAttendanceRecords(sessionId, updates);
      await ApiService.updateSessionStatus(sessionId, 'finalized');

      toast.success('Session Finalized', 'All remaining unmarked students have been marked Absent and attendance is locked.');
      await loadSessionData();
      onSessionUpdated();
    } catch (err: any) {
      toast.error('Finalization Failed', err.message);
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleFinalizeSession = async () => {
    try {
      setIsFinalizing(true);
      const updates = rows.map(({ student }) => ({
        student_id: student.id,
        status: statusMap[student.id] || 'absent',
        notes: notesMap[student.id] || undefined,
      }));
      await ApiService.saveAttendanceRecords(sessionId, updates);
      await ApiService.updateSessionStatus(sessionId, 'finalized');

      toast.success('Session Finalized', 'Attendance record is confirmed and locked.');
      setIsFinalizeModalOpen(false);
      await loadSessionData();
      onSessionUpdated();
    } catch (err: any) {
      toast.error('Finalization Failed', err.message);
    } finally {
      setIsFinalizing(false);
    }
  };

  const handleReopenSession = async () => {
    try {
      await ApiService.updateSessionStatus(sessionId, 'active');
      toast.info('Session Reopened', 'You can now edit student attendance marks.');
      await loadSessionData();
      onSessionUpdated();
    } catch (err: any) {
      toast.error('Failed to reopen session', err.message);
    }
  };

  // Real Attendance Metrics Calculation (Zero pending / Zero division errors)
  const counts = useMemo(() => {
    let present = 0;
    let absent = 0;
    let unselected = 0;

    rows.forEach(({ student }) => {
      const st = statusMap[student.id];
      if (st === 'present') present++;
      else if (st === 'absent') absent++;
      else unselected++;
    });

    const total = rows.length;
    const attendanceRate = total > 0 ? Math.round((present / total) * 100) : 0;
    const totalMarked = present + absent;
    const progressPercent = total > 0 ? Math.round((totalMarked / total) * 100) : 0;

    return {
      total,
      present,
      absent,
      unselected,
      attendanceRate,
      totalMarked,
      progressPercent,
    };
  }, [statusMap, rows]);

  // Filtered & Sorted Rows
  const filteredRows = useMemo(() => {
    let list = [...rows];

    // 1. Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        ({ student }) =>
          student.full_name.toLowerCase().includes(q) ||
          student.roll_number.toLowerCase().includes(q) ||
          (student.email && student.email.toLowerCase().includes(q))
      );
    }

    // 2. Status Filter
    if (statusFilter !== 'all') {
      list = list.filter(({ student }) => {
        const st = statusMap[student.id];
        if (statusFilter === 'present') return st === 'present';
        if (statusFilter === 'absent') return st === 'absent';
        if (statusFilter === 'unmarked') return st !== 'present' && st !== 'absent';
        return true;
      });
    }

    // 3. Sorting
    list.sort((a, b) => {
      if (sortBy === 'name_asc') {
        return a.student.full_name.localeCompare(b.student.full_name);
      }
      if (sortBy === 'name_desc') {
        return b.student.full_name.localeCompare(a.student.full_name);
      }
      if (sortBy === 'roll_asc') {
        return a.student.roll_number.localeCompare(b.student.roll_number);
      }
      if (sortBy === 'roll_desc') {
        return b.student.roll_number.localeCompare(a.student.roll_number);
      }
      return 0;
    });

    return list;
  }, [rows, searchQuery, statusFilter, sortBy, statusMap]);

  if (isLoading) {
    return (
      <div className="p-16 text-center text-slate-500 space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" />
        <p className="text-xs font-semibold tracking-wide text-slate-600">Loading Instructor Command Center...</p>
      </div>
    );
  }

  if (!session) return null;

  const isFinalized = session.status === 'finalized';

  return (
    <div className="space-y-6 animate-fade-in pb-12">
      {/* ========================================================= */}
      {/* 1. INSTRUCTOR COMMAND CENTER (Header & Actions)          */}
      {/* ========================================================= */}
      <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200/90 shadow-sm space-y-6">
        {/* Top Header Row */}
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-5">
          <div className="flex items-start gap-4">
            <button
              onClick={onBack}
              className="p-2.5 rounded-2xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition border border-slate-200/80 bg-white shadow-xs shrink-0 mt-0.5"
              title="Return to session list"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>

            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200/80">
                  {session.class_code}
                </span>

                <span
                  className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold tracking-wide uppercase border ${
                    isFinalized
                      ? 'bg-slate-100 text-slate-700 border-slate-300'
                      : 'bg-emerald-50 text-emerald-700 border-emerald-300/80'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full ${
                      isFinalized ? 'bg-slate-500' : 'bg-emerald-500 animate-pulse'
                    }`}
                  />
                  {isFinalized ? 'Session Finalized' : 'Attendance in Progress'}
                </span>

                {instructor && (
                  <span className="text-xs font-semibold text-slate-600 bg-slate-100/80 px-2.5 py-1 rounded-lg border border-slate-200 hidden sm:inline-flex items-center gap-1">
                    <span className="text-slate-400 font-normal">Instructor:</span>
                    {instructor.full_name}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-2xl font-extrabold text-slate-900 tracking-tight">
                {session.title}
              </h1>

              <div className="flex flex-wrap items-center gap-y-1 gap-x-4 text-xs font-medium text-slate-500">
                <span className="flex items-center gap-1.5 text-slate-700 font-semibold">
                  <BookOpen className="w-3.5 h-3.5 text-indigo-500" />
                  {session.class_name}
                </span>
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  {session.session_date}
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  {session.start_time} - {session.end_time}
                </span>
              </div>
            </div>
          </div>

          {/* Command Center Action Buttons Hierarchy */}
          <div className="flex flex-wrap items-center gap-2.5 w-full lg:w-auto justify-start lg:justify-end pt-2 lg:pt-0 border-t lg:border-t-0 border-slate-100">
            {/* Save Changes (Primary when dirty) */}
            <button
              onClick={handleSaveAttendance}
              disabled={isSaving || !hasUnsavedChanges}
              className={`h-9 px-4 text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-xs ${
                hasUnsavedChanges
                  ? 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-600/25 ring-2 ring-indigo-600/20'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  {hasUnsavedChanges ? 'Save Changes' : 'Saved'}
                </>
              )}
            </button>

            {/* Face Attendance (AI Scan) */}
            {!isFinalized && (
              <button
                onClick={() => setIsFaceModalOpen(true)}
                className="h-9 px-3.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200/90 rounded-xl transition flex items-center gap-1.5 shadow-xs"
                title="Launch AI multi-face classroom photo scanner"
              >
                <Camera className="w-3.5 h-3.5 text-emerald-600" />
                Face Attendance
              </button>
            )}

            {/* Audit Trail */}
            <button
              onClick={() => setIsAuditModalOpen(true)}
              className="h-9 px-3 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200/90 rounded-xl transition flex items-center gap-1.5 shadow-xs"
              title="Inspect attendance modification log"
            >
              <History className="w-3.5 h-3.5 text-slate-500" />
              Audit Trail
            </button>

            {/* Presence Key Toggle */}
            <button
              onClick={() => setSheetView(sheetView === 'presence_key' ? 'roll' : 'presence_key')}
              className={`h-9 px-3 text-xs font-semibold rounded-xl transition flex items-center gap-1.5 border shadow-xs ${
                sheetView === 'presence_key'
                  ? 'bg-indigo-700 text-white border-indigo-700 shadow-indigo-600/20'
                  : 'text-slate-700 bg-white hover:bg-slate-50 border-slate-200/90'
              }`}
            >
              <KeyRound className="w-3.5 h-3.5" />
              {sheetView === 'presence_key' ? 'Smart Roster' : 'Presence Key'}
            </button>

            {/* Finalize / Reopen Session */}
            {isFinalized ? (
              <button
                onClick={handleReopenSession}
                className="h-9 px-3.5 text-xs font-semibold text-amber-700 bg-amber-50 hover:bg-amber-100 border border-amber-200 rounded-xl transition flex items-center gap-1.5"
              >
                <Unlock className="w-3.5 h-3.5" />
                Reopen Session
              </button>
            ) : (
              <button
                onClick={handleFinalizeClick}
                className="h-9 px-3.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-1.5 border border-slate-300"
              >
                <Lock className="w-3.5 h-3.5 text-slate-600" />
                Finalize Session
              </button>
            )}
          </div>
        </div>

        {/* 4 Clean Summary Metric Cards (Zero Pending / Non-Zero Division Safe) */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 pt-1">
          {/* Total Enrolled */}
          <div className="bg-slate-50/90 rounded-2xl p-4 border border-slate-200/80 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-slate-500">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Enrolled</span>
              <Users className="w-4 h-4 text-slate-400" />
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {counts.total}
            </p>
            <p className="text-[11px] font-medium text-slate-500">Active Course Roster</p>
          </div>

          {/* Present */}
          <div className="bg-emerald-50/70 rounded-2xl p-4 border border-emerald-200/80 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-emerald-800">
              <span className="text-[11px] font-bold uppercase tracking-wider">Present</span>
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-emerald-700 tracking-tight">
              {counts.present}
            </p>
            <p className="text-[11px] font-medium text-emerald-600">
              {counts.total > 0 ? Math.round((counts.present / counts.total) * 100) : 0}% of Class
            </p>
          </div>

          {/* Absent */}
          <div className="bg-rose-50/70 rounded-2xl p-4 border border-rose-200/80 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-rose-800">
              <span className="text-[11px] font-bold uppercase tracking-wider">Absent</span>
              <XCircle className="w-4 h-4 text-rose-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-rose-700 tracking-tight">
              {counts.absent}
            </p>
            <p className="text-[11px] font-medium text-rose-600">
              {counts.total > 0 ? Math.round((counts.absent / counts.total) * 100) : 0}% Missing
            </p>
          </div>

          {/* Attendance Rate */}
          <div className="bg-indigo-50/70 rounded-2xl p-4 border border-indigo-200/80 shadow-xs space-y-1">
            <div className="flex items-center justify-between text-indigo-800">
              <span className="text-[11px] font-bold uppercase tracking-wider">Attendance Rate</span>
              <Sparkles className="w-4 h-4 text-indigo-600" />
            </div>
            <p className="text-2xl sm:text-3xl font-extrabold text-indigo-700 tracking-tight">
              {counts.attendanceRate}%
            </p>
            <p className="text-[11px] font-medium text-indigo-600">
              {counts.present} of {counts.total} Enrolled
            </p>
          </div>
        </div>

        {/* Slim Session Progress Bar & Concise Status */}
        <div className="space-y-2 pt-2 border-t border-slate-100">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between text-xs font-semibold gap-1">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  isFinalized
                    ? 'bg-slate-400'
                    : counts.totalMarked === counts.total
                    ? 'bg-emerald-500'
                    : 'bg-indigo-500 animate-pulse'
                }`}
              />
              <span className="text-slate-800">
                {isFinalized
                  ? 'Session finalized — Official institutional record locked'
                  : counts.totalMarked === counts.total
                  ? hasUnsavedChanges
                    ? 'All students have been marked — Unsaved changes'
                    : 'All students have been marked — Ready for finalization'
                  : hasUnsavedChanges
                  ? `Attendance is in progress (${counts.totalMarked}/${counts.total} marked) — Unsaved changes`
                  : `Attendance is in progress (${counts.totalMarked}/${counts.total} marked)`}
              </span>
            </div>

            <span className="text-slate-500 font-mono text-[11px]">
              {counts.totalMarked} / {counts.total} Marked ({counts.progressPercent}%)
            </span>
          </div>

          <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-300 ${
                isFinalized
                  ? 'bg-slate-500'
                  : counts.progressPercent === 100
                  ? 'bg-emerald-500'
                  : 'bg-indigo-600'
              }`}
              style={{ width: `${counts.progressPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Presence Key View */}
      {sheetView === 'presence_key' && (
        <PresenceKeyPanel
          session={session}
          enrolledStudents={rows.map((r) => r.student)}
          onAttendanceUpdated={loadSessionData}
          onCloseSession={handleFinalizeClick}
        />
      )}

      {/* ========================================================= */}
      {/* 2. SMART STUDENT ROSTER (Search, Filter, Table & Undo)    */}
      {/* ========================================================= */}
      {sheetView === 'roll' && (
        <div className="bg-white rounded-3xl border border-slate-200/90 shadow-sm overflow-hidden">
          {/* Search, Filter Tabs & Bulk Actions Bar */}
          <div className="p-4 sm:p-5 border-b border-slate-100 bg-slate-50/60 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3.5">
            {/* Left: Search input & Status Filters */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 flex-1">
              {/* Search */}
              <div className="relative flex-1 max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name, roll number, or email..."
                  className="w-full pl-9 pr-8 py-2 bg-white border border-slate-200 rounded-xl text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 text-xs"
                  >
                    &times;
                  </button>
                )}
              </div>

              {/* Status Filter Tabs: All, Present, Absent */}
              <div className="inline-flex rounded-xl p-1 bg-white border border-slate-200 text-xs font-semibold shrink-0 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setStatusFilter('all')}
                  className={`px-3 py-1 rounded-lg transition ${
                    statusFilter === 'all'
                      ? 'bg-slate-900 text-white shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  All ({counts.total})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('present')}
                  className={`px-3 py-1 rounded-lg transition ${
                    statusFilter === 'present'
                      ? 'bg-emerald-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-emerald-700'
                  }`}
                >
                  Present ({counts.present})
                </button>
                <button
                  type="button"
                  onClick={() => setStatusFilter('absent')}
                  className={`px-3 py-1 rounded-lg transition ${
                    statusFilter === 'absent'
                      ? 'bg-rose-600 text-white shadow-xs'
                      : 'text-slate-600 hover:text-rose-700'
                  }`}
                >
                  Absent ({counts.absent})
                </button>
                {counts.unselected > 0 && (
                  <button
                    type="button"
                    onClick={() => setStatusFilter('unmarked')}
                    className={`px-2.5 py-1 rounded-lg transition flex items-center gap-1 ${
                      statusFilter === 'unmarked'
                        ? 'bg-amber-600 text-white shadow-xs'
                        : 'text-amber-700 hover:bg-amber-50'
                    }`}
                    title="Filter students awaiting an attendance decision"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                    Unmarked ({counts.unselected})
                  </button>
                )}
              </div>
            </div>

            {/* Right: Sorting, Bulk Mark & Undo */}
            <div className="flex flex-wrap items-center gap-2 justify-between lg:justify-end">
              {/* Sort Selector */}
              <div className="flex items-center gap-1.5">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={sortBy}
                  onChange={(e: any) => setSortBy(e.target.value)}
                  className="bg-white border border-slate-200 text-slate-700 text-xs font-medium rounded-xl px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 shadow-2xs"
                >
                  <option value="name_asc">Name (A → Z)</option>
                  <option value="name_desc">Name (Z → A)</option>
                  <option value="roll_asc">Roll No (Asc)</option>
                  <option value="roll_desc">Roll No (Desc)</option>
                </select>
              </div>

              {/* Undo Button */}
              {historyStack.length > 0 && !isFinalized && (
                <button
                  onClick={handleUndo}
                  className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-100 border border-slate-200 rounded-xl transition flex items-center gap-1 shadow-2xs"
                  title="Undo last attendance status change"
                >
                  <Undo2 className="w-3.5 h-3.5 text-slate-500" />
                  Undo
                </button>
              )}

              {/* Bulk: Mark All Present */}
              {!isFinalized && (
                <button
                  onClick={() => setIsMarkAllPresentModalOpen(true)}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded-xl transition shadow-2xs"
                >
                  Mark All Present
                </button>
              )}

              {/* Clear Search & Filter action */}
              {(searchQuery || statusFilter !== 'all') && (
                <button
                  onClick={handleClearFilters}
                  className="px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-800 underline transition"
                >
                  Clear Filters
                </button>
              )}
            </div>
          </div>

          {/* Subheader Matching Count */}
          <div className="px-5 py-2.5 bg-slate-50/30 border-b border-slate-100 text-xs font-medium text-slate-500 flex items-center justify-between">
            <span>
              Showing <strong className="text-slate-800">{filteredRows.length}</strong> of{' '}
              <strong className="text-slate-800">{rows.length}</strong> enrolled students
              {searchQuery && ` matching "${searchQuery}"`}
              {statusFilter !== 'all' && ` (filtered: ${statusFilter})`}
            </span>

            {hasUnsavedChanges && (
              <span className="text-amber-700 font-semibold flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                Unsaved modifications pending
              </span>
            )}
          </div>

          {/* Table Container */}
          {rows.length === 0 ? (
            <div className="p-16 text-center text-slate-400 space-y-2">
              <Users className="w-12 h-12 mx-auto text-slate-300" />
              <p className="text-sm font-bold text-slate-700">No students enrolled in this class</p>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Navigate to the Classes section to enroll students before taking attendance.
              </p>
            </div>
          ) : filteredRows.length === 0 ? (
            <div className="p-14 text-center text-slate-400 space-y-3">
              <Search className="w-10 h-10 mx-auto text-slate-300" />
              <p className="text-xs font-semibold text-slate-700">No students match current search or filters</p>
              <button
                onClick={handleClearFilters}
                className="px-3.5 py-1.5 text-xs font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-xl transition border border-indigo-200"
              >
                Clear Search & Filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200/90">
                    <th className="py-3.5 px-4 sm:px-5">Student</th>
                    <th className="py-3.5 px-4">Roll Number</th>
                    <th className="py-3.5 px-4">Attendance (Present | Absent)</th>
                    <th className="py-3.5 px-4 sm:px-5">Remarks</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {filteredRows.map(({ student, record }) => {
                    const currentStatus = statusMap[student.id];
                    const notes = notesMap[student.id] || '';

                    return (
                      <tr
                        key={student.id}
                        className={`transition ${
                          currentStatus === 'present'
                            ? 'hover:bg-emerald-50/20'
                            : currentStatus === 'absent'
                            ? 'hover:bg-rose-50/20'
                            : 'hover:bg-slate-50/60 bg-amber-50/10'
                        }`}
                      >
                        {/* Student Info & Photo */}
                        <td className="py-3.5 px-4 sm:px-5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 shadow-2xs">
                              {student.photo_url ? (
                                <img
                                  src={student.photo_url}
                                  alt={student.full_name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center font-bold text-xs text-indigo-700 bg-indigo-50">
                                  {student.full_name.charAt(0)}
                                </div>
                              )}
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-bold text-slate-900 text-sm">{student.full_name}</p>
                                {record?.method === 'presence_key' && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-indigo-700 bg-indigo-50 px-1.5 py-0.5 rounded border border-indigo-200">
                                    <KeyRound className="w-2.5 h-2.5" /> App Check-in
                                  </span>
                                )}
                                {(record?.method === 'face_scan' || record?.method === 'face_recognition') && (
                                  <span className="inline-flex items-center gap-1 text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200">
                                    <Camera className="w-2.5 h-2.5" /> Face Scan
                                  </span>
                                )}
                                {student.face_enrollment_status === 'enrolled' ? (
                                  <span
                                    className="text-[9px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200"
                                    title="Biometric Face ID registered"
                                  >
                                    Face ID Enrolled
                                  </span>
                                ) : (
                                  <span
                                    className="text-[9px] text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded"
                                    title="No Biometric Data"
                                  >
                                    No Face ID
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {student.course} &bull; {student.section}
                              </p>
                            </div>
                          </div>
                        </td>

                        {/* Roll Number */}
                        <td className="py-3.5 px-4">
                          <span className="font-mono font-bold text-xs text-slate-800 bg-slate-100/90 px-2.5 py-1 rounded-lg border border-slate-200/80">
                            {student.roll_number}
                          </span>
                        </td>

                        {/* EXACT TWO-OPTION ATTENDANCE CONTROL: Present | Absent */}
                        <td className="py-3.5 px-4">
                          <div className="inline-flex rounded-xl p-1 bg-slate-100 border border-slate-200/90 gap-1 shrink-0 shadow-2xs">
                            {/* Present Button */}
                            <button
                              type="button"
                              disabled={isFinalized}
                              onClick={() => handleStatusChange(student.id, 'present')}
                              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                                currentStatus === 'present'
                                  ? 'bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-500/20'
                                  : 'text-slate-600 hover:text-emerald-700 hover:bg-emerald-50 border border-transparent hover:border-emerald-200'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Present
                            </button>

                            {/* Absent Button */}
                            <button
                              type="button"
                              disabled={isFinalized}
                              onClick={() => handleStatusChange(student.id, 'absent')}
                              className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition flex items-center gap-1.5 ${
                                currentStatus === 'absent'
                                  ? 'bg-rose-600 text-white shadow-xs ring-2 ring-rose-500/20'
                                  : 'text-slate-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200'
                              }`}
                            >
                              <XCircle className="w-3.5 h-3.5" />
                              Absent
                            </button>
                          </div>
                        </td>

                        {/* Remarks Input */}
                        <td className="py-3.5 px-4 sm:px-5">
                          <input
                            type="text"
                            disabled={isFinalized}
                            value={notes}
                            onChange={(e) => handleNotesChange(student.id, e.target.value)}
                            placeholder="Add remark..."
                            className="w-full max-w-xs px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs text-slate-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 disabled:bg-slate-100 disabled:text-slate-400"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal: Mark All Present */}
      <ConfirmationModal
        isOpen={isMarkAllPresentModalOpen}
        title="Mark All Enrolled Students as Present?"
        message={`This will set all ${rows.length} enrolled students to Present status. Any existing absent marks will be updated. You can undo this action before saving.`}
        confirmLabel="Mark All Present"
        cancelLabel="Cancel"
        onConfirm={handleConfirmMarkAllPresent}
        onCancel={() => setIsMarkAllPresentModalOpen(false)}
      />

      {/* Validation Warning Modal: Unmarked Students Detected before Finalization */}
      {isUnselectedWarningOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fade-in">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full border border-slate-100 p-6 space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">Unselected Students Detected</h3>
              <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                <strong>{counts.unselected} of {counts.total} students</strong> have not been given an
                attendance decision. Attendance cannot be silently submitted. Every enrolled student must
                have an explicit <strong>Present</strong> or <strong>Absent</strong> mark.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                onClick={() => {
                  setStatusFilter('unmarked');
                  setIsUnselectedWarningOpen(false);
                }}
                className="w-full py-2.5 px-4 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs transition shadow-xs"
              >
                Review {counts.unselected} Unmarked Students
              </button>

              <button
                onClick={handleMarkRemainingAbsentAndFinalize}
                className="w-full py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs transition border border-slate-200"
              >
                Mark Remaining as Absent & Finalize
              </button>

              <button
                onClick={() => setIsUnselectedWarningOpen(false)}
                className="w-full py-2 text-xs font-medium text-slate-500 hover:text-slate-800 transition"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal: Finalize Session (when all students marked) */}
      <ConfirmationModal
        isOpen={isFinalizeModalOpen}
        title="Finalize Attendance Session?"
        message="Finalizing will permanently lock and confirm this lecture's official attendance record. All students have been verified."
        confirmLabel="Finalize & Lock Session"
        cancelLabel="Continue Editing"
        isLoading={isFinalizing}
        onConfirm={handleFinalizeSession}
        onCancel={() => setIsFinalizeModalOpen(false)}
      />

      {/* Audit Trail Modal */}
      <AttendanceAuditModal
        isOpen={isAuditModalOpen}
        sessionId={sessionId}
        sessionTitle={session.title}
        students={rows.map((r) => r.student)}
        onClose={() => setIsAuditModalOpen(false)}
      />

      {/* Face Attendance Modal */}
      {isFaceModalOpen && session && (
        <FaceAttendanceModal
          isOpen={isFaceModalOpen}
          session={session}
          enrolledStudents={rows.map((r) => r.student)}
          onClose={() => setIsFaceModalOpen(false)}
          onAttendanceSubmitted={() => {
            loadSessionData();
            onSessionUpdated();
          }}
        />
      )}
    </div>
  );
};
