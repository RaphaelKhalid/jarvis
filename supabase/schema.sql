-- GYRO cloud schema (Supabase / Postgres). Apply via SQL editor or CLI.
-- Design: local-first app; these tables mirror the localStorage schemas
-- (sbl-save-v1, sbl-progress-v1) with last-write-wins per document.

-- ── profiles ────────────────────────────────────────────────────
create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Builder',
  role text not null default 'student' check (role in ('student', 'teacher')),
  created_at timestamptz not null default now()
);

-- ── classes (teacher-owned; students join by code) ─────────────
create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  name text not null,
  join_code text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists class_members (
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (class_id, student_id)
);

-- ── synced documents (assembly save + lesson progress) ─────────
create table if not exists documents (
  user_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('save', 'progress')),
  body jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, kind)
);

-- ── assignments (teacher pins a lesson for a class) ────────────
create table if not exists assignments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  lesson_id text not null,
  assigned_at timestamptz not null default now()
);

-- ── row level security ──────────────────────────────────────────
alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_members enable row level security;
alter table documents enable row level security;
alter table assignments enable row level security;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own documents" on documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "teacher manages own classes" on classes
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "members see their classes" on classes
  for select using (exists (
    select 1 from class_members m where m.class_id = id and m.student_id = auth.uid()));

create policy "student joins/leaves own membership" on class_members
  for all using (auth.uid() = student_id) with check (auth.uid() = student_id);

create policy "teacher sees class members" on class_members
  for select using (exists (
    select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()));

-- teacher may read progress documents of students in their classes
create policy "teacher reads student progress" on documents
  for select using (
    kind = 'progress' and exists (
      select 1 from class_members m
      join classes c on c.id = m.class_id
      where m.student_id = documents.user_id and c.teacher_id = auth.uid()));

create policy "class members see assignments" on assignments
  for select using (exists (
    select 1 from class_members m where m.class_id = assignments.class_id and m.student_id = auth.uid())
    or exists (select 1 from classes c where c.id = assignments.class_id and c.teacher_id = auth.uid()));

create policy "teacher manages assignments" on assignments
  for insert with check (exists (
    select 1 from classes c where c.id = class_id and c.teacher_id = auth.uid()));
