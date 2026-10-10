-- ============================================================
-- MIGRACION 00141 — LOS MIEMBROS DE UN WORKSPACE EN UNA SOLA CONSULTA
-- ============================================================
-- Auditoria de velocidad (10/10/2026).
--
-- Los nombres y emails de los miembros viven en auth.users, que no se lee por
-- RLS. `getWorkspaceMembers` (lib/workspace-members.ts) y la pantalla de
-- Equipo los pedian a la API de administracion de Auth DE A UNO
-- (`auth.admin.getUserById` por miembro): con N miembros, N viajes de red en
-- cada render del detalle de un agente, la bandeja, la ficha del contacto, los
-- ajustes de Agenda y unas diez pantallas mas.
--
-- Esta funcion devuelve lo mismo en una sola consulta. Es SOLO para el
-- servidor (service_role): devuelve emails, y el codigo que la llama ya usaba
-- la service key para lo mismo. Ni `authenticated` ni `anon` la pueden
-- ejecutar.
--
-- Aditiva: el codigo cae al camino viejo si la funcion todavia no existe, asi
-- que se puede desplegar antes o despues de aplicarla.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.workspace_member_profiles(uuid);
-- ============================================================

CREATE OR REPLACE FUNCTION public.workspace_member_profiles(p_workspace_id uuid)
RETURNS TABLE (
  user_id uuid,
  role text,
  role_id uuid,
  joined_at timestamptz,
  email text,
  full_name text,
  meta_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    m.user_id,
    m.role::text,
    m.role_id,
    m.created_at,
    u.email::text,
    u.raw_user_meta_data ->> 'full_name',
    u.raw_user_meta_data ->> 'name'
  FROM public.workspace_members m
  LEFT JOIN auth.users u ON u.id = m.user_id
  WHERE m.workspace_id = p_workspace_id;
$$;

COMMENT ON FUNCTION public.workspace_member_profiles(uuid) IS
  'Miembros de un workspace con email y nombre (de auth.users) en una sola consulta. Solo service_role: reemplaza N llamadas a auth.admin.getUserById.';

REVOKE ALL ON FUNCTION public.workspace_member_profiles(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.workspace_member_profiles(uuid) TO service_role;
