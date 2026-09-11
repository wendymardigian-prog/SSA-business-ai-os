-- ============================================================================
-- 00047 — find_or_link_contact queda solo para el service role
-- ============================================================================
-- La funcion no tiene ningun control de permisos propio: lo unico que hace es
-- derivar el workspace del canal que le pasan. Con EXECUTE de `authenticated`,
-- un Member —que por diseño solo ve los leads que le asignaron— podia llamarla
-- por REST directo para crear o vincular contactos en el workspace, saltandose
-- el scope de leads. Y con p_stamp_existing pisar last_interaction_at de
-- cualquier contacto.
--
-- No cruza workspaces (el canal ancla el workspace), asi que no es una fuga
-- entre negocios: es escalada de privilegios adentro del workspace.
--
-- PRECONDICION: los dos unicos llamadores con cliente de usuario ya se
-- migraron a service client en commits anteriores —
--   app/api/v1/channels/sync/route.ts  (ademas ahora exige Owner/Admin)
--   app/api/v1/channels/test-key/route.ts
-- via lib/inbox-sync.ts, que recibe el service client como parametro aparte.
-- Los webhooks siempre la llamaron con service role.
--
-- Va sola y despues del resto porque su rotura seria silenciosa: el backfill
-- del Inbox falla adentro de un catch que solo loguea, asi que el usuario veria
-- "conectado, todo bien" con la bandeja vacia.
--
-- Idempotente.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.find_or_link_contact(
  uuid, text, text, text, text, text, text, timestamptz, boolean
) FROM authenticated;

COMMENT ON FUNCTION public.find_or_link_contact(
  uuid, text, text, text, text, text, text, timestamptz, boolean
) IS
  'Dedup cross-canal. Solo service_role: no valida permisos, solo deriva el workspace del canal. Las rutas que la usan validan el rol antes y llaman con service client (lib/inbox-sync.ts).';
