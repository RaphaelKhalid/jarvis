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

-- Membership checks run as SECURITY DEFINER so they DON'T re-invoke RLS. Without
-- this, a policy on `classes` that reads `class_members` (and vice-versa) forms
-- an infinite-recursion loop (Postgres 42P17) that breaks reads of classes,
-- class_members AND documents (its teacher-read policy joins both). These helpers
-- break the cycle. `stable` + explicit search_path are required for definer fns.
create or replace function public.is_class_member(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from class_members where class_id = cid and student_id = auth.uid());
$$;

create or replace function public.is_class_teacher(cid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from classes where id = cid and teacher_id = auth.uid());
$$;

create or replace function public.teaches_student(student uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from class_members m join classes c on c.id = m.class_id
    where m.student_id = student and c.teacher_id = auth.uid());
$$;

create policy "own profile" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

create policy "own documents" on documents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "teacher manages own classes" on classes
  for all using (auth.uid() = teacher_id) with check (auth.uid() = teacher_id);

create policy "members see their classes" on classes
  for select using (public.is_class_member(id));

create policy "student joins/leaves own membership" on class_members
  for all using (auth.uid() = student_id) with check (auth.uid() = student_id);

create policy "teacher sees class members" on class_members
  for select using (public.is_class_teacher(class_id));

-- teacher may read progress documents of students in their classes
create policy "teacher reads student progress" on documents
  for select using (kind = 'progress' and public.teaches_student(documents.user_id));

create policy "class members see assignments" on assignments
  for select using (
    public.is_class_member(assignments.class_id) or public.is_class_teacher(assignments.class_id));

create policy "teacher manages assignments" on assignments
  for insert with check (public.is_class_teacher(class_id));

-- ── auto-provision a profile on signup ──────────────────────────
-- classes/class_members/documents all FK to profiles(id). Without this trigger,
-- the very first write after a magic-link signup FK-violates (no profile row
-- exists yet). security definer lets it insert past RLS; on conflict keeps it
-- idempotent. Backfill any users that signed up before this ran (see below).
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', 'Builder'))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- Backfill profiles for any pre-existing auth users (safe to re-run):
insert into public.profiles (id)
  select id from auth.users on conflict (id) do nothing;
