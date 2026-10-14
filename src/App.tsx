import React, { useState, useEffect, useCallback } from 'react';
import { Layout } from './components/layout/Layout';
import type { NavTab } from './components/layout/Sidebar';
import { DashboardView } from './components/dashboard/DashboardView';
import { StudentList } from './components/students/StudentList';
import { ClassList } from './components/classes/ClassList';
import { SessionList } from './components/attendance/SessionList';
import { ReportsView } from './components/reports/ReportsView';
import { SettingsView } from './components/settings/SettingsView';
import { ToastProvider, useToast } from './components/common/ToastContext';
import type { Instructor } from './types';
import { ApiService } from './services/api';
import { LocalDatabase } from './services/localDb';
import { MobilePhotoUploadPage } from './components/mobile/MobilePhotoUploadPage';
import { AuthModal } from './components/auth/AuthModal';
import { isSupabaseConfigured } from './lib/supabase';
import { ShieldCheck, LogIn } from 'lucide-react';

const isMobileUploadPath = (): boolean => {
  if (typeof window === 'undefined') return false;
  const path = window.location.pathname;
  const search = window.location.search;
  const hash = window.location.hash;
  return (
    path.startsWith('/attendance-upload') ||
    path.startsWith('/mobile-upload') ||
    new URLSearchParams(search).has('token') ||
    hash.includes('attendance-upload') ||
    hash.includes('token=')
  );
};

const MainApp: React.FC = () => {
  const [currentTab, setCurrentTab] = useState<NavTab>('dashboard');
  const [instructor, setInstructor] = useState<Instructor | null>(null);
  const [studentCount, setStudentCount] = useState<number>(0);
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Deep linking props
  const [selectedClassIdForSession, setSelectedClassIdForSession] = useState<string | undefined>(undefined);

  const toast = useToast();

  const loadInstructor = useCallback(async () => {
    try {
      const current = await ApiService.getCurrentInstructor();
      setInstructor(current);
      const students = await ApiService.getStudents();
      setStudentCount(students.length);
    } catch (err) {
      console.error('Failed to load instructor:', err);
    }
  }, []);

  useEffect(() => {
    loadInstructor();
  }, [loadInstructor, refreshKey]);

  // Demo & Reset Handlers
  const handleSeedDemoData = () => {
    LocalDatabase.seedDemoData();
    setRefreshKey((k) => k + 1);
    toast.success('Demo Data Loaded', 'Sample students, classes, and attendance records seeded.');
  };

  const handleResetEmptyData = () => {
    LocalDatabase.resetToEmpty();
    setRefreshKey((k) => k + 1);
    toast.info('Account Cleared', 'Reset to empty state with zero baseline records.');
  };

  const handleStartSessionForClass = (classId: string) => {
    setSelectedClassIdForSession(classId);
    setCurrentTab('attendance');
  };

  const handleSignOut = async () => {
    try {
      await ApiService.signOut();
      setInstructor(null);
      toast.info('Signed Out', 'You have been signed out from faculty session.');
      setRefreshKey((k) => k + 1);
    } catch (err: any) {
      toast.error('Sign Out Failed', err.message);
    }
  };

  const isLive = isSupabaseConfigured();

  return (
    <>
      <Layout
        currentTab={currentTab}
        onSelectTab={(tab) => {
          if (tab !== 'attendance') {
            setSelectedClassIdForSession(undefined);
          }
          setCurrentTab(tab);
        }}
        instructor={instructor}
        studentCount={studentCount}
        onSeedDemoData={handleSeedDemoData}
        onResetEmptyData={handleResetEmptyData}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
        onSignOut={handleSignOut}
      >
        {isLive && !instructor && (
          <div className="mb-6 p-4 rounded-2xl bg-gradient-to-r from-brand-900 to-indigo-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-md animate-fade-in border border-brand-700/50">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5 text-emerald-400" />
              </div>
              <div>
                <p className="text-xs font-bold">Supabase Cloud Connected</p>
                <p className="text-[11px] text-slate-300">
                  Authenticate your faculty account to synchronize records with PostgreSQL and Row Level Security.
                </p>
              </div>
            </div>
            <button
              onClick={() => setIsAuthModalOpen(true)}
              className="px-4 py-2 rounded-xl text-xs font-bold bg-white text-brand-900 hover:bg-slate-100 transition shrink-0 flex items-center justify-center gap-1.5 shadow-sm"
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign In / Register
            </button>
          </div>
        )}

        <div key={refreshKey}>
          {currentTab === 'dashboard' && (
            <DashboardView
              instructor={instructor}
              onNavigate={(tab) => setCurrentTab(tab)}
              onOpenSession={() => {
                setCurrentTab('attendance');
              }}
              onOpenClassRoster={() => {
                setCurrentTab('classes');
              }}
              onSeedDemoData={handleSeedDemoData}
            />
          )}

          {currentTab === 'students' && (
            <StudentList onStudentCountChange={setStudentCount} />
          )}

          {currentTab === 'classes' && (
            <ClassList onStartSessionForClass={handleStartSessionForClass} />
          )}

          {currentTab === 'attendance' && (
            <SessionList initialClassId={selectedClassIdForSession} />
          )}

          {currentTab === 'reports' && <ReportsView />}

          {currentTab === 'settings' && (
            <SettingsView
              instructor={instructor}
              onInstructorUpdated={loadInstructor}
              onSeedDemoData={handleSeedDemoData}
              onResetEmptyData={handleResetEmptyData}
            />
          )}
        </div>
      </Layout>

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthSuccess={() => {
          loadInstructor();
          setRefreshKey((k) => k + 1);
        }}
        onContinueSandbox={() => {
          LocalDatabase.seedDemoData();
          loadInstructor();
          setRefreshKey((k) => k + 1);
        }}
      />
    </>
  );
};

export function App() {
  if (isMobileUploadPath()) {
    return <MobilePhotoUploadPage />;
  }

  return (
    <ToastProvider>
      <MainApp />
    </ToastProvider>
  );
}

export default App;
