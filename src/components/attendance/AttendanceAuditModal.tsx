import React, { useEffect, useState } from 'react';
import { X, History, Clock } from 'lucide-react';
import type { AttendanceAuditLog, Student } from '../../types';
import { ApiService } from '../../services/api';

interface AttendanceAuditModalProps {
  isOpen: boolean;
  sessionId: string;
  sessionTitle: string;
  onClose: () => void;
  students: Student[];
}

export const AttendanceAuditModal: React.FC<AttendanceAuditModalProps> = ({
  isOpen,
  sessionId,
  sessionTitle,
  onClose,
  students,
}) => {
  const [logs, setLogs] = useState<AttendanceAuditLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (isOpen && sessionId) {
      setIsLoading(true);
      ApiService.getAttendanceAuditLogs(sessionId)
        .then((data) => setLogs(data))
        .finally(() => setIsLoading(false));
    }
  }, [isOpen, sessionId]);

  if (!isOpen) return null;

  const studentMap = new Map<string, Student>();
  students.forEach((s) => studentMap.set(s.id, s));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto animate-fade-in">
      <div className="bg-white rounded-3xl shadow-2xl max-w-2xl w-full border border-slate-100 overflow-hidden my-8">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
          <div>
            <div className="flex items-center gap-2">
              <History className="w-5 h-5 text-brand-600" />
              <h2 className="text-lg font-bold text-slate-900">Attendance Audit Trail</h2>
            </div>
            <p className="text-xs text-slate-500 mt-0.5 truncate max-w-md">
              Session: {sessionTitle}
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
          {isLoading ? (
            <div className="p-8 text-center text-slate-400">
              <div className="w-6 h-6 border-2 border-brand-300 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
              <p className="text-xs">Loading audit logs...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="p-8 text-center bg-slate-50 rounded-2xl text-slate-400 text-xs">
              No audit logs recorded for this session yet. Modifications will be logged here.
            </div>
          ) : (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {logs.map((log) => {
                const stu = studentMap.get(log.student_id);
                return (
                  <div
                    key={log.id}
                    className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-xs space-y-1.5"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-900">
                          {stu ? stu.full_name : 'Student ID: ' + log.student_id}
                        </span>
                        {stu && (
                          <span className="font-mono text-[10px] text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                            {stu.roll_number}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <Clock className="w-3.5 h-3.5" />
                        <span>{new Date(log.changed_at).toLocaleTimeString()}</span>
                        <span>&bull;</span>
                        <span>{new Date(log.changed_at).toLocaleDateString()}</span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs">
                      <span className="text-slate-500">Status Change:</span>
                      <span className="font-mono px-2 py-0.5 rounded bg-slate-200/80 text-slate-700 capitalize">
                        {log.previous_status || 'initial'}
                      </span>
                      <span className="text-slate-400">&rarr;</span>
                      <span
                        className={`font-mono font-semibold px-2 py-0.5 rounded capitalize ${
                          log.new_status === 'present'
                            ? 'bg-emerald-100 text-emerald-800'
                            : log.new_status === 'late'
                            ? 'bg-amber-100 text-amber-800'
                            : log.new_status === 'absent'
                            ? 'bg-rose-100 text-rose-800'
                            : 'bg-slate-100 text-slate-700'
                        }`}
                      >
                        {log.new_status}
                      </span>
                    </div>

                    {log.reason && (
                      <p className="text-[11px] text-slate-500 italic mt-1">
                        Reason: {log.reason}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="mt-6 pt-4 border-t border-slate-100 flex justify-end">
            <button
              onClick={onClose}
              className="px-4 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
