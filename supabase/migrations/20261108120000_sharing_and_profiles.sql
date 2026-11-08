-- Multiplayer boards: profiles, board members, invite links, shared assets, private realtime channels.
-- Additive: existing owners keep exactly the access they had.

create extension if not exists pgcrypto with schema extensions;

/* ---------- profiles ---------- */

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null unique check (username ~ '^[a-z0-9_]{3,20}$'),
  display_name text check (char_length(display_name) <= 40),
  color text not null default '#8e8e93' check (color ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

create policy "Signed-in users read profiles" on public.profiles
  for select to authenticated using (true);
create policy "Users create own profile" on public.profiles
  for insert to authenticated with check ((select auth.uid()) = id);
create policy "Users update own profile" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

/* ---------- members & invites ---------- */

alter table public.boards add column invite_token text unique;

create table public.board_members (
  board_id text not null references public.boards (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (board_id, user_id)
);
create index board_members_user_idx on public.board_members (user_id);
alter table public.board_members enable row level security;

-- SECURITY DEFINER so boards ↔ board_members policies don't recurse into each other.
create function public.can_access_board(b text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.boards where id = b and user_id = (select auth.uid()))
      or exists (select 1 from public.board_members where board_id = b and user_id = (select auth.uid()));
$$;

create policy "Members see who else is on their boards" on public.board_members
  for select to authenticated using ((select public.can_access_board(board_id)));
-- Owners can remove anyone; members can leave.
create policy "Owners remove members, members leave" on public.board_members
  for delete to authenticated using (
    user_id = (select auth.uid())
    or exists (select 1 from public.boards b where b.id = board_id and b.user_id = (select auth.uid()))
  );

/* ---------- boards: members can read and edit ---------- */

drop policy "Users read own boards" on public.boards;
drop policy "Users update own boards" on public.boards;
create policy "Owners and members read boards" on public.boards
  for select to authenticated using ((select public.can_access_board(id)));
create policy "Owners and members update boards" on public.boards
  for update to authenticated using ((select public.can_access_board(id))) with check ((select public.can_access_board(id)));

-- Ownership and the invite token can't be changed through a plain update.
revoke update on public.boards from anon, authenticated;
grant update (name, items, viewport, updated_at) on public.boards to authenticated;

/* ---------- invite RPCs ---------- */

-- Owner only. Returns the board's invite token, creating (or replacing, with reset) it.
create function public.board_invite(b text, reset boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare t text;
begin
  if not exists (select 1 from public.boards where id = b and user_id = (select auth.uid())) then
    raise exception 'Only the board owner can manage the invite link';
  end if;
  update public.boards
     set invite_token = encode(extensions.gen_random_bytes(16), 'hex')
   where id = b and (reset or invite_token is null);
  select invite_token into t from public.boards where id = b;
  return t;
end $$;

-- Owner only. Turns the link off.
create function public.revoke_board_invite(b text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.boards set invite_token = null where id = b and user_id = (select auth.uid());
end $$;

-- What an invite points at, for the "join this board?" screen.
create function public.invite_info(token text)
returns table (board_id text, board_name text, owner_username text, owner_name text, owner_color text, already_member boolean)
language sql stable security definer set search_path = '' as $$
  select b.id, b.name, p.username, p.display_name, p.color, public.can_access_board(b.id)
    from public.boards b left join public.profiles p on p.id = b.user_id
   where b.invite_token = token and token is not null;
$$;

create function public.join_board(token text) returns text
language plpgsql security definer set search_path = '' as $$
declare b public.boards;
begin
  if (select auth.uid()) is null then raise exception 'Sign in first'; end if;
  select * into b from public.boards where invite_token = token and token is not null;
  if b.id is null then raise exception 'This invite link is no longer valid'; end if;
  if b.user_id <> (select auth.uid()) then
    insert into public.board_members (board_id, user_id) values (b.id, (select auth.uid()))
    on conflict do nothing;
  end if;
  return b.id;
end $$;

/* ---------- assets ---------- */

-- Readable when a board you can open contains it.
create function public.can_read_asset(path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.boards b
     where public.can_access_board(b.id)
       and b.items @> jsonb_build_array(jsonb_build_object('assetId', split_part(path, '/', 2)))
  );
$$;
create policy "Collaborators read shared assets" on storage.objects
  for select to authenticated using (bucket_id = 'assets' and (select public.can_read_asset(name)));

-- Asset ids of yours that any board still uses (including boards you were removed from),
-- so cleanup never deletes an image someone else's board still shows.
create function public.my_used_assets() returns setof text
language sql stable security definer set search_path = '' as $$
  select distinct e ->> 'assetId'
    from public.boards b, jsonb_array_elements(b.items) e
   where e ->> 'type' = 'image' and e ? 'assetId'
     and (e ->> 'assetOwner' = (select auth.uid())::text
          or (not e ? 'assetOwner' and b.user_id = (select auth.uid())));
$$;

revoke execute on function public.can_access_board(text), public.board_invite(text, boolean), public.revoke_board_invite(text),
  public.invite_info(text), public.join_board(text), public.can_read_asset(text), public.my_used_assets() from public, anon;
grant execute on function public.can_access_board(text), public.board_invite(text, boolean), public.revoke_board_invite(text),
  public.invite_info(text), public.join_board(text), public.can_read_asset(text), public.my_used_assets() to authenticated;

/* ---------- realtime: private channel "board:<id>" for owner + members ---------- */

create policy "Board members receive board channel" on realtime.messages
  for select to authenticated using (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select public.can_access_board(split_part((select realtime.topic()), ':', 2)))
  );
create policy "Board members send on board channel" on realtime.messages
  for insert to authenticated with check (
    realtime.messages.extension in ('broadcast', 'presence')
    and (select public.can_access_board(split_part((select realtime.topic()), ':', 2)))
  );
