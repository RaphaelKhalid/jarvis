-- Paid entitlement tier on the profile. Apply in the Supabase SQL Editor.
-- Default 'free'; a Stripe webhook (later) flips a buyer to 'pro'. The existing
-- "own profile" RLS already lets a user read their own tier; only a server
-- (service-role) should ever write 'pro'.
alter table public.profiles
  add column if not exists tier text not null default 'free'
  check (tier in ('free', 'pro'));
