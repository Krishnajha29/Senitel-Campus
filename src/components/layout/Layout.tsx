import React, { useState } from 'react';
import { Sidebar } from './Sidebar';
import type { NavTab } from './Sidebar';
import { Navbar } from './Navbar';
import type { Instructor } from '../../types';

interface LayoutProps {
  currentTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  instructor: Instructor | null;
  studentCount?: number;
  onSeedDemoData: () => void;
  onResetEmptyData: () => void;
  onOpenAuthModal?: () => void;
  onSignOut?: () => void;
  children: React.ReactNode;
}

export const Layout: React.FC<LayoutProps> = ({
  currentTab,
  onSelectTab,
  instructor,
  studentCount,
  onSeedDemoData,
  onResetEmptyData,
  onOpenAuthModal,
  onSignOut,
  children,
}) => {
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const getPageTitle = (tab: NavTab): string => {
    switch (tab) {
      case 'dashboard':
        return 'Instructor Dashboard';
      case 'students':
        return 'Student Directory';
      case 'classes':
        return 'Classes & Courses';
      case 'attendance':
        return 'Attendance Management';
      case 'reports':
        return 'Reports & Analytics';
      case 'settings':
        return 'Settings & Configuration';
      default:
        return 'Sentinel Campus';
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row text-slate-900 font-sans">
      <Sidebar
        currentTab={currentTab}
        onSelectTab={onSelectTab}
        isCollapsed={isSidebarCollapsed}
        onToggleCollapse={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
        isOpenMobile={isMobileSidebarOpen}
        onCloseMobile={() => setIsMobileSidebarOpen(false)}
        studentCount={studentCount}
      />

      <div className="flex-1 flex flex-col min-w-0 min-h-screen">
        <Navbar
          instructor={instructor}
          onOpenMobileSidebar={() => setIsMobileSidebarOpen(true)}
          onNavigateSettings={() => onSelectTab('settings')}
          onSeedDemoData={onSeedDemoData}
          onResetEmptyData={onResetEmptyData}
          onOpenAuthModal={onOpenAuthModal}
          onSignOut={onSignOut}
          title={getPageTitle(currentTab)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto">
          {children}
        </main>
      </div>
    </div>
  );
};
