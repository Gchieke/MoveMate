-- ============================================================
-- MoveMate database schema — run this in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run)
--
-- Tables:
--   neighborhoods  — one row per neighborhood, join via invite_code
--   profiles       — display name + neighborhood per auth user
--   moves          — PUBLIC move listings (no exact address here)
--   move_addresses — exact address, visible ONLY to the move
--                     creator + confirmed helpers (privacy!)
--   signups        — who volunteered for what
-- ============================================================

-- ---------- tables ----------
create table neighborhoods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text unique not null,
  created_at timestamptz default now()
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  neighborhood_id uuid references neighborhoods(id) on delete set null,
  created_at timestamptz default now()
);

create table moves (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references profiles(id) on delete cascade,
  neighborhood_id uuid not null references neighborhoods(id) on delete cascade,
  title text not null,
  move_type text not null check (move_type in ('in', 'out')),
  move_date date not null,
  time_window text not null,
  area_label text not null,              -- public, e.g. "Maple Street area"
  description text,
  needed jsonb not null default '[]',    -- e.g. [{"role":"hands","count":4}]
  status text not null default 'open' check (status in ('open','full','completed','cancelled')),
  notified_at timestamptz,        -- set by the email alert function (see migrations/)
  sms_notified_at timestamptz,    -- set by the SMS alert function (see migrations/)
  created_at timestamptz default now()
);

create table move_addresses (
  move_id uuid primary key references moves(id) on delete cascade,
  address_exact text not null            -- PRIVATE: creator + helpers only
);

create table signups (
  id uuid primary key default gen_random_uuid(),
  move_id uuid not null references moves(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  role text not null,
  note text,
  created_at timestamptz default now(),
  unique(move_id, user_id, role)
);

-- Private contact preferences (phone for SMS alerts). Only the owner
-- can read/write their own row; the alert Edge Function uses the
-- service-role key and bypasses RLS.
create table contact_prefs (
  user_id uuid primary key references profiles(id) on delete cascade,
  phone text,                                   -- E.164, e.g. +15550102030
  sms_opt_in boolean not null default false,
  updated_at timestamptz default now()
);

-- ---------- realtime: new moves appear live in the app ----------
alter publication supabase_realtime add table moves;
alter publication supabase_realtime add table signups;

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
alter table neighborhoods enable row level security;
alter table profiles      enable row level security;
alter table moves         enable row level security;
alter table move_addresses enable row level security;
alter table signups       enable row level security;
alter table contact_prefs enable row level security;

-- ----- neighborhoods -----
-- Anyone signed in can look up a neighborhood by invite code (needed to join),
-- and can create a new one.
create policy "signed-in users can read neighborhoods"
  on neighborhoods for select to authenticated using (true);
create policy "signed-in users can create neighborhoods"
  on neighborhoods for insert to authenticated with check (true);

-- ----- profiles -----
create policy "users can read own profile"
  on profiles for select to authenticated using (id = auth.uid());
create policy "users can read profiles of neighborhood members"
  on profiles for select to authenticated using (
    neighborhood_id is not null and exists (
      select 1 from profiles me
      where me.id = auth.uid() and me.neighborhood_id = profiles.neighborhood_id
    )
  );
create policy "users can create own profile"
  on profiles for insert to authenticated with check (id = auth.uid());
create policy "users can update own profile"
  on profiles for update to authenticated using (id = auth.uid());

-- ----- moves (public fields only — no exact address in this table) -----
create policy "neighborhood members can read moves"
  on moves for select to authenticated using (
    exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.neighborhood_id = moves.neighborhood_id
    )
  );
create policy "members can post moves in their neighborhood"
  on moves for insert to authenticated with check (
    created_by = auth.uid() and exists (
      select 1 from profiles p
      where p.id = auth.uid() and p.neighborhood_id = moves.neighborhood_id
    )
  );
create policy "creators can update own moves"
  on moves for update to authenticated using (created_by = auth.uid());
create policy "creators can delete own moves"
  on moves for delete to authenticated using (created_by = auth.uid());

-- ----- move_addresses (PRIVATE) -----
-- Only the move creator and users who signed up to help can read it.
create policy "creators and helpers can read exact address"
  on move_addresses for select to authenticated using (
    exists (select 1 from moves m where m.id = move_addresses.move_id and m.created_by = auth.uid())
    or exists (select 1 from signups s where s.move_id = move_addresses.move_id and s.user_id = auth.uid())
  );
create policy "creators can save the address for own moves"
  on move_addresses for insert to authenticated with check (
    exists (select 1 from moves m where m.id = move_addresses.move_id and m.created_by = auth.uid())
  );

-- ----- signups -----
create policy "neighborhood members can read signups"
  on signups for select to authenticated using (
    exists (
      select 1 from moves m
      join profiles p on p.neighborhood_id = m.neighborhood_id
      where m.id = signups.move_id and p.id = auth.uid()
    )
  );
create policy "members can volunteer for open moves in their neighborhood"
  on signups for insert to authenticated with check (
    user_id = auth.uid() and exists (
      select 1 from moves m
      join profiles p on p.neighborhood_id = m.neighborhood_id
      where m.id = signups.move_id and p.id = auth.uid() and m.status = 'open'
    )
  );
create policy "users can withdraw own signups"
  on signups for delete to authenticated using (user_id = auth.uid());

-- ----- contact_prefs (PRIVATE) -----
-- Only the owner can touch their own row. The SMS Edge Function reads
-- these with the service-role key, which bypasses RLS.
create policy "users manage own contact prefs"
  on contact_prefs for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
