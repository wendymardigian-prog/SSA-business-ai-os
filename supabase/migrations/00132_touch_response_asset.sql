-- ============================================================
-- MIGRACION 00132 — CONTAR LOS USOS DE UN RECURSO
-- ============================================================
-- Plano: requerimientos-banca-recursos-v2.md (v2.1), §5 "Contar los usos sin
-- abrir la escritura" y F1. El plano la numeraba 00126 (ocupada).
--
-- `usage_count` y `last_used_at` (00131) los tiene que poder actualizar
-- cualquiera que MANDE un recurso, y un Member no tiene escritura sobre
-- response_assets (ni la va a tener: le dejaria editar los recursos del
-- negocio). Esta funcion es la puerta angosta: corre con permisos elevados
-- pero sabe hacer una sola cosa, sumar uno al contador de un recurso.
--
-- Quien la puede usar con efecto:
--   - Un usuario, solo sobre un recurso de un workspace del que es miembro.
--     Si el recurso es de otro workspace, o no existe, o esta borrado, no
--     hace nada y no dice nada: no revela que existe.
--   - El servidor (service_role), sobre cualquiera. Es el caso del agente de
--     IA, que corre con el service client y no tiene auth.uid(): sin esta
--     rama, sus envios nunca contarian.
--
-- Mismo patron que find_or_link_contact y record_contact_touch: SECURITY
-- DEFINER con search_path vacio, todo calificado con el esquema.
--
-- Como volver atras:
--   DROP FUNCTION IF EXISTS public.touch_response_asset(uuid);
-- ============================================================

CREATE OR REPLACE FUNCTION public.touch_response_asset(p_asset_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.response_assets
     SET usage_count = usage_count + 1,
         last_used_at = now()
   WHERE id = p_asset_id
     AND deleted_at IS NULL
     AND (
       auth.role() = 'service_role'
       OR public.is_workspace_member(workspace_id)
     );
END;
$$;

COMMENT ON FUNCTION public.touch_response_asset(uuid) IS
  'Suma 1 a usage_count y pone last_used_at = now() en un recurso del workspace de quien llama (o en cualquiera, si llama el servidor). Si no corresponde, no hace nada y no lo dice.';

REVOKE ALL ON FUNCTION public.touch_response_asset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.touch_response_asset(uuid) TO authenticated, service_role;
