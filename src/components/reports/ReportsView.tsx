import React, { useState, useEffect, useMemo } from 'react';
import {
  BarChart3,
  Download,
  Search,
  Users,
  FileSpreadsheet,
} from 'lucide-react';
import type {
  Student,
  ClassCourse,
  AttendanceSession,
} from '../../types';
import { ApiService } from '../../services/api';
import { useToast } from '../common/ToastContext';

export const ReportsView: React.FC = () => {
  const [classes, setClasses] = useState<ClassCourse[]>([]);
  const [sessions, setSessions] = useState<AttendanceSession[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Filters
  const [selectedClassId, setSelectedClassId] = useState<string>('ALL');
  const [startDate, setStartDate] = useState<string>('');
  const [endDate, setEndDate] = useState<string>('');
  const [studentSearch, setStudentSearch] = useState<string>('');

  // Active Report Tab
  const [activeTab, setActiveTab] = useState<'students' | 'sessions' | 'detailed'>('students');

  // Student drilldown calculation
  const [studentStats, setStudentStats] = useState<
    Array<{
      student: Student;
      totalFinalized: number;
      present: number;
      late: number;
      absent: number;
      unmarked: number;
      percentage: number;
    }>
  >([]);

  const toast = useToast();

  const loadData = async () => {
    try {
      setIsLoading(true);
      const [stuList, clsList, sesList] = await Promise.all([
        ApiService.getStudents(),
        ApiService.getClasses(),
        ApiService.getAttendanceSessions(),
      ]);

      setClasses(clsList);
      setSessions(sesList);

      // Compute stats for all students
      const statsList = await Promise.all(
        stuList.map(async (stu) => {
          const s = await ApiService.getStudentAttendanceSummary(stu.id);
          return {
            student: stu,
            totalFinalized: s.total,
            present: s.present,
            late: s.late,
            absent: s.absent,
            unmarked: s.unmarked,
            percentage: s.percentage,
          };
        })
      );

      setStudentStats(statsList);
    } catch (err: any) {
      toast.error('Error generating reports', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered sessions
  const filteredSessions = useMemo(() => {
    return sessions.filter((s) => {
      if (selectedClassId !== 'ALL' && s.class_id !== selectedClassId) return false;
      if (startDate && s.session_date < startDate) return false;
      if (endDate && s.session_date > endDate) return false;
      return true;
    });
  }, [sessions, selectedClassId, startDate, endDate]);

  // Filtered student stats
  const filteredStudentStats = useMemo(() => {
    return studentStats.filter(({ student }) => {
      if (studentSearch.trim()) {
        const q = studentSearch.toLowerCase().trim();
        const matchName = student.full_name.toLowerCase().includes(q);
        const matchRoll = student.roll_number.toLowerCase().includes(q);
        if (!matchName && !matchRoll) return false;
      }
      return true;
    });
  }, [studentStats, studentSearch]);

  // Overall Report Metrics
  const overallMetrics = useMemo(() => {
    let totalPresent = 0;
    let totalLate = 0;
    let totalAbsent = 0;
    let totalFinalizedSessions = filteredSessions.filter((s) => s.status === 'finalized').length;

    filteredSessions.forEach((s) => {
      if (s.stats) {
        totalPresent += s.stats.present;
        totalLate += s.stats.late;
        totalAbsent += s.stats.absent;
      }
    });

    const totalRecorded = totalPresent + totalLate + totalAbsent;
    const avgPct =
      totalRecorded > 0 ? Math.round(((totalPresent + totalLate) / totalRecorded) * 100) : 0;

    return {
      totalFinalizedSessions,
      totalPresent,
      totalLate,
      totalAbsent,
      avgPct,
    };
  }, [filteredSessions]);

  const handleExportCSV = () => {
    if (activeTab === 'students') {
      const rows = filteredStudentStats.map(({ student, totalFinalized, present, late, absent, percentage }) => ({
        'Student Name': student.full_name,
        'Roll Number': student.roll_number,
        'Course': student.course,
        'Academic Year': student.academic_year,
        'Section': student.section,
        'Finalized Sessions': totalFinalized,
        'Present Count': present,
        'Late Count': late,
        'Absent Count': absent,
        'Attendance Percentage': `${percentage}%`,
      }));

      ApiService.exportToCSV(`sentinel_student_attendance_${new Date().toISOString().split('T')[0]}`, rows);
      toast.success('Report Exported', `${rows.length} student records exported to CSV.`);
    } else {
      const rows = filteredSessions.map((s) => ({
        'Class Code': s.class_code,
        'Class Name': s.class_name,
        'Session Title': s.title,
        'Date': s.session_date,
        'Time': `${s.start_time} - ${s.end_time}`,
        'Status': s.status,
        'Enrolled': s.stats?.total || 0,
        'Present': s.stats?.present || 0,
        'Late': s.stats?.late || 0,
        'Absent': s.stats?.absent || 0,
      }));

      ApiService.exportToCSV(`sentinel_sessions_report_${new Date().toISOString().split('T')[0]}`, rows);
      toast.success('Report Exported', `${rows.length} session summaries exported to CSV.`);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-600" />
            Attendance Reports & Analytics
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Aggregate attendance rates, student compliance, session breakdowns, and CSV reports.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="px-4 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center gap-2 border border-slate-200 shadow-sm"
        >
          <Download className="w-4 h-4 text-slate-600" />
          Export Report CSV
        </button>
      </div>

      {/* Aggregate KPI Metric Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-semibold text-slate-500">Overall Attendance</p>
          <div className="flex items-baseline gap-2 mt-2">
            <span
              className={`text-2xl font-bold ${
                overallMetrics.avgPct >= 75
                  ? 'text-emerald-600'
                  : overallMetrics.avgPct >= 60
                  ? 'text-amber-600'
                  : 'text-rose-600'
              }`}
            >
              {overallMetrics.avgPct}%
            </span>
            <span className="text-[11px] text-slate-400 font-medium">Finalized sessions</span>
          </div>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-semibold text-emerald-800">Total Marks: Present</p>
          <p className="text-2xl font-bold text-emerald-600 mt-2">{overallMetrics.totalPresent}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-semibold text-amber-800">Total Marks: Late</p>
          <p className="text-2xl font-bold text-amber-600 mt-2">{overallMetrics.totalLate}</p>
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm">
          <p className="text-xs font-semibold text-rose-800">Total Marks: Absent</p>
          <p className="text-2xl font-bold text-rose-600 mt-2">{overallMetrics.totalAbsent}</p>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-sm grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Filter Course / Class
          </label>
          <select
            value={selectedClassId}
            onChange={(e) => setSelectedClassId(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          >
            <option value="ALL">All Enrolled Classes</option>
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name} ({cls.code} - Sec {cls.section})
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Date Range (From)
          </label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
            Date Range (To)
          </label>
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            />

            {(selectedClassId !== 'ALL' || startDate || endDate) && (
              <button
                onClick={() => {
                  setSelectedClassId('ALL');
                  setStartDate('');
                  setEndDate('');
                }}
                className="px-2.5 py-2 text-xs font-medium text-slate-500 hover:text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center gap-2 border-b border-slate-200">
        <button
          onClick={() => setActiveTab('students')}
          className={`px-4 py-2.5 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'students'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <Users className="w-4 h-4" />
          Student Attendance History
        </button>

        <button
          onClick={() => setActiveTab('sessions')}
          className={`px-4 py-2.5 text-xs font-bold transition border-b-2 flex items-center gap-2 ${
            activeTab === 'sessions'
              ? 'border-brand-600 text-brand-600'
              : 'border-transparent text-slate-500 hover:text-slate-800'
          }`}
        >
          <FileSpreadsheet className="w-4 h-4" />
          Session Breakdown Report
        </button>
      </div>

      {/* Main Report Table Content */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 space-y-2">
            <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto" />
            <p className="text-xs font-medium">Calculating attendance summaries...</p>
          </div>
        ) : activeTab === 'students' ? (
          /* Student History Tab */
          <div>
            <div className="p-4 border-b border-slate-100">
              <div className="relative max-w-sm">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => setStudentSearch(e.target.value)}
                  placeholder="Filter students by name or roll number..."
                  className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-brand-500/20"
                />
              </div>
            </div>

            {filteredStudentStats.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                No students match your filter criteria.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200/80">
                      <th className="py-3.5 px-4">Student</th>
                      <th className="py-3.5 px-4">Roll Number</th>
                      <th className="py-3.5 px-4">Finalized Sessions</th>
                      <th className="py-3.5 px-4">Present</th>
                      <th className="py-3.5 px-4">Late</th>
                      <th className="py-3.5 px-4">Absent</th>
                      <th className="py-3.5 px-4">Attendance Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredStudentStats.map(
                      ({ student, totalFinalized, present, late, absent, percentage }) => (
                        <tr key={student.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-3 px-4">
                            <div className="flex items-center gap-3">
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
                                <p className="font-bold text-slate-900">{student.full_name}</p>
                                <p className="text-[11px] text-slate-500">{student.course}</p>
                              </div>
                            </div>
                          </td>

                          <td className="py-3 px-4">
                            <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                              {student.roll_number}
                            </span>
                          </td>

                          <td className="py-3 px-4 font-semibold text-slate-700">{totalFinalized}</td>

                          <td className="py-3 px-4 font-semibold text-emerald-600">{present}</td>

                          <td className="py-3 px-4 font-semibold text-amber-600">{late}</td>

                          <td className="py-3 px-4 font-semibold text-rose-600">{absent}</td>

                          <td className="py-3 px-4">
                            <div className="flex items-center gap-2">
                              <span
                                className={`font-bold font-mono ${
                                  percentage >= 75
                                    ? 'text-emerald-700'
                                    : percentage >= 60
                                    ? 'text-amber-700'
                                    : 'text-rose-700'
                                }`}
                              >
                                {percentage}%
                              </span>

                              <div className="w-20 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    percentage >= 75
                                      ? 'bg-emerald-500'
                                      : percentage >= 60
                                      ? 'bg-amber-500'
                                      : 'bg-rose-500'
                                  }`}
                                  style={{ width: `${percentage}%` }}
                                />
                              </div>
                            </div>
                          </td>
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          /* Session Summary Tab */
          <div>
            {filteredSessions.length === 0 ? (
              <div className="p-12 text-center text-slate-400 text-xs">
                No sessions conducted within the selected filter parameters.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200/80">
                      <th className="py-3.5 px-4">Session Title</th>
                      <th className="py-3.5 px-4">Class</th>
                      <th className="py-3.5 px-4">Lecture Date</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Enrolled</th>
                      <th className="py-3.5 px-4">Present</th>
                      <th className="py-3.5 px-4">Late</th>
                      <th className="py-3.5 px-4">Absent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-xs">
                    {filteredSessions.map((session) => (
                      <tr key={session.id} className="hover:bg-slate-50/50 transition">
                        <td className="py-3 px-4 font-bold text-slate-900">{session.title}</td>

                        <td className="py-3 px-4">
                          <span className="font-mono font-semibold text-brand-700 bg-brand-50 px-2 py-0.5 rounded border border-brand-200">
                            {session.class_code}
                          </span>
                        </td>

                        <td className="py-3 px-4 text-slate-600">{session.session_date}</td>

                        <td className="py-3 px-4">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border capitalize ${
                              session.status === 'finalized'
                                ? 'bg-slate-100 text-slate-700 border-slate-200'
                                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            }`}
                          >
                            {session.status}
                          </span>
                        </td>

                        <td className="py-3 px-4 font-semibold text-slate-700">
                          {session.stats?.total || 0}
                        </td>

                        <td className="py-3 px-4 font-semibold text-emerald-600">
                          {session.stats?.present || 0}
                        </td>

                        <td className="py-3 px-4 font-semibold text-amber-600">
                          {session.stats?.late || 0}
                        </td>

                        <td className="py-3 px-4 font-semibold text-rose-600">
                          {session.stats?.absent || 0}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
