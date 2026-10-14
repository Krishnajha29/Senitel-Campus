import React, { useState, useEffect } from 'react';
import {
  GraduationCap,
  Plus,
  Users,
  Search,
  CalendarCheck,
  Edit2,
  BookOpen,
} from 'lucide-react';
import type { ClassCourse } from '../../types';
import { ApiService } from '../../services/api';
import { ClassFormModal } from './ClassFormModal';
import { ClassRosterModal } from './ClassRosterModal';
import { useToast } from '../common/ToastContext';

interface ClassListProps {
  onStartSessionForClass?: (classId: string) => void;
}

export const ClassList: React.FC<ClassListProps> = ({ onStartSessionForClass }) => {
  const [classes, setClasses] = useState<ClassCourse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [classToEdit, setClassToEdit] = useState<ClassCourse | null>(null);
  const [rosterClass, setRosterClass] = useState<ClassCourse | null>(null);

  const toast = useToast();

  const fetchClasses = async () => {
    try {
      setIsLoading(true);
      const data = await ApiService.getClasses();
      setClasses(data);
    } catch (err: any) {
      toast.error('Failed to load classes', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchClasses();
  }, []);

  const handleSaveClass = async (
    data: Omit<ClassCourse, 'id' | 'instructor_id' | 'created_at' | 'updated_at' | 'enrolled_count'>
  ) => {
    if (classToEdit) {
      const updated = await ApiService.updateClass(classToEdit.id, data);
      toast.success('Class Updated', `${updated.name} (${updated.code}) saved.`);
    } else {
      const created = await ApiService.createClass(data);
      toast.success('Class Created', `${created.name} (${created.code}) created.`);
    }
    await fetchClasses();
  };

  const filteredClasses = classes.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.academic_year.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.section.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.programme && c.programme.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (c.batch && c.batch.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <GraduationCap className="w-6 h-6 text-brand-600" />
            Classes & Academic Courses
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Organize lecture sections, manage student cohorts, and initiate attendance sessions.
          </p>
        </div>

        <button
          onClick={() => {
            setClassToEdit(null);
            setIsFormOpen(true);
          }}
          className="px-4 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Create New Class
        </button>
      </div>

      {/* Search Bar */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200/80 shadow-sm">
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search classes by name, code (e.g. CS201), year or section..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20"
          />
        </div>
      </div>

      {/* Classes Grid */}
      {isLoading ? (
        <div className="p-12 text-center text-slate-500">
          <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto mb-2" />
          <p className="text-xs font-medium">Loading classes...</p>
        </div>
      ) : filteredClasses.length === 0 ? (
        <div className="bg-white rounded-3xl p-12 text-center border border-slate-200/80 shadow-sm space-y-4">
          <BookOpen className="w-12 h-12 text-slate-300 mx-auto" />
          <div>
            <h3 className="text-sm font-bold text-slate-800">No classes found</h3>
            <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
              {searchQuery
                ? 'No classes match your search query.'
                : 'Create your first class or course to organize student enrollments and take attendance.'}
            </p>
          </div>
          <button
            onClick={() => {
              setClassToEdit(null);
              setIsFormOpen(true);
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Create Class
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filteredClasses.map((cls) => (
            <div
              key={cls.id}
              className="bg-white rounded-3xl border border-slate-200/80 shadow-sm hover:shadow-md transition p-5 flex flex-col justify-between"
            >
              <div>
                {/* Header tags */}
                <div className="flex items-center justify-between gap-2 mb-3">
                  <span className="font-mono text-xs font-bold px-2.5 py-1 rounded-lg bg-brand-50 text-brand-700 border border-brand-200">
                    {cls.code} &bull; Sec {cls.section}
                  </span>

                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                      cls.is_active
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        cls.is_active ? 'bg-emerald-500' : 'bg-slate-400'
                      }`}
                    />
                    {cls.is_active ? 'Active' : 'Inactive'}
                  </span>
                </div>

                {/* Title */}
                <h3 className="text-base font-bold text-slate-900 leading-snug">{cls.name}</h3>

                <p className="text-xs text-slate-500 mt-1">
                  Programme: <span className="font-semibold text-slate-700">{cls.section_details?.programme || cls.programme || 'Core Curriculum'}</span>
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cohort: <span className="font-semibold text-slate-700">Batch {cls.section_details?.batch || cls.batch || '2024-2028'}</span> &bull; <span className="text-slate-600">{cls.academic_year}</span>
                </p>

                {cls.description && (
                  <p className="text-xs text-slate-600 mt-2 line-clamp-2 leading-relaxed">
                    {cls.description}
                  </p>
                )}

                {/* Enrolled Count Pill & Type */}
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200/70 text-xs">
                    <Users className="w-3.5 h-3.5 text-brand-600" />
                    <span className="font-bold text-slate-800">{cls.enrolled_count || 0}</span>
                    <span className="text-slate-500">Active Students</span>
                  </div>
                  {cls.enrollment_type === 'manual' ? (
                    <span className="text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-1 rounded-lg">
                      Elective (Manual)
                    </span>
                  ) : (
                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                      Section Cohort
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between gap-2">
                <button
                  onClick={() => setRosterClass(cls)}
                  className="px-3 py-1.5 text-xs font-semibold text-slate-700 hover:text-brand-600 hover:bg-brand-50 rounded-xl transition flex items-center gap-1.5"
                >
                  <Users className="w-3.5 h-3.5" />
                  Roster
                </button>

                <div className="flex items-center gap-1">
                  <button
                    onClick={() => {
                      setClassToEdit(cls);
                      setIsFormOpen(true);
                    }}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition"
                    title="Edit Class"
                  >
                    <Edit2 className="w-4 h-4" />
                  </button>

                  {onStartSessionForClass && (
                    <button
                      onClick={() => onStartSessionForClass(cls.id)}
                      className="px-3 py-1.5 text-xs font-semibold text-brand-700 bg-brand-50 hover:bg-brand-100 rounded-xl transition flex items-center gap-1"
                    >
                      <CalendarCheck className="w-3.5 h-3.5" />
                      Session
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Form Modal */}
      <ClassFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setClassToEdit(null);
        }}
        onSubmit={handleSaveClass}
        classToEdit={classToEdit}
      />

      {/* Roster Modal */}
      <ClassRosterModal
        isOpen={!!rosterClass}
        classObj={rosterClass}
        onClose={() => setRosterClass(null)}
        onRosterUpdated={fetchClasses}
      />
    </div>
  );
};
