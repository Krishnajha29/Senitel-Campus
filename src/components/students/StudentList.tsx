import React, { useState, useEffect, useMemo } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Eye,
  Power,
  ChevronLeft,
  ChevronRight,
  UserX,
  Download,
  Users,
  Camera,
} from 'lucide-react';
import type { Student } from '../../types';
import { ApiService } from '../../services/api';
import { StudentFormModal } from './StudentFormModal';
import { StudentProfileModal } from './StudentProfileModal';
import { ConfirmationModal } from '../common/ConfirmationModal';
import { useToast } from '../common/ToastContext';

interface StudentListProps {
  onStudentCountChange?: (count: number) => void;
}

export const StudentList: React.FC<StudentListProps> = ({ onStudentCountChange }) => {
  const [students, setStudents] = useState<Student[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('ALL');
  const [selectedYear, setSelectedYear] = useState('ALL');
  const [selectedSection, setSelectedSection] = useState('ALL');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'INACTIVE'>('ALL');

  // Sorting
  const [sortField, setSortField] = useState<'roll_number' | 'full_name' | 'course'>('roll_number');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Modals state
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [studentToEdit, setStudentToEdit] = useState<Student | null>(null);
  const [selectedStudentForProfile, setSelectedStudentForProfile] = useState<Student | null>(null);

  // Status toggle confirmation modal
  const [studentToToggle, setStudentToToggle] = useState<Student | null>(null);
  const [isToggling, setIsToggling] = useState(false);

  const toast = useToast();

  const fetchStudents = async () => {
    try {
      setIsLoading(true);
      const data = await ApiService.getStudents();
      setStudents(data);
      if (onStudentCountChange) {
        onStudentCountChange(data.length);
      }
    } catch (err: any) {
      console.error('Failed to load students:', err);
      toast.error('Failed to load student directory', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStudents();
  }, []);

  // Filter options extraction
  const courses = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.course && set.add(s.course));
    return Array.from(set);
  }, [students]);

  const years = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.academic_year && set.add(s.academic_year));
    return Array.from(set);
  }, [students]);

  const sections = useMemo(() => {
    const set = new Set<string>();
    students.forEach((s) => s.section && set.add(s.section));
    return Array.from(set);
  }, [students]);

  // Filtering & Sorting
  const filteredStudents = useMemo(() => {
    return students
      .filter((s) => {
        // Status filter
        if (statusFilter === 'ACTIVE' && !s.is_active) return false;
        if (statusFilter === 'INACTIVE' && s.is_active) return false;

        // Course filter
        if (selectedCourse !== 'ALL' && s.course !== selectedCourse) return false;

        // Year filter
        if (selectedYear !== 'ALL' && s.academic_year !== selectedYear) return false;

        // Section filter
        if (selectedSection !== 'ALL' && s.section !== selectedSection) return false;

        // Search query
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchName = s.full_name.toLowerCase().includes(q);
          const matchRoll = s.roll_number.toLowerCase().includes(q);
          const matchEmail = s.email?.toLowerCase().includes(q) || false;
          return matchName || matchRoll || matchEmail;
        }

        return true;
      })
      .sort((a, b) => {
        let valA = a[sortField] || '';
        let valB = b[sortField] || '';
        const cmp = valA.localeCompare(valB);
        return sortOrder === 'asc' ? cmp : -cmp;
      });
  }, [
    students,
    statusFilter,
    selectedCourse,
    selectedYear,
    selectedSection,
    searchQuery,
    sortField,
    sortOrder,
  ]);

  // Pagination calculation
  const totalPages = Math.ceil(filteredStudents.length / itemsPerPage) || 1;
  const paginatedStudents = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredStudents.slice(start, start + itemsPerPage);
  }, [filteredStudents, currentPage, itemsPerPage]);

  const handleSort = (field: 'roll_number' | 'full_name' | 'course') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const handleSaveStudent = async (
    data: Omit<Student, 'id' | 'instructor_id' | 'created_at' | 'updated_at'>,
    photoFile?: File,
    onProgress?: (pct: number) => void
  ) => {
    if (studentToEdit) {
      const updated = await ApiService.updateStudent(studentToEdit.id, data, photoFile, onProgress);
      toast.success('Student profile updated', `${updated.full_name} (${updated.roll_number})`);
    } else {
      const created = await ApiService.createStudent(data, photoFile, onProgress);
      toast.success('Student added successfully', `${created.full_name} (${created.roll_number})`);
    }
    await fetchStudents();
  };

  const handleToggleStatus = async () => {
    if (!studentToToggle) return;
    try {
      setIsToggling(true);
      const newStatus = !studentToToggle.is_active;
      await ApiService.toggleStudentStatus(studentToToggle.id, newStatus);
      toast.info(
        newStatus ? 'Student Activated' : 'Student Deactivated',
        `${studentToToggle.full_name} status updated to ${newStatus ? 'Active' : 'Inactive'}.`
      );
      setStudentToToggle(null);
      await fetchStudents();
    } catch (err: any) {
      toast.error('Failed to change status', err.message);
    } finally {
      setIsToggling(false);
    }
  };

  const handleExportCSV = () => {
    const rows = filteredStudents.map((s) => ({
      'Roll Number': s.roll_number,
      'Full Name': s.full_name,
      'Email': s.email || 'N/A',
      'Programme': s.course,
      'Batch': s.batch,
      'Year': s.academic_year,
      'Section': s.section,
      'Status': s.is_active ? 'Active' : 'Inactive',
      'Enrolled Date': new Date(s.created_at).toISOString().split('T')[0],
    }));

    ApiService.exportToCSV(`sentinel_students_${new Date().toISOString().split('T')[0]}`, rows);
    toast.success('Directory Exported', `${rows.length} student records exported to CSV.`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Top Banner & Action */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white p-6 rounded-3xl border border-slate-200/80 shadow-sm">
        <div>
          <h2 className="text-xl font-bold text-slate-900 flex items-center gap-2">
            <Users className="w-6 h-6 text-brand-600" />
            Registered Students Directory
          </h2>
          <p className="text-xs text-slate-500 mt-1">
            Manage student academic records, roll numbers, biometric face photos, and enrollment status.
          </p>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={handleExportCSV}
            disabled={filteredStudents.length === 0}
            className="flex-1 sm:flex-none px-3.5 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition flex items-center justify-center gap-1.5 border border-slate-200 disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-slate-600" />
            Export CSV
          </button>

          <button
            onClick={() => {
              setStudentToEdit(null);
              setIsFormOpen(true);
            }}
            className="flex-1 sm:flex-none px-4 py-2.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-xl transition shadow-md shadow-brand-600/20 flex items-center justify-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Add Student
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-sm space-y-4">
        {/* Search input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setCurrentPage(1);
            }}
            placeholder="Search by full name, roll number, or email..."
            className="w-full pl-10 pr-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition"
          />
        </div>

        {/* Filter controls row */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-1 border-t border-slate-100">
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Course / Programme
            </label>
            <select
              value={selectedCourse}
              onChange={(e) => {
                setSelectedCourse(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">All Programmes</option>
              {courses.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Academic Year
            </label>
            <select
              value={selectedYear}
              onChange={(e) => {
                setSelectedYear(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">All Years</option>
              {years.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Section
            </label>
            <select
              value={selectedSection}
              onChange={(e) => {
                setSelectedSection(e.target.value);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">All Sections</option>
              {sections.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">
              Status
            </label>
            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value as any);
                setCurrentPage(1);
              }}
              className="w-full px-2.5 py-1.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
            >
              <option value="ALL">All Students</option>
              <option value="ACTIVE">Active Only</option>
              <option value="INACTIVE">Inactive Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Main Student Table */}
      <div className="bg-white rounded-3xl border border-slate-200/80 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-slate-500 space-y-3">
            <div className="w-8 h-8 border-3 border-brand-200 border-t-brand-600 rounded-full animate-spin mx-auto" />
            <p className="text-xs font-medium">Loading registered students...</p>
          </div>
        ) : filteredStudents.length === 0 ? (
          <div className="p-12 text-center space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto">
              <UserX className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-800">No students found</h3>
              <p className="text-xs text-slate-500 max-w-sm mx-auto mt-1">
                {searchQuery || selectedCourse !== 'ALL' || statusFilter !== 'ALL'
                  ? 'No students match the current filters. Try resetting search parameters.'
                  : 'Your student directory is currently empty. Register your first student to begin.'}
              </p>
            </div>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCourse('ALL');
                setSelectedYear('ALL');
                setSelectedSection('ALL');
                setStatusFilter('ALL');
                if (students.length === 0) {
                  setIsFormOpen(true);
                }
              }}
              className="px-4 py-2 text-xs font-semibold text-brand-600 bg-brand-50 hover:bg-brand-100 rounded-xl transition inline-flex items-center gap-1.5"
            >
              {students.length === 0 ? (
                <>
                  <Plus className="w-3.5 h-3.5" /> Register Student
                </>
              ) : (
                'Clear Filters'
              )}
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50/80 text-[11px] font-bold text-slate-600 uppercase tracking-wider border-b border-slate-200/80">
                  <th className="py-3.5 px-4">Student</th>
                  <th
                    onClick={() => handleSort('roll_number')}
                    className="py-3.5 px-4 cursor-pointer hover:text-slate-900 transition"
                  >
                    Roll No. {sortField === 'roll_number' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th
                    onClick={() => handleSort('course')}
                    className="py-3.5 px-4 cursor-pointer hover:text-slate-900 transition"
                  >
                    Programme & Year {sortField === 'course' && (sortOrder === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="py-3.5 px-4">Section</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {paginatedStudents.map((student) => (
                  <tr
                    key={student.id}
                    className="hover:bg-slate-50/60 transition group cursor-pointer"
                    onClick={() => setSelectedStudentForProfile(student)}
                  >
                    {/* Student Avatar & Name */}
                    <td className="py-3.5 px-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl overflow-hidden bg-slate-100 border border-slate-200 shrink-0 shadow-sm">
                          {student.photo_url ? (
                            <img
                              src={student.photo_url}
                              alt={student.full_name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center bg-brand-50 text-brand-700 font-bold text-sm">
                              {student.full_name.charAt(0)}
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="font-bold text-slate-900 group-hover:text-brand-600 transition">
                            {student.full_name}
                          </p>
                          <p className="text-[11px] text-slate-500">
                            {student.email || 'No email provided'}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Roll Number */}
                    <td className="py-3.5 px-4">
                      <span className="font-mono font-bold text-slate-800 bg-slate-100 px-2.5 py-1 rounded-md border border-slate-200">
                        {student.roll_number}
                      </span>
                    </td>

                    {/* Programme & Year */}
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-slate-800">{student.course}</p>
                      <p className="text-[11px] text-slate-500">
                        {student.academic_year} &bull; {student.batch}
                      </p>
                    </td>

                    {/* Section */}
                    <td className="py-3.5 px-4">
                      <span className="font-medium text-slate-700">{student.section}</span>
                    </td>

                    {/* Status & Biometrics Pill */}
                    <td className="py-3.5 px-4">
                      <div className="flex flex-col gap-1 items-start">
                        <span
                          className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                            student.is_active
                              ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              student.is_active ? 'bg-emerald-500' : 'bg-slate-400'
                            }`}
                          />
                          {student.is_active ? 'Active' : 'Inactive'}
                        </span>

                        {student.face_enrollment_status === 'enrolled' ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200/80">
                            <Camera className="w-2.5 h-2.5 text-emerald-600" /> Face ID
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 bg-slate-100 px-2 py-0.5 rounded-md border border-slate-200">
                            No Face ID
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Action buttons */}
                    <td
                      className="py-3.5 px-4 text-right"
                      onClick={(e) => e.stopPropagation()} // Prevent row click
                    >
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setSelectedStudentForProfile(student)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition"
                          title="View Profile"
                        >
                          <Eye className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => {
                            setStudentToEdit(student);
                            setIsFormOpen(true);
                          }}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-slate-800 hover:bg-slate-100 transition"
                          title="Edit Details"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>

                        <button
                          onClick={() => setStudentToToggle(student)}
                          className={`p-1.5 rounded-lg transition ${
                            student.is_active
                              ? 'text-slate-400 hover:text-amber-600 hover:bg-amber-50'
                              : 'text-slate-400 hover:text-emerald-600 hover:bg-emerald-50'
                          }`}
                          title={student.is_active ? 'Deactivate' : 'Activate'}
                        >
                          <Power className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        {filteredStudents.length > 0 && (
          <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-200/80 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
            <p>
              Showing{' '}
              <span className="font-semibold text-slate-800">
                {(currentPage - 1) * itemsPerPage + 1}
              </span>{' '}
              to{' '}
              <span className="font-semibold text-slate-800">
                {Math.min(currentPage * itemsPerPage, filteredStudents.length)}
              </span>{' '}
              of <span className="font-semibold text-slate-800">{filteredStudents.length}</span>{' '}
              students
            </p>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 transition"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <span className="font-medium px-2">
                Page {currentPage} of {totalPages}
              </span>

              <button
                onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 transition"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Form Modal (Add / Edit) */}
      <StudentFormModal
        isOpen={isFormOpen}
        onClose={() => {
          setIsFormOpen(false);
          setStudentToEdit(null);
        }}
        onSubmit={handleSaveStudent}
        studentToEdit={studentToEdit}
      />

      {/* Profile Modal */}
      <StudentProfileModal
        isOpen={!!selectedStudentForProfile}
        student={selectedStudentForProfile}
        onClose={() => setSelectedStudentForProfile(null)}
        onEdit={(stu) => {
          setSelectedStudentForProfile(null);
          setStudentToEdit(stu);
          setIsFormOpen(true);
        }}
        onToggleStatus={(stu) => {
          setSelectedStudentForProfile(null);
          setStudentToToggle(stu);
        }}
      />

      {/* Confirmation Modal for Activate/Deactivate */}
      <ConfirmationModal
        isOpen={!!studentToToggle}
        title={
          studentToToggle?.is_active
            ? `Deactivate ${studentToToggle?.full_name}?`
            : `Activate ${studentToToggle?.full_name}?`
        }
        message={
          studentToToggle?.is_active
            ? 'Deactivating this student will hide them from future active class session rosters, but existing attendance records and audits will remain safe.'
            : 'Activating this student will restore their eligibility for attendance marking across enrolled classes.'
        }
        confirmLabel={studentToToggle?.is_active ? 'Deactivate Student' : 'Activate Student'}
        isDestructive={studentToToggle?.is_active}
        isLoading={isToggling}
        onConfirm={handleToggleStatus}
        onCancel={() => setStudentToToggle(null)}
      />
    </div>
  );
};
