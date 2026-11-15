-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00385_portal_context  (Portal de estudiantes, Corrida B2 · P03)
-- ============================================================================
-- `app_servicio_portal.portal_context(session, host, product_id?)`: lo que arma el shell del portal en cada pedido
-- (§5 del plano, F205, F208, F210 a F212). Con la forma de `PortalContext` del repo del portal:
--   contract, brand {name, short, logo_path, host, support}, programs[], program, moment, variant, status
--   (active · paused · ended), pause {since, until}, terms_pending, preview, points_enabled, levels, me, sections[]
--   ({key, display: open · locked · soon, reason, when, expired, count}), excluded[], notifications_count.
--
-- El menú lo decide la base, sección por sección (decisión 430):
--   * Inicio, Mi camino y Perfil: siempre.
--   * Contenido, Calendario, Reto, Comunidad, Asistente IA y Mis referidos: la sección tiene que estar prendida en el
--     programa (`portal_section_enabled`) e incluida en SU variante (`portal_section_rule`). Si no: no viene (y va en
--     `excluded`, para «Esto no está en <programa>»).
--   * Con acceso vigente (`portal_access_effective`): abierta. Acceso que terminó: con candado y `expired`. Cortado por
--     un pago vencido: con candado y el motivo. Todavía no abrió: como dice la regla (`display`): `hidden` no viene,
--     `coming_soon` → «Pronto» con la fecha si la hay, `locked` (por defecto) → candado con el motivo.
--   * Sala de la fama y Mis proyectos son de la Corrida C: todavía no vienen.
-- El negocio sale de la sesión y se comprueba contra la dirección (`host`): una sesión de otro negocio da PO401.
--
-- Solo lectura (salvo el día activo que ya suma `session_resolve`, 00384). Aditiva.
--
-- Volver atrás: DROP FUNCTION IF EXISTS app_servicio_portal.portal_context(text, text, uuid), app_servicio_portal.portal_public_brand(text), app_servicio_portal.ctx_programs(uuid, uuid),
--   app_servicio_portal.ctx_section(uuid, uuid, uuid, text, date);
-- ============================================================================

-- Los programas de una persona: productos con portal donde tiene un servicio (no cancelado) con una variante que
-- tiene el portal prendido. Primero los activos; dentro, el más reciente.
CREATE OR REPLACE FUNCTION app_servicio_portal.ctx_programs(p_ws uuid, p_contact uuid)
RETURNS TABLE (product_id uuid, name text, product_type text, service_id uuid, variant_id uuid, status text, starts_on date, paused_at timestamptz,
               pause_cut_access boolean, pause_resume_on date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT DISTINCT ON (p.id) p.id, p.name, p.product_type, s.id, s.product_variant_id, s.status, s.starts_on, s.paused_at, s.pause_cut_access, s.pause_resume_on
    FROM app_servicio.services s
    JOIN public.products p ON p.id = s.product_id
    JOIN public.product_variants v ON v.id = s.product_variant_id
   WHERE s.workspace_id = p_ws AND s.contact_id = p_contact AND s.status <> 'cancelled' AND p.portal_enabled
     AND COALESCE((v.portal_settings ->> 'enabled')::boolean, false)
   ORDER BY p.id, (s.status IN ('active', 'paused')) DESC, s.created_at DESC;
$$;

-- El estado de UNA sección para el menú. NULL = no viene (oculta, no incluida o apagada).
CREATE OR REPLACE FUNCTION app_servicio_portal.ctx_section(p_contact uuid, p_product uuid, p_variant uuid, p_section text, p_starts date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_rule jsonb;
  o jsonb;
  v_display text;
  v_when date;
  v_reason text;
  v_ref text;
  v_name text;
BEGIN
  IF NOT app_servicio.portal_section_enabled(p_product, p_section) THEN RETURN NULL; END IF;
  v_rule := app_servicio.portal_section_rule(p_variant, p_section);
  IF v_rule IS NULL THEN RETURN NULL; END IF;
  IF app_servicio.portal_access_effective(p_contact, p_product, p_section) IS NOT NULL THEN
    RETURN jsonb_build_object('display', 'open');
  END IF;
  -- Tuvo acceso y se cortó.
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.contact_id = p_contact AND a.product_id = p_product AND a.section = p_section
              AND a.revoked_at IS NULL AND a.suspended_overdue_at IS NOT NULL) THEN
    RETURN jsonb_build_object('display', 'locked', 'reason', 'Se reabre cuando se regularice el pago');
  END IF;
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.contact_id = p_contact AND a.product_id = p_product AND a.section = p_section
              AND (a.revoked_at IS NOT NULL OR a.ends_at < now())) THEN
    RETURN jsonb_build_object('display', 'locked', 'expired', true, 'reason', 'Tu acceso a esta sección terminó');
  END IF;
  -- Todavía no abrió: como dice la regla.
  v_display := COALESCE(v_rule ->> 'display', 'locked');
  IF v_display = 'hidden' THEN RETURN NULL; END IF;
  o := COALESCE(NULLIF(v_rule -> 'opens', 'null'::jsonb), '{"type":"service_start"}'::jsonb);
  v_ref := o ->> 'ref';
  CASE o ->> 'type'
    WHEN 'fixed_date' THEN v_when := NULLIF(o ->> 'date', '')::date;
    WHEN 'days_after_start' THEN v_when := p_starts + COALESCE((o ->> 'days')::integer, 0);
    WHEN 'service_start' THEN v_when := p_starts;
    ELSE v_when := NULL;
  END CASE;
  IF o ->> 'type' = 'phase_completed' THEN
    SELECT ph ->> 'name' INTO v_name FROM public.product_variants v, jsonb_array_elements(COALESCE(v.journey_template -> 'phases', '[]'::jsonb)) ph
     WHERE v.id = p_variant AND ph ->> 'key' = v_ref LIMIT 1;
    v_reason := 'Se abre al terminar ' || COALESCE('la fase «' || v_name || '»', 'una fase de tu camino');
  ELSIF o ->> 'type' = 'item_completed' THEN
    SELECT it ->> 'name' INTO v_name FROM public.product_variants v, jsonb_array_elements(COALESCE(v.journey_template -> 'phases', '[]'::jsonb)) ph,
           jsonb_array_elements(COALESCE(ph -> 'items', '[]'::jsonb)) it
     WHERE v.id = p_variant AND it ->> 'key' = v_ref LIMIT 1;
    v_reason := 'Se abre al completar ' || COALESCE('«' || v_name || '»', 'un paso de tu camino');
  ELSIF o ->> 'type' = 'module_completed' THEN
    SELECT i.title INTO v_name FROM app_servicio.program_items i WHERE i.id::text = v_ref AND i.product_id = p_product;
    v_reason := 'Se abre al terminar ' || COALESCE('el módulo «' || v_name || '»', 'un módulo');
  ELSIF o ->> 'type' = 'challenge_started' THEN
    v_reason := 'Se abre cuando empieces el reto';
  ELSIF v_when IS NOT NULL THEN
    v_reason := 'Se abre el ' || to_char(v_when, 'DD/MM/YYYY');
  ELSE
    v_reason := 'Se abre más adelante';
  END IF;
  RETURN jsonb_build_object('display', CASE WHEN v_display = 'coming_soon' THEN 'soon' ELSE 'locked' END, 'reason', v_reason,
                            'when', CASE WHEN v_when IS NOT NULL AND v_when > CURRENT_DATE THEN to_char(v_when, 'YYYY-MM-DD') END);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_context(p_session text, p_host text, p_product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  v_ws uuid := (sess ->> 'workspace_id')::uuid;
  v_contact uuid := (sess ->> 'contact_id')::uuid;
  w public.workspaces;
  a app_servicio_portal.portal_accounts;
  c public.contacts;
  pr record;
  v_programs jsonb := '[]'::jsonb;
  v_program jsonb;
  v_sections jsonb := '[]'::jsonb;
  v_excluded jsonb := '[]'::jsonb;
  v_status text := 'ended';
  v_pause jsonb;
  v_moment text;
  v_points jsonb;
  v_total integer;
  v_notif integer := 0;
  v_st jsonb;
  k record;
  v_any_open boolean := false;
BEGIN
  IF app_servicio_portal.ws_by_host(p_host) IS DISTINCT FROM v_ws THEN PERFORM app_servicio_portal.err('PO401', 'Tu sesión venció. Volvé a entrar'); END IF;
  SELECT * INTO w FROM public.workspaces WHERE id = v_ws;
  SELECT * INTO c FROM public.contacts WHERE id = v_contact;
  SELECT * INTO a FROM app_servicio_portal.portal_accounts WHERE workspace_id = v_ws AND contact_id = v_contact;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', x.product_id, 'name', x.name, 'short', x.name, 'detail', COALESCE(x.product_type, ''),
           'kind', CASE WHEN x.product_type = 'event' THEN 'event' ELSE 'program' END, 'nick', 'el programa «' || x.name || '»')
           ORDER BY (x.status IN ('active', 'paused')) DESC, x.name), '[]'::jsonb)
    INTO v_programs FROM app_servicio_portal.ctx_programs(v_ws, v_contact) x;

  SELECT * INTO pr FROM app_servicio_portal.ctx_programs(v_ws, v_contact) x
   ORDER BY (x.product_id = p_product_id) DESC, (x.status IN ('active', 'paused')) DESC, x.name LIMIT 1;

  IF pr.product_id IS NOT NULL THEN
    v_program := (SELECT e FROM jsonb_array_elements(v_programs) e WHERE e ->> 'id' = pr.product_id::text);
    -- Las secciones del menú, en el orden del portal.
    FOR k IN SELECT * FROM (VALUES (1, 'inicio', NULL), (2, 'camino', NULL), (3, 'programa', 'program'), (4, 'calendario', 'calendar'),
                                   (5, 'reto', 'challenge'), (6, 'comunidad', 'community'), (7, 'referidos', 'affiliates'),
                                   (8, 'asistente', 'assistant'), (9, 'perfil', NULL)) t(pos, key, section) ORDER BY pos LOOP
      IF k.section IS NULL THEN
        v_sections := v_sections || jsonb_build_object('key', k.key, 'display', 'open');
        CONTINUE;
      END IF;
      v_st := app_servicio_portal.ctx_section(v_contact, pr.product_id, pr.variant_id, k.section, pr.starts_on);
      IF v_st IS NULL THEN
        IF app_servicio.portal_section_rule(pr.variant_id, k.section) IS NULL OR NOT app_servicio.portal_section_enabled(pr.product_id, k.section) THEN
          v_excluded := v_excluded || to_jsonb(k.key);
        END IF;
        CONTINUE;
      END IF;
      IF v_st ->> 'display' = 'open' THEN v_any_open := true; END IF;
      IF k.key = 'comunidad' AND v_st ->> 'display' = 'open' THEN
        v_st := v_st || jsonb_build_object('count', (SELECT count(*) FROM app_servicio_portal.community_posts p
          WHERE p.product_id = pr.product_id AND p.parent_id IS NULL AND p.deleted_at IS NULL AND p.hidden_at IS NULL
            AND p.author_contact_id IS DISTINCT FROM v_contact
            AND p.created_at > GREATEST(COALESCE(a.notifications_seen_at, '-infinity'::timestamptz), now() - interval '7 days')));
      END IF;
      v_sections := v_sections || (jsonb_build_object('key', k.key) || v_st);
    END LOOP;

    -- El estado del programa (F212).
    IF pr.status = 'paused' AND pr.pause_cut_access THEN
      v_status := 'paused';
      v_pause := jsonb_build_object('since', to_char(app_servicio.local_date(pr.paused_at, v_ws), 'YYYY-MM-DD'), 'until', to_char(pr.pause_resume_on, 'YYYY-MM-DD'));
    ELSIF pr.status IN ('active', 'paused', 'pending_confirmation') OR v_any_open THEN
      v_status := 'active';
    END IF;

    -- El momento (para el Inicio): terminado, en pausa, certificado, en el reto, en el onboarding o a mitad de camino.
    v_moment := CASE
      WHEN v_status = 'ended' THEN 'exp'
      WHEN v_status = 'paused' THEN 'pausa'
      WHEN EXISTS (SELECT 1 FROM app_servicio.service_items i WHERE i.service_id = pr.service_id AND i.kind = 'certificate' AND i.status = 'completed') THEN 'cert'
      WHEN EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id AND ph.status = 'in_progress' AND ph.challenge -> 'enabled' = 'true'::jsonb) THEN 'reto'
      WHEN COALESCE((SELECT ph.position FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id AND ph.status = 'in_progress' ORDER BY ph.position LIMIT 1), 0)
           = (SELECT min(ph.position) FROM app_servicio.service_phases ph WHERE ph.service_id = pr.service_id) THEN 'onb'
      ELSE 'mid' END;

    SELECT portal_settings -> 'points' INTO v_points FROM public.products WHERE id = pr.product_id;
    SELECT COALESCE(sum(points), 0)::integer INTO v_total FROM app_servicio_portal.points_ledger WHERE contact_id = v_contact AND product_id = pr.product_id;
    IF a.id IS NOT NULL THEN
      v_notif := COALESCE((app_servicio.portal_notifications_view(a.id, pr.product_id) ->> 'unseen')::integer, 0)
               + COALESCE(jsonb_array_length(app_servicio.portal_notifications_view(a.id, pr.product_id) -> 'today_items'), 0);
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'contract', app_servicio.contract_version()::integer,
    'brand', jsonb_build_object('name', COALESCE(NULLIF(w.brand_name, ''), w.name), 'short', upper(left(COALESCE(NULLIF(w.brand_name, ''), w.name), 1)),
                                'logo_path', w.brand_logo_path, 'color', w.brand_color, 'host', w.portal_settings ->> 'host',
                                'support', w.portal_settings ->> 'support_whatsapp'),
    'programs', v_programs,
    'program', v_program,
    'moment', COALESCE(v_moment, 'exp'),
    'variant', 'full',
    'status', v_status,
    'pause', v_pause,
    'terms_pending', CASE WHEN pr.product_id IS NULL THEN false ELSE app_servicio.portal_terms_pending(v_contact, pr.product_id) END,
    'preview', sess ->> 'kind' = 'preview',
    'points_enabled', COALESCE(v_points -> 'enabled' = 'true'::jsonb, false),
    'levels', (SELECT jsonb_agg(jsonb_build_object('level', n, 'name', l ->> 'name', 'min', (l ->> 'min')::integer) ORDER BY n)
                 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(v_points -> 'levels') = 'array' AND jsonb_array_length(v_points -> 'levels') = 9 THEN v_points -> 'levels'
                   ELSE '[{"name":"Explorador","min":0},{"name":"Aprendiz","min":10},{"name":"Constructor","min":30},{"name":"Builder","min":60},{"name":"Builder Pro","min":100},{"name":"Arquitecto","min":160},{"name":"Experto","min":250},{"name":"Maestro","min":400},{"name":"Leyenda","min":600}]'::jsonb END)
                   WITH ORDINALITY AS t(l, n)),
    'me', jsonb_build_object('name', COALESCE(a.display_name, c.display_name, ''), 'first_name', split_part(COALESCE(a.display_name, c.display_name, ''), ' ', 1),
                             'email', COALESCE(a.email, c.email), 'points', CASE WHEN COALESCE(v_points -> 'enabled' = 'true'::jsonb, false) THEN v_total END,
                             'theme', COALESCE(a.notification_prefs ->> 'theme', 'dark')),
    'sections', v_sections,
    'excluded', v_excluded,
    'notifications_count', v_notif);
END;
$$;

-- La marca para las pantallas SIN sesión (Entrar, invitación, «Este portal no existe»): solo lo público del negocio
-- de esa dirección. Dirección desconocida: {exists:false}, sin ningún nombre (F201).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_public_brand(p_host text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((
    SELECT jsonb_build_object('exists', true, 'name', COALESCE(NULLIF(w.brand_name, ''), w.name),
             'short', upper(left(COALESCE(NULLIF(w.brand_name, ''), w.name), 1)), 'logo_path', w.brand_logo_path, 'color', w.brand_color,
             'host', w.portal_settings ->> 'host', 'support', w.portal_settings ->> 'support_whatsapp',
             'password_allowed', COALESCE(w.portal_settings #> '{login,password_allowed}' = 'true'::jsonb, false),
             'contract', app_servicio.contract_version()::integer)
      FROM public.workspaces w
     WHERE w.id = app_servicio_portal.ws_by_host(p_host) AND app_servicio.module_on(w.id)), jsonb_build_object('exists', false));
$$;

REVOKE ALL ON FUNCTION app_servicio_portal.ctx_programs(uuid, uuid), app_servicio_portal.ctx_section(uuid, uuid, uuid, text, date),
  app_servicio_portal.portal_context(text, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_public_brand(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_context(text, text, uuid), app_servicio_portal.portal_public_brand(text) TO portal_app, service_role;
