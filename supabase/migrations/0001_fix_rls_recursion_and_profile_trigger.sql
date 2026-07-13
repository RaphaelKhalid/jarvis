-- Migration for an ALREADY-DEPLOYED GYRO project (paste into Supabase SQL Editor).
-- Fixes two issues found in round-table #2 live verification (2026-07-13):
--   1. classes <-> class_members RLS policies recurse (42P17), breaking reads of
--      classes, class_members, AND documents (its teacher policy joins both).
--   2. No profile row is created on signup, so the first cloud write FK-violates.
-- Idempotent: safe to run more than once. (schema.sql already reflects this state
-- for fresh projects; this file is only needed to patch the existing database.)

-- ── 1. SECURITY DEFINER membership helpers (break the RLS recursion) ──
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

-- ── 2. drop the recursive policies and recreate them via the helpers ──
drop policy if exists "members see their classes" on classes;
create policy "members see their classes" on classes
  for select using (public.is_class_member(id));

drop policy if exists "teacher sees class members" on class_members;
create policy "teacher sees class members" on class_members
  for select using (public.is_class_teacher(class_id));

drop policy if exists "teacher reads student progress" on documents;
create policy "teacher reads student progress" on documents
  for select using (kind = 'progress' and public.teaches_student(documents.user_id));

drop policy if exists "class members see assignments" on assignments;
create policy "class members see assignments" on assignments
  for select using (
    public.is_class_member(assignments.class_id) or public.is_class_teacher(assignments.class_id));

drop policy if exists "teacher manages assignments" on assignments;
create policy "teacher manages assignments" on assignments
  for insert with check (public.is_class_teacher(class_id));

-- ── 3. auto-provision a profile on signup + backfill existing users ──
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
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
  for each row execute function public.handle_new_user();

insert into public.profiles (id)
  select id from auth.users on conflict (id) do nothing;
