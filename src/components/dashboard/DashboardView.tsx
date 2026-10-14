import React, { useState, useEffect } from 'react';
import {
  Users,
  GraduationCap,
  CalendarCheck,
  ArrowRight,
  TrendingUp,
  Sparkles,
} from 'lucide-react';
import type {
  DashboardStats,
  AttendanceSession,
  ClassCourse,
  Instructor,
} from '../../types';
import { ApiService } from '../../services/api';
import type { NavTab } from '../layout/Sidebar';

interface DashboardViewProps {
  instructor: Instructor | null;
  onNavigate: (tab: NavTab) => void;
  onOpenSession: (sessionId: string) => void;
  onOpenClassRoster: (classId: string) => void;
  onSeedDemoData: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  instructor,
  onNavigate,
  onOpenSession,
  onOpenClassRoster,
  onSeedDemoData,
}) => {
  const [stats, setStats] = useState<DashboardStats>({
    totalStudents: 0,
    totalActiveClasses: 0,
    totalSessions: 0,
    selectedSessionPresent: 0,
    selectedSessionAbsent: 0,
    selectedSessionLate: 0,
    overallAttendancePct: 0,
  });

  const [recentSessions, setRecentSessions] = useState<AttendanceSession[]>([]);
  const [activeClasses, setActiveClasses] = useState<ClassCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDashboardData = async () => {
    try {
      setIsLoading(true);
      const [statsData, sessionsData, classesData] = await Promise.all([
        ApiService.getDashboardStats(),
        ApiService.getAttendanceSessions(),
        ApiService.getClasses(),
      ]);

      setStats(statsData);
      setRecentSessions(sessionsData.slice(0, 5));
      setActiveClasses(classesData.filter((c) => c.is_active).slice(0, 4));
    } catch (err) {
      console.error('Failed to load dashboard:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, []);

  const isBrandNewAccount =
    stats.totalStudents === 0 && stats.totalActiveClasses === 0 && stats.totalSessions === 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome & Faculty Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-brand-950 rounded-3xl p-6 sm:p-8 text-white shadow-lg relative overflow-hidden">
        <div className="relative z-10 max-w-2xl">
          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-white/10 text-white backdrop-blur-md mb-3 border border-white/10">
            {instructor?.institution || 'Sentinel Campus'} &bull; Faculty Portal
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Welcome back, {instructor?.full_name || 'Instructor'}
          </h2>
          <p className="text-xs sm:text-sm text-slate-300 mt-2 leading-relaxed">
            Manage your students, classes, and daily lecture attendance rolls with cryptographic accuracy.
          </p>

          <div className="mt-5 flex flex-wrap items-center gap-3">
            <button
              onClick={() => onNavigate('students')}
              className="px-4 py-2 text-xs font-semibold text-slate-900 bg-white hover:bg-slate-100 rounded-xl transition shadow-sm flex items-center gap-1.5"
            >
              <Users className="w-3.5 h-3.5 text-brand-600" />
              Manage Students
            </button>

            <button
              onClick={() => onNavigate('attendance')}
              className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-500 rounded-xl transition shadow-md shadow-brand-500/20 flex items-center gap-1.5"
            >
              <CalendarCheck className="w-3.5 h-3.5" />
              Conduct Attendance
            </button>
          </div>
        </div>

        {/* Ambient background decoration */}
        <div className="absolute right-0 top-0 bottom-0 w-96 bg-gradient-to-l from-brand-600/20 to-transparent pointer-events-none" />
      </div>

      {/* If brand new empty account: Helpful Onboarding Card */}
      {isBrandNewAccount && !isLoading && (
        <div className="bg-brand-50/80 border border-brand-200 rounded-3xl p-6 flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-brand-600" />
              <h3 className="text-sm font-bold text-brand-950">
                Fresh Instructor Account Initialized
              </h3>
            </div>
            <p className="text-xs text-brand-800 leading-relaxed max-w-xl">
              All statistics are calculated strictly from your database records and start at zero.
              You can start by creating classes and registering students, or test the interface with a realistic demo dataset.
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onSeedDemoData}
              className="px-4 py-2 text-xs font-semibold text-brand-700 bg-white hover:bg-brand-100 rounded-xl transition border border-brand-300 shadow-sm"
            >
              Load Demo Dataset
            </button>

            <button
              onClick={() => onNavigate('students')}
              className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-sm"
            >
              Add First Student
            </button>
          </div>
        </div>
      )}

      {/* Real Calculated Statistics Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Students */}
        <div
          onClick={() => onNavigate('students')}
          className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm hover:border-brand-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">Registered Students</p>
            <div className="p-2 rounded-xl bg-brand-50 text-brand-600 group-hover:scale-110 transition-transform">
              <Users className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
            {stats.totalStudents}
          </p>
          <span className="text-[11px] text-slate-400 mt-1 block">
            {stats.totalStudents === 0 ? 'No students enrolled yet' : 'In student directory'}
          </span>
        </div>

        {/* Active Classes */}
        <div
          onClick={() => onNavigate('classes')}
          className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm hover:border-brand-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">Active Classes</p>
            <div className="p-2 rounded-xl bg-indigo-50 text-indigo-600 group-hover:scale-110 transition-transform">
              <GraduationCap className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
            {stats.totalActiveClasses}
          </p>
          <span className="text-[11px] text-slate-400 mt-1 block">
            {stats.totalActiveClasses === 0 ? 'No active classes' : 'Active courses & cohorts'}
          </span>
        </div>

        {/* Sessions Conducted */}
        <div
          onClick={() => onNavigate('attendance')}
          className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm hover:border-brand-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">Sessions Conducted</p>
            <div className="p-2 rounded-xl bg-emerald-50 text-emerald-600 group-hover:scale-110 transition-transform">
              <CalendarCheck className="w-5 h-5" />
            </div>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-slate-900 mt-2">
            {stats.totalSessions}
          </p>
          <span className="text-[11px] text-slate-400 mt-1 block">
            {stats.totalSessions === 0 ? 'No sessions logged' : 'Recorded lectures'}
          </span>
        </div>

        {/* Overall Attendance Percentage */}
        <div
          onClick={() => onNavigate('reports')}
          className="bg-white p-5 rounded-3xl border border-slate-200/80 shadow-sm hover:border-brand-300 hover:shadow-md transition cursor-pointer group"
        >
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-slate-500">Overall Attendance</p>
            <div className="p-2 rounded-xl bg-purple-50 text-purple-600 group-hover:scale-110 transition-transform">
              <TrendingUp className="w-5 h-5" />
            </div>
          </div>
          <div className="flex items-baseline gap-2 mt-2">
            <span
              className={`text-2xl sm:text-3xl font-extrabold ${
                stats.overallAttendancePct >= 75
                  ? 'text-emerald-600'
                  : stats.overallAttendancePct >= 60
                  ? 'text-amber-600'
                  : 'text-slate-800'
              }`}
            >
              {stats.overallAttendancePct}%
            </span>
          </div>
          <span className="text-[11px] text-slate-400 mt-1 block">
            {stats.totalSessions === 0 ? 'Zero baseline' : 'Across finalized sessions'}
          </span>
        </div>
      </div>

      {/* Selected/Recent Session Breakdown Card */}
      {stats.selectedSessionTitle && (
        <div className="bg-white rounded-3xl p-5 border border-slate-200/80 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              Most Recent Lecture Roll
            </span>
            <h4 className="text-sm font-bold text-slate-900 mt-0.5">
              {stats.selectedSessionTitle}
            </h4>
          </div>

          <div className="flex items-center gap-3">
            <div className="px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-center">
              <p className="text-[10px] text-emerald-800 font-bold uppercase">Present</p>
              <p className="text-base font-bold text-emerald-700">{stats.selectedSessionPresent}</p>
            </div>

            <div className="px-3 py-1.5 rounded-xl bg-rose-50 border border-rose-200 text-center">
              <p className="text-[10px] text-rose-800 font-bold uppercase">Absent</p>
              <p className="text-base font-bold text-rose-700">{stats.selectedSessionAbsent}</p>
            </div>

            {(stats.selectedSessionPresent + stats.selectedSessionAbsent) > 0 && (
              <div className="px-3 py-1.5 rounded-xl bg-indigo-50 border border-indigo-200 text-center">
                <p className="text-[10px] text-indigo-800 font-bold uppercase">Rate</p>
                <p className="text-base font-bold text-indigo-700">
                  {Math.round(
                    (stats.selectedSessionPresent /
                      (stats.selectedSessionPresent + stats.selectedSessionAbsent)) *
                      100
                  )}%
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Two Column Section: Recent Sessions & Active Classes */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Attendance Sessions */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <CalendarCheck className="w-4 h-4 text-brand-600" />
              Recent Attendance Sessions
            </h3>
            <button
              onClick={() => onNavigate('attendance')}
              className="text-xs font-semibold text-brand-600 hover:text-brand-800 transition"
            >
              View All &rarr;
            </button>
          </div>

          {recentSessions.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-100">
              No attendance sessions conducted yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {recentSessions.map((session) => (
                <div
                  key={session.id}
                  onClick={() => onOpenSession(session.id)}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 px-2 rounded-xl transition cursor-pointer group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-brand-600 transition truncate">
                      {session.title}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span className="font-mono">{session.class_code}</span>
                      <span>&bull;</span>
                      <span>{session.session_date}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${
                        session.status === 'finalized'
                          ? 'bg-slate-100 text-slate-700 border-slate-200'
                          : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                      }`}
                    >
                      {session.status}
                    </span>

                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-brand-600 transition" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Active Classes Overview */}
        <div className="bg-white rounded-3xl border border-slate-200/80 p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-indigo-600" />
              Active Classes & Courses
            </h3>
            <button
              onClick={() => onNavigate('classes')}
              className="text-xs font-semibold text-brand-600 hover:text-brand-800 transition"
            >
              View All &rarr;
            </button>
          </div>

          {activeClasses.length === 0 ? (
            <div className="p-8 text-center text-slate-400 text-xs bg-slate-50 rounded-2xl border border-slate-100">
              No active classes registered yet.
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {activeClasses.map((cls) => (
                <div
                  key={cls.id}
                  onClick={() => onOpenClassRoster(cls.id)}
                  className="py-3 flex items-center justify-between gap-3 hover:bg-slate-50/60 px-2 rounded-xl transition cursor-pointer group"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-slate-900 group-hover:text-brand-600 transition truncate">
                      {cls.name}
                    </p>
                    <div className="flex items-center gap-2 text-[11px] text-slate-500 mt-0.5">
                      <span className="font-mono text-brand-700 font-semibold">{cls.code}</span>
                      <span>&bull;</span>
                      <span>Sec {cls.section}</span>
                      <span>&bull;</span>
                      <span>{cls.academic_year}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className="px-2.5 py-1 rounded-xl bg-slate-100 text-slate-700 text-xs font-semibold flex items-center gap-1">
                      <Users className="w-3 h-3 text-slate-500" />
                      {cls.enrolled_count || 0}
                    </span>

                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-brand-600 transition" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
