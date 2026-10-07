-- ============================================================
-- 00119_invite_signup_no_workspace.sql
--
-- Hasta ahora, CUALQUIER alta en auth.users recibia un workspace propio via
-- el trigger on_auth_user_created (00001): el registro publico estaba
-- abierto en /register, asi que cualquiera terminaba con su propio negocio.
--
-- El registro publico se sacó (lib/actions/team.ts, registerFromInvite): la
-- unica forma de crear una cuenta es aceptando una invitacion. Pero el
-- trigger viejo seguia creando un workspace de mentira ANTES de que
-- registerFromInvite sumara a la persona al workspace de la invitacion, asi
-- que terminaba con DOS: el suyo, vacio, y el real.
--
-- Unico cambio sobre la 00001: si new.raw_user_meta_data trae un 'invite_id'
-- que corresponde a una invitacion PENDIENTE para ese mismo email, no se crea
-- workspace ni membership aca. El alta la termina registerFromInvite llamando
-- a finalizeAcceptInvite, que suma a la persona al workspace correcto.
--
-- Definicion vieja completa (00001), por si hay que volver atras:
--
-- create or replace function handle_new_user()
-- returns trigger as $$
-- declare
--   ws_id uuid;
--   user_name text;
--   workspace_slug text;
-- begin
--   user_name := coalesce(
--     new.raw_user_meta_data->>'full_name',
--     new.raw_user_meta_data->>'name',
--     split_part(new.email, '@', 1)
--   );
--   workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);
--
--   insert into public.workspaces (name, slug)
--   values (user_name || '''s Workspace', workspace_slug)
--   returning id into ws_id;
--
--   insert into public.workspace_members (workspace_id, user_id, role)
--   values (ws_id, new.id, 'owner');
--
--   return new;
-- exception when others then
--   raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
--   return new;
-- end;
-- $$ language plpgsql security definer set search_path = public;
-- ============================================================

create or replace function handle_new_user()
returns trigger as $$
declare
  ws_id uuid;
  user_name text;
  workspace_slug text;
  v_invite_id uuid;
  v_has_pending_invite boolean;
begin
  -- Alta por invitacion: no se crea workspace propio. registerFromInvite ya
  -- valido la invitacion antes de crear esta cuenta y suma la membresia el
  -- mismo, con finalizeAcceptInvite.
  v_invite_id := (new.raw_user_meta_data->>'invite_id')::uuid;
  if v_invite_id is not null then
    select exists (
      select 1 from public.workspace_invites
      where id = v_invite_id
        and email = new.email
        and status = 'pending'
        and expires_at > now()
    ) into v_has_pending_invite;

    if v_has_pending_invite then
      return new;
    end if;
  end if;

  user_name := coalesce(
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'name',
    split_part(new.email, '@', 1)
  );
  workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);

  insert into public.workspaces (name, slug)
  values (user_name || '''s Workspace', workspace_slug)
  returning id into ws_id;

  insert into public.workspace_members (workspace_id, user_id, role)
  values (ws_id, new.id, 'owner');

  return new;
exception when others then
  raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
  return new;
end;
$$ language plpgsql security definer set search_path = public;
