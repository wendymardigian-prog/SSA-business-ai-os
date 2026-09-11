-- ============================================================================
-- 00048 — Las trigger functions tampoco quedan expuestas a usuarios logueados
-- ============================================================================
-- La 00045 les saco el EXECUTE de `anon` pero dejo el de `authenticated`, asi
-- que el linter las sigue reportando. No son explotables por ninguno de los dos
-- roles —retornan `trigger` y Postgres rechaza llamarlas fuera de un trigger—,
-- pero mientras esten en el reporte tapan a las que si hay que mirar, y un
-- reporte con ruido cronico es uno que nadie lee.
--
-- Un trigger corre con los privilegios del dueño de la tabla, no del invocante,
-- asi que revocar EXECUTE no afecta a ninguno de los triggers que las usan.
--
-- Despues de esto, lo unico que el linter sigue marcando en esta categoria son
-- las funciones de Vault y los helpers de RLS, las dos cosas documentadas en la
-- 00045 como intencionales.
--
-- Idempotente.
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.triggers_set_workspace_id() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_created() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_deanonymized() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contacts_emit_changes() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contact_tags_emit() FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.contact_custom_fields_emit() FROM authenticated;
