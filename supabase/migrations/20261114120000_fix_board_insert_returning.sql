-- Creating a board does INSERT ... RETURNING, which must also pass the SELECT policy.
-- can_access_board() is STABLE, so it looks the board up in a snapshot taken before the insert
-- and never sees the new row: every create (and duplicate) failed RLS. Check ownership on the row itself first.
drop policy "Owners and members read boards" on public.boards;
create policy "Owners and members read boards" on public.boards
  for select to authenticated using ((select auth.uid()) = user_id or (select public.can_access_board(id)));
