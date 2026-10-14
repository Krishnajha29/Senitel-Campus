import React, { useState, useEffect, useRef } from 'react';
import {
  KeyRound,
  Copy,
  CheckCircle2,
  Clock,
  RefreshCw,
  Slash,
  Lock,
  Users,
  ShieldCheck,
  Timer,
  Smartphone,
  Send,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import type { AttendanceSession, PresenceKey, Student } from '../../types';
import { ApiService } from '../../services/api';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { useToast } from '../common/ToastContext';

interface PresenceKeyPanelProps {
  session: AttendanceSession;
  enrolledStudents: Student[];
  onAttendanceUpdated: () => void;
  onCloseSession: () => void;
}

export const PresenceKeyPanel: React.FC<PresenceKeyPanelProps> = ({
  session,
  enrolledStudents,
  onAttendanceUpdated,
  onCloseSession,
}) => {
  const [activeKey, setActiveKey] = useState<PresenceKey | null>(null);
  const [plainKey, setPlainKey] = useState<string | null>(null);
  const [selectedDuration, setSelectedDuration] = useState<number>(10);
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);
  const [copied, setCopied] = useState<boolean>(false);

  // Loading states
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);

  // Modals
  const [showRegenerateModal, setShowRegenerateModal] = useState<boolean>(false);
  const [showRevokeModal, setShowRevokeModal] = useState<boolean>(false);

  // Student App simulator state for testing
  const [testStudentId, setTestStudentId] = useState<string>('');
  const [testKeyCode, setTestKeyCode] = useState<string>('');
  const [isTestingCheckIn, setIsTestingCheckIn] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const toast = useToast();

  const isSessionClosed = session.status === 'finalized' || session.status === 'cancelled';

  // Load active key
  const loadActiveKey = async () => {
    try {
      setIsLoading(true);
      const key = await ApiService.getActivePresenceKey(session.id);
      setActiveKey(key);

      if (key && key.status === 'active') {
        const remaining = Math.max(
          0,
          Math.floor((new Date(key.expires_at).getTime() - Date.now()) / 1000)
        );
        setSecondsRemaining(remaining);
      } else {
        setSecondsRemaining(0);
      }
    } catch (err: any) {
      console.error('Failed to load active presence key:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadActiveKey();
    if (enrolledStudents.length > 0 && !testStudentId) {
      setTestStudentId(enrolledStudents[0].id);
    }
  }, [session.id]);

  // Live countdown timer
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current);

    if (activeKey && activeKey.status === 'active') {
      timerRef.current = setInterval(() => {
        const remaining = Math.max(
          0,
          Math.floor((new Date(activeKey.expires_at).getTime() - Date.now()) / 1000)
        );
        setSecondsRemaining(remaining);

        if (remaining <= 0) {
          if (timerRef.current) clearInterval(timerRef.current);
          setActiveKey((prev) => (prev ? { ...prev, status: 'expired' } : null));
          toast.info('Presence Key Expired', 'The key duration has ended. Regenerate to resume check-ins.');
        }
      }, 1000);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [activeKey]);

  // Generate Key Handler
  const handleGenerateKey = async () => {
    if (isSessionClosed) {
      toast.error('Session Closed', 'Cannot generate key for a finalized lecture.');
      return;
    }

    try {
      setIsGenerating(true);
      const newKey = await ApiService.generatePresenceKey(session.id, selectedDuration);
      setActiveKey(newKey);
      setPlainKey(newKey.plain_key || null);
      setTestKeyCode(newKey.plain_key || '');

      const remaining = Math.max(
        0,
        Math.floor((new Date(newKey.expires_at).getTime() - Date.now()) / 1000)
      );
      setSecondsRemaining(remaining);
      toast.success(
        'Presence Key Active',
        `Generated 6-digit key valid for ${selectedDuration} minutes.`
      );
    } catch (err: any) {
      toast.error('Generation Failed', err.message);
    } finally {
      setIsGenerating(false);
      setShowRegenerateModal(false);
    }
  };

  // Revoke Key Handler
  const handleRevokeKey = async () => {
    try {
      setIsRevoking(true);
      await ApiService.revokePresenceKey(session.id);
      setActiveKey((prev) => (prev ? { ...prev, status: 'revoked' } : null));
      setSecondsRemaining(0);
      setPlainKey(null);
      toast.info('Presence Key Revoked', 'Students can no longer use this key for check-in.');
    } catch (err: any) {
      toast.error('Revocation Failed', err.message);
    } finally {
      setIsRevoking(false);
      setShowRevokeModal(false);
    }
  };

  const handleCopyKey = () => {
    if (!plainKey) return;
    navigator.clipboard.writeText(plainKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success('Key Copied', 'Presence key copied to clipboard.');
  };

  // Student check-in test simulator
  const handleSimulateCheckIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testKeyCode.trim() || !testStudentId) return;

    try {
      setIsTestingCheckIn(true);
      setTestResult(null);
      const res = await ApiService.validateStudentCheckIn(testKeyCode.trim(), testStudentId);
      setTestResult({
        success: res.success,
        message: res.message,
      });

      if (res.success) {
        toast.success('Check-in Recorded', `${res.student?.full_name} (${res.student?.roll_number})`);
        onAttendanceUpdated();
      } else {
        toast.error('Check-in Rejected', res.message);
      }
    } catch (err: any) {
      setTestResult({ success: false, message: err.message || 'Validation error' });
      toast.error('Check-in Error', err.message);
    } finally {
      setIsTestingCheckIn(false);
    }
  };

  const formatCountdown = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const checkedInCount = session.stats?.present || 0;
  const totalEnrolled = enrolledStudents.length;

  return (
    <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <KeyRound className="w-5 h-5 text-brand-600" />
            <h3 className="text-lg font-bold text-slate-900">Lecture Presence Key</h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Cryptographically secure single-use entry key for the student companion app.
          </p>
        </div>

        {/* Status Pill */}
        <div>
          {isSessionClosed ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
              <Lock className="w-3.5 h-3.5 text-slate-500" />
              Session Closed &bull; Check-ins Blocked
            </span>
          ) : activeKey && activeKey.status === 'active' && secondsRemaining > 0 ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              Key Active &bull; Check-in Open
            </span>
          ) : activeKey && activeKey.status === 'expired' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              <Clock className="w-3.5 h-3.5 text-amber-600" />
              Key Expired
            </span>
          ) : activeKey && activeKey.status === 'revoked' ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200">
              <Slash className="w-3.5 h-3.5 text-rose-600" />
              Key Revoked
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600 border border-slate-200">
              No Active Key
            </span>
          )}
        </div>
      </div>

      {/* Main Display: Loading, Closed, Active Key Card or Key Generation Card */}
      {isLoading ? (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200/80 flex items-center justify-center gap-2 text-slate-500 text-xs">
          <Loader2 className="w-4 h-4 animate-spin text-brand-600" />
          Checking presence key status...
        </div>
      ) : isSessionClosed ? (
        <div className="p-8 text-center bg-slate-50 rounded-2xl border border-slate-200/80 space-y-2">
          <Lock className="w-10 h-10 text-slate-400 mx-auto" />
          <h4 className="text-sm font-bold text-slate-800">Attendance Session Finalized</h4>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            This lecture has been locked. New presence keys cannot be generated and all check-ins are permanently blocked.
          </p>
        </div>
      ) : activeKey && activeKey.status === 'active' && secondsRemaining > 0 ? (
        /* Active Key Display Board */
        <div className="bg-gradient-to-br from-slate-900 via-brand-950 to-indigo-950 text-white rounded-3xl p-6 sm:p-8 shadow-xl relative overflow-hidden">
          <div className="relative z-10 space-y-6">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <span className="text-[11px] font-bold text-brand-300 uppercase tracking-widest">
                  Live Attendance Entry Code
                </span>
                <p className="text-xs text-slate-300 mt-0.5">
                  Instruct enrolled students to open their app and enter this code
                </p>
              </div>

              {/* Countdown Timer Badge */}
              <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-2xl bg-white/10 backdrop-blur-md border border-white/15">
                <Timer className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span className="font-mono text-sm font-bold text-emerald-300">
                  {formatCountdown(secondsRemaining)}
                </span>
                <span className="text-[10px] text-slate-300">remaining</span>
              </div>
            </div>

            {/* Prominent 6-digit Code Display */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6 py-4 px-6 rounded-2xl bg-white/5 border border-white/10 backdrop-blur-sm">
              <div className="text-center sm:text-left">
                {plainKey ? (
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-4xl sm:text-5xl font-black tracking-[0.25em] text-white">
                      {plainKey}
                    </span>
                    <button
                      onClick={handleCopyKey}
                      className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-white transition backdrop-blur-md"
                      title="Copy Key"
                    >
                      {copied ? (
                        <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                      ) : (
                        <Copy className="w-5 h-5 text-slate-300" />
                      )}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <span className="font-mono text-2xl font-bold text-amber-300">
                      Active Key Protected (SHA-256 Hashed)
                    </span>
                    <p className="text-[11px] text-slate-300">
                      Plaintext code was shown when created. Click 'Regenerate' if students need a fresh code.
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-slate-400 mt-2">
                  Session: <span className="text-slate-200 font-semibold">{session.title}</span> &bull;
                  Expires at {new Date(activeKey.expires_at).toLocaleTimeString()}
                </p>
              </div>

              {/* Action buttons */}
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setShowRegenerateModal(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-white bg-white/10 hover:bg-white/20 border border-white/20 rounded-xl transition flex items-center gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Regenerate
                </button>

                <button
                  onClick={() => setShowRevokeModal(true)}
                  className="px-3.5 py-2 text-xs font-semibold text-rose-300 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded-xl transition flex items-center gap-1.5"
                >
                  <Slash className="w-3.5 h-3.5" />
                  Revoke Key
                </button>

                <button
                  onClick={onCloseSession}
                  className="px-3.5 py-2 text-xs font-semibold text-slate-300 bg-slate-800/80 hover:bg-slate-700 border border-white/10 rounded-xl transition flex items-center gap-1.5"
                  title="Finalize and close this session"
                >
                  <Lock className="w-3.5 h-3.5" />
                  Close Session
                </button>
              </div>
            </div>

            {/* Check-in Progress Bar */}
            <div className="pt-2">
              <div className="flex items-center justify-between text-xs text-slate-300 mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-brand-400" />
                  Students Checked In
                </span>
                <span className="font-bold text-white">
                  {checkedInCount} / {totalEnrolled} (
                  {totalEnrolled > 0 ? Math.round((checkedInCount / totalEnrolled) * 100) : 0}%)
                </span>
              </div>
              <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-emerald-400 h-2 rounded-full transition-all duration-500"
                  style={{
                    width: `${totalEnrolled > 0 ? (checkedInCount / totalEnrolled) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Key Generator Form */
        <div className="p-6 bg-slate-50 rounded-3xl border border-slate-200/80 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-sm font-bold text-slate-900">Generate New Presence Key</h4>
              <p className="text-xs text-slate-500">
                Select duration and launch a cryptographic key for this session.
              </p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row items-center gap-4 pt-2">
            <div className="w-full sm:w-auto flex-1">
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Validity Duration
              </label>
              <select
                value={selectedDuration}
                onChange={(e) => setSelectedDuration(Number(e.target.value))}
                className="w-full px-3.5 py-2.5 bg-white border border-slate-200 rounded-xl text-xs sm:text-sm font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              >
                <option value={5}>5 Minutes</option>
                <option value={10}>10 Minutes (Recommended)</option>
                <option value={15}>15 Minutes</option>
                <option value={30}>30 Minutes</option>
                <option value={60}>60 Minutes</option>
              </select>
            </div>

            <div className="w-full sm:w-auto pt-0 sm:pt-6">
              <button
                onClick={handleGenerateKey}
                disabled={isGenerating}
                className="w-full sm:w-auto px-5 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    Generating...
                  </>
                ) : (
                  <>
                    <KeyRound className="w-4 h-4" />
                    Generate Attendance Key
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="p-3 bg-brand-50 rounded-2xl border border-brand-200/60 text-[11px] text-brand-900 flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-brand-600 shrink-0" />
            <span>
              Keys are salted and stored as SHA-256 hashes bound to this session ID. Replay attacks across different sessions are cryptographically impossible.
            </span>
          </div>
        </div>
      )}

      {/* Student App Check-in Simulator / Quick Test */}
      <div className="p-5 bg-slate-50/70 rounded-2xl border border-slate-200/80 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-slate-600" />
            <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider">
              Student App Endpoint Simulator (API Contract Test)
            </h4>
          </div>
          <span className="font-mono text-[10px] text-brand-700 bg-white px-2 py-0.5 rounded border border-slate-200">
            POST /api/presence/check-in
          </span>
        </div>

        <p className="text-[11px] text-slate-500">
          Test student submission using the exact backend check-in logic that your teammate's app will call over REST.
        </p>

        <form onSubmit={handleSimulateCheckIn} className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
              Select Enrolled Student
            </label>
            <select
              value={testStudentId}
              onChange={(e) => setTestStudentId(e.target.value)}
              className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs"
            >
              {enrolledStudents.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.full_name} ({s.roll_number})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[10px] font-semibold text-slate-600 uppercase mb-1">
              Presence Key Code
            </label>
            <input
              type="text"
              required
              value={testKeyCode}
              onChange={(e) => setTestKeyCode(e.target.value)}
              placeholder="e.g. 6-digit key"
              className="w-full px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-mono"
            />
          </div>

          <div className="flex items-end">
            <button
              type="submit"
              disabled={isTestingCheckIn}
              className="w-full px-4 py-2 text-xs font-semibold text-brand-700 bg-white hover:bg-brand-50 border border-brand-300 rounded-lg transition flex items-center justify-center gap-1.5 shadow-sm disabled:opacity-50"
            >
              <Send className="w-3.5 h-3.5" />
              Simulate Check-in
            </button>
          </div>
        </form>

        {testResult && (
          <div
            className={`p-3 rounded-xl border text-xs flex items-center gap-2 ${
              testResult.success
                ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                : 'bg-rose-50 border-rose-200 text-rose-900'
            }`}
          >
            {testResult.success ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Regenerate Confirmation Modal */}
      <ConfirmationModal
        isOpen={showRegenerateModal}
        title="Regenerate Presence Key?"
        message="Generating a new presence key will immediately invalidate and revoke the existing key. Any student trying to enter the old key will be rejected."
        confirmLabel="Regenerate Key"
        isDestructive={false}
        isLoading={isGenerating}
        onConfirm={handleGenerateKey}
        onCancel={() => setShowRegenerateModal(false)}
      />

      {/* Revoke Confirmation Modal */}
      <ConfirmationModal
        isOpen={showRevokeModal}
        title="Revoke Presence Key?"
        message="Revoking will permanently deactivate this key and halt all student check-ins for this session."
        confirmLabel="Revoke Key Now"
        isDestructive={true}
        isLoading={isRevoking}
        onConfirm={handleRevokeKey}
        onCancel={() => setShowRevokeModal(false)}
      />
    </div>
  );
};
