import React from 'react';
import {
  LayoutDashboard,
  Users,
  GraduationCap,
  CalendarCheck,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
  Database,
} from 'lucide-react';
import { isSupabaseConfigured } from '../../lib/supabase';

export type NavTab = 'dashboard' | 'students' | 'classes' | 'attendance' | 'reports' | 'settings';

interface SidebarProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  studentCount?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentTab,
  onSelectTab,
  isCollapsed,
  onToggleCollapse,
  isOpenMobile,
  onCloseMobile,
  studentCount,
}) => {
  const isLiveSupabase = isSupabaseConfigured();

  const navItems = [
    {
      id: 'dashboard' as NavTab,
      label: 'Overview',
      icon: LayoutDashboard,
      badge: null,
    },
    {
      id: 'students' as NavTab,
      label: 'Students',
      icon: Users,
      badge: studentCount !== undefined && studentCount > 0 ? String(studentCount) : null,
    },
    {
      id: 'classes' as NavTab,
      label: 'Classes & Courses',
      icon: GraduationCap,
      badge: null,
    },
    {
      id: 'attendance' as NavTab,
      label: 'Attendance Sessions',
      icon: CalendarCheck,
      badge: null,
    },
    {
      id: 'reports' as NavTab,
      label: 'Reports & Analytics',
      icon: BarChart3,
      badge: null,
    },
    {
      id: 'settings' as NavTab,
      label: 'Settings & Database',
      icon: Settings,
      badge: null,
    },
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpenMobile && (
        <div
          onClick={onCloseMobile}
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden transition-opacity"
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen bg-slate-900 text-slate-100 flex flex-col justify-between border-r border-slate-800 transition-all duration-300 ${
          isCollapsed ? 'w-20' : 'w-64'
        } ${
          isOpenMobile ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        {/* Top Header / Branding */}
        <div>
          <div className="h-16 flex items-center justify-between px-4 border-b border-slate-800">
            <div className="flex items-center gap-3 overflow-hidden">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-600 to-indigo-500 flex items-center justify-center shrink-0 shadow-lg shadow-brand-500/20 text-white">
                <ShieldCheck className="w-6 h-6" />
              </div>
              {!isCollapsed && (
                <div className="flex flex-col truncate">
                  <span className="font-bold tracking-tight text-white text-base leading-tight">
                    Sentinel<span className="text-brand-400">Campus</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                    Instructor Portal
                  </span>
                </div>
              )}
            </div>

            {/* Collapse toggle (desktop only) */}
            <button
              onClick={onToggleCollapse}
              className="hidden lg:flex p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
            </button>
          </div>

          {/* Navigation Items */}
          <nav className="p-3 space-y-1.5 mt-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile();
                  }}
                  title={isCollapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all group relative ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                      : 'text-slate-300 hover:text-white hover:bg-slate-800/80'
                  }`}
                >
                  <Icon
                    className={`w-5 h-5 shrink-0 transition-transform ${
                      isActive ? 'text-white' : 'text-slate-400 group-hover:text-slate-200'
                    }`}
                  />

                  {!isCollapsed && (
                    <span className="truncate text-left flex-1">{item.label}</span>
                  )}

                  {!isCollapsed && item.badge && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-semibold ${
                        isActive
                          ? 'bg-brand-700 text-brand-100'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {item.badge}
                    </span>
                  )}

                  {isCollapsed && item.badge && (
                    <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-brand-400" />
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer / Database Status */}
        <div className="p-3 border-t border-slate-800">
          <div
            className={`flex items-center gap-2.5 p-2 rounded-xl bg-slate-800/50 text-xs ${
              isCollapsed ? 'justify-center' : 'justify-between'
            }`}
          >
            <div className="flex items-center gap-2 overflow-hidden">
              <Database
                className={`w-4 h-4 shrink-0 ${
                  isLiveSupabase ? 'text-emerald-400' : 'text-amber-400'
                }`}
              />
              {!isCollapsed && (
                <div className="truncate">
                  <p className="font-semibold text-slate-200 truncate">
                    {isLiveSupabase ? 'Supabase Live' : 'Local Persistence'}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {isLiveSupabase ? 'PostgreSQL & Storage' : 'IndexedDB Engine'}
                  </p>
                </div>
              )}
            </div>

            {!isCollapsed && (
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${
                  isLiveSupabase ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'
                }`}
              />
            )}
          </div>
        </div>
      </aside>
    </>
  );
};
