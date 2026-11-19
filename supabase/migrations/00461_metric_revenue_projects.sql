-- @plantilla-quitar(proyectos)
-- ============================================================
-- 00461_metric_revenue_projects.sql
-- ============================================================
-- «Una cifra del estudiante llega a…» (00460), las dos cifras de la extensión de proyectos. ADITIVA. Necesita la 00460
-- (`app_servicio.svc_metric_fire`) y la 00395 (el esquema `app_servicio_proyectos`).
--
--   revenue        Facturación cargada del estudiante en el programa, contada como la Sala de la fama (`fame_plan`, 00395):
--                  los pagos sin borrar, solo los verificados salvo que el programa diga `fame.verified_only = false`
--                  (los ajustes del equipo siempre), y lo de antes del programa solo con `fame.include_before_program`.
--                  En centavos; la automatización guarda la cifra en unidades de la moneda (la 00460 la multiplica).
--   real_projects  Proyectos reales (kind = 'real') en Ganado, En construcción o Entregado, sin archivar.
--
-- Dos funciones que reciben lo que cambió (las filas nuevas y las viejas, como jsonb) y por cada estudiante y programa
-- calculan la cifra de ahora y la de antes (ahora − lo que sumó el cambio), y llaman a `svc_metric_fire`. Triggers de
-- SENTENCIA, uno por evento (Postgres no deja tablas de transición en un trigger de varios eventos). Una fila que cambia
-- de persona o de programa (unir contactos) no cuenta: no es una carga nueva. Con la extensión apagada no hacen nada, y
-- nunca hacen fallar el guardado.
--
-- Volver atrás: DROP TRIGGER student_revenue_metric_ins/_upd/_del ON app_servicio_proyectos.student_revenue_entries;
-- DROP TRIGGER student_projects_metric_ins/_upd ON app_servicio_proyectos.student_projects; DROP FUNCTION de las cinco
-- funciones de abajo.
-- Idempotente: CREATE OR REPLACE y DROP TRIGGER IF EXISTS.
-- ============================================================

-- ─── Qué cuenta (puras) ─────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.metric_revenue_counts(p_row jsonb, p_fame jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_row ->> 'deleted_at' IS NULL
     AND (p_row ->> 'kind' = 'adjustment' OR NOT COALESCE((p_fame ->> 'verified_only')::boolean, true) OR p_row ->> 'verified_at' IS NOT NULL)
     AND (COALESCE((p_fame ->> 'include_before_program')::boolean, false) OR NOT COALESCE((p_row ->> 'before_program')::boolean, false));
$$;

CREATE OR REPLACE FUNCTION app_servicio_proyectos.metric_project_counts(p_row jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT p_row ->> 'kind' = 'real' AND p_row ->> 'status' IN ('won', 'in_build', 'delivered') AND p_row ->> 'archived_at' IS NULL;
$$;

-- ─── Facturación ────────────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.metric_revenue_changed(p_new jsonb, p_old jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_fame jsonb;
  v_after numeric;
  v_n integer := 0;
BEGIN
  FOR r IN
    WITH n AS (SELECT x FROM jsonb_array_elements(COALESCE(p_new, '[]'::jsonb)) x),
         o AS (SELECT x FROM jsonb_array_elements(COALESCE(p_old, '[]'::jsonb)) x),
         moved AS (SELECT n.x ->> 'id' AS id FROM n JOIN o ON o.x ->> 'id' = n.x ->> 'id'
                    WHERE o.x ->> 'contact_id' IS DISTINCT FROM n.x ->> 'contact_id' OR o.x ->> 'product_id' IS DISTINCT FROM n.x ->> 'product_id'),
         ch AS (SELECT x, 1 AS sign FROM n WHERE x ->> 'id' NOT IN (SELECT id FROM moved)
                UNION ALL SELECT x, -1 FROM o WHERE x ->> 'id' NOT IN (SELECT id FROM moved))
    SELECT (ch.x ->> 'workspace_id')::uuid AS workspace_id, (ch.x ->> 'contact_id')::uuid AS contact_id, (ch.x ->> 'product_id')::uuid AS product_id,
           jsonb_agg(jsonb_build_object('row', ch.x, 'sign', ch.sign)) AS rows
      FROM ch GROUP BY 1, 2, 3
  LOOP
    BEGIN
      CONTINUE WHEN NOT app_servicio_proyectos.enabled(r.workspace_id);
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.triggers tr WHERE tr.workspace_id = r.workspace_id AND tr.is_active
                                  AND tr.type = 'service_metric_reached' AND tr.config ->> 'metric' = 'revenue');
      SELECT COALESCE(p.portal_settings -> 'fame', '{}'::jsonb) INTO v_fame FROM public.products p WHERE p.id = r.product_id;
      v_fame := COALESCE(v_fame, '{}'::jsonb);
      SELECT COALESCE(sum(e.amount_cents), 0) INTO v_after FROM app_servicio_proyectos.student_revenue_entries e
       WHERE e.contact_id = r.contact_id AND e.product_id = r.product_id
         AND app_servicio_proyectos.metric_revenue_counts(to_jsonb(e), v_fame);
      v_n := v_n + app_servicio.svc_metric_fire(r.workspace_id, r.contact_id, r.product_id, 'revenue',
        v_after - (SELECT COALESCE(sum((y ->> 'sign')::int * (y -> 'row' ->> 'amount_cents')::numeric), 0) FROM jsonb_array_elements(r.rows) y
                    WHERE app_servicio_proyectos.metric_revenue_counts(y -> 'row', v_fame)),
        v_after);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'metric_revenue_changed: %', SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'metric_revenue_changed: %', SQLERRM;
  RETURN v_n;
END;
$$;

-- ─── Proyectos reales ───────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.metric_projects_changed(p_new jsonb, p_old jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
  v_after numeric;
  v_n integer := 0;
BEGIN
  FOR r IN
    WITH n AS (SELECT x FROM jsonb_array_elements(COALESCE(p_new, '[]'::jsonb)) x),
         o AS (SELECT x FROM jsonb_array_elements(COALESCE(p_old, '[]'::jsonb)) x),
         moved AS (SELECT n.x ->> 'id' AS id FROM n JOIN o ON o.x ->> 'id' = n.x ->> 'id'
                    WHERE o.x ->> 'contact_id' IS DISTINCT FROM n.x ->> 'contact_id' OR o.x ->> 'product_id' IS DISTINCT FROM n.x ->> 'product_id'),
         ch AS (SELECT x, 1 AS sign FROM n WHERE x ->> 'id' NOT IN (SELECT id FROM moved)
                UNION ALL SELECT x, -1 FROM o WHERE x ->> 'id' NOT IN (SELECT id FROM moved))
    SELECT (ch.x ->> 'workspace_id')::uuid AS workspace_id, (ch.x ->> 'contact_id')::uuid AS contact_id, (ch.x ->> 'product_id')::uuid AS product_id,
           sum(CASE WHEN app_servicio_proyectos.metric_project_counts(ch.x) THEN ch.sign ELSE 0 END) AS delta
      FROM ch GROUP BY 1, 2, 3
  LOOP
    BEGIN
      CONTINUE WHEN r.delta <= 0;
      CONTINUE WHEN NOT app_servicio_proyectos.enabled(r.workspace_id);
      CONTINUE WHEN NOT EXISTS (SELECT 1 FROM public.triggers tr WHERE tr.workspace_id = r.workspace_id AND tr.is_active
                                  AND tr.type = 'service_metric_reached' AND tr.config ->> 'metric' = 'real_projects');
      SELECT count(*) INTO v_after FROM app_servicio_proyectos.student_projects p
       WHERE p.contact_id = r.contact_id AND p.product_id = r.product_id AND app_servicio_proyectos.metric_project_counts(to_jsonb(p));
      v_n := v_n + app_servicio.svc_metric_fire(r.workspace_id, r.contact_id, r.product_id, 'real_projects', v_after - r.delta, v_after);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'metric_projects_changed: %', SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'metric_projects_changed: %', SQLERRM;
  RETURN v_n;
END;
$$;

-- ─── Los triggers (de sentencia) ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.metric_on_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_new jsonb := '[]'::jsonb;
  v_old jsonb := '[]'::jsonb;
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN SELECT COALESCE(jsonb_agg(to_jsonb(n)), '[]'::jsonb) INTO v_new FROM new_rows n; END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') THEN SELECT COALESCE(jsonb_agg(to_jsonb(o)), '[]'::jsonb) INTO v_old FROM old_rows o; END IF;
  IF TG_TABLE_NAME = 'student_revenue_entries' THEN
    PERFORM app_servicio_proyectos.metric_revenue_changed(v_new, v_old);
  ELSE
    PERFORM app_servicio_proyectos.metric_projects_changed(v_new, v_old);
  END IF;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'metric_on_change %: %', TG_TABLE_NAME, SQLERRM;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION app_servicio_proyectos.metric_revenue_counts(jsonb, jsonb), app_servicio_proyectos.metric_project_counts(jsonb),
  app_servicio_proyectos.metric_revenue_changed(jsonb, jsonb), app_servicio_proyectos.metric_projects_changed(jsonb, jsonb),
  app_servicio_proyectos.metric_on_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_proyectos.metric_revenue_counts(jsonb, jsonb), app_servicio_proyectos.metric_project_counts(jsonb),
  app_servicio_proyectos.metric_revenue_changed(jsonb, jsonb), app_servicio_proyectos.metric_projects_changed(jsonb, jsonb) TO service_role;

DROP TRIGGER IF EXISTS student_revenue_metric_ins ON app_servicio_proyectos.student_revenue_entries;
DROP TRIGGER IF EXISTS student_revenue_metric_upd ON app_servicio_proyectos.student_revenue_entries;
DROP TRIGGER IF EXISTS student_revenue_metric_del ON app_servicio_proyectos.student_revenue_entries;
CREATE TRIGGER student_revenue_metric_ins AFTER INSERT ON app_servicio_proyectos.student_revenue_entries
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_servicio_proyectos.metric_on_change();
CREATE TRIGGER student_revenue_metric_upd AFTER UPDATE ON app_servicio_proyectos.student_revenue_entries
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_servicio_proyectos.metric_on_change();
CREATE TRIGGER student_revenue_metric_del AFTER DELETE ON app_servicio_proyectos.student_revenue_entries
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION app_servicio_proyectos.metric_on_change();

DROP TRIGGER IF EXISTS student_projects_metric_ins ON app_servicio_proyectos.student_projects;
DROP TRIGGER IF EXISTS student_projects_metric_upd ON app_servicio_proyectos.student_projects;
CREATE TRIGGER student_projects_metric_ins AFTER INSERT ON app_servicio_proyectos.student_projects
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_servicio_proyectos.metric_on_change();
CREATE TRIGGER student_projects_metric_upd AFTER UPDATE ON app_servicio_proyectos.student_projects
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION app_servicio_proyectos.metric_on_change();
