-- Classroom layer: create/join class RPCs + let a teacher read their students'
-- names. Apply in the Supabase SQL Editor (idempotent). Builds on 0001's
-- SECURITY DEFINER membership helpers (is_class_teacher / teaches_student).

-- Teacher creates a class: generate a 6-char join code, insert, and mark the
-- creator a teacher. SECURITY DEFINER so the role update + insert are atomic.
create or replace function public.create_class(p_name text)
returns public.classes language plpgsql security definer set search_path = public as $$
declare c public.classes; code text;
begin
  -- retry a couple times in the (tiny) chance of a code collision
  for i in 1..5 loop
    code := upper(substring(md5(random()::text || clock_timestamp()::text) from 1 for 6));
    begin
      insert into classes (teacher_id, name, join_code) values (auth.uid(), coalesce(nullif(trim(p_name), ''), 'My Class'), code)
        returning * into c;
      exit;
    exception when unique_violation then code := null; end;
  end loop;
  update profiles set role = 'teacher' where id = auth.uid();
  return c;
end; $$;

-- Student joins by code. SECURITY DEFINER bypasses the classes SELECT RLS
-- (a non-member can't see the class yet — chicken-and-egg). Idempotent.
create or replace function public.join_class(p_code text)
returns public.classes language plpgsql security definer set search_path = public as $$
declare c public.classes;
begin
  select * into c from classes where join_code = upper(trim(p_code));
  if c.id is null then raise exception 'No class found for that code'; end if;
  insert into class_members (class_id, student_id) values (c.id, auth.uid())
    on conflict (class_id, student_id) do nothing;
  return c;
end; $$;

-- A teacher may read the profile (name) of any student in one of their classes,
-- in addition to their own. Uses the definer helper so it can't recurse.
drop policy if exists "teacher reads member profiles" on profiles;
create policy "teacher reads member profiles" on profiles
  for select using (auth.uid() = id or public.teaches_student(id));
