-- ============================================================
-- 00377_portal_notifications.sql
-- ============================================================
-- Servicios A3, F128 (decisiones 471 y 475): avisos del estudiante, resumen semanal y días activos.
--
--   * `app_servicio_portal.portal_accounts` suma tres columnas (aprobadas por Wendy el 14/11; ninguna tabla):
--       notification_prefs    jsonb NOT NULL DEFAULT '{}'  lo que eligió en Perfil (lo que falta toma el de por defecto)
--       notifications_seen_at timestamptz NULL             hasta cuándo vio los avisos (el contador de la campana)
--       active_days           date[] NOT NULL DEFAULT '{}' los días que entró al portal, los últimos 180 (decisión 475)
--   * Gemelas puras (lib/portal-notify/rules.ts, rules.cases.json): `portal_notification_prefs` y `portal_active_days_plan`.
--   * Solo servidor (las usa el portal en B2): `portal_touch_active_day` (una escritura por día), `portal_save_notification_prefs`,
--     `portal_mark_notifications_seen` y `portal_notifications_view` («Para hoy» y «Novedades», calculadas, sin guardar).
--   * `products.portal_settings.notifications = {weekly_digest, due_today_email}`: SIN la clave, el resumen semanal y el
--     «vence hoy» por email están APAGADOS en todos los programas (condición de Wendy: se prenden con el portal en línea).
--   * `portal_digest_targets(workspace)` y `portal_digest_data(...)`: a quién le toca el resumen y qué lleva. El envío
--     es código (lib/jobs/handlers/portal-digest.ts) con el Resend del negocio.
--
-- Antes de aplicarla: ninguna cuenta del portal tiene estas columnas; ningún programa tiene `notifications`.
--
-- Como volver atras: la validación vieja de los ajustes del programa está en docs/servicios/definiciones-viejas-a3.sql
-- (§00377). Lo demás se puede dejar, o:
--   DROP FUNCTION IF EXISTS app_servicio.portal_notification_prefs(jsonb), app_servicio.portal_active_days_plan(date[], date),
--     app_servicio.portal_touch_active_day(uuid), app_servicio.portal_save_notification_prefs(uuid, jsonb),
--     app_servicio.portal_mark_notifications_seen(uuid), app_servicio.portal_notifications_view(uuid, uuid),
--     app_servicio.portal_digest_targets(uuid), app_servicio.portal_digest_data(uuid, uuid, timestamptz);
--   ALTER TABLE app_servicio_portal.portal_accounts DROP COLUMN IF EXISTS notification_prefs,
--     DROP COLUMN IF EXISTS notifications_seen_at, DROP COLUMN IF EXISTS active_days;

-- ─── 1. Las columnas ────────────────────────────────────────────────────────
ALTER TABLE app_servicio_portal.portal_accounts
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notifications_seen_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS active_days date[] NOT NULL DEFAULT '{}'::date[];
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_accounts_notification_prefs_check') THEN
    ALTER TABLE app_servicio_portal.portal_accounts ADD CONSTRAINT portal_accounts_notification_prefs_check CHECK (jsonb_typeof(notification_prefs) = 'object');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'portal_accounts_active_days_check') THEN
    ALTER TABLE app_servicio_portal.portal_accounts ADD CONSTRAINT portal_accounts_active_days_check CHECK (cardinality(active_days) <= 180);
  END IF;
END $$;

-- ─── 2. Reglas puras ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_notification_prefs(p jsonb)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object(
    'weekly_digest', CASE WHEN jsonb_typeof(p -> 'weekly_digest') = 'boolean' THEN (p ->> 'weekly_digest')::boolean ELSE true END,
    'due_today_email', CASE WHEN jsonb_typeof(p -> 'due_today_email') = 'boolean' THEN (p ->> 'due_today_email')::boolean ELSE false END,
    'review_done', CASE WHEN jsonb_typeof(p -> 'review_done') = 'boolean' THEN (p ->> 'review_done')::boolean ELSE true END,
    'community_reply', CASE WHEN jsonb_typeof(p -> 'community_reply') = 'boolean' THEN (p ->> 'community_reply')::boolean ELSE true END,
    'announcements', CASE WHEN jsonb_typeof(p -> 'announcements') = 'boolean' THEN (p ->> 'announcements')::boolean ELSE true END);
$$;

-- NULL = hoy ya estaba (no se escribe).
CREATE OR REPLACE FUNCTION app_servicio.portal_active_days_plan(p_days date[], p_today date)
RETURNS date[] LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE WHEN p_today = ANY (COALESCE(p_days, '{}'::date[])) THEN NULL ELSE
    (SELECT COALESCE(array_agg(d ORDER BY d), '{}'::date[]) FROM (
       SELECT DISTINCT d FROM unnest(COALESCE(p_days, '{}'::date[]) || p_today) d
        WHERE d >= p_today - 179 AND d <= p_today) x) END;
$$;

-- ─── 3. Solo servidor: lo que va a llamar el portal (B2) ─────────────────────
-- La zona del estudiante: la de su cuenta, la de su contacto o la del negocio.
CREATE OR REPLACE FUNCTION app_servicio.portal_account_today(p_account_id uuid)
RETURNS date LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (now() AT TIME ZONE COALESCE(NULLIF(a.timezone, ''), NULLIF(c.timezone, ''), app_servicio.ws_tz(a.workspace_id)))::date
    FROM app_servicio_portal.portal_accounts a LEFT JOIN public.contacts c ON c.id = a.contact_id WHERE a.id = p_account_id;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_touch_active_day(p_account_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_days date[]; v_next date[];
BEGIN
  SELECT active_days INTO v_days FROM app_servicio_portal.portal_accounts WHERE id = p_account_id;
  IF NOT FOUND THEN RETURN false; END IF;
  v_next := app_servicio.portal_active_days_plan(v_days, app_servicio.portal_account_today(p_account_id));
  IF v_next IS NULL THEN RETURN false; END IF;
  UPDATE app_servicio_portal.portal_accounts SET active_days = v_next WHERE id = p_account_id;
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_save_notification_prefs(p_account_id uuid, p_prefs jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_clean jsonb;
BEGIN
  IF p_prefs IS NULL OR jsonb_typeof(p_prefs) <> 'object'
     OR EXISTS (SELECT 1 FROM jsonb_each(p_prefs) e WHERE NOT (e.key = ANY (ARRAY['weekly_digest','due_today_email','review_done','community_reply','announcements'])) OR jsonb_typeof(e.value) <> 'boolean') THEN
    RAISE EXCEPTION 'Esas preferencias no son válidas' USING ERRCODE = 'SV038';
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET notification_prefs = notification_prefs || p_prefs, updated_at = now()
   WHERE id = p_account_id RETURNING notification_prefs INTO v_clean;
  IF v_clean IS NULL THEN RAISE EXCEPTION 'No existe la cuenta' USING ERRCODE = 'SV002'; END IF;
  RETURN app_servicio.portal_notification_prefs(v_clean);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_mark_notifications_seen(p_account_id uuid)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE app_servicio_portal.portal_accounts SET notifications_seen_at = now() WHERE id = p_account_id;
$$;

-- «Para hoy» (lo que le vence hoy, en su zona) y «Novedades» (desde la última vez que miró, como mucho 30 días), sin
-- guardar nada. Las novedades respetan sus preferencias (revisaron su entrega, le contestaron, anuncios).
CREATE OR REPLACE FUNCTION app_servicio.portal_notifications_view(p_account_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a app_servicio_portal.portal_accounts;
  v_today date; v_since timestamptz; v_prefs jsonb; v_today_items jsonb; v_news jsonb;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE id = p_account_id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.portal_account_today(a.id);
  v_since := GREATEST(COALESCE(a.notifications_seen_at, '-infinity'::timestamptz), now() - interval '30 days');
  v_prefs := app_servicio.portal_notification_prefs(a.notification_prefs);
  SELECT COALESCE(jsonb_agg(jsonb_build_object('item_id', i.id, 'name', i.name, 'kind', i.kind, 'due_on', i.due_on, 'due_at', i.due_at,
           'occurrence', i.parent_item_id IS NOT NULL) ORDER BY i.due_at NULLS LAST, i.position), '[]'::jsonb)
    INTO v_today_items
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
   WHERE s.contact_id = a.contact_id AND s.product_id = p_product_id AND s.status = 'active' AND s.workspace_id = a.workspace_id
     AND i.status = 'pending' AND NOT i.is_recurring_template AND i.visible_to_client AND i.due_on = v_today;
  SELECT COALESCE(jsonb_agg(n ORDER BY n ->> 'at' DESC), '[]'::jsonb) INTO v_news FROM (
    SELECT jsonb_build_object('kind', 'review', 'at', fs.reviewed_at, 'title', f.name, 'status', fs.review_status, 'submission_id', fs.id) AS n
      FROM public.form_submissions fs JOIN public.forms f ON f.id = fs.form_id
     WHERE (v_prefs ->> 'review_done')::boolean AND fs.contact_id = a.contact_id AND f.product_id = p_product_id
       AND fs.review_status IN ('reviewed', 'needs_changes') AND fs.reviewed_at > v_since
    UNION ALL
    SELECT jsonb_build_object('kind', 'reply', 'at', r.created_at, 'post_id', r.parent_id, 'reply_id', r.id)
      FROM app_servicio_portal.community_posts r JOIN app_servicio_portal.community_posts p ON p.id = r.parent_id
     WHERE (v_prefs ->> 'community_reply')::boolean AND p.author_contact_id = a.contact_id AND r.author_contact_id IS DISTINCT FROM a.contact_id
       AND r.product_id = p_product_id AND r.created_at > v_since AND r.deleted_at IS NULL AND r.hidden_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'announcement', 'at', p.created_at, 'post_id', p.id)
      FROM app_servicio_portal.community_posts p
     WHERE (v_prefs ->> 'announcements')::boolean AND p.as_business AND p.parent_id IS NULL AND p.product_id = p_product_id
       AND p.created_at > v_since AND p.deleted_at IS NULL AND p.hidden_at IS NULL
    UNION ALL
    SELECT jsonb_build_object('kind', 'content', 'at', pi.created_at, 'title', pi.title, 'program_item_id', pi.id)
      FROM app_servicio.program_items pi
     WHERE pi.product_id = p_product_id AND pi.workspace_id = a.workspace_id AND pi.status = 'active' AND pi.kind = 'lesson' AND pi.created_at > v_since
  ) x;
  RETURN jsonb_build_object('today', v_today, 'today_items', v_today_items, 'news', v_news, 'unseen', jsonb_array_length(v_news), 'prefs', v_prefs);
END;
$$;

-- ─── 4. El resumen semanal ───────────────────────────────────────────────────
-- A quién le toca: cuentas activas con un servicio activo de un programa con el resumen PRENDIDO
-- (portal_settings.notifications.weekly_digest = true) y que no lo apagaron en Perfil. Con su zona.
CREATE OR REPLACE FUNCTION app_servicio.portal_digest_targets(p_workspace_id uuid)
RETURNS TABLE (account_id uuid, contact_id uuid, email text, display_name text, timezone text, product_id uuid, product_name text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT a.id, a.contact_id, a.email, COALESCE(a.display_name, c.display_name),
         COALESCE(NULLIF(a.timezone, ''), NULLIF(c.timezone, ''), app_servicio.ws_tz(a.workspace_id)), p.id, p.name
    FROM app_servicio_portal.portal_accounts a
    JOIN public.contacts c ON c.id = a.contact_id
    JOIN app_servicio.services s ON s.contact_id = a.contact_id AND s.workspace_id = a.workspace_id AND s.status = 'active' AND NOT s.is_test
    JOIN public.products p ON p.id = s.product_id
   WHERE a.workspace_id = p_workspace_id AND a.status = 'active' AND app_servicio.module_on(a.workspace_id)
     AND p.portal_settings #> '{notifications,weekly_digest}' = 'true'::jsonb
     AND (app_servicio.portal_notification_prefs(a.notification_prefs) ->> 'weekly_digest')::boolean;
$$;

-- Lo que lleva el resumen de una persona en un programa desde p_since: lo que hizo, lo pendiente, su reto, el contenido
-- nuevo y la comunidad. Cada sección con su número (0 = no sale). Referidos lo arma el código (siempre va).
CREATE OR REPLACE FUNCTION app_servicio.portal_digest_data(p_account_id uuid, p_product_id uuid, p_since timestamptz)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a app_servicio_portal.portal_accounts;
  v_done integer; v_pending integer; v_reports integer; v_content integer; v_community integer; v_today date;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE id = p_account_id;
  IF a.id IS NULL THEN RETURN NULL; END IF;
  v_today := app_servicio.portal_account_today(a.id);
  SELECT count(*) FILTER (WHERE i.status = 'completed' AND i.completed_at >= p_since AND i.parent_item_id IS NULL),
         count(*) FILTER (WHERE i.status = 'pending' AND i.visible_to_client AND i.parent_item_id IS NULL AND i.due_on IS NOT NULL AND i.due_on <= v_today + 7),
         count(*) FILTER (WHERE i.status = 'completed' AND i.completed_at >= p_since AND i.parent_item_id IS NOT NULL)
    INTO v_done, v_pending, v_reports
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
   WHERE s.contact_id = a.contact_id AND s.product_id = p_product_id AND s.status = 'active' AND NOT i.is_recurring_template;
  SELECT count(*) INTO v_content FROM app_servicio.program_items pi
   WHERE pi.product_id = p_product_id AND pi.status = 'active' AND pi.kind = 'lesson' AND pi.created_at >= p_since;
  SELECT count(*) INTO v_community FROM app_servicio_portal.community_posts cp
   WHERE cp.product_id = p_product_id AND cp.parent_id IS NULL AND cp.created_at >= p_since AND cp.deleted_at IS NULL AND cp.hidden_at IS NULL;
  RETURN jsonb_build_object('done', v_done, 'pending', v_pending, 'challenge', v_reports, 'content', v_content, 'community', v_community);
END;
$$;

-- ─── 5. Los ajustes del programa: `notifications` ───────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL)
RETURNS text[]
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','sections','terms','community','affiliates','assistant','notifications']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) THEN v := v || 'Todavía no está disponible'::text;
        ELSIF jsonb_typeof(p -> 'sections' -> k) <> 'boolean' THEN v := v || (k || ': tiene que ser sí o no');
        END IF;
      END LOOP;
    END IF;
  END IF;
  IF p ? 'terms' THEN
    t := p -> 'terms';
    IF jsonb_typeof(t) <> 'object' THEN v := v || 'los términos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(t, ARRAY['enabled','form_id','ask_again_on_change']);
      IF t -> 'enabled' = 'true'::jsonb AND NOT app_servicio.j_uuid(t -> 'form_id') THEN v := v || 'cargá los términos antes de prenderlos'::text; END IF;
    END IF;
  END IF;
  IF p ? 'community' THEN
    c := p -> 'community';
    IF jsonb_typeof(c) <> 'object' THEN v := v || 'la comunidad no es válida'::text;
    ELSE
      v := v || app_servicio.unknown_keys(c, ARRAY['lesson_comments','spaces']);
      IF c ? 'spaces' THEN
        IF jsonb_typeof(c -> 'spaces') <> 'array' THEN v := v || 'los espacios no son válidos'::text;
        ELSE
          FOR sp IN SELECT x FROM jsonb_array_elements(c -> 'spaces') x LOOP
            IF jsonb_typeof(sp) <> 'object' OR jsonb_typeof(sp -> 'key') IS DISTINCT FROM 'string' OR (sp ->> 'key') !~ '^[a-z0-9_]{1,40}$'
               OR jsonb_typeof(sp -> 'name') IS DISTINCT FROM 'string' OR btrim(sp ->> 'name') = '' THEN
              v := v || 'hay un espacio sin nombre o con una clave inválida'::text;
              CONTINUE;
            END IF;
            IF (sp ->> 'key') = ANY (v_keys) THEN v := v || format('el espacio %s está repetido', sp ->> 'key'); END IF;
            v_keys := v_keys || (sp ->> 'key');
          END LOOP;
        END IF;
      END IF;
    END IF;
  END IF;
  IF p ? 'affiliates' THEN
    a := p -> 'affiliates';
    IF jsonb_typeof(a) <> 'object' OR (a ? 'visible_link_keys' AND NOT (jsonb_typeof(a -> 'visible_link_keys') = 'array'
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a -> 'visible_link_keys') x WHERE jsonb_typeof(x) <> 'string' OR (x #>> '{}') !~ '^lk_[a-z0-9]{6}$'))) THEN
      v := v || 'los links de afiliados no son válidos'::text;
    END IF;
  END IF;
  IF p ? 'assistant' THEN
    a := p -> 'assistant';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'el asistente no es válido'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['excluded_kb_ids','monthly_limit_usd_per_student','credits_per_usd','credits_name','suggestions']);
      IF a ? 'monthly_limit_usd_per_student' AND NOT (jsonb_typeof(a -> 'monthly_limit_usd_per_student') = 'number'
         AND app_servicio.j_num(a -> 'monthly_limit_usd_per_student') BETWEEN 0 AND 10000) THEN
        v := v || 'el límite por estudiante va de 0 a 10.000 dólares'::text;
      END IF;
      IF a ? 'credits_per_usd' AND NOT (app_servicio.j_int(a -> 'credits_per_usd') AND app_servicio.j_num(a -> 'credits_per_usd') BETWEEN 1 AND 100000) THEN
        v := v || 'los créditos por dólar tienen que ser un número entero positivo'::text;
      END IF;
    END IF;
  END IF;
  -- A3 (F128): los avisos del programa. Sin la clave, el resumen semanal está APAGADO (condición de Wendy, 14/11).
  IF p ? 'notifications' THEN
    a := p -> 'notifications';
    IF jsonb_typeof(a) <> 'object' THEN v := v || 'los avisos no son válidos'::text;
    ELSE
      v := v || app_servicio.unknown_keys(a, ARRAY['weekly_digest','due_today_email']);
      IF (a ? 'weekly_digest' AND jsonb_typeof(a -> 'weekly_digest') <> 'boolean') OR (a ? 'due_today_email' AND jsonb_typeof(a -> 'due_today_email') <> 'boolean') THEN
        v := v || 'los avisos tienen que ser sí o no'::text;
      END IF;
    END IF;
  END IF;
  RETURN v;
END;
$$;

-- ─── 6. Permisos: todo solo del servidor salvo las reglas puras ─────────────
REVOKE ALL ON FUNCTION
  app_servicio.portal_notification_prefs(jsonb), app_servicio.portal_active_days_plan(date[], date),
  app_servicio.portal_account_today(uuid), app_servicio.portal_touch_active_day(uuid), app_servicio.portal_save_notification_prefs(uuid, jsonb),
  app_servicio.portal_mark_notifications_seen(uuid), app_servicio.portal_notifications_view(uuid, uuid),
  app_servicio.portal_digest_targets(uuid), app_servicio.portal_digest_data(uuid, uuid, timestamptz)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.portal_notification_prefs(jsonb), app_servicio.portal_active_days_plan(date[], date),
  app_servicio.portal_account_today(uuid), app_servicio.portal_touch_active_day(uuid), app_servicio.portal_save_notification_prefs(uuid, jsonb),
  app_servicio.portal_mark_notifications_seen(uuid), app_servicio.portal_notifications_view(uuid, uuid),
  app_servicio.portal_digest_targets(uuid), app_servicio.portal_digest_data(uuid, uuid, timestamptz)
TO service_role;
GRANT EXECUTE ON FUNCTION app_servicio.portal_notification_prefs(jsonb), app_servicio.portal_active_days_plan(date[], date) TO authenticated;
