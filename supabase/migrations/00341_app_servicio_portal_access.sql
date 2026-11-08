-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00341_app_servicio_portal_access  (Servicios v12, Corrida A1 · S09 · bloque AC)
-- ============================================================================
-- 1. `app_servicio_portal.portal_access` (§8.2 #10): un acceso de un contacto a una seccion de un programa,
--    por un servicio. «Todavia no» = no hay fila; una revocada se conserva. Suma `until_type` (de que
--    regla salio su fin: lo necesita el corte al completar o renovar, F38) y `workspace_id`. El unico de
--    vigentes es (service_id, product_id, section): un acceso extra puede ser de OTRO programa (F40).
-- 2. Gemelas puras (casos en lib/portal-admin/access-rule.cases.json y access.cases.json):
--    `portal_access_window` (si un hecho abre una seccion y hasta que dia), `portal_access_until_reached`
--    (si un hecho la cierra) y `portal_access_pick` (de varios accesos, el que vale).
-- 3. El motor (reemplaza los puntos vacios de la 00333): `svc_grant_initial_access`, `svc_open_access`,
--    `svc_apply_access_event` (fase, paso, modulo, Reto y el cron), `svc_cut_access` (cancelar, reembolso,
--    completar, renovar), `svc_shift_access` (extender y reanudar), `svc_suspend_for_pause`,
--    `svc_overdue_sweep` (mora, F39) y `svc_access_tick` (el cron diario de la S16 los llama).
--    `portal_access_effective` y `portal_section_enabled` para leer.
-- 4. A mano (F40, `services.access`): dar un acceso extra (AC001 sin motivo), extender (AC002 a una fecha
--    anterior), quitar y dar ahora. Todo al historial.
-- 5. Cuentas (F41): la cuenta nace con el primer acceso si hay email; invitar (token de un solo uso, solo la
--    huella, 7 dias, uno por minuto y cinco por dia) y suspender (revoca sus sesiones), con `portal.accounts`.
--    `portal_invite_token_valid(hash)`. El email del contacto cambia → la cuenta lo sigue (trigger con
--    EXCEPTION: nunca tumba la edicion del contacto).
-- 6. «Ver como estudiante» (F42): `portal_admin_create_preview_pass(contact)` deja un pase de 60 s (solo la
--    huella) y devuelve el token UNA vez.
-- 7. Triggers sobre las tablas del modulo: completar una fase o un paso y empezar un Reto abren y cierran
--    accesos. Nunca tumban lo que los origina (EXCEPTION → aviso + svc.hook_failed).
-- 8. `app_servicio.contract_version()` (la version del contrato con el portal, Parte 2).
--
-- Aditiva + reemplaza seis funciones vacias de la 00333 (CREATE OR REPLACE con la misma firma; las vacias
-- eran `BEGIN RETURN; END` y `RETURN 0`). Puede ir antes o despues del codigo. Con el modulo apagado no
-- cambia nada: todo sale al principio con `module_on` o no tiene servicios activos sobre los que actuar.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS trg_app_servicio_contact_email ON public.contacts;
--   DROP TRIGGER IF EXISTS trg_svc_phase_access ON app_servicio.service_phases;
--   DROP TRIGGER IF EXISTS trg_svc_item_access ON app_servicio.service_items;
--   DROP TABLE IF EXISTS app_servicio_portal.portal_access;
--   DROP FUNCTION de cada funcion nueva de este archivo, y las seis de la 00333 vuelven a ser vacias:
--     CREATE OR REPLACE FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid)
--     RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
--     (igual svc_open_access(uuid,text,text,text), svc_cut_access(uuid,text), svc_suspend_for_pause(uuid,boolean);
--      svc_shift_access(uuid,integer,date,boolean) con RETURN 0)
--
-- Riesgo: medio (triggers sobre contacts y sobre las tablas del camino; todos con EXCEPTION y module_on).
-- ============================================================================

-- ─── 1. La tabla ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.portal_access (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id            uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  service_id            uuid NOT NULL REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  product_id            uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  section               text NOT NULL,
  starts_at             timestamptz NOT NULL DEFAULT now(),
  ends_at               timestamptz NULL,
  until_type            text NOT NULL DEFAULT 'service',
  source                text NOT NULL,
  source_ref            text NULL,
  reason                text NULL,
  revoked_at            timestamptz NULL,
  revoke_reason         text NULL,
  suspended_overdue_at  timestamptz NULL,
  suspended_pause_at    timestamptz NULL,
  ai_monthly_limit_usd  numeric NULL,
  muted_at              timestamptz NULL,
  muted_reason          text NULL,
  created_by            uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_access_section_check CHECK (section IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'fame', 'affiliates', 'projects')),
  CONSTRAINT portal_access_source_check CHECK (source IN ('service_start', 'journey_item', 'automation', 'manual_extra', 'renewal_transfer', 'extension')),
  CONSTRAINT portal_access_until_check CHECK (until_type IN ('service', 'days', 'months', 'fixed_date', 'phase_completed', 'item_completed', 'forever', 'manual')),
  CONSTRAINT portal_access_reason_check CHECK (source <> 'manual_extra' OR NULLIF(btrim(reason), '') IS NOT NULL),
  CONSTRAINT portal_access_ai_check CHECK (ai_monthly_limit_usd IS NULL OR (section = 'assistant' AND ai_monthly_limit_usd >= 0)),
  CONSTRAINT portal_access_mute_check CHECK (muted_at IS NULL OR section = 'community')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_portal_access_live ON app_servicio_portal.portal_access (service_id, product_id, section) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_portal_access_contact ON app_servicio_portal.portal_access (contact_id, product_id, section);
CREATE INDEX IF NOT EXISTS idx_portal_access_service ON app_servicio_portal.portal_access (service_id);
COMMENT ON TABLE app_servicio_portal.portal_access IS
  'Servicios v12 (F37): los accesos al portal. Todavia no = no hay fila; una revocada se conserva. La escriben solo las funciones del modulo (00341).';
ALTER TABLE app_servicio_portal.portal_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.portal_access FROM public, anon, authenticated;
GRANT ALL ON app_servicio_portal.portal_access TO service_role;

-- ─── 2. Gemelas puras ───────────────────────────────────────────────────────
-- Suma meses como `date + interval` (si el dia no existe, el ultimo del mes).
CREATE OR REPLACE FUNCTION app_servicio.portal_add_months(p_day date, p_n integer)
RETURNS date LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT (p_day + make_interval(months => p_n))::date;
$$;

-- Hasta que dia dura un acceso que se abre hoy. NULL = sin fecha. Gemela de untilDay.
CREATE OR REPLACE FUNCTION app_servicio.portal_until_day(p_until jsonb, p_today date, p_ends_on date)
RETURNS date LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  t text := COALESCE(p_until ->> 'type', 'service');
  n numeric := CASE WHEN jsonb_typeof(p_until -> 'n') = 'number' THEN (p_until ->> 'n')::numeric END;
BEGIN
  IF t = 'service' THEN RETURN p_ends_on; END IF;
  IF t = 'days' THEN RETURN CASE WHEN n > 0 THEN p_today + n::integer END; END IF;
  IF t = 'months' THEN RETURN CASE WHEN n > 0 THEN app_servicio.portal_add_months(p_today, n::integer) END; END IF;
  IF t = 'fixed_date' THEN RETURN NULLIF(p_until ->> 'date', '')::date; END IF;
  RETURN NULL;
END;
$$;

-- Gemela de accessWindow. Entrada: {rule:{opens,until}, event:{type,ref}, startsOn, endsOn, today}.
-- Salida: {action:'none'} o {action:'open', endsOn, untilType}.
CREATE OR REPLACE FUNCTION app_servicio.portal_access_window(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  o jsonb := COALESCE(NULLIF(p #> '{rule,opens}', 'null'::jsonb), '{"type":"service_start"}'::jsonb);
  u jsonb := NULLIF(p #> '{rule,until}', 'null'::jsonb);
  t text := COALESCE(o ->> 'type', 'service_start');
  ev text := p #>> '{event,type}';
  ev_ref text := p #>> '{event,ref}';
  v_today date := (p ->> 'today')::date;
  v_starts date := NULLIF(p ->> 'startsOn', '')::date;
  v_ends date := NULLIF(p ->> 'endsOn', '')::date;
  v_days integer;
  v_open boolean := false;
  v_until_day date;
BEGIN
  IF t = 'service_start' THEN
    v_open := ev IN ('service_start', 'tick');
  ELSIF t = 'days_after_start' THEN
    v_days := CASE WHEN jsonb_typeof(o -> 'days') = 'number' AND (o ->> 'days')::numeric > 0 THEN (o ->> 'days')::numeric::integer ELSE 0 END;
    v_open := ev IN ('service_start', 'tick') AND v_starts IS NOT NULL AND v_today >= v_starts + v_days;
  ELSIF t = 'fixed_date' THEN
    v_open := ev IN ('service_start', 'tick') AND NULLIF(o ->> 'date', '') IS NOT NULL AND v_today >= (o ->> 'date')::date;
  ELSIF t IN ('phase_completed', 'item_completed', 'module_completed') THEN
    v_open := ev = t AND NULLIF(o ->> 'ref', '') IS NOT NULL AND ev_ref = o ->> 'ref';
  ELSIF t = 'challenge_started' THEN
    v_open := ev = 'challenge_started';
  END IF;
  IF NOT v_open THEN RETURN jsonb_build_object('action', 'none'); END IF;
  v_until_day := app_servicio.portal_until_day(u, v_today, v_ends);
  IF v_until_day IS NOT NULL AND v_until_day < v_today THEN RETURN jsonb_build_object('action', 'none'); END IF;
  RETURN jsonb_build_object('action', 'open', 'endsOn', to_char(v_until_day, 'YYYY-MM-DD'), 'untilType', COALESCE(u ->> 'type', 'service'));
END;
$$;

-- Gemela de untilReached. Entrada: {until, event:{type,ref}}.
CREATE OR REPLACE FUNCTION app_servicio.portal_access_until_reached(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT COALESCE(p #>> '{until,type}' IN ('phase_completed', 'item_completed')
         AND p #>> '{event,type}' = p #>> '{until,type}'
         AND NULLIF(p #>> '{until,ref}', '') IS NOT NULL
         AND p #>> '{event,ref}' = p #>> '{until,ref}', false);
$$;

-- Gemela de pickEffective. Entrada: {rows:[{id,starts_at,ends_at,revoked_at,suspended_overdue_at,suspended_pause_at}], now}.
CREATE OR REPLACE FUNCTION app_servicio.portal_access_pick(p jsonb)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT r ->> 'id'
    FROM jsonb_array_elements(COALESCE(p -> 'rows', '[]'::jsonb)) r
   WHERE NULLIF(r ->> 'revoked_at', '') IS NULL AND NULLIF(r ->> 'suspended_overdue_at', '') IS NULL AND NULLIF(r ->> 'suspended_pause_at', '') IS NULL
     AND (r ->> 'starts_at')::timestamptz <= (p ->> 'now')::timestamptz
     AND (NULLIF(r ->> 'ends_at', '') IS NULL OR (r ->> 'ends_at')::timestamptz >= (p ->> 'now')::timestamptz)
   ORDER BY (NULLIF(r ->> 'ends_at', '') IS NULL) DESC, (NULLIF(r ->> 'ends_at', ''))::timestamptz DESC NULLS LAST, r ->> 'id' COLLATE "C"
   LIMIT 1;
$$;

-- ─── 3. Ayudas del motor ────────────────────────────────────────────────────
-- Una seccion esta prendida en el programa salvo que `products.portal_settings.sections` la apague.
CREATE OR REPLACE FUNCTION app_servicio.portal_section_enabled(p_product_id uuid, p_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT COALESCE((pr.portal_settings #>> ARRAY['sections', p_section])::boolean, true)
                     FROM public.products pr WHERE pr.id = p_product_id), false)
     AND p_section IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'affiliates');
$$;

-- La regla de una seccion en la variante del servicio (o NULL si la variante no la incluye).
CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule(p_variant_id uuid, p_section text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT x FROM public.product_variants v, jsonb_array_elements(COALESCE(v.portal_settings -> 'sections', '[]'::jsonb)) x
   WHERE v.id = p_variant_id AND x ->> 'section' = p_section AND COALESCE((x ->> 'included')::boolean, true)
   LIMIT 1;
$$;

-- La cuenta del portal de un contacto: se crea con el primer acceso si tiene email y nadie mas lo usa.
CREATE OR REPLACE FUNCTION app_servicio.svc_ensure_portal_account(p_workspace_id uuid, p_contact_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
  v_email text;
BEGIN
  SELECT id INTO v_id FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT NULLIF(lower(btrim(c.email)), '') INTO v_email FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id;
  IF v_email IS NULL THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_no_email', '{}'::jsonb, 'system');
    RETURN NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND email = v_email) THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_email_conflict', '{}'::jsonb, 'system');
    RETURN NULL;
  END IF;
  INSERT INTO app_servicio_portal.portal_accounts (workspace_id, contact_id, email) VALUES (p_workspace_id, p_contact_id, v_email)
  ON CONFLICT DO NOTHING RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.account_created', jsonb_build_object('account_id', v_id), 'system');
  END IF;
  RETURN v_id;
END;
$$;

-- Inserta un acceso si no hay uno vigente de esa seccion y programa para el servicio. Devuelve su id o NULL.
CREATE OR REPLACE FUNCTION app_servicio.svc_insert_access(p_service_id uuid, p_product_id uuid, p_section text, p_ends_on date,
  p_until_type text, p_source text, p_source_ref text, p_reason text, p_ai_limit numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  v_id uuid;
BEGIN
  SELECT id, workspace_id, contact_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a WHERE a.service_id = p_service_id AND a.product_id = p_product_id AND a.section = p_section AND a.revoked_at IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO app_servicio_portal.portal_access (workspace_id, contact_id, service_id, product_id, section, ends_at, until_type, source, source_ref, reason,
                                                 ai_monthly_limit_usd, created_by)
  VALUES (s.workspace_id, s.contact_id, p_service_id, p_product_id, p_section,
          CASE WHEN p_ends_on IS NULL THEN NULL ELSE app_servicio.end_of_day(p_ends_on, app_servicio.ws_tz(s.workspace_id)) END,
          COALESCE(p_until_type, 'service'), p_source, p_source_ref, NULLIF(btrim(COALESCE(p_reason, '')), ''),
          CASE WHEN p_section = 'assistant' THEN p_ai_limit END, CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NOT NULL THEN
    PERFORM app_servicio.svc_ensure_portal_account(s.workspace_id, s.contact_id);
    PERFORM app_servicio.audit(s.workspace_id, 'service', p_service_id, 'svc.access_opened',
      jsonb_build_object('section', p_section, 'product_id', p_product_id, 'source', p_source, 'ends_on', p_ends_on));
  END IF;
  RETURN v_id;
END;
$$;

-- ─── 4. El motor ────────────────────────────────────────────────────────────
-- Aplica un hecho a los accesos de un servicio activo: abre lo que la regla dice (si nunca se abrio) y cierra lo
-- que llega a su «hasta». Eventos: service_start | tick | phase_completed | item_completed | module_completed |
-- challenge_started.
CREATE OR REPLACE FUNCTION app_servicio.svc_apply_access_event(p_service_id uuid, p_event text, p_ref text)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  v_portal jsonb;
  r jsonb;
  w jsonb;
  a record;
  v_today date;
  n integer := 0;
BEGIN
  SELECT id, workspace_id, contact_id, product_id, product_variant_id, status, starts_on, ends_on INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status <> 'active' OR NOT app_servicio.module_on(s.workspace_id) OR s.product_variant_id IS NULL THEN RETURN 0; END IF;
  SELECT v.portal_settings INTO v_portal FROM public.product_variants v WHERE v.id = s.product_variant_id;
  v_today := app_servicio.today_in(s.workspace_id);
  -- Cerrar lo que llega a su «hasta» (fase o paso).
  IF p_event IN ('phase_completed', 'item_completed') THEN
    FOR a IN SELECT id, section FROM app_servicio_portal.portal_access
              WHERE service_id = s.id AND revoked_at IS NULL AND until_type = p_event AND source <> 'manual_extra' LOOP
      r := app_servicio.portal_section_rule(s.product_variant_id, a.section);
      IF app_servicio.portal_access_until_reached(jsonb_build_object('until', r -> 'until', 'event', jsonb_build_object('type', p_event, 'ref', p_ref))) THEN
        UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'until_reached', updated_at = now() WHERE id = a.id;
        PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_closed', jsonb_build_object('section', a.section, 'reason', 'until_reached'));
        n := n + 1;
      END IF;
    END LOOP;
  END IF;
  -- Abrir: solo con el portal de la variante prendido, y solo lo que nunca se abrio (una revocada no vuelve sola).
  IF NOT COALESCE((v_portal ->> 'enabled')::boolean, false) THEN RETURN n; END IF;
  FOR r IN SELECT x FROM jsonb_array_elements(COALESCE(v_portal -> 'sections', '[]'::jsonb)) x WHERE COALESCE((x ->> 'included')::boolean, true) LOOP
    CONTINUE WHEN NOT app_servicio.portal_section_enabled(s.product_id, r ->> 'section');
    CONTINUE WHEN EXISTS (SELECT 1 FROM app_servicio_portal.portal_access WHERE service_id = s.id AND product_id = s.product_id AND section = r ->> 'section');
    w := app_servicio.portal_access_window(jsonb_build_object('rule', jsonb_build_object('opens', r -> 'opens', 'until', r -> 'until'),
           'event', jsonb_build_object('type', p_event, 'ref', p_ref), 'startsOn', s.starts_on, 'endsOn', s.ends_on, 'today', v_today));
    IF w ->> 'action' = 'open' THEN
      IF app_servicio.svc_insert_access(s.id, s.product_id, r ->> 'section', NULLIF(w ->> 'endsOn', '')::date, w ->> 'untilType',
           CASE WHEN p_event IN ('service_start', 'tick') THEN 'service_start' ELSE 'journey_item' END, p_event || COALESCE(':' || p_ref, ''), NULL,
           CASE WHEN jsonb_typeof(r -> 'ai_limit_usd') = 'number' THEN (r ->> 'ai_limit_usd')::numeric END) IS NOT NULL THEN
        n := n + 1;
      END IF;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;

-- Al activarse un servicio: las secciones «desde el inicio» (y las que por fecha ya corresponden).
CREATE OR REPLACE FUNCTION app_servicio.svc_grant_initial_access(p_service_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_servicio.svc_apply_access_event(p_service_id, 'service_start', NULL);
END;
$$;

-- Abre UNA seccion ahora (paso «Se abre» del camino o la accion «Dar acceso»). Fin segun la regla de la
-- variante (o lo que dure el servicio si la variante no la tiene). No duplica una vigente.
CREATE OR REPLACE FUNCTION app_servicio.svc_open_access(p_service_id uuid, p_section text, p_scope text, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  r jsonb;
  v_until_day date;
BEGIN
  SELECT id, workspace_id, product_id, product_variant_id, status, ends_on INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR s.status NOT IN ('active', 'paused') OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN; END IF;
  IF NOT app_servicio.portal_section_enabled(s.product_id, p_section) THEN RETURN; END IF;
  r := app_servicio.portal_section_rule(s.product_variant_id, p_section);
  v_until_day := app_servicio.portal_until_day(r -> 'until', app_servicio.today_in(s.workspace_id), s.ends_on);
  PERFORM app_servicio.svc_insert_access(s.id, s.product_id, p_section, v_until_day, COALESCE(r #>> '{until,type}', 'service'),
    CASE WHEN p_source IN ('service_start', 'journey_item', 'automation', 'renewal_transfer', 'extension') THEN p_source ELSE 'automation' END,
    p_scope, NULL, CASE WHEN jsonb_typeof(r -> 'ai_limit_usd') = 'number' THEN (r ->> 'ai_limit_usd')::numeric END);
END;
$$;

-- Corte (F38). cancelled | refunded: todo, tambien los extras. completed: solo lo que dura el servicio.
-- renewed: lo que el servicio nuevo tambien da pasa al nuevo (renewal_transfer) ANTES de cortar; el resto de lo
-- que dura el servicio se corta. Los de fecha fija o para siempre siguen hasta su fecha.
CREATE OR REPLACE FUNCTION app_servicio.svc_cut_access(p_service_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  nx record;
  a record;
  r jsonb;
BEGIN
  SELECT id, workspace_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN; END IF;
  IF p_reason IN ('cancelled', 'refunded') THEN
    UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = p_reason, updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL;
  ELSIF p_reason = 'completed' THEN
    UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = p_reason, updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service';
  ELSIF p_reason = 'renewed' THEN
    SELECT id, product_id, product_variant_id, ends_on, status INTO nx FROM app_servicio.services
     WHERE previous_service_id = s.id AND status IN ('active', 'pending_confirmation') ORDER BY created_at DESC LIMIT 1;
    FOR a IN SELECT * FROM app_servicio_portal.portal_access WHERE service_id = s.id AND revoked_at IS NULL AND until_type = 'service' LOOP
      IF nx.id IS NOT NULL AND nx.product_id = a.product_id THEN
        r := app_servicio.portal_section_rule(nx.product_variant_id, a.section);
        IF r IS NOT NULL THEN
          PERFORM app_servicio.svc_insert_access(nx.id, nx.product_id, a.section,
            app_servicio.portal_until_day(r -> 'until', app_servicio.today_in(s.workspace_id), nx.ends_on), COALESCE(r #>> '{until,type}', 'service'),
            'renewal_transfer', a.id::text, NULL, a.ai_monthly_limit_usd);
        END IF;
      END IF;
      UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'renewed', updated_at = now() WHERE id = a.id;
    END LOOP;
  ELSE
    RETURN;
  END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_cut', jsonb_build_object('reason', p_reason));
END;
$$;

-- Extender o reanudar: con una fecha nueva, lo que dura el servicio pasa a ese dia; con dias, se corre todo lo que
-- tiene fin. Con p_extend_own tambien los extras dados a mano. Devuelve cuantos cambio.
CREATE OR REPLACE FUNCTION app_servicio.svc_shift_access(p_service_id uuid, p_days integer, p_new_end date, p_extend_own boolean)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  n integer := 0;
BEGIN
  SELECT id, workspace_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN 0; END IF;
  IF p_new_end IS NOT NULL THEN
    UPDATE app_servicio_portal.portal_access
       SET ends_at = app_servicio.end_of_day(p_new_end, app_servicio.ws_tz(s.workspace_id)), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL
       AND (until_type = 'service' OR (p_extend_own AND source = 'manual_extra'))
       AND (ends_at IS NULL OR ends_at < app_servicio.end_of_day(p_new_end, app_servicio.ws_tz(s.workspace_id)));
    GET DIAGNOSTICS n = ROW_COUNT;
  ELSIF COALESCE(p_days, 0) > 0 THEN
    UPDATE app_servicio_portal.portal_access SET ends_at = ends_at + make_interval(days => p_days), updated_at = now()
     WHERE service_id = s.id AND revoked_at IS NULL AND ends_at IS NOT NULL AND (source <> 'manual_extra' OR p_extend_own);
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  RETURN n;
END;
$$;

-- Pausa: suspende o devuelve los accesos del servicio (suspendido ≠ revocado).
CREATE OR REPLACE FUNCTION app_servicio.svc_suspend_for_pause(p_service_id uuid, p_suspend boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_suspend THEN
    UPDATE app_servicio_portal.portal_access SET suspended_pause_at = now(), updated_at = now()
     WHERE service_id = p_service_id AND revoked_at IS NULL AND suspended_pause_at IS NULL;
  ELSE
    UPDATE app_servicio_portal.portal_access SET suspended_pause_at = NULL, updated_at = now()
     WHERE service_id = p_service_id AND suspended_pause_at IS NOT NULL;
  END IF;
END;
$$;

-- Mora (F39): con `overdue_cut` de la configuracion VIGENTE de la variante, suspende los accesos de los servicios
-- cuya venta tiene un pago `overdue` hace mas de N dias y los devuelve (si `restore`) al ponerse al dia.
CREATE OR REPLACE FUNCTION app_servicio.svc_overdue_sweep(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
  v_cut jsonb;
  v_days integer;
  v_late boolean;
  v_today date;
  v_susp integer := 0;
  v_rest integer := 0;
  n integer;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('suspended', 0, 'restored', 0); END IF;
  v_today := app_servicio.today_in(p_workspace_id);
  FOR s IN SELECT sv.id, sv.sale_id, v.service_settings -> 'overdue_cut' AS cut
             FROM app_servicio.services sv JOIN public.product_variants v ON v.id = sv.product_variant_id
            WHERE sv.workspace_id = p_workspace_id AND sv.status = 'active' AND sv.sale_id IS NOT NULL LOOP
    v_cut := s.cut;
    CONTINUE WHEN v_cut IS NULL OR NOT COALESCE((v_cut ->> 'enabled')::boolean, false);
    v_days := COALESCE(NULLIF(v_cut ->> 'days', '')::integer, 30);
    v_late := EXISTS (SELECT 1 FROM public.payments pm WHERE pm.sale_id = s.sale_id AND pm.status = 'overdue' AND pm.due_date IS NOT NULL AND v_today - pm.due_date > v_days);
    IF v_late THEN
      UPDATE app_servicio_portal.portal_access SET suspended_overdue_at = now(), updated_at = now()
       WHERE service_id = s.id AND revoked_at IS NULL AND suspended_overdue_at IS NULL;
      GET DIAGNOSTICS n = ROW_COUNT; v_susp := v_susp + n;
      IF n > 0 THEN PERFORM app_servicio.audit(p_workspace_id, 'service', s.id, 'svc.access_suspended_overdue', jsonb_build_object('days', v_days), 'system'); END IF;
    ELSIF COALESCE((v_cut ->> 'restore')::boolean, true)
          AND NOT EXISTS (SELECT 1 FROM public.payments pm WHERE pm.sale_id = s.sale_id AND pm.status = 'overdue') THEN
      UPDATE app_servicio_portal.portal_access SET suspended_overdue_at = NULL, updated_at = now()
       WHERE service_id = s.id AND suspended_overdue_at IS NOT NULL;
      GET DIAGNOSTICS n = ROW_COUNT; v_rest := v_rest + n;
      IF n > 0 THEN PERFORM app_servicio.audit(p_workspace_id, 'service', s.id, 'svc.access_restored_overdue', '{}'::jsonb, 'system'); END IF;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('suspended', v_susp, 'restored', v_rest);
END;
$$;

-- El paso diario (lo llama el cron de la S16): abre lo que por fecha corresponde y aplica la mora.
CREATE OR REPLACE FUNCTION app_servicio.svc_access_tick(p_workspace_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sid uuid;
  n integer := 0;
  m jsonb;
BEGIN
  IF NOT app_servicio.module_on(p_workspace_id) THEN RETURN jsonb_build_object('opened', 0); END IF;
  PERFORM app_servicio.as_system();
  FOR sid IN SELECT id FROM app_servicio.services WHERE workspace_id = p_workspace_id AND status = 'active' LOOP
    BEGIN
      n := n + app_servicio.svc_apply_access_event(sid, 'tick', NULL);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'svc_access_tick: %', SQLERRM;
    END;
  END LOOP;
  m := app_servicio.svc_overdue_sweep(p_workspace_id);
  RETURN jsonb_build_object('opened', n) || m;
END;
$$;

-- Para leer: el acceso que vale de un contacto a una seccion de un programa.
CREATE OR REPLACE FUNCTION app_servicio.portal_access_effective(p_contact_id uuid, p_product_id uuid, p_section text)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT (app_servicio.portal_access_pick(jsonb_build_object('now', now(), 'rows', COALESCE((
    SELECT jsonb_agg(jsonb_build_object('id', a.id, 'starts_at', a.starts_at, 'ends_at', a.ends_at, 'revoked_at', a.revoked_at,
                                        'suspended_overdue_at', a.suspended_overdue_at, 'suspended_pause_at', a.suspended_pause_at))
      FROM app_servicio_portal.portal_access a
     WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = p_section), '[]'::jsonb))))::uuid
   WHERE app_servicio.portal_section_enabled(p_product_id, p_section);
$$;

-- ─── 5. A mano (F40) ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.svc_access_grant_extra(p_service_id uuid, p_section text, p_product_id uuid, p_ends_on date, p_reason text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  v_id uuid;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  IF p_section NOT IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'affiliates') THEN
    RAISE EXCEPTION 'Esa sección no existe' USING ERRCODE = 'AC003';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = COALESCE(p_product_id, s.product_id) AND pr.workspace_id = s.workspace_id) THEN
    RAISE EXCEPTION 'Ese programa no es de este negocio' USING ERRCODE = 'AC003';
  END IF;
  IF p_ends_on IS NOT NULL AND p_ends_on < app_servicio.today_in(s.workspace_id) THEN RAISE EXCEPTION 'La fecha ya pasó' USING ERRCODE = 'AC002'; END IF;
  v_id := app_servicio.svc_insert_access(s.id, COALESCE(p_product_id, s.product_id), p_section, p_ends_on,
            CASE WHEN p_ends_on IS NULL THEN 'forever' ELSE 'fixed_date' END, 'manual_extra', NULL, p_reason, NULL);
  IF v_id IS NULL THEN RAISE EXCEPTION 'Ya tiene ese acceso vigente: extendelo' USING ERRCODE = 'AC004'; END IF;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_extra', jsonb_build_object('section', p_section, 'reason', btrim(p_reason)));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_extend(p_access_id uuid, p_ends_on date, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  s app_servicio.services;
  v_new timestamptz;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_access WHERE id = p_access_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe ese acceso' USING ERRCODE = 'AC003'; END IF;
  s := app_servicio.svc_get(a.service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF a.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'Un acceso revocado no se extiende: dá uno nuevo' USING ERRCODE = 'AC002'; END IF;
  IF p_ends_on IS NULL THEN RAISE EXCEPTION 'Elegí hasta cuándo' USING ERRCODE = 'AC002'; END IF;
  v_new := app_servicio.end_of_day(p_ends_on, app_servicio.ws_tz(a.workspace_id));
  IF a.ends_at IS NULL OR v_new <= a.ends_at THEN RAISE EXCEPTION 'La fecha nueva tiene que ser posterior a la de hoy' USING ERRCODE = 'AC002'; END IF;
  UPDATE app_servicio_portal.portal_access SET ends_at = v_new, until_type = 'manual', updated_at = now() WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'service', a.service_id, 'svc.access_extended',
    jsonb_build_object('section', a.section, 'ends_at', jsonb_build_object('old', a.ends_at, 'new', v_new), 'reason', NULLIF(btrim(COALESCE(p_reason, '')), '')));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_access_revoke(p_access_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
  s app_servicio.services;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.portal_access WHERE id = p_access_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe ese acceso' USING ERRCODE = 'AC003'; END IF;
  s := app_servicio.svc_get(a.service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  IF a.revoked_at IS NOT NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.portal_access SET revoked_at = now(), revoke_reason = 'manual', updated_at = now() WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'service', a.service_id, 'svc.access_revoked', jsonb_build_object('section', a.section, 'reason', btrim(p_reason)));
END;
$$;

-- «Dar ahora»: abre ya una seccion que la regla todavia no abrio.
CREATE OR REPLACE FUNCTION app_servicio.svc_access_give_now(p_service_id uuid, p_section text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id, true);
  PERFORM app_servicio.require_service(s, 'services.access');
  PERFORM app_servicio.svc_open_access(s.id, p_section, 'give_now', 'automation');
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.access_given_now', jsonb_build_object('section', p_section));
END;
$$;

-- ─── 6. Cuentas: invitar y suspender (F41) ──────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_token_hash(p_token text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT encode(extensions.digest(convert_to(p_token, 'UTF8'), 'sha256'), 'hex');
$$;

-- Prepara una invitacion: crea la cuenta si hace falta, guarda la HUELLA de un token nuevo (el anterior deja de
-- valer) y devuelve el token UNA vez para que el servidor arme el link y mande el email. Uno por minuto, cinco por
-- dia. Estados: ok | no_email | email_conflict | suspended | rate_limited.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_invite(p_workspace_id uuid, p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc record;
  v_id uuid;
  v_token text;
  v_today date;
  v_count integer;
BEGIN
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(p_workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(p_workspace_id, p_contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'AC003';
  END IF;
  v_id := app_servicio.svc_ensure_portal_account(p_workspace_id, p_contact_id);
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('status', CASE WHEN EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND NULLIF(btrim(c.email), '') IS NOT NULL)
                                              THEN 'email_conflict' ELSE 'no_email' END);
  END IF;
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = v_id FOR UPDATE;
  IF acc.status = 'suspended' THEN RETURN jsonb_build_object('status', 'suspended'); END IF;
  v_today := app_servicio.today_in(p_workspace_id);
  IF acc.invite_sent_at IS NOT NULL AND acc.invite_sent_at > now() - interval '1 minute' THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', GREATEST(1, ceil(extract(epoch FROM acc.invite_sent_at + interval '1 minute' - now()))::integer));
  END IF;
  v_count := CASE WHEN acc.invite_sent_at IS NOT NULL AND app_servicio.local_date(acc.invite_sent_at, p_workspace_id) = v_today THEN acc.invite_sent_count_day ELSE 0 END;
  IF v_count >= 5 THEN RETURN jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', 86400); END IF;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  UPDATE app_servicio_portal.portal_accounts
     SET invite_token_hash = app_servicio.portal_token_hash(v_token), invite_expires_at = now() + interval '7 days',
         invite_sent_at = now(), invite_sent_count_day = v_count + 1, updated_at = now()
   WHERE id = v_id;
  PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.invited', jsonb_build_object('account_id', v_id, 'count_today', v_count + 1));
  RETURN jsonb_build_object('status', 'ok', 'token', v_token, 'account_id', v_id, 'email', acc.email, 'expires_at', now() + interval '7 days');
END;
$$;

-- Para la Parte 2 (y las pruebas): si una huella de invitacion vale.
CREATE OR REPLACE FUNCTION app_servicio.portal_invite_token_valid(p_hash text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts a
                  WHERE a.invite_token_hash = p_hash AND a.invite_expires_at > now() AND a.status <> 'suspended');
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_suspend_account(p_account_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc record;
BEGIN
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = p_account_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'No existe la cuenta' USING ERRCODE = 'AC003'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(acc.workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(acc.workspace_id, acc.contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'AC001'; END IF;
  UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = now(), suspended_reason = btrim(p_reason),
         invite_token_hash = NULL, invite_expires_at = NULL, updated_at = now()
   WHERE id = acc.id;
  UPDATE app_servicio_portal.portal_sessions SET revoked_at = now() WHERE account_id = acc.id AND revoked_at IS NULL;
  PERFORM app_servicio.audit(acc.workspace_id, 'contact', acc.contact_id, 'portal.account_suspended', jsonb_build_object('reason', btrim(p_reason)));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_admin_reactivate_account(p_account_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc record;
BEGIN
  SELECT * INTO acc FROM app_servicio_portal.portal_accounts WHERE id = p_account_id FOR UPDATE;
  IF acc.id IS NULL THEN RAISE EXCEPTION 'No existe la cuenta' USING ERRCODE = 'AC003'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(acc.workspace_id, 'portal.accounts') AND app_servicio.can_view_as_student(acc.workspace_id, acc.contact_id)) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  UPDATE app_servicio_portal.portal_accounts SET status = CASE WHEN last_login_at IS NULL THEN 'invited' ELSE 'active' END,
         suspended_at = NULL, suspended_reason = NULL, updated_at = now()
   WHERE id = acc.id AND status = 'suspended';
  PERFORM app_servicio.audit(acc.workspace_id, 'contact', acc.contact_id, 'portal.account_reactivated', '{}'::jsonb);
END;
$$;

-- ─── 7. «Ver como estudiante» (F42) ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_create_preview_pass(p_workspace_id uuid, p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_token text;
  v_account uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT (public.has_permission(p_workspace_id, 'portal.view_as') AND app_servicio.can_view_as_student(p_workspace_id, p_contact_id)) THEN
    RAISE EXCEPTION 'No existe' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND c.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'No existe' USING ERRCODE = 'P0002';
  END IF;
  SELECT id INTO v_account FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO app_servicio_portal.portal_sessions (workspace_id, account_id, kind, token_hash, expires_at, preview_user_id, preview_contact_id)
  VALUES (p_workspace_id, v_account, 'preview_pass', app_servicio.portal_token_hash(v_token), now() + interval '60 seconds', auth.uid(), p_contact_id);
  PERFORM app_servicio.audit(p_workspace_id, 'contact', p_contact_id, 'portal.view_as', '{}'::jsonb);
  RETURN jsonb_build_object('token', v_token, 'expires_at', now() + interval '60 seconds');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.contract_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$ SELECT '1'::text; $$;

-- ─── 8. Triggers ────────────────────────────────────────────────────────────
-- Fase completada / Reto que empieza: abre y cierra accesos. Nunca tumba el avance del camino.
CREATE OR REPLACE FUNCTION app_servicio.svc_phase_access_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'phase_completed', NEW.template_key);
    ELSIF NEW.status = 'in_progress' AND OLD.status IS DISTINCT FROM 'in_progress' AND NEW.challenge IS NOT NULL THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'challenge_started', NEW.template_key);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'svc_phase_access_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'service', NEW.service_id, 'svc.hook_failed', jsonb_build_object('hook', 'phase_access', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'svc_phase_access_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_svc_phase_access ON app_servicio.service_phases;
CREATE TRIGGER trg_svc_phase_access AFTER UPDATE OF status ON app_servicio.service_phases
  FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_phase_access_hook();

CREATE OR REPLACE FUNCTION app_servicio.svc_item_access_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  BEGIN
    IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
      PERFORM app_servicio.svc_apply_access_event(NEW.service_id, 'item_completed', NEW.template_key);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'svc_item_access_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'service', NEW.service_id, 'svc.hook_failed', jsonb_build_object('hook', 'item_access', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'svc_item_access_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_svc_item_access ON app_servicio.service_items;
CREATE TRIGGER trg_svc_item_access AFTER UPDATE OF status ON app_servicio.service_items
  FOR EACH ROW EXECUTE FUNCTION app_servicio.svc_item_access_hook();

-- El email del contacto cambia → la cuenta del portal lo sigue (si nadie mas lo usa). Nunca tumba la edicion.
CREATE OR REPLACE FUNCTION app_servicio.contact_email_portal_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_email text;
BEGIN
  BEGIN
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    v_email := NULLIF(lower(btrim(COALESCE(NEW.email, ''))), '');
    IF v_email IS NULL OR v_email IS NOT DISTINCT FROM NULLIF(lower(btrim(COALESCE(OLD.email, ''))), '') THEN RETURN NULL; END IF;
    IF NOT EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.id) THEN RETURN NULL; END IF;
    IF EXISTS (SELECT 1 FROM app_servicio_portal.portal_accounts WHERE workspace_id = NEW.workspace_id AND email = v_email AND contact_id <> NEW.id) THEN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'portal.account_email_conflict', '{}'::jsonb, 'system', 'servicios');
      RETURN NULL;
    END IF;
    UPDATE app_servicio_portal.portal_accounts SET email = v_email, updated_at = now() WHERE workspace_id = NEW.workspace_id AND contact_id = NEW.id;
    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
    VALUES (NEW.workspace_id, 'contact', NEW.id, 'portal.account_email_changed', '{}'::jsonb, 'system', 'servicios');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'contact_email_portal_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.id, 'svc.hook_failed', jsonb_build_object('hook', 'contact_email', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'contact_email_portal_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_contact_email ON public.contacts;
CREATE TRIGGER trg_app_servicio_contact_email AFTER UPDATE OF email ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION app_servicio.contact_email_portal_hook();

-- ─── 8b. Lecturas para las pantallas de SSA (corregida el 8/11: el esquema del portal no se expone) ──
-- Los accesos de un servicio (pestaña Accesos): quien ve el servicio con `services.view`.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_service_accesses(p_service_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.view');
  RETURN COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'section', a.section, 'product_id', a.product_id, 'starts_at', a.starts_at,
            'ends_at', a.ends_at, 'until_type', a.until_type, 'source', a.source, 'reason', a.reason, 'revoked_at', a.revoked_at,
            'revoke_reason', a.revoke_reason, 'suspended_overdue_at', a.suspended_overdue_at, 'suspended_pause_at', a.suspended_pause_at)
            ORDER BY a.created_at)
     FROM app_servicio_portal.portal_access a WHERE a.service_id = s.id), '[]'::jsonb);
END;
$$;

-- La cuenta del portal de un contacto (sin huellas ni secretos): quien ve el contacto y tiene alguna clave del portal.
CREATE OR REPLACE FUNCTION app_servicio.portal_admin_account(p_workspace_id uuid, p_contact_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  acc record;
BEGIN
  IF NOT app_servicio.is_system() AND NOT (
       (public.has_permission(p_workspace_id, 'services.view') OR public.has_permission(p_workspace_id, 'portal.accounts') OR public.has_permission(p_workspace_id, 'portal.view_as'))
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = p_workspace_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT id, status, invite_sent_at, invite_expires_at, last_login_at, suspended_reason INTO acc
    FROM app_servicio_portal.portal_accounts WHERE workspace_id = p_workspace_id AND contact_id = p_contact_id;
  IF acc.id IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('id', acc.id, 'status', acc.status, 'invite_sent_at', acc.invite_sent_at, 'invite_expires_at', acc.invite_expires_at,
                            'last_login_at', acc.last_login_at, 'suspended_reason', acc.suspended_reason);
END;
$$;

-- ─── 9. Permisos de ejecucion ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.portal_add_months(date, integer), app_servicio.portal_until_day(jsonb, date, date), app_servicio.portal_access_window(jsonb),
  app_servicio.portal_access_until_reached(jsonb), app_servicio.portal_access_pick(jsonb), app_servicio.portal_section_enabled(uuid, text),
  app_servicio.portal_section_rule(uuid, text), app_servicio.svc_ensure_portal_account(uuid, uuid),
  app_servicio.svc_insert_access(uuid, uuid, text, date, text, text, text, text, numeric), app_servicio.svc_apply_access_event(uuid, text, text),
  app_servicio.svc_grant_initial_access(uuid), app_servicio.svc_open_access(uuid, text, text, text), app_servicio.svc_cut_access(uuid, text),
  app_servicio.svc_shift_access(uuid, integer, date, boolean), app_servicio.svc_suspend_for_pause(uuid, boolean), app_servicio.svc_overdue_sweep(uuid),
  app_servicio.svc_access_tick(uuid), app_servicio.portal_access_effective(uuid, uuid, text),
  app_servicio.svc_access_grant_extra(uuid, text, uuid, date, text), app_servicio.svc_access_extend(uuid, date, text),
  app_servicio.svc_access_revoke(uuid, text), app_servicio.svc_access_give_now(uuid, text), app_servicio.portal_token_hash(text),
  app_servicio.portal_admin_invite(uuid, uuid), app_servicio.portal_invite_token_valid(text), app_servicio.portal_admin_suspend_account(uuid, text),
  app_servicio.portal_admin_reactivate_account(uuid), app_servicio.portal_admin_create_preview_pass(uuid, uuid), app_servicio.contract_version(),
  app_servicio.svc_phase_access_hook(), app_servicio.svc_item_access_hook(), app_servicio.contact_email_portal_hook(),
  app_servicio.portal_admin_service_accesses(uuid), app_servicio.portal_admin_account(uuid, uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.portal_add_months(date, integer), app_servicio.portal_until_day(jsonb, date, date), app_servicio.portal_access_window(jsonb),
  app_servicio.portal_access_until_reached(jsonb), app_servicio.portal_access_pick(jsonb), app_servicio.portal_section_enabled(uuid, text),
  app_servicio.portal_section_rule(uuid, text), app_servicio.svc_ensure_portal_account(uuid, uuid),
  app_servicio.svc_insert_access(uuid, uuid, text, date, text, text, text, text, numeric), app_servicio.svc_apply_access_event(uuid, text, text),
  app_servicio.svc_grant_initial_access(uuid), app_servicio.svc_open_access(uuid, text, text, text), app_servicio.svc_cut_access(uuid, text),
  app_servicio.svc_shift_access(uuid, integer, date, boolean), app_servicio.svc_suspend_for_pause(uuid, boolean), app_servicio.svc_overdue_sweep(uuid),
  app_servicio.svc_access_tick(uuid), app_servicio.portal_access_effective(uuid, uuid, text),
  app_servicio.svc_access_grant_extra(uuid, text, uuid, date, text), app_servicio.svc_access_extend(uuid, date, text),
  app_servicio.svc_access_revoke(uuid, text), app_servicio.svc_access_give_now(uuid, text), app_servicio.portal_token_hash(text),
  app_servicio.portal_admin_invite(uuid, uuid), app_servicio.portal_invite_token_valid(text), app_servicio.portal_admin_suspend_account(uuid, text),
  app_servicio.portal_admin_reactivate_account(uuid), app_servicio.portal_admin_create_preview_pass(uuid, uuid), app_servicio.contract_version(),
  app_servicio.portal_admin_service_accesses(uuid), app_servicio.portal_admin_account(uuid, uuid)
TO service_role;
-- Con la sesion (cada una mira el permiso y el alcance adentro): las acciones de la pestaña Accesos, invitar,
-- suspender, el pase de vista previa y las gemelas puras (sin datos).
GRANT EXECUTE ON FUNCTION
  app_servicio.svc_access_grant_extra(uuid, text, uuid, date, text), app_servicio.svc_access_extend(uuid, date, text),
  app_servicio.svc_access_revoke(uuid, text), app_servicio.svc_access_give_now(uuid, text),
  app_servicio.portal_admin_invite(uuid, uuid), app_servicio.portal_admin_suspend_account(uuid, text), app_servicio.portal_admin_reactivate_account(uuid),
  app_servicio.portal_admin_create_preview_pass(uuid, uuid), app_servicio.portal_admin_service_accesses(uuid), app_servicio.portal_admin_account(uuid, uuid)
TO authenticated;
