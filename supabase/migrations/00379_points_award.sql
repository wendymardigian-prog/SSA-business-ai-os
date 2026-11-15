-- ============================================================
-- 00379_points_award.sql
-- ============================================================
-- Servicios A3, F129 (decisión 468; F245 a F249 del portal): cómo se ganan los puntos.
--
--   * `award_points(...)`: la ÚNICA que suma. Una sola vez por (contacto, programa, origen) por el índice único de
--     points_ledger; el valor del paso / fase / actividad gana al del programa (points_for); un programa con los puntos
--     APAGADOS no suma nada; un servicio de prueba no suma; topes por día (publicar, comentar) en la zona del
--     estudiante; al subir de nivel emite `points_level_up` (disparador nuevo de Automatizaciones).
--   * `revoke_points(...)`: el descuento (`<origen>:revoked`, con signo negativo). Desmarcar algo NO descuenta.
--   * Disparadores sobre lo que ya existe, todos envueltos en EXCEPTION WHEN OTHERS (un fallo de puntos NUNCA frena lo
--     que hizo el estudiante; queda en hook_failed) y sin efecto con el módulo apagado o los puntos apagados:
--       program_progress (clase vista o marcada, módulo terminado, todo el contenido), service_items (paso, cada
--       repetición; una tarde con late.counts = false no suma), service_phases (fase), services (todo el camino),
--       form_submissions (entregar, aprobar una actividad, aprobar una evaluación), live_attendance (asistir),
--       community_posts (publicar, comentar; se descuenta si el equipo lo oculta), community_reactions (cada «me gusta»
--       recibido), contacts / bookings / sales (referidos: lead con su código, agenda, compra; se descuenta si la venta
--       se cancela o se reembolsa).
--   * `points_adjust(service, puntos, motivo)`: el ajuste a mano (permiso `portal.points`), y `points_backfill(product)`:
--     «Calcular lo ya hecho» (una vez; repetirlo no duplica por el índice único), con audit_log.
--   * `triggers.type` suma `points_level_up` (se leen los valores vigentes y se agrega el nuevo, sin sacar ninguno).
--
-- Antes de aplicarla: points_ledger vacía y ningún programa con los puntos prendidos: ningún disparador escribe nada.
--
-- Como volver atras: DROP de los disparadores trg_points_* y de las funciones nuevas (lista al final del archivo); la
-- tabla queda vacía si nadie prendió los puntos. El valor nuevo de triggers.type se puede dejar.

-- ─── 1. Auxiliares ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.points_tz(p_contact_id uuid, p_workspace_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(
    (SELECT NULLIF(a.timezone, '') FROM app_servicio_portal.portal_accounts a WHERE a.contact_id = p_contact_id LIMIT 1),
    (SELECT NULLIF(c.timezone, '') FROM public.contacts c WHERE c.id = p_contact_id),
    app_servicio.ws_tz(p_workspace_id));
$$;

CREATE OR REPLACE FUNCTION app_servicio.points_level_check(s app_servicio.services, p_settings jsonb, p_before integer, p_after integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  l0 jsonb := app_servicio.level_of(p_before, p_settings -> 'levels');
  l1 jsonb := app_servicio.level_of(p_after, p_settings -> 'levels');
BEGIN
  IF (l1 ->> 'level')::integer > (l0 ->> 'level')::integer THEN
    PERFORM app_servicio.emit(s, 'points_level_up', jsonb_build_object('level', (l1 ->> 'level')::integer, 'level_name', l1 ->> 'name', 'points', p_after));
  END IF;
END;
$$;

-- Los programas (con un servicio activo o en pausa, no de prueba) de alguien: para los puntos de referidos.
CREATE OR REPLACE FUNCTION app_servicio.points_contact_products(p_contact_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT s.product_id FROM app_servicio.services s
   WHERE s.contact_id = p_contact_id AND s.status IN ('active', 'paused') AND NOT s.is_test AND s.product_id IS NOT NULL;
$$;

-- Todas las clases activas y obligatorias del programa, completas.
CREATE OR REPLACE FUNCTION app_servicio.points_all_content_done(p_contact_id uuid, p_product_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app_servicio.program_items i WHERE i.product_id = p_product_id AND i.kind = 'lesson' AND i.status = 'active' AND i.required)
     AND NOT EXISTS (
       SELECT 1 FROM app_servicio.program_items i
        WHERE i.product_id = p_product_id AND i.kind = 'lesson' AND i.status = 'active' AND i.required
          AND NOT EXISTS (SELECT 1 FROM app_servicio_portal.program_progress pp
                           WHERE pp.program_item_id = i.id AND pp.contact_id = p_contact_id AND pp.completed_at IS NOT NULL));
$$;

-- ─── 2. Sumar y descontar ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.award_points(p_contact_id uuid, p_product_id uuid, p_service_id uuid, p_event text, p_source_key text,
  p_override integer DEFAULT NULL, p_reason text DEFAULT NULL, p_at timestamptz DEFAULT now())
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid; v_settings jsonb; r jsonb; v_pts integer; v_grp text;
  s app_servicio.services;
  v_day date; v_cap integer; v_before integer; v_id uuid;
BEGIN
  IF p_contact_id IS NULL OR p_product_id IS NULL OR p_source_key IS NULL THEN RETURN 0; END IF;
  SELECT workspace_id, portal_settings -> 'points' INTO v_ws, v_settings FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL OR NOT app_servicio.module_on(v_ws) THEN RETURN 0; END IF;
  r := app_servicio.points_for(p_event, v_settings, p_override);
  v_pts := (r ->> 'points')::integer;
  v_grp := r ->> 'group';
  IF v_pts IS NULL OR v_pts <= 0 OR v_grp IS NULL THEN RETURN 0; END IF;
  IF p_service_id IS NOT NULL THEN
    SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  ELSE
    SELECT * INTO s FROM app_servicio.services
     WHERE contact_id = p_contact_id AND product_id = p_product_id AND workspace_id = v_ws
     ORDER BY (status IN ('active', 'paused')) DESC, created_at DESC LIMIT 1;
  END IF;
  IF s.id IS NULL OR s.is_test OR s.contact_id IS DISTINCT FROM p_contact_id THEN RETURN 0; END IF;
  v_day := (p_at AT TIME ZONE app_servicio.points_tz(p_contact_id, v_ws))::date;
  v_cap := app_servicio.points_daily_cap(p_event, v_settings);
  IF v_cap IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('points_cap:' || p_contact_id::text || ':' || p_product_id::text || ':' || p_event, 0));
    IF (SELECT count(*) FROM app_servicio_portal.points_ledger
         WHERE contact_id = p_contact_id AND product_id = p_product_id AND local_day = v_day AND points > 0
           AND source_key LIKE p_event || ':%' AND source_key NOT LIKE '%:revoked') >= v_cap THEN
      RETURN 0;
    END IF;
  END IF;
  SELECT COALESCE(sum(points), 0) INTO v_before FROM app_servicio_portal.points_ledger WHERE contact_id = p_contact_id AND product_id = p_product_id;
  INSERT INTO app_servicio_portal.points_ledger (workspace_id, contact_id, product_id, service_id, source_key, point_group, points, reason, local_day, created_by, created_at)
  VALUES (v_ws, p_contact_id, p_product_id, s.id, left(p_source_key, 200), v_grp, v_pts, left(p_reason, 300), v_day,
          CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END, p_at)
  ON CONFLICT (contact_id, product_id, source_key) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN RETURN 0; END IF;
  PERFORM app_servicio.points_level_check(s, v_settings, v_before, v_before + v_pts);
  RETURN v_pts;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.revoke_points(p_contact_id uuid, p_product_id uuid, p_source_key text, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  o app_servicio_portal.points_ledger;
  v_id uuid;
BEGIN
  SELECT * INTO o FROM app_servicio_portal.points_ledger WHERE contact_id = p_contact_id AND product_id = p_product_id AND source_key = p_source_key;
  IF o.id IS NULL OR o.points <= 0 THEN RETURN 0; END IF;
  INSERT INTO app_servicio_portal.points_ledger (workspace_id, contact_id, product_id, service_id, source_key, point_group, points, reason, local_day, created_by)
  VALUES (o.workspace_id, o.contact_id, o.product_id, o.service_id, left(p_source_key || ':revoked', 200), o.point_group, -o.points, left(p_reason, 300),
          (now() AT TIME ZONE app_servicio.points_tz(o.contact_id, o.workspace_id))::date, CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  ON CONFLICT (contact_id, product_id, source_key) DO NOTHING
  RETURNING id INTO v_id;
  RETURN CASE WHEN v_id IS NULL THEN 0 ELSE -o.points END;
END;
$$;

-- ─── 3. El equipo: ajuste a mano y «Calcular lo ya hecho» ────────────────────
CREATE OR REPLACE FUNCTION app_servicio.points_adjust(p_service_id uuid, p_points integer, p_reason text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_settings jsonb; v_before integer; v_after integer;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(s.workspace_id, 'portal.points') AND app_servicio.can_see_service_row(s)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_points IS NULL OR p_points = 0 OR abs(p_points) > 10000 THEN RAISE EXCEPTION 'Elegí cuántos puntos (de -10.000 a 10.000)' USING ERRCODE = 'SV001'; END IF;
  IF btrim(COALESCE(p_reason, '')) = '' THEN RAISE EXCEPTION 'Contá el motivo' USING ERRCODE = 'SV001'; END IF;
  SELECT portal_settings -> 'points' INTO v_settings FROM public.products WHERE id = s.product_id;
  IF v_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Los puntos están apagados en este programa' USING ERRCODE = 'SV039'; END IF;
  SELECT COALESCE(sum(points), 0) INTO v_before FROM app_servicio_portal.points_ledger WHERE contact_id = s.contact_id AND product_id = s.product_id;
  INSERT INTO app_servicio_portal.points_ledger (workspace_id, contact_id, product_id, service_id, source_key, point_group, points, reason, local_day, created_by)
  VALUES (s.workspace_id, s.contact_id, s.product_id, s.id, 'manual:' || gen_random_uuid()::text, 'equipo', p_points, left(btrim(p_reason), 300),
          (now() AT TIME ZONE app_servicio.points_tz(s.contact_id, s.workspace_id))::date, auth.uid());
  v_after := v_before + p_points;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'points.adjusted', jsonb_build_object('points', p_points, 'reason', left(btrim(p_reason), 300), 'total', v_after));
  PERFORM app_servicio.points_level_check(s, v_settings, v_before, v_after);
  RETURN v_after;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.points_backfill(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid; v_settings jsonb; v_rows_before integer; v_rows_after integer; v_prev text;
  x record;
BEGIN
  SELECT workspace_id, portal_settings -> 'points' INTO v_ws, v_settings FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(v_ws, 'portal.points') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF v_settings -> 'enabled' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'Los puntos están apagados en este programa' USING ERRCODE = 'SV039'; END IF;
  SELECT count(*) INTO v_rows_before FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id;
  v_prev := COALESCE(current_setting('app_servicio.system', true), '');
  PERFORM app_servicio.as_system();
  -- Contenido.
  FOR x IN SELECT pp.contact_id, i.id, i.kind, i.title, COALESCE(pp.completed_at, pp.viewed_at) AS at, pp.completed_at
             FROM app_servicio_portal.program_progress pp JOIN app_servicio.program_items i ON i.id = pp.program_item_id
            WHERE i.product_id = p_product_id AND (pp.viewed_at IS NOT NULL OR pp.completed_at IS NOT NULL) ORDER BY 5 LOOP
    IF x.kind = 'lesson' THEN PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'lesson', 'lesson:' || x.id, NULL, x.title, x.at);
    ELSIF x.completed_at IS NOT NULL THEN PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'module', 'module:' || x.id, NULL, x.title, x.completed_at);
    END IF;
  END LOOP;
  FOR x IN SELECT DISTINCT pp.contact_id FROM app_servicio_portal.program_progress pp JOIN app_servicio.program_items i ON i.id = pp.program_item_id
            WHERE i.product_id = p_product_id LOOP
    IF app_servicio.points_all_content_done(x.contact_id, p_product_id) THEN
      PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'all_content', 'all_content:' || p_product_id, NULL, 'Terminó todo el contenido', now());
    END IF;
  END LOOP;
  -- Mi camino.
  FOR x IN SELECT i.*, s.contact_id AS s_contact FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
            WHERE s.product_id = p_product_id AND i.status = 'completed' AND NOT i.is_recurring_template ORDER BY i.completed_at LOOP
    CONTINUE WHEN x.parent_item_id IS NOT NULL AND x.late -> 'counts' = 'false'::jsonb AND x.due_at IS NOT NULL AND x.completed_at > x.due_at;
    PERFORM app_servicio.award_points(x.s_contact, p_product_id, x.service_id, 'step', 'step:' || x.id,
      CASE WHEN app_servicio.j_int(x.ref -> 'points') THEN (x.ref ->> 'points')::integer END, x.name, x.completed_at);
  END LOOP;
  FOR x IN SELECT ph.*, s.contact_id AS s_contact, s.product_variant_id FROM app_servicio.service_phases ph JOIN app_servicio.services s ON s.id = ph.service_id
            WHERE s.product_id = p_product_id AND ph.status = 'completed' LOOP
    PERFORM app_servicio.award_points(x.s_contact, p_product_id, x.service_id, 'phase', 'phase:' || x.id,
      (SELECT CASE WHEN app_servicio.j_int(t -> 'points') THEN (t ->> 'points')::integer END
         FROM public.product_variants pv, jsonb_array_elements(COALESCE(pv.journey_template -> 'phases', '[]'::jsonb)) t
        WHERE pv.id = x.product_variant_id AND t ->> 'key' = x.template_key LIMIT 1), x.name, COALESCE(x.completed_at, now()));
  END LOOP;
  FOR x IN SELECT * FROM app_servicio.services WHERE product_id = p_product_id AND status = 'completed' LOOP
    PERFORM app_servicio.award_points(x.contact_id, p_product_id, x.id, 'journey', 'journey:' || x.id, NULL, 'Completó el camino', x.updated_at);
  END LOOP;
  -- Actividades y evaluaciones.
  FOR x IN SELECT fs.*, f.type AS f_type, (SELECT pi.points FROM app_servicio.program_items pi WHERE pi.form_id = f.id LIMIT 1) AS pi_points
             FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id
            WHERE f.product_id = p_product_id AND f.type IN ('activity', 'quiz') AND fs.status = 'received' AND fs.contact_id IS NOT NULL
              AND fs.review_status IS DISTINCT FROM 'superseded' ORDER BY fs.created_at LOOP
    IF x.f_type = 'activity' THEN
      PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'submit', 'submit:' || x.form_id,
        CASE WHEN app_servicio.j_int(x.pi_points -> 'submit') THEN (x.pi_points ->> 'submit')::integer END, NULL, x.created_at);
      IF x.review_status = 'reviewed' AND x.grade -> 'passed' = 'true'::jsonb THEN
        PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'pass', 'pass:' || x.form_id,
          CASE WHEN app_servicio.j_int(x.pi_points -> 'pass') THEN (x.pi_points ->> 'pass')::integer END, NULL, COALESCE(x.reviewed_at, x.created_at));
      END IF;
    ELSIF x.grade -> 'passed' = 'true'::jsonb THEN
      PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'quiz_pass', 'quiz_pass:' || x.form_id,
        CASE WHEN app_servicio.j_int(x.pi_points -> 'pass') THEN (x.pi_points ->> 'pass')::integer END, NULL, x.created_at);
    END IF;
  END LOOP;
  -- Clases en vivo.
  FOR x IN SELECT la.* FROM app_servicio_portal.live_attendance la JOIN app_servicio.live_sessions ls ON ls.id = la.live_session_id
            WHERE ls.product_id = p_product_id AND la.removed_at IS NULL LOOP
    PERFORM app_servicio.award_points(x.contact_id, p_product_id, NULL, 'attendance', 'attendance:' || x.live_session_id || ':' || x.occurs_on, NULL, NULL, x.marked_at);
  END LOOP;
  -- Comunidad.
  FOR x IN SELECT * FROM app_servicio_portal.community_posts
            WHERE product_id = p_product_id AND author_contact_id IS NOT NULL AND NOT as_business AND hidden_at IS NULL AND deleted_at IS NULL ORDER BY created_at LOOP
    IF x.parent_id IS NULL THEN PERFORM app_servicio.award_points(x.author_contact_id, p_product_id, NULL, 'post', 'post:' || x.id, NULL, NULL, x.created_at);
    ELSE PERFORM app_servicio.award_points(x.author_contact_id, p_product_id, NULL, 'comment', 'comment:' || x.id, NULL, NULL, x.created_at);
    END IF;
  END LOOP;
  FOR x IN SELECT r.*, p.author_contact_id FROM app_servicio_portal.community_reactions r JOIN app_servicio_portal.community_posts p ON p.id = r.post_id
            WHERE p.product_id = p_product_id AND r.kind = 'like' AND p.author_contact_id IS NOT NULL AND r.contact_id IS DISTINCT FROM p.author_contact_id LOOP
    PERFORM app_servicio.award_points(x.author_contact_id, p_product_id, NULL, 'like', 'like:' || x.post_id || ':' || COALESCE(x.contact_id, x.user_id)::text, NULL, NULL, x.created_at);
  END LOOP;
  -- Referidos (de quienes tienen este programa).
  FOR x IN SELECT c.id, c.affiliate_contact_id, c.created_at FROM public.contacts c
            WHERE c.workspace_id = v_ws AND c.affiliate_contact_id IS NOT NULL AND c.deleted_at IS NULL
              AND p_product_id IN (SELECT app_servicio.points_contact_products(c.affiliate_contact_id)) LOOP
    PERFORM app_servicio.award_points(x.affiliate_contact_id, p_product_id, NULL, 'ref_lead', 'ref_lead:' || x.id, NULL, NULL, x.created_at);
    IF EXISTS (SELECT 1 FROM public.bookings b WHERE b.contact_id = x.id) THEN
      PERFORM app_servicio.award_points(x.affiliate_contact_id, p_product_id, NULL, 'ref_booking', 'ref_booking:' || x.id, NULL, NULL,
        (SELECT min(b.created_at) FROM public.bookings b WHERE b.contact_id = x.id));
    END IF;
  END LOOP;
  FOR x IN SELECT sa.id, sa.affiliate_contact_id, sa.created_at FROM public.sales sa
            WHERE sa.workspace_id = v_ws AND sa.affiliate_contact_id IS NOT NULL AND sa.status IN ('paid', 'subscription_active')
              AND p_product_id IN (SELECT app_servicio.points_contact_products(sa.affiliate_contact_id)) LOOP
    PERFORM app_servicio.award_points(x.affiliate_contact_id, p_product_id, NULL, 'ref_sale', 'ref_sale:' || x.id, NULL, NULL, x.created_at);
  END LOOP;
  PERFORM set_config('app_servicio.system', v_prev, true);
  SELECT count(*) INTO v_rows_after FROM app_servicio_portal.points_ledger WHERE product_id = p_product_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'points.backfill', jsonb_build_object('added', v_rows_after - v_rows_before));
  RETURN jsonb_build_object('added', v_rows_after - v_rows_before);
END;
$$;

-- ─── 4. Los disparadores (nunca frenan lo que los dispara) ──────────────────
CREATE OR REPLACE FUNCTION app_servicio.points_progress_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
BEGIN
  BEGIN
    IF NEW.viewed_at IS NULL AND NEW.completed_at IS NULL THEN RETURN NULL; END IF;
    SELECT id, kind, title, product_id INTO it FROM app_servicio.program_items WHERE id = NEW.program_item_id;
    IF it.id IS NULL THEN RETURN NULL; END IF;
    IF it.kind = 'lesson' THEN
      PERFORM app_servicio.award_points(NEW.contact_id, it.product_id, NULL, 'lesson', 'lesson:' || it.id, NULL, it.title, COALESCE(NEW.completed_at, NEW.viewed_at));
    ELSIF NEW.completed_at IS NOT NULL THEN
      PERFORM app_servicio.award_points(NEW.contact_id, it.product_id, NULL, 'module', 'module:' || it.id, NULL, it.title, NEW.completed_at);
    END IF;
    IF NEW.completed_at IS NOT NULL AND app_servicio.points_all_content_done(NEW.contact_id, it.product_id) THEN
      PERFORM app_servicio.award_points(NEW.contact_id, it.product_id, NULL, 'all_content', 'all_content:' || it.product_id, NULL, 'Terminó todo el contenido', NEW.completed_at);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_progress', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_progress ON app_servicio_portal.program_progress;
CREATE TRIGGER trg_points_progress AFTER INSERT OR UPDATE OF viewed_at, completed_at ON app_servicio_portal.program_progress
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_progress_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_item_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  BEGIN
    IF NEW.status <> 'completed' OR OLD.status = 'completed' OR NEW.is_recurring_template THEN RETURN NULL; END IF;
    -- Una repetición tarde que no cuenta (late.counts = false) no suma.
    IF NEW.parent_item_id IS NOT NULL AND NEW.late -> 'counts' = 'false'::jsonb AND NEW.due_at IS NOT NULL AND NEW.completed_at > NEW.due_at THEN RETURN NULL; END IF;
    SELECT * INTO s FROM app_servicio.services WHERE id = NEW.service_id;
    PERFORM app_servicio.award_points(s.contact_id, s.product_id, s.id, 'step', 'step:' || NEW.id,
      CASE WHEN app_servicio.j_int(NEW.ref -> 'points') THEN (NEW.ref ->> 'points')::integer END, NEW.name, COALESCE(NEW.completed_at, now()));
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_item', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_item ON app_servicio.service_items;
CREATE TRIGGER trg_points_item AFTER UPDATE OF status ON app_servicio.service_items
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_item_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_phase_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  BEGIN
    IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
    SELECT * INTO s FROM app_servicio.services WHERE id = NEW.service_id;
    PERFORM app_servicio.award_points(s.contact_id, s.product_id, s.id, 'phase', 'phase:' || NEW.id,
      (SELECT CASE WHEN app_servicio.j_int(t -> 'points') THEN (t ->> 'points')::integer END
         FROM public.product_variants pv, jsonb_array_elements(COALESCE(pv.journey_template -> 'phases', '[]'::jsonb)) t
        WHERE pv.id = s.product_variant_id AND t ->> 'key' = NEW.template_key LIMIT 1), NEW.name, COALESCE(NEW.completed_at, now()));
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_phase', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_phase ON app_servicio.service_phases;
CREATE TRIGGER trg_points_phase AFTER UPDATE OF status ON app_servicio.service_phases
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_phase_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_service_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN RETURN NULL; END IF;
    PERFORM app_servicio.award_points(NEW.contact_id, NEW.product_id, NEW.id, 'journey', 'journey:' || NEW.id, NULL, 'Completó el camino', now());
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_service', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_service ON app_servicio.services;
CREATE TRIGGER trg_points_service AFTER UPDATE OF status ON app_servicio.services
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_service_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_submission_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  f record; v_pts jsonb;
BEGIN
  BEGIN
    IF NEW.contact_id IS NULL OR NEW.status IS DISTINCT FROM 'received' THEN RETURN NULL; END IF;
    SELECT id, type, product_id INTO f FROM public.forms WHERE id = NEW.form_id;
    IF f.id IS NULL OR f.product_id IS NULL OR f.type NOT IN ('activity', 'quiz') THEN RETURN NULL; END IF;
    SELECT pi.points INTO v_pts FROM app_servicio.program_items pi WHERE pi.form_id = f.id LIMIT 1;
    IF TG_OP = 'INSERT' THEN
      IF f.type = 'activity' THEN
        PERFORM app_servicio.award_points(NEW.contact_id, f.product_id, NULL, 'submit', 'submit:' || f.id,
          CASE WHEN app_servicio.j_int(v_pts -> 'submit') THEN (v_pts ->> 'submit')::integer END, NULL, NEW.created_at);
      ELSIF NEW.grade -> 'passed' = 'true'::jsonb THEN
        PERFORM app_servicio.award_points(NEW.contact_id, f.product_id, NULL, 'quiz_pass', 'quiz_pass:' || f.id,
          CASE WHEN app_servicio.j_int(v_pts -> 'pass') THEN (v_pts ->> 'pass')::integer END, NULL, NEW.created_at);
      END IF;
    ELSIF f.type = 'activity' AND NEW.review_status = 'reviewed' AND OLD.review_status IS DISTINCT FROM 'reviewed' AND NEW.grade -> 'passed' = 'true'::jsonb THEN
      PERFORM app_servicio.award_points(NEW.contact_id, f.product_id, NULL, 'pass', 'pass:' || f.id,
        CASE WHEN app_servicio.j_int(v_pts -> 'pass') THEN (v_pts ->> 'pass')::integer END, NULL, COALESCE(NEW.reviewed_at, now()));
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_submission', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_submission ON public.form_submissions;
CREATE TRIGGER trg_points_submission AFTER INSERT OR UPDATE OF review_status ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_submission_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_attendance_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_product uuid;
BEGIN
  BEGIN
    IF NEW.removed_at IS NOT NULL THEN RETURN NULL; END IF;
    SELECT product_id INTO v_product FROM app_servicio.live_sessions WHERE id = NEW.live_session_id;
    PERFORM app_servicio.award_points(NEW.contact_id, v_product, NULL, 'attendance', 'attendance:' || NEW.live_session_id || ':' || NEW.occurs_on, NULL, NULL, COALESCE(NEW.marked_at, now()));
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_attendance', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_attendance ON app_servicio_portal.live_attendance;
CREATE TRIGGER trg_points_attendance AFTER INSERT ON app_servicio_portal.live_attendance
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_attendance_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_post_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_key text;
BEGIN
  BEGIN
    IF NEW.author_contact_id IS NULL OR NEW.as_business THEN RETURN NULL; END IF;
    v_key := CASE WHEN NEW.parent_id IS NULL THEN 'post:' ELSE 'comment:' END || NEW.id;
    IF TG_OP = 'INSERT' THEN
      PERFORM app_servicio.award_points(NEW.author_contact_id, NEW.product_id, NULL, CASE WHEN NEW.parent_id IS NULL THEN 'post' ELSE 'comment' END, v_key, NULL, NULL, NEW.created_at);
    ELSIF NEW.hidden_at IS NOT NULL AND OLD.hidden_at IS NULL THEN
      -- Lo ocultó el equipo (moderación): se descuenta.
      PERFORM app_servicio.revoke_points(NEW.author_contact_id, NEW.product_id, v_key, 'Publicación ocultada por moderación');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_post', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_post ON app_servicio_portal.community_posts;
CREATE TRIGGER trg_points_post AFTER INSERT OR UPDATE OF hidden_at ON app_servicio_portal.community_posts
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_post_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_reaction_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p record;
BEGIN
  BEGIN
    IF NEW.kind <> 'like' THEN RETURN NULL; END IF;
    SELECT id, product_id, author_contact_id INTO p FROM app_servicio_portal.community_posts WHERE id = NEW.post_id;
    IF p.author_contact_id IS NULL OR NEW.contact_id IS NOT DISTINCT FROM p.author_contact_id THEN RETURN NULL; END IF;
    PERFORM app_servicio.award_points(p.author_contact_id, p.product_id, NULL, 'like', 'like:' || p.id || ':' || COALESCE(NEW.contact_id, NEW.user_id)::text, NULL, NULL, NEW.created_at);
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_reaction', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_reaction ON app_servicio_portal.community_reactions;
CREATE TRIGGER trg_points_reaction AFTER INSERT ON app_servicio_portal.community_reactions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_reaction_hook();

-- Referidos: el lead con su código, cuando agenda y cuando compra (en cada programa de quien refiere).
CREATE OR REPLACE FUNCTION app_servicio.points_referral_contact_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_product uuid;
BEGIN
  BEGIN
    IF TG_OP = 'UPDATE' AND OLD.affiliate_contact_id IS NOT DISTINCT FROM NEW.affiliate_contact_id THEN RETURN NULL; END IF;
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    FOR v_product IN SELECT app_servicio.points_contact_products(NEW.affiliate_contact_id) LOOP
      PERFORM app_servicio.award_points(NEW.affiliate_contact_id, v_product, NULL, 'ref_lead', 'ref_lead:' || NEW.id, NULL, NULL, now());
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_referral', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_referral_contact ON public.contacts;
CREATE TRIGGER trg_points_referral_contact AFTER INSERT OR UPDATE OF affiliate_contact_id ON public.contacts
  FOR EACH ROW WHEN (NEW.affiliate_contact_id IS NOT NULL) EXECUTE FUNCTION app_servicio.points_referral_contact_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_referral_booking_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ref uuid; v_product uuid;
BEGIN
  BEGIN
    IF NEW.contact_id IS NULL OR NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    SELECT affiliate_contact_id INTO v_ref FROM public.contacts WHERE id = NEW.contact_id;
    IF v_ref IS NULL THEN RETURN NULL; END IF;
    FOR v_product IN SELECT app_servicio.points_contact_products(v_ref) LOOP
      PERFORM app_servicio.award_points(v_ref, v_product, NULL, 'ref_booking', 'ref_booking:' || NEW.contact_id, NULL, NULL, now());
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_referral', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_referral_booking ON public.bookings;
CREATE TRIGGER trg_points_referral_booking AFTER INSERT ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_referral_booking_hook();

CREATE OR REPLACE FUNCTION app_servicio.points_referral_sale_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_product uuid;
BEGIN
  BEGIN
    IF NEW.affiliate_contact_id IS NULL OR NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    IF NEW.status IN ('paid', 'subscription_active') THEN
      FOR v_product IN SELECT app_servicio.points_contact_products(NEW.affiliate_contact_id) LOOP
        PERFORM app_servicio.award_points(NEW.affiliate_contact_id, v_product, NULL, 'ref_sale', 'ref_sale:' || NEW.id, NULL, NULL, now());
      END LOOP;
    ELSIF NEW.status IN ('cancelled', 'refunded') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
      FOR v_product IN SELECT DISTINCT product_id FROM app_servicio_portal.points_ledger WHERE contact_id = NEW.affiliate_contact_id AND source_key = 'ref_sale:' || NEW.id LOOP
        PERFORM app_servicio.revoke_points(NEW.affiliate_contact_id, v_product, 'ref_sale:' || NEW.id, 'Se anuló la venta referida');
      END LOOP;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'points_referral', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_points_referral_sale ON public.sales;
CREATE TRIGGER trg_points_referral_sale AFTER INSERT OR UPDATE OF status, affiliate_contact_id ON public.sales
  FOR EACH ROW EXECUTE FUNCTION app_servicio.points_referral_sale_hook();

-- ─── 5. «Subió de nivel» en Automatizaciones ────────────────────────────────
-- Antes de cambiar el CHECK: si la base acepta algún tipo que esta lista no tiene, frena (no se saca ninguno).
DO $$
DECLARE
  v_def text;
  v_live text[];
  v_new text[] := ARRAY['keyword', 'postback', 'quick_reply', 'welcome', 'default', 'comment_keyword', 'new_contact', 'crm_event', 'inactivity', 'email_received', 'booking_created', 'booking_rescheduled', 'booking_cancelled', 'booking_updated', 'booking_ended', 'booking_status_changed', 'booking_before_start', 'booking_after_end', 'booking_after_created', 'call_analyzed', 'call_linked', 'form_submitted', 'survey_answered', 'contract_signed', 'sale_created', 'sale_status_changed', 'payment_created', 'payment_status_changed', 'payment_before_due', 'payment_after_due', 'eod_submitted', 'webhook_received', 'task_completed', 'task_overdue', 'whatsapp_group_joined', 'whatsapp_group_reaction', 'whatsapp_group_poll_vote', 'scheduled_time', 'affiliate_assignment_expired', 'affiliate_lead_created', 'affiliate_sale_created', 'certificate_issued', 'challenge_completed', 'challenge_occurrence_due_soon', 'challenge_occurrence_overdue', 'challenge_started', 'live_session_missed', 'portal_access_expired', 'portal_access_expiring', 'program_lesson_completed', 'program_module_completed', 'quiz_failed', 'quiz_passed', 'service_created', 'service_ending_soon', 'service_extended', 'service_item_completed', 'service_item_overdue', 'service_light_changed', 'service_paused', 'service_phase_completed', 'service_phase_started', 'service_resumed', 'service_started', 'service_status_changed', 'task_submission_received', 'task_submission_reviewed', 'service_relative', 'service_phase_periodic', 'points_level_up'];
  x text;
BEGIN
  SELECT pg_get_constraintdef(c.oid) INTO v_def FROM pg_constraint c
   WHERE c.conrelid = 'public.triggers'::regclass AND c.conname = 'triggers_type_check';
  IF v_def IS NULL THEN RETURN; END IF;
  SELECT array_agg(m[1]) INTO v_live FROM regexp_matches(v_def, '''([^'']+)''', 'g') AS t(m);
  FOREACH x IN ARRAY COALESCE(v_live, ARRAY[]::text[]) LOOP
    IF NOT (x = ANY (v_new)) THEN
      RAISE EXCEPTION 'triggers_type_check acepta % y la lista nueva no: revisar antes de aplicar', x;
    END IF;
  END LOOP;
END $$;

-- CHECK de triggers.type: los vigentes (los de la 00372, 69) + points_level_up.
ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;
ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (type = ANY (ARRAY['keyword'::text, 'postback'::text, 'quick_reply'::text, 'welcome'::text, 'default'::text, 'comment_keyword'::text, 'new_contact'::text, 'crm_event'::text, 'inactivity'::text, 'email_received'::text, 'booking_created'::text, 'booking_rescheduled'::text, 'booking_cancelled'::text, 'booking_updated'::text, 'booking_ended'::text, 'booking_status_changed'::text, 'booking_before_start'::text, 'booking_after_end'::text, 'booking_after_created'::text, 'call_analyzed'::text, 'call_linked'::text, 'form_submitted'::text, 'survey_answered'::text, 'contract_signed'::text, 'sale_created'::text, 'sale_status_changed'::text, 'payment_created'::text, 'payment_status_changed'::text, 'payment_before_due'::text, 'payment_after_due'::text, 'eod_submitted'::text, 'webhook_received'::text, 'task_completed'::text, 'task_overdue'::text, 'whatsapp_group_joined'::text, 'whatsapp_group_reaction'::text, 'whatsapp_group_poll_vote'::text, 'scheduled_time'::text, 'affiliate_assignment_expired'::text, 'affiliate_lead_created'::text, 'affiliate_sale_created'::text, 'certificate_issued'::text, 'challenge_completed'::text, 'challenge_occurrence_due_soon'::text, 'challenge_occurrence_overdue'::text, 'challenge_started'::text, 'live_session_missed'::text, 'portal_access_expired'::text, 'portal_access_expiring'::text, 'program_lesson_completed'::text, 'program_module_completed'::text, 'quiz_failed'::text, 'quiz_passed'::text, 'service_created'::text, 'service_ending_soon'::text, 'service_extended'::text, 'service_item_completed'::text, 'service_item_overdue'::text, 'service_light_changed'::text, 'service_paused'::text, 'service_phase_completed'::text, 'service_phase_started'::text, 'service_resumed'::text, 'service_started'::text, 'service_status_changed'::text, 'task_submission_received'::text, 'task_submission_reviewed'::text, 'service_relative'::text, 'service_phase_periodic'::text, 'points_level_up'::text]));

-- ─── 6. Permisos ────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.points_tz(uuid, uuid), app_servicio.points_level_check(app_servicio.services, jsonb, integer, integer),
  app_servicio.points_contact_products(uuid), app_servicio.points_all_content_done(uuid, uuid),
  app_servicio.award_points(uuid, uuid, uuid, text, text, integer, text, timestamptz), app_servicio.revoke_points(uuid, uuid, text, text),
  app_servicio.points_adjust(uuid, integer, text), app_servicio.points_backfill(uuid),
  app_servicio.points_progress_hook(), app_servicio.points_item_hook(), app_servicio.points_phase_hook(), app_servicio.points_service_hook(),
  app_servicio.points_submission_hook(), app_servicio.points_attendance_hook(), app_servicio.points_post_hook(), app_servicio.points_reaction_hook(),
  app_servicio.points_referral_contact_hook(), app_servicio.points_referral_booking_hook(), app_servicio.points_referral_sale_hook()
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.points_tz(uuid, uuid), app_servicio.points_contact_products(uuid), app_servicio.points_all_content_done(uuid, uuid),
  app_servicio.award_points(uuid, uuid, uuid, text, text, integer, text, timestamptz), app_servicio.revoke_points(uuid, uuid, text, text),
  app_servicio.points_adjust(uuid, integer, text), app_servicio.points_backfill(uuid)
TO service_role;
-- El equipo (con `portal.points`, mirado adentro) ajusta a mano y calcula lo ya hecho desde el panel.
GRANT EXECUTE ON FUNCTION app_servicio.points_adjust(uuid, integer, text), app_servicio.points_backfill(uuid) TO authenticated;

-- Para volver atrás:
--   DROP TRIGGER IF EXISTS trg_points_progress ON app_servicio_portal.program_progress; DROP TRIGGER IF EXISTS trg_points_item ON app_servicio.service_items;
--   DROP TRIGGER IF EXISTS trg_points_phase ON app_servicio.service_phases; DROP TRIGGER IF EXISTS trg_points_service ON app_servicio.services;
--   DROP TRIGGER IF EXISTS trg_points_submission ON public.form_submissions; DROP TRIGGER IF EXISTS trg_points_attendance ON app_servicio_portal.live_attendance;
--   DROP TRIGGER IF EXISTS trg_points_post ON app_servicio_portal.community_posts; DROP TRIGGER IF EXISTS trg_points_reaction ON app_servicio_portal.community_reactions;
--   DROP TRIGGER IF EXISTS trg_points_referral_contact ON public.contacts; DROP TRIGGER IF EXISTS trg_points_referral_booking ON public.bookings;
--   DROP TRIGGER IF EXISTS trg_points_referral_sale ON public.sales;
