-- ============================================================
-- 00309_signup_needs_invite_or_flag (7/11/2026)
--
-- Auditoria de seguridad. Con el registro publico de Supabase prendido (lo
-- estaba en produccion), cualquiera con la anon key (que es publica) hacia
-- POST /auth/v1/signup, confirmaba su correo y el trigger le armaba un
-- workspace como Owner: podia publicar formularios y agendas con el dominio
-- del negocio y usar las acciones que piden ser Owner de "algun" workspace.
--
-- El arreglo de fondo es apagar "Allow new users to sign up" en el panel
-- (Authentication -> Sign In / Providers). Esta migracion es la segunda
-- cerradura: `handle_new_user` ya NO le arma un workspace a cualquiera. Solo:
--   * a la PRIMERA cuenta de una instalacion vacia (asi sigue andando
--     `scripts/create-owner.mjs` y el alta desde el panel en un clon nuevo);
--   * a una cuenta creada por el servidor con
--     `app_metadata.ssa_create_workspace = true`. `app_metadata` solo lo
--     escribe la API de admin (service role): un registro publico no puede
--     ponerlo.
-- La invitacion valida sigue igual: no se crea workspace (registerFromInvite
-- suma la membresia). Una cuenta sin nada de esto queda sin workspace y la
-- app la manda al login (lib/workspace.ts).
--
-- Los scripts de verificacion crean sus usuarios con la marca.
--
-- Definicion anterior (00119), copiada de la base el 7/11/2026:
--
--   create or replace function public.handle_new_user()
--   returns trigger as $$
--   declare
--     ws_id uuid;
--     user_name text;
--     workspace_slug text;
--     v_invite_id uuid;
--     v_has_pending_invite boolean;
--   begin
--     v_invite_id := (new.raw_user_meta_data->>'invite_id')::uuid;
--     if v_invite_id is not null then
--       select exists (
--         select 1 from public.workspace_invites
--         where id = v_invite_id
--           and email = new.email
--           and status = 'pending'
--           and expires_at > now()
--       ) into v_has_pending_invite;
--
--       if v_has_pending_invite then
--         return new;
--       end if;
--     end if;
--
--     user_name := coalesce(
--       new.raw_user_meta_data->>'full_name',
--       new.raw_user_meta_data->>'name',
--       split_part(new.email, '@', 1)
--     );
--     workspace_slug := lower(regexp_replace(user_name, '[^a-zA-Z0-9]', '-', 'g')) || '-' || substr(new.id::text, 1, 8);
--
--     insert into public.workspaces (name, slug)
--     values (user_name || '''s Workspace', workspace_slug)
--     returning id into ws_id;
--
--     insert into public.workspace_members (workspace_id, user_id, role)
--     values (ws_id, new.id, 'owner');
--
--     return new;
--   exception when others then
--     raise log 'handle_new_user error: % %', sqlerrm, sqlstate;
--     return new;
--   end;
--   $$ language plpgsql security definer set search_path = public;
--
-- Idempotente (CREATE OR REPLACE con la misma firma; el trigger no cambia).
-- Puede ir antes o despues del deploy.
-- ============================================================

create or replace function public.handle_new_user()
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

  -- 00309: un registro publico no se arma un negocio. Solo la primera cuenta
  -- de una instalacion vacia, o una creada por el servidor con la marca en
  -- app_metadata (que el registro publico no puede escribir).
  if coalesce(new.raw_app_meta_data->>'ssa_create_workspace', '') <> 'true'
     and exists (select 1 from public.workspaces) then
    return new;
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

revoke all on function public.handle_new_user() from public, anon, authenticated;
