-- 00523 · Servicios: permisos por conjuntos en las políticas de lectura (velocidad, 25/11/2026, traído de RER #96).
--
-- POR QUÉ: las políticas de SELECT de `services`, `service_items` y `service_phases` llaman a
-- `app_servicio.can_see_service(_row)` por CADA fila, y por dentro esa función llama a `is_workspace_member`,
-- `has_permission`, `permission_scope` y un EXISTS sobre `contacts`. Medido como Owner en producción el 25/11/2026:
-- leer `service_items` tardaba 134 ms (184 filas) contra 0,3 ms sin la política; `service_phases` 82 ms (108 filas);
-- `services` 21 ms (34). Unos 0,7 ms por fila: crece con cada cliente.
--
-- QUÉ CAMBIA: nada de QUIÉN VE QUÉ. `app_servicio.rls_visible_service_ids()` es `can_see_service_row` pasada a
-- conjunto (los mismos caminos: miembro con `services.view` y, o el alcance `all`, o ser el responsable, o ser setter
-- o vendedor del contacto) y se calcula UNA vez por consulta; `has_permission` y `permission_scope` corren una vez por
-- negocio. `can_see_service` y `can_see_service_row` NO se tocan (las usan otras funciones): si cambia su regla, cambia
-- también este helper, en la misma migración. Ensayada en producción, persona por persona, comparando los ids
-- visibles antes y después (0 diferencias). Va antes o después del deploy: el código no depende de ella. No toca datos.
--
-- ─── Definiciones viejas, letra por letra (para volver atrás) ────────────────────────────────────────────────────────
--   CREATE POLICY services_select ON app_servicio.services FOR SELECT TO authenticated
--     USING (app_servicio.can_see_service_row(services.*));
--   CREATE POLICY service_items_select ON app_servicio.service_items FOR SELECT TO authenticated
--     USING (app_servicio.can_see_service(service_id));
--   CREATE POLICY service_phases_select ON app_servicio.service_phases FOR SELECT TO authenticated
--     USING (app_servicio.can_see_service(service_id));
-- Las tres PERMISSIVE. Volver atrás: recrearlas así y `DROP FUNCTION app_servicio.rls_visible_service_ids()`.
--
-- Regla para lo que venga: una política nueva de Servicios NO llama a una función con columnas de la fila (corre por
-- fila); pregunta `service_id IN (SELECT app_servicio.rls_visible_service_ids())`.

CREATE OR REPLACE FUNCTION app_servicio.rls_visible_service_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO ''
AS $function$
  WITH me AS (SELECT auth.uid() AS uid),
  ws AS (
    -- Un renglón por negocio donde la persona es miembro y tiene `services.view` (is_workspace_member + has_permission).
    SELECT m.workspace_id, COALESCE(public.permission_scope(m.workspace_id, 'services') = 'all', false) AS sees_all
      FROM public.workspace_members m, me
     WHERE m.user_id = me.uid
       AND public.has_permission(m.workspace_id, 'services.view')
  )
  SELECT s.id
    FROM app_servicio.services s
    JOIN ws ON ws.workspace_id = s.workspace_id
   CROSS JOIN me
   WHERE ws.sees_all
      OR s.owner_user_id = me.uid
      OR s.contact_id IN (
        SELECT c.id FROM public.contacts c
         WHERE c.setter_id = me.uid OR c.vendedor_id = me.uid);
$function$;

REVOKE ALL ON FUNCTION app_servicio.rls_visible_service_ids() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.rls_visible_service_ids() TO authenticated, service_role;

DROP POLICY IF EXISTS services_select ON app_servicio.services;
CREATE POLICY services_select ON app_servicio.services FOR SELECT TO authenticated
  USING (id IN (SELECT app_servicio.rls_visible_service_ids()));

DROP POLICY IF EXISTS service_items_select ON app_servicio.service_items;
CREATE POLICY service_items_select ON app_servicio.service_items FOR SELECT TO authenticated
  USING (service_id IN (SELECT app_servicio.rls_visible_service_ids()));

DROP POLICY IF EXISTS service_phases_select ON app_servicio.service_phases;
CREATE POLICY service_phases_select ON app_servicio.service_phases FOR SELECT TO authenticated
  USING (service_id IN (SELECT app_servicio.rls_visible_service_ids()));
