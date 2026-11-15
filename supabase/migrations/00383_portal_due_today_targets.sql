-- @plantilla-quitar(servicios)
-- 00383 · Corrida A3 · F128: a quién le toca el email «Lo que vence hoy» (solo lectura).
--
-- Igual que `portal_digest_targets` (00377), pero con el interruptor del programa `notifications.due_today_email`
-- (nace APAGADO) y la preferencia de la persona `due_today_email` (nace apagada, decisión de Wendy 14/11). Lo que vence
-- hoy de cada persona lo lee el envío con `portal_notifications_view` (00377). Solo para el servidor.
--
-- Volver atrás: DROP FUNCTION IF EXISTS app_servicio.portal_due_today_targets(uuid);

CREATE OR REPLACE FUNCTION app_servicio.portal_due_today_targets(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, contact_id uuid, email text, display_name text, timezone text, product_id uuid, product_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT a.id, a.contact_id, a.email, COALESCE(a.display_name, c.display_name),
         COALESCE(NULLIF(a.timezone, ''), NULLIF(c.timezone, ''), app_servicio.ws_tz(a.workspace_id)), p.id, p.name
    FROM app_servicio_portal.portal_accounts a
    JOIN public.contacts c ON c.id = a.contact_id
    JOIN app_servicio.services s ON s.contact_id = a.contact_id AND s.workspace_id = a.workspace_id AND s.status = 'active' AND NOT s.is_test
    JOIN public.products p ON p.id = s.product_id
   WHERE a.workspace_id = p_workspace_id AND a.status = 'active' AND app_servicio.module_on(a.workspace_id)
     AND p.portal_settings #> '{notifications,due_today_email}' = 'true'::jsonb
     AND (app_servicio.portal_notification_prefs(a.notification_prefs) ->> 'due_today_email')::boolean;
$$;

REVOKE ALL ON FUNCTION app_servicio.portal_due_today_targets(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.portal_due_today_targets(uuid) TO service_role;
