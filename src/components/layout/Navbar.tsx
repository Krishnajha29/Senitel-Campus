import React, { useState, useRef, useEffect } from 'react';
import { Menu, LogOut, Settings, Sparkles, RefreshCw } from 'lucide-react';
import type { Instructor } from '../../types';
import { isSupabaseConfigured } from '../../lib/supabase';

interface NavbarProps {
  instructor: Instructor | null;
  onOpenMobileSidebar: () => void;
  onNavigateSettings: () => void;
  onSeedDemoData: () => void;
  onResetEmptyData: () => void;
  onOpenAuthModal?: () => void;
  onSignOut?: () => void;
  title: string;
}

export const Navbar: React.FC<NavbarProps> = ({
  instructor,
  onOpenMobileSidebar,
  onNavigateSettings,
  onSeedDemoData,
  onResetEmptyData,
  onOpenAuthModal,
  onSignOut,
  title,
}) => {
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isDataMenuOpen, setIsDataMenuOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const dataMenuRef = useRef<HTMLDivElement>(null);

  const isLive = isSupabaseConfigured();

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setIsProfileOpen(false);
      }
      if (dataMenuRef.current && !dataMenuRef.current.contains(e.target as Node)) {
        setIsDataMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <header className="h-16 bg-white border-b border-slate-200 sticky top-0 z-30 flex items-center justify-between px-4 sm:px-6">
      {/* Left side: Mobile Toggle & Page Title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onOpenMobileSidebar}
          className="lg:hidden p-2 rounded-xl text-slate-600 hover:text-slate-900 hover:bg-slate-100 transition"
          aria-label="Open sidebar"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div>
          <h1 className="text-lg font-bold text-slate-900 leading-tight">{title}</h1>
          <p className="text-xs text-slate-500 hidden sm:block">
            {instructor?.institution || 'Sentinel Campus'} &bull; {instructor?.department || 'Faculty'}
          </p>
        </div>
      </div>

      {/* Right side: Database State & Profile Menu */}
      <div className="flex items-center gap-3">
        {/* Dataset controls dropdown (Demo vs Empty) */}
        <div className="relative" ref={dataMenuRef}>
          <button
            onClick={() => setIsDataMenuOpen(!isDataMenuOpen)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-slate-100 hover:bg-slate-200 text-slate-700 transition border border-slate-200/80"
          >
            <Sparkles className="w-3.5 h-3.5 text-brand-600" />
            <span className="hidden md:inline">Demo & Reset</span>
            <span className="md:hidden">Data</span>
          </button>

          {isDataMenuOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-50 animate-fade-in">
              <div className="px-3 py-2 border-b border-slate-100">
                <p className="text-xs font-bold text-slate-800">Dataset Control</p>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Test new account states or load demo records.
                </p>
              </div>

              <div className="py-1">
                <button
                  onClick={() => {
                    onSeedDemoData();
                    setIsDataMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 rounded-xl flex items-center gap-2 transition"
                >
                  <Sparkles className="w-4 h-4 text-brand-600" />
                  <div>
                    <p className="font-semibold">Load Sample Data</p>
                    <p className="text-[10px] text-slate-500">Seed realistic classes & students</p>
                  </div>
                </button>

                <button
                  onClick={() => {
                    onResetEmptyData();
                    setIsDataMenuOpen(false);
                  }}
                  className="w-full text-left px-3 py-2 text-xs font-medium text-rose-700 hover:bg-rose-50 rounded-xl flex items-center gap-2 transition mt-1"
                >
                  <RefreshCw className="w-4 h-4 text-rose-600" />
                  <div>
                    <p className="font-semibold">Reset to Zero / Empty</p>
                    <p className="text-[10px] text-slate-500">Test fresh instructor onboarding</p>
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Database mode pill */}
        <div
          className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${
            isLive
              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
              : 'bg-amber-50 text-amber-700 border-amber-200'
          }`}
        >
          <span
            className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500' : 'bg-amber-500'}`}
          />
          {isLive ? 'Supabase Connected' : 'Local Sandbox Mode'}
        </div>

        {/* Instructor Profile Dropdown or Sign In */}
        {instructor ? (
          <div className="relative" ref={profileRef}>
            <button
              onClick={() => setIsProfileOpen(!isProfileOpen)}
              className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-slate-100 transition"
            >
              <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
                {instructor?.full_name?.charAt(0) || 'I'}
              </div>
              <div className="text-left hidden md:block">
                <p className="text-xs font-bold text-slate-900 leading-tight">
                  {instructor?.full_name || 'Instructor'}
                </p>
                <p className="text-[11px] text-slate-500 leading-tight truncate max-w-[130px]">
                  {instructor?.email || 'faculty@campus.edu'}
                </p>
              </div>
            </button>

            {isProfileOpen && (
              <div className="absolute right-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-100 p-2 z-50 animate-fade-in">
                <div className="px-3 py-2.5 border-b border-slate-100">
                  <p className="text-sm font-bold text-slate-900">{instructor?.full_name}</p>
                  <p className="text-xs text-slate-500">{instructor?.email}</p>
                  <span className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-50 text-brand-700">
                    {instructor?.institution || 'Sentinel University'}
                  </span>
                </div>

                <div className="py-1">
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      onNavigateSettings();
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 rounded-xl flex items-center gap-2 transition"
                  >
                    <Settings className="w-4 h-4 text-slate-400" />
                    Account & System Settings
                  </button>
                </div>

                <div className="pt-1 border-t border-slate-100">
                  <button
                    onClick={() => {
                      setIsProfileOpen(false);
                      if (onSignOut) {
                        onSignOut();
                      } else {
                        onNavigateSettings();
                      }
                    }}
                    className="w-full text-left px-3 py-2 text-xs font-medium text-rose-600 hover:bg-rose-50 rounded-xl flex items-center gap-2 transition"
                  >
                    <LogOut className="w-4 h-4 text-rose-500" />
                    Sign Out
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={onOpenAuthModal}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-brand-600 hover:bg-brand-700 text-white transition shadow-sm"
          >
            Sign In
          </button>
        )}
      </div>
    </header>
  );
};
