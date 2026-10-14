import React, { useState } from 'react';
import {
  Settings,
  User,
  Database,
  ShieldCheck,
  Save,
  CheckCircle2,
  Copy,
  RefreshCw,
  Sparkles,
} from 'lucide-react';
import type { Instructor } from '../../types';
import { ApiService } from '../../services/api';
import { isSupabaseConfigured } from '../../lib/supabase';
import { useToast } from '../common/ToastContext';

interface SettingsViewProps {
  instructor: Instructor | null;
  onInstructorUpdated: () => void;
  onSeedDemoData: () => void;
  onResetEmptyData: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  instructor,
  onInstructorUpdated,
  onSeedDemoData,
  onResetEmptyData,
}) => {
  const [fullName, setFullName] = useState(instructor?.full_name || '');
  const [email, setEmail] = useState(instructor?.email || '');
  const [institution, setInstitution] = useState(instructor?.institution || 'Sentinel University');
  const [department, setDepartment] = useState(
    instructor?.department || 'Department of Computer Science & Engineering'
  );

  const [isSaving, setIsSaving] = useState(false);
  const [copiedSql, setCopiedSql] = useState(false);

  const isLive = isSupabaseConfigured();
  const toast = useToast();

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      await ApiService.updateInstructorProfile({
        full_name: fullName.trim(),
        email: email.trim(),
        institution: institution.trim(),
        department: department.trim(),
      });
      toast.success('Profile Updated', 'Faculty credentials have been saved.');
      onInstructorUpdated();
    } catch (err: any) {
      toast.error('Failed to update profile', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const copySqlSchema = () => {
    const sqlPath = 'supabase/complete_schema.sql';
    navigator.clipboard.writeText(`-- View unified production schema: ${sqlPath}`);
    setCopiedSql(true);
    setTimeout(() => setCopiedSql(false), 2500);
    toast.info('Migration Reference Copied', 'Check supabase/complete_schema.sql in codebase.');
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
      {/* Top Banner */}
      <div className="bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
          <Settings className="w-6 h-6 text-brand-600" />
          Settings & Institutional Configuration
        </h2>
        <p className="text-xs text-slate-500 mt-1">
          Configure faculty account details, inspect database connection, and manage datasets.
        </p>
      </div>

      {/* Instructor Profile Form */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-6">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <User className="w-5 h-5 text-brand-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Faculty Instructor Profile</h3>
            <p className="text-xs text-slate-500">Your profile details appear on attendance records and audits.</p>
          </div>
        </div>

        <form onSubmit={handleSaveProfile} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Instructor Full Name
              </label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Official Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Institution / University
              </label>
              <input
                type="text"
                required
                value={institution}
                onChange={(e) => setInstitution(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Academic Department
              </label>
              <input
                type="text"
                required
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                disabled={isSaving}
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
              />
            </div>
          </div>

          <div className="pt-3 flex justify-end">
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2"
            >
              {isSaving ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Profile
                </>
              )}
            </button>
          </div>
        </form>
      </div>

      {/* Database & Storage Architecture */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <Database className="w-5 h-5 text-indigo-600" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Database & Storage Status</h3>
            <p className="text-xs text-slate-500">PostgreSQL tables, Row Level Security, and photo bucket</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Database Backend</span>
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                  isLive
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                    : 'bg-amber-50 text-amber-700 border-amber-200'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`}
                />
                {isLive ? 'Supabase Connected' : 'Local IndexedDB Engine'}
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              {isLive
                ? 'Connected to live Supabase PostgreSQL with multi-tenant Row Level Security isolation.'
                : 'Running on high-performance local IndexedDB with constraint checking and image caching.'}
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-slate-50 border border-slate-200/80 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-700">Storage Bucket</span>
              <span className="font-mono text-[10px] font-semibold text-slate-700 bg-white px-2 py-0.5 rounded border border-slate-200">
                student-photos (Private)
              </span>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Images are stored with access-controlled signed URLs. No raw base64 or public URLs are exposed.
            </p>
          </div>
        </div>

        {/* Database Migration file link */}
        <div className="p-4 rounded-2xl bg-slate-900 text-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
          <div>
            <p className="font-bold text-white flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
              SQL Schema & RLS Policies Ready
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              File: <code className="font-mono text-brand-300">supabase/complete_schema.sql</code>
            </p>
          </div>

          <button
            onClick={copySqlSchema}
            className="px-3.5 py-1.5 text-xs font-semibold bg-white/10 hover:bg-white/20 text-white rounded-xl transition flex items-center gap-1.5 shrink-0"
          >
            {copiedSql ? (
              <>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" /> Copy Path
              </>
            )}
          </button>
        </div>
      </div>

      {/* Dataset & Testing Controls */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 pb-4 border-b border-slate-100">
          <Sparkles className="w-5 h-5 text-amber-500" />
          <div>
            <h3 className="text-sm font-bold text-slate-900">Dataset & Demo Controls</h3>
            <p className="text-xs text-slate-500">Test different account lifecycle states</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="p-4 rounded-2xl border border-brand-200 bg-brand-50/50 flex flex-col justify-between space-y-3">
            <div>
              <span className="text-[10px] font-bold text-brand-700 bg-brand-100 px-2 py-0.5 rounded uppercase tracking-wider">
                Demo Dataset
              </span>
              <h4 className="text-xs font-bold text-slate-900 mt-2">Seed Sample Records</h4>
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Loads sample students with profile photos, enrolled classes, and finalized attendance sessions.
              </p>
            </div>

            <button
              onClick={onSeedDemoData}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-sm w-full"
            >
              Load Demo Dataset
            </button>
          </div>

          <div className="p-4 rounded-2xl border border-rose-200 bg-rose-50/50 flex flex-col justify-between space-y-3">
            <div>
              <span className="text-[10px] font-bold text-rose-700 bg-rose-100 px-2 py-0.5 rounded uppercase tracking-wider">
                Zero Baseline
              </span>
              <h4 className="text-xs font-bold text-slate-900 mt-2">Reset to Empty Account</h4>
              <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">
                Clears all records to test clean zero states and new instructor onboarding.
              </p>
            </div>

            <button
              onClick={onResetEmptyData}
              className="px-3.5 py-2 text-xs font-semibold text-rose-700 bg-white hover:bg-rose-100 border border-rose-300 rounded-xl transition shadow-sm w-full"
            >
              Reset to Empty State
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
