-- TCRS HQ database (Supabase / Postgres)
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to re-run: it only creates what is missing.
-- Roles: admin (everything + settings), sales (everything), tv (read only).
-- Every new login starts as "sales". Change roles at the bottom of this file.

create extension if not exists pgcrypto;

-- ───────── People ─────────
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null default 'sales' check (role in ('admin','sales','tv')),
  created_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email,'@',1)))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- backfill profiles for users created before this script ran
insert into public.profiles (id, name)
select id, split_part(email,'@',1) from auth.users
on conflict (id) do nothing;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

-- ───────── Customers (one row = one lead / project) ─────────
create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text, email text, address text, city text, zip text,
  source text,                 -- how they found us
  ctype text,                  -- homeowner / contractor / flipper / designer / landlord
  repeat boolean not null default false,
  products text[] not null default '{}',
  services text[] not null default '{}',
  budget numeric,
  timeline text,
  stage text not null default 'new',
  status_override text check (status_override in ('red','yellow','green')),
  first_contact date default current_date,
  measure_date date, delivery_date date, install_date date,
  revisions int not null default 0,
  intake_complete boolean not null default false,
  conversion int check (conversion between 1 and 5),
  tldr text,
  est_price numeric,
  paid jsonb,                  -- {amount, method: quickbooks|clover|other, at, ref}
  lost jsonb,                  -- {reason, at}
  notes text,
  data jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.actions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  title text not null,
  due date,
  waiting_on text not null default 'us' check (waiting_on in ('us','supplier','contractor','customer')),
  owner uuid,
  done boolean not null default false,
  done_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.logs (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  kind text not null default 'note',  -- email / call / text / note / upload / system
  at timestamptz not null default now(),
  summary text,
  body text,
  who text check (who in ('us','customer','supplier','contractor')),  -- who spoke
  by uuid default auth.uid()
);

create table if not exists public.files (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  path text not null,          -- storage path in bucket "files"
  name text not null,
  ftype text not null default 'Other', -- Photo / Layout / Rendering / Supplier quote / Contractor quote / Estimate / Quote / Agreement / Scan / Other
  version int not null default 1,
  size int, mime text,
  by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.sizes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  what text not null,          -- e.g. "Wall A", "Cabinet base run", "Basement floor"
  value numeric,
  unit text,                   -- in / ft / lf / sf / ea
  source text,                 -- tape / layout / photo / scan / customer / grid
  created_at timestamptz not null default now()
);

create table if not exists public.layouts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  name text not null default 'Layout',
  version int not null default 1,
  plan jsonb not null default '{}'::jsonb,
  takeoff jsonb,
  is_revision boolean not null default false,
  by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references public.customers(id) on delete cascade,
  number text,
  mode text not null default 'estimate' check (mode in ('estimate','quote')),
  status text not null default 'draft' check (status in ('draft','sent','accepted','declined')),
  sections jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  sent_at timestamptz, accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ───────── What HQ learns from ─────────
create table if not exists public.pricebook (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  product text,                -- Cabinets / Countertops / Flooring / Appliances / Other
  kind text,                   -- material / install / delivery / fee
  unit text,
  cost numeric,                -- what TCRS pays
  markup numeric,              -- % on cost
  partner text,
  uses int not null default 0,
  won int not null default 0,  -- times on a quote that got paid
  history jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  ptype text not null default 'supplier' check (ptype in ('supplier','contractor')),
  trades text,
  phone text, email text,
  discount_pct numeric,        -- supplier discount off list
  referral_pct numeric,        -- referral fee the contractor pays TCRS
  notes text,
  jobs int not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.docs (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'SOP' check (kind in ('SOP','FAQ','Doc')),
  body text, url text,
  tags text[] not null default '{}',
  pinned boolean not null default false,
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  context text,                -- parse / lines / quote
  rating int,                  -- 1 = good, -1 = bad
  note text,
  by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- ───────── Security: logged-in team reads; admin + sales write; tv reads only ─────────
do $$
declare t text;
begin
  foreach t in array array['customers','actions','logs','files','sizes','layouts','quotes','pricebook','partners','docs','feedback','settings'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "%s read" on public.%I', t, t);
    execute format('drop policy if exists "%s write" on public.%I', t, t);
    execute format('create policy "%s read" on public.%I for select to authenticated using (public.my_role() in (''admin'',''sales'',''tv''))', t, t);
    execute format('create policy "%s write" on public.%I for all to authenticated using (public.my_role() in (''admin'',''sales'')) with check (public.my_role() in (''admin'',''sales''))', t, t);
  end loop;
end $$;

alter table public.profiles enable row level security;
drop policy if exists "profiles read" on public.profiles;
drop policy if exists "profiles admin" on public.profiles;
drop policy if exists "profiles self name" on public.profiles;
create policy "profiles read" on public.profiles for select to authenticated using (true);
create policy "profiles admin" on public.profiles for update to authenticated using (public.my_role() = 'admin') with check (true);

-- ───────── File storage ─────────
insert into storage.buckets (id, name, public) values ('files','files', false)
on conflict (id) do nothing;

drop policy if exists "hq files read" on storage.objects;
drop policy if exists "hq files write" on storage.objects;
drop policy if exists "hq files update" on storage.objects;
drop policy if exists "hq files delete" on storage.objects;
create policy "hq files read" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.my_role() in ('admin','sales','tv'));
create policy "hq files write" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.my_role() in ('admin','sales'));
create policy "hq files update" on storage.objects for update to authenticated
  using (bucket_id = 'files' and public.my_role() in ('admin','sales'));
create policy "hq files delete" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.my_role() in ('admin','sales'));

-- ───────── Live updates (TV board refreshes itself) ─────────
do $$
declare t text;
begin
  foreach t in array array['customers','actions','quotes','logs','files','layouts'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ───────── Starting settings (edit later in HQ → Settings) ─────────
insert into public.settings (id, data) values ('main', '{
  "markupDefault": 25,
  "markupOneOff": 55,
  "markupFloor": 25,
  "referralPct": 15,
  "depositAmount": 250,
  "revisionsIncluded": 2,
  "revisionBonusIfIntakeComplete": 1,
  "revisionFee": 200,
  "taxRate": null,
  "staleDays": 3,
  "quoteValidDays": 30
}'::jsonb) on conflict (id) do nothing;

-- ───────── Roles: run these after everyone has a login ─────────
-- update public.profiles set role = 'admin' where id = (select id from auth.users where email = 'nathan@tcremodelingsupply.com');
-- update public.profiles set role = 'tv'    where id = (select id from auth.users where email = 'tv@tcremodelingsupply.com');
