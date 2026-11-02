-- ============================================================================
-- 00276 — Las SECURITY DEFINER de Equipo y roles, Agenda, Ventas y mensajes
--         dejan de ser ejecutables con la anon key
-- ============================================================================
-- La 00045 y la 00048 cerraron las funciones de la era pre-hardening. Despues
-- se sumaron trece SECURITY DEFINER nuevas sin el REVOKE: Postgres le da
-- EXECUTE a PUBLIC a toda funcion nueva, anon hereda de PUBLIC, y PostgREST
-- publica todo lo invocable del schema public. El linter de seguridad las
-- marca en "Public Can Execute SECURITY DEFINER Function" (chequeo del
-- 2/11/2026, antes de abrir los endpoints /api/public/... para la web).
--
-- 1. Los tres helpers de "no podes dar lo que no tenes" (00212):
--    can_give_role, can_grant_permissions, is_own_role.
--    Para anon no filtran nada (sin auth.uid() devuelven false), pero cualquiera
--    con la anon key podia llamarlos por REST y sondear ids de roles. Se les
--    saca PUBLIC y anon. authenticated se queda, y es OBLIGATORIO: las usan las
--    policies de escritura de workspace_roles, workspace_invites y
--    workspace_members, y una expresion de policy se evalua con el rol de la
--    SESION (ver la advertencia de la 00045 sobre is_workspace_member).
--
--    Efecto sobre anon: un INSERT/UPDATE/DELETE con la anon key sobre esas tres
--    tablas pasa de "0 filas" a "permission denied for function". Sigue siendo
--    un rechazo; ningun flujo legitimo escribe ahi como anon. Aceptar una
--    invitacion (con cuenta o creandola, lib/actions/team.ts) escribe con el
--    cliente de service role, que no pasa por RLS. Las policies de SELECT no
--    usan estas funciones.
--
-- 2. Diez trigger functions: se les saca PUBLIC, anon y authenticated, como a
--    las de la 00048. No son explotables (retornan `trigger` y Postgres rechaza
--    llamarlas fuera de un trigger), pero ensucian el reporte. Postgres no
--    chequea EXECUTE al disparar un trigger, solo al crearlo, asi que los
--    triggers siguen funcionando para todos (incluidos los formularios y la
--    agenda publicos, que insertan via sus RPC).
--
-- Lo que NO se toca, para que el proximo scan no lo reabra:
--
--   * get_public_form(text) sigue con EXECUTE de anon A PROPOSITO: es la que
--     lee la definicion de un formulario publicado para /f/[slug] (lista blanca
--     de campos, no devuelve la clave de Turnstile; scripts/verify-forms lo
--     prueba). Es el unico item que debe quedar en esa categoria del linter.
--
-- Idempotente.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Helpers de permisos: revocar anon, JAMAS authenticated
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.can_give_role(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_give_role(uuid, uuid, text) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.can_grant_permissions(uuid, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_grant_permissions(uuid, jsonb, jsonb) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.is_own_role(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_own_role(uuid, uuid) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 2. Trigger functions: nadie las llama a mano
-- ----------------------------------------------------------------------------

REVOKE ALL ON FUNCTION public.booking_categories_two_levels() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_discard_answered_drafts() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_fill_origin() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.messages_upsert_text() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_booking_categories() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_copywriter_agent() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_message_categories() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_sales_defaults() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.seed_workspace_roles() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.workspace_roles_grant_check() FROM PUBLIC, anon, authenticated;
