-- ============================================================
-- 00316_signup_flag_after_update (7/11/2026)
--
-- Corrige la 00309. La marca `app_metadata.ssa_create_workspace` que pasan
-- `scripts/create-owner.mjs` y los `verify-*` NO llega en el INSERT de
-- auth.users: la API de admin de Supabase crea la cuenta y escribe
-- `app_metadata` despues, con un UPDATE. El trigger de alta (AFTER INSERT) no
-- la veia y la cuenta quedaba sin workspace (lo atajo
-- `verify-workspace-isolation --despues-de-00309`).
--
-- Ahora `handle_new_user` tambien corre AFTER UPDATE OF raw_app_meta_data:
-- cuando la marca pasa a `true` y la persona todavia no es miembro de ningun
-- workspace, le arma el suyo (el mismo camino que el alta). Si ya tiene uno
-- (por ejemplo la primera cuenta de una instalacion, que lo recibio en el
-- INSERT), no hace nada. `app_metadata` no lo puede escribir un usuario: un
-- registro publico sigue sin negocio.
--
-- La definicion anterior es la de la 00309 (supabase/migrations/00309_*.sql);
-- lo unico que se agrega es el bloque "00316" del principio.
--
-- Idempotente. Puede ir antes o despues del deploy.
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
  -- 00316: la marca llega en un UPDATE posterior al alta. Solo cuando pasa a
  -- `true` y la persona todavia no tiene ningun workspace.
  if tg_op = 'UPDATE' then
    if coalesce(new.raw_app_meta_data->>'ssa_create_workspace', '') <> 'true'
       or coalesce(old.raw_app_meta_data->>'ssa_create_workspace', '') = 'true' then
      return new;
    end if;
    if exists (select 1 from public.workspace_members m where m.user_id = new.id) then
      return new;
    end if;
  end if;

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

drop trigger if exists on_auth_user_workspace_flag on auth.users;
create trigger on_auth_user_workspace_flag
  after update of raw_app_meta_data on auth.users
  for each row execute function public.handle_new_user();
