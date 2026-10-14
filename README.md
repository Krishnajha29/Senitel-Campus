# Sentinel Campus — Academic Attendance & Biometric Verification Platform

**Sentinel Campus** is an enterprise-grade academic attendance management platform tailored for academic institutions, collegiate faculty, and security-critical classroom environments.

It provides a comprehensive Instructor Command Center, Smart Student Roster with private photo storage, presence-key cryptographic check-in, in-browser and server-assisted multi-face biometric matching, and real-time QR-based multi-photo classroom capture from physical smartphones.

---

## 🏛️ Architecture & Feature Overview

Sentinel Campus is built using **React 19**, **TypeScript**, **Vite**, and **Tailwind CSS**, interfacing with **Supabase Authentication**, **PostgreSQL**, and private **Supabase Storage**.

```
Sentinel Campus (Instructor Command Center)
  ├── 1. Overview Dashboard (Real-time analytics, session health, recent cohorts)
  ├── 2. Smart Student Roster (Search, sort, filter, 128-dim biometric enrollment, private photos)
  ├── 3. Classes & Cohorts (Course creation, unique section checks, student enrollment)
  ├── 4. Attendance Management (Live session tracking, single-record database constraint)
  │     ├── A. Manual Mark & Quick Roll (Present / Absent / Late toggle with undo & audit)
  │     ├── B. Secure Presence Keys (Cryptographic lecture keys, rate-limiting, student-app RPC)
  │     ├── C. Multi-Face Recognition (Simultaneous multi-face detection & Euclidean matching)
  │     └── D. QR Mobile Photo Upload (Live QR code, physical smartphone multi-angle capture)
  ├── 5. Reports & Analytics (Per-student attendance history, cohort trends, CSV exports)
  └── 6. Faculty Account Settings (Profile credentials, database migration reference, dataset controls)
```

---

## 🗄️ Database Schema & Security Architecture

The complete, idempotent production database schema is defined in:
👉 [`supabase/complete_schema.sql`](supabase/complete_schema.sql)

### PostgreSQL Tables & Constraints
1. **`instructors`**: Extends `auth.users(id)` with faculty credentials and institutional details.
2. **`students`**: Student directory with `UNIQUE(instructor_id, roll_number)` and 128-dimensional Euclidean face descriptors.
3. **`classes`**: Courses with `UNIQUE(instructor_id, code, section)`.
4. **`class_enrollments`**: Prevents duplicate enrollment: `UNIQUE(class_id, student_id)`.
5. **`attendance_sessions`**: Lecture sessions (`scheduled`, `active`, `finalized`, `cancelled`).
6. **`attendance_records`**: Enforces the **critical rule**: `UNIQUE(session_id, student_id)` — strictly at most one record per student per lecture.
7. **`attendance_audit_logs`**: Immutable audit trail for every status modification and photo scan.
8. **`presence_keys`**: Salted cryptographic presence keys with partial unique index for single active key.
9. **`presence_checkin_attempts`**: Rate limiting table guarding against key brute-force attempts.
10. **`photo_upload_sessions`**: Temporary mobile QR upload tokens with atomic state transitions.
11. **`classroom_photos`**: Multi-photo capture batch metadata.
12. **`face_scan_sessions`**: Multi-face detection audit sessions.

### Row Level Security (RLS) & Private Storage
- **Multi-Tenant Isolation**: RLS is enabled on all tables. Instructors can only query and mutate their own classes, students, and sessions (`auth.uid() = instructor_id`).
- **Student Check-in Security**: Students have **no direct write access** to `attendance_records` and submit check-ins via the `student_check_in_with_key` `SECURITY DEFINER` function.
- **Private Storage**: Buckets `student-photos` and `classroom-photos` are private (`public: false`). Photos are accessed exclusively via time-limited signed URLs (`createSignedUrl(path, 3600)`).

---

## 🚀 Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment Variables
Copy `.env.example` to `.env`:
```bash
cp .env.example .env
```

Configure your Supabase credentials in `.env`:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_your_key_here
VITE_APP_URL=http://localhost:5173
```

> **Resilient Local Persistence**: When Supabase credentials are not provided or in offline environments, Sentinel Campus automatically operates in a resilient local sandbox mode with full constraint validation, duplicate checks, and photo blob caching.

### 3. Database Migration
In your Supabase Dashboard:
1. Open the **SQL Editor** $\rightarrow$ **New query**.
2. Paste the contents of [`supabase/complete_schema.sql`](supabase/complete_schema.sql).
3. Click **Run**.
4. In **Authentication** $\rightarrow$ **Providers** $\rightarrow$ **Email**, uncheck **"Confirm email"** for instant faculty account onboarding.

### 4. Run Development Server
```bash
npm run dev
```

### 5. Run Automated Test Suite
```bash
npm test -- --run
```
Executes 95 automated unit, integration, and security tests across 6 test suites covering:
- Dashboard Command Center & Smart Roster
- Cryptographic Presence Key generation, expiration & rate-limited student check-in
- Multi-face biometric detection and matching
- QR-based mobile classroom capture and multi-photo upload batches
- Database constraints and multi-tenant RLS isolation

---

## 🔒 Security Best Practices
- Secret API keys, service-role keys, and database passwords are **never** committed or exposed in frontend client bundles.
- All client-side queries run through the Supabase Anon / Publishable key governed strictly by PostgreSQL Row Level Security.
