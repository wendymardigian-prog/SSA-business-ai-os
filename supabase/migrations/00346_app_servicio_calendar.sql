-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00346_app_servicio_calendar  (Servicios v12, Corrida A1 · S12 · bloque CA)
-- ============================================================================
-- 1. `app_servicio.live_sessions` (§8.2 #5, F58): las sesiones en vivo de un programa (semanal o suelta), en SU zona.
--    `meeting_url` nunca sale al portal. `attendance_base` (sobre quienes se mide, F61) con CHECK de forma.
-- 2. `app_servicio.live_session_dates` (§8.2 #6, F59, F63): solo las excepciones de una fecha (cancelada, movida) y su
--    grabacion. Nunca se materializan fechas futuras.
-- 3. `app_servicio.link_clicks` (§8.2 #7, F60): los clics al link de una clase en vivo. SIN IP en claro (solo huella).
-- 4. `app_servicio_portal.live_attendance` (§8.2 #12, F61): asistencia, unica por (sesion, fecha, contacto) entre las
--    no quitadas. Marcar y quitar a mano con `attendance.manage` (`attendance_mark` / `attendance_remove`, al historial).
-- 5. Gemelas puras: `live_occurrences_plan(jsonb)` (lib/program/occurrences.ts), `live_attendance_window` y
--    `attendance_base_plan(jsonb)`. Y para leer: `live_session_occurrences(product, from, to)`,
--    `attendance_base_members(session, fecha)` y `program_live_recordings(product)` (F51, que la S10 no podia nombrar).
-- 6. El tipo de grabacion «Clase» (`servicio.clase`, F64) en cada negocio con el area Servicio; en uno que se crea
--    despues, al prender el modulo (un negocio nuevo con el modulo apagado nace igual que antes). Ninguna grabacion
--    vieja cambia de tipo.
--
-- Aditiva. Puede ir antes o despues del codigo. Con el modulo apagado no cambia nada (nadie crea sesiones).
--
-- Cómo volver atrás:
--   DROP TABLE IF EXISTS app_servicio_portal.live_attendance, app_servicio.link_clicks, app_servicio.live_session_dates, app_servicio.live_sessions;
--   DROP TRIGGER IF EXISTS trg_app_servicio_booking_area_clase ON public.booking_categories; DROP TRIGGER IF EXISTS trg_app_servicio_module_clase ON public.workspaces;
--   DROP FUNCTION app_servicio.booking_area_clase_hook(), app_servicio.module_enabled_clase_hook(), app_servicio.ensure_clase_type(uuid);
--   DELETE FROM public.booking_categories WHERE system_key = 'servicio.clase' AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.category_id = booking_categories.id);
--     (si ya habia un «Clase» al que solo se le puso la clave: UPDATE ... SET system_key = NULL)
--   DROP FUNCTION de cada funcion nueva (live_occurrences_plan, live_attendance_window, attendance_base_plan, live_session_occurrences,
--     attendance_base_members, program_live_recordings, live_session_save, live_session_archive, live_date_save, attendance_mark,
--     attendance_remove, live_session_attendance, live_attendance_overview).
--
-- Riesgo: bajo (todo nuevo; una fila por negocio en booking_categories).
-- ============================================================================

-- ─── 1. Sesiones ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.live_sessions (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id                  uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  title                       text NOT NULL,
  kind                        text NOT NULL,
  weekdays                    integer[] NULL,
  every_weeks                 integer NULL,
  starts_on                   date NULL,
  ends_on                     date NULL,
  single_at                   timestamptz NULL,
  start_time                  time NULL,
  duration_minutes            integer NOT NULL DEFAULT 60,
  timezone                    text NOT NULL,
  variant_ids                 uuid[] NULL,
  host_user_id                uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  meeting_url                 text NULL,
  keyword                     text NULL,
  track_clicks                boolean NOT NULL DEFAULT true,
  click_counts_as_attendance  boolean NOT NULL DEFAULT false,
  attendance_base             jsonb NOT NULL DEFAULT '{"type":"active"}'::jsonb,
  archived_at                 timestamptz NULL,
  created_by                  uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_sessions_title_check CHECK (btrim(title) <> '' AND char_length(title) <= 120),
  CONSTRAINT live_sessions_kind_check CHECK (kind IN ('weekly', 'single')),
  CONSTRAINT live_sessions_shape_check CHECK (
    (kind = 'weekly' AND starts_on IS NOT NULL AND start_time IS NOT NULL AND cardinality(weekdays) BETWEEN 1 AND 7
       AND weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7] AND every_weeks BETWEEN 1 AND 4 AND (ends_on IS NULL OR ends_on >= starts_on))
    OR (kind = 'single' AND single_at IS NOT NULL)),
  CONSTRAINT live_sessions_duration_check CHECK (duration_minutes BETWEEN 5 AND 720),
  CONSTRAINT live_sessions_url_check CHECK (meeting_url IS NULL OR meeting_url ~ '^https://'),
  CONSTRAINT live_sessions_base_check CHECK (
    (attendance_base ->> 'type') = 'active'
    OR ((attendance_base ->> 'type') = 'started_within' AND jsonb_typeof(attendance_base -> 'days') = 'number' AND (attendance_base ->> 'days')::numeric BETWEEN 1 AND 365)
    OR ((attendance_base ->> 'type') = 'phase' AND (attendance_base ->> 'phase_key') ~ '^ph_[a-z0-9]{6}$')
    OR ((attendance_base ->> 'type') = 'variant' AND (attendance_base ->> 'variant_id') ~* '^[0-9a-f-]{36}$'))
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_product ON app_servicio.live_sessions (product_id) WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS app_servicio.live_session_dates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  live_session_id    uuid NOT NULL REFERENCES app_servicio.live_sessions(id) ON DELETE CASCADE,
  occurs_on          date NOT NULL,
  status             text NOT NULL DEFAULT 'normal',
  moved_to           timestamptz NULL,
  recording_url      text NULL,
  recording_call_id  uuid NULL REFERENCES public.calls(id) ON DELETE SET NULL,
  recording_source   text NULL,
  recording_active   boolean NOT NULL DEFAULT true,
  note               text NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT live_session_dates_status_check CHECK (status IN ('normal', 'cancelled', 'moved')),
  CONSTRAINT live_session_dates_moved_check CHECK (status <> 'moved' OR moved_to IS NOT NULL),
  CONSTRAINT live_session_dates_source_check CHECK (recording_source IS NULL OR recording_source IN ('manual', 'fathom')),
  CONSTRAINT live_session_dates_url_check CHECK (recording_url IS NULL OR recording_url ~ '^https://')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_session_dates ON app_servicio.live_session_dates (live_session_id, occurs_on);

CREATE TABLE IF NOT EXISTS app_servicio.link_clicks (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id       uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  target_type        text NOT NULL,
  target_id          uuid NOT NULL,
  target_date        date NULL,
  contact_id         uuid NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  portal_account_id  uuid NULL,
  clicked_at         timestamptz NOT NULL DEFAULT now(),
  ip_hash            text NULL,
  user_agent_kind    text NULL,
  is_bot             boolean NOT NULL DEFAULT false,
  CONSTRAINT link_clicks_target_check CHECK (target_type IN ('live_session')),
  CONSTRAINT link_clicks_ip_hash_check CHECK (ip_hash IS NULL OR ip_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS idx_link_clicks_target ON app_servicio.link_clicks (target_type, target_id, target_date);
CREATE INDEX IF NOT EXISTS idx_link_clicks_contact ON app_servicio.link_clicks (contact_id);

CREATE TABLE IF NOT EXISTS app_servicio_portal.live_attendance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  live_session_id  uuid NOT NULL REFERENCES app_servicio.live_sessions(id) ON DELETE CASCADE,
  occurs_on        date NOT NULL,
  contact_id       uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  source           text NOT NULL,
  added_manually   boolean NOT NULL DEFAULT false,
  marked_at        timestamptz NOT NULL DEFAULT now(),
  marked_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_at       timestamptz NULL,
  removed_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  removed_reason   text NULL,
  CONSTRAINT live_attendance_source_check CHECK (source IN ('self', 'team', 'click')),
  CONSTRAINT live_attendance_removed_check CHECK (removed_at IS NULL OR NULLIF(btrim(removed_reason), '') IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_live_attendance ON app_servicio_portal.live_attendance (live_session_id, occurs_on, contact_id) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_live_attendance_contact ON app_servicio_portal.live_attendance (contact_id);

-- RLS: el equipo lee sesiones y fechas con `live_sessions.manage`, `services.view` o `portal.view`; los clics, quien ve
-- el contacto; la asistencia es del portal (cerrada). Escribe solo el servidor (funciones del modulo).
ALTER TABLE app_servicio.live_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio.live_session_dates ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio.link_clicks ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio_portal.live_attendance ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS live_sessions_select ON app_servicio.live_sessions;
CREATE POLICY live_sessions_select ON app_servicio.live_sessions FOR SELECT TO authenticated USING (
  public.is_workspace_member(workspace_id)
  AND (public.has_permission(workspace_id, 'live_sessions.manage') OR public.has_permission(workspace_id, 'services.view') OR public.has_permission(workspace_id, 'portal.view')));
DROP POLICY IF EXISTS live_session_dates_select ON app_servicio.live_session_dates;
CREATE POLICY live_session_dates_select ON app_servicio.live_session_dates FOR SELECT TO authenticated USING (
  public.is_workspace_member(workspace_id)
  AND (public.has_permission(workspace_id, 'live_sessions.manage') OR public.has_permission(workspace_id, 'services.view') OR public.has_permission(workspace_id, 'portal.view')));
DROP POLICY IF EXISTS link_clicks_select ON app_servicio.link_clicks;
CREATE POLICY link_clicks_select ON app_servicio.link_clicks FOR SELECT TO authenticated USING (
  public.is_workspace_member(workspace_id)
  AND contact_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = link_clicks.contact_id AND public.can_see_contact(c)));
REVOKE ALL ON app_servicio.live_sessions, app_servicio.live_session_dates, app_servicio.link_clicks FROM public, anon, authenticated;
REVOKE ALL ON app_servicio_portal.live_attendance FROM public, anon, authenticated;
GRANT SELECT ON app_servicio.live_session_dates, app_servicio.link_clicks TO authenticated;
-- El link de la reunion no lo lee nadie con la sesion: solo el servidor (el portal recibe «Entrar», nunca la URL).
-- Por columnas: sacar una sola columna no alcanza si la tabla entera esta concedida.
GRANT SELECT (id, workspace_id, product_id, title, kind, weekdays, every_weeks, starts_on, ends_on, single_at, start_time, duration_minutes,
              timezone, variant_ids, host_user_id, keyword, track_clicks, click_counts_as_attendance, attendance_base, archived_at, created_by,
              created_at, updated_at) ON app_servicio.live_sessions TO authenticated;
GRANT ALL ON app_servicio.live_sessions, app_servicio.live_session_dates, app_servicio.link_clicks TO service_role;
GRANT ALL ON app_servicio_portal.live_attendance TO service_role;

-- ─── 2. Gemelas puras ───────────────────────────────────────────────────────
-- Gemela de occurrences. Entrada: {session, exceptions, from, to}. Salida: [{occursOn, startsAt, endsAt, status}].
CREATE OR REPLACE FUNCTION app_servicio.live_occurrences_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  s jsonb := p -> 'session';
  v_from date := (p ->> 'from')::date;
  v_to date := (p ->> 'to')::date;
  v_tz text := COALESCE(NULLIF(s ->> 'timezone', ''), 'UTC');
  v_dur integer := COALESCE((s ->> 'duration_minutes')::integer, 60);
  v_out jsonb := '[]'::jsonb;
  v_start date; v_last date; d date; v_anchor date; v_every integer;
  v_at timestamptz; v_day date;
  ex jsonb;
  v_days integer[];
BEGIN
  IF s ->> 'kind' = 'single' THEN
    IF NULLIF(s ->> 'single_at', '') IS NULL THEN RETURN v_out; END IF;
    v_at := (s ->> 'single_at')::timestamptz;
    v_day := (v_at AT TIME ZONE v_tz)::date;
    IF v_day < v_from OR v_day > v_to THEN RETURN v_out; END IF;
    ex := (SELECT x FROM jsonb_array_elements(COALESCE(p -> 'exceptions', '[]'::jsonb)) x WHERE x ->> 'occurs_on' = v_day::text LIMIT 1);
    IF ex ->> 'status' = 'moved' AND NULLIF(ex ->> 'moved_to', '') IS NOT NULL THEN v_at := (ex ->> 'moved_to')::timestamptz; END IF;
    RETURN jsonb_build_array(jsonb_build_object('occursOn', v_day::text,
      'startsAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'endsAt', to_char((v_at + make_interval(mins => v_dur)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'status', COALESCE(ex ->> 'status', 'normal')));
  END IF;
  IF NULLIF(s ->> 'starts_on', '') IS NULL OR NULLIF(s ->> 'start_time', '') IS NULL OR jsonb_array_length(COALESCE(s -> 'weekdays', '[]'::jsonb)) = 0 THEN RETURN v_out; END IF;
  v_days := ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(s -> 'weekdays') x);
  v_every := LEAST(4, GREATEST(1, COALESCE((s ->> 'every_weeks')::integer, 1)));
  v_start := (s ->> 'starts_on')::date;
  v_anchor := v_start - (extract(isodow FROM v_start)::integer - 1);
  d := GREATEST(v_from, v_start);
  v_last := CASE WHEN NULLIF(s ->> 'ends_on', '') IS NOT NULL AND (s ->> 'ends_on')::date < v_to THEN (s ->> 'ends_on')::date ELSE v_to END;
  WHILE d <= v_last LOOP
    IF extract(isodow FROM d)::integer = ANY (v_days) AND ((d - v_anchor) / 7) % v_every = 0 THEN
      v_at := (d + (s ->> 'start_time')::time) AT TIME ZONE v_tz;
      ex := (SELECT x FROM jsonb_array_elements(COALESCE(p -> 'exceptions', '[]'::jsonb)) x WHERE x ->> 'occurs_on' = d::text LIMIT 1);
      IF ex ->> 'status' = 'moved' AND NULLIF(ex ->> 'moved_to', '') IS NOT NULL THEN v_at := (ex ->> 'moved_to')::timestamptz; END IF;
      v_out := v_out || jsonb_build_array(jsonb_build_object('occursOn', d::text,
        'startsAt', to_char(v_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'endsAt', to_char((v_at + make_interval(mins => v_dur)) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'status', COALESCE(ex ->> 'status', 'normal')));
    END IF;
    d := d + 1;
  END LOOP;
  RETURN v_out;
END;
$$;

-- Gemela de inAttendanceWindow: de 10 minutos antes del inicio a 30 despues del final.
CREATE OR REPLACE FUNCTION app_servicio.live_attendance_window(p_starts timestamptz, p_ends timestamptz, p_at timestamptz)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT p_at >= p_starts - interval '10 minutes' AND p_at <= p_ends + interval '30 minutes';
$$;

-- Gemela de inAttendanceBase. Entrada: {base, sessionVariantIds, member:{calendarAccess, variantId, serviceStartsOn, phaseKeyOnDate}, occursOn}.
CREATE OR REPLACE FUNCTION app_servicio.attendance_base_plan(p jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT CASE
    WHEN NOT COALESCE((p #>> '{member,calendarAccess}')::boolean, false) THEN false
    WHEN jsonb_typeof(p -> 'sessionVariantIds') = 'array'
         AND (NULLIF(p #>> '{member,variantId}', '') IS NULL OR NOT ((p -> 'sessionVariantIds') ? (p #>> '{member,variantId}'))) THEN false
    WHEN p #>> '{base,type}' = 'active' THEN true
    WHEN p #>> '{base,type}' = 'started_within' THEN NULLIF(p #>> '{member,serviceStartsOn}', '') IS NOT NULL
         AND (p #>> '{member,serviceStartsOn}')::date <= (p ->> 'occursOn')::date
         AND (p ->> 'occursOn')::date - (p #>> '{member,serviceStartsOn}')::date <= (p #>> '{base,days}')::integer
    WHEN p #>> '{base,type}' = 'phase' THEN p #>> '{member,phaseKeyOnDate}' = p #>> '{base,phase_key}'
    WHEN p #>> '{base,type}' = 'variant' THEN p #>> '{member,variantId}' = p #>> '{base,variant_id}'
    ELSE false END;
$$;

-- ─── 3. Lecturas ────────────────────────────────────────────────────────────
-- Las fechas de las sesiones de un programa entre dos dias (en la zona de cada sesion).
CREATE OR REPLACE FUNCTION app_servicio.live_session_occurrences(p_product_id uuid, p_from date, p_to date)
RETURNS TABLE (live_session_id uuid, occurs_on date, starts_at timestamptz, ends_at timestamptz, status text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ls.id, (o ->> 'occursOn')::date, (o ->> 'startsAt')::timestamptz, (o ->> 'endsAt')::timestamptz, o ->> 'status'
    FROM app_servicio.live_sessions ls
    CROSS JOIN LATERAL jsonb_array_elements(app_servicio.live_occurrences_plan(jsonb_build_object(
      'session', jsonb_build_object('kind', ls.kind, 'weekdays', to_jsonb(ls.weekdays), 'every_weeks', ls.every_weeks, 'starts_on', ls.starts_on,
                                    'ends_on', ls.ends_on, 'single_at', ls.single_at, 'start_time', to_char(ls.start_time, 'HH24:MI'),
                                    'duration_minutes', ls.duration_minutes, 'timezone', ls.timezone),
      'exceptions', COALESCE((SELECT jsonb_agg(jsonb_build_object('occurs_on', d.occurs_on, 'status', d.status, 'moved_to', d.moved_to))
                                FROM app_servicio.live_session_dates d WHERE d.live_session_id = ls.id), '[]'::jsonb),
      'from', p_from, 'to', p_to))) o
   WHERE ls.product_id = p_product_id AND ls.archived_at IS NULL
     AND (app_servicio.is_system() OR (public.is_workspace_member(ls.workspace_id)
          AND (public.has_permission(ls.workspace_id, 'live_sessions.manage') OR public.has_permission(ls.workspace_id, 'services.view') OR public.has_permission(ls.workspace_id, 'portal.view'))));
$$;

-- Sobre quienes se mide una sesion en una fecha (F61): las personas con un servicio del programa, evaluadas ESE dia.
CREATE OR REPLACE FUNCTION app_servicio.attendance_base_members(p_live_session_id uuid, p_occurs_on date)
RETURNS TABLE (contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH ls AS (SELECT * FROM app_servicio.live_sessions WHERE id = p_live_session_id),
  day_end AS (SELECT app_servicio.end_of_day(p_occurs_on, ls.timezone) AS t FROM ls)
  SELECT DISTINCT s.contact_id
    FROM ls, day_end, app_servicio.services s
   WHERE s.product_id = ls.product_id AND s.status IN ('active', 'paused', 'completed')
     AND app_servicio.attendance_base_plan(jsonb_build_object(
       'base', ls.attendance_base,
       'sessionVariantIds', to_jsonb(ls.variant_ids),
       'occursOn', p_occurs_on,
       'member', jsonb_build_object(
         'calendarAccess', EXISTS (SELECT 1 FROM app_servicio_portal.portal_access a
                                    WHERE a.service_id = s.id AND a.section = 'calendar' AND a.starts_at <= day_end.t
                                      AND (a.ends_at IS NULL OR a.ends_at >= day_end.t) AND (a.revoked_at IS NULL OR a.revoked_at > day_end.t)),
         'variantId', s.product_variant_id,
         'serviceStartsOn', s.starts_on,
         'phaseKeyOnDate', (SELECT ph.template_key FROM app_servicio.service_phases ph
                             WHERE ph.service_id = s.id AND ph.started_at IS NOT NULL AND ph.started_at <= day_end.t
                               AND (ph.completed_at IS NULL OR ph.completed_at > day_end.t)
                             ORDER BY ph.started_at DESC LIMIT 1))));
$$;

-- «Sesiones semanales» del programa (F51): las fechas pasadas con grabacion activa.
CREATE OR REPLACE FUNCTION app_servicio.program_live_recordings(p_product_id uuid)
RETURNS TABLE (live_session_id uuid, title text, occurs_on date, recording_url text, recording_call_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT ls.id, ls.title, d.occurs_on, d.recording_url, d.recording_call_id
    FROM app_servicio.live_sessions ls JOIN app_servicio.live_session_dates d ON d.live_session_id = ls.id
   WHERE ls.product_id = p_product_id AND ls.archived_at IS NULL AND d.status <> 'cancelled' AND d.recording_active
     AND (d.recording_url IS NOT NULL OR d.recording_call_id IS NOT NULL)
   ORDER BY d.occurs_on DESC;
$$;

-- ─── 4. Escribir (live_sessions.manage / attendance.manage) ─────────────────
CREATE OR REPLACE FUNCTION app_servicio.live_session_save(p_product_id uuid, p_session_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_id uuid := p_session_id;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(v_ws, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p ? 'host_user_id' AND NULLIF(p ->> 'host_user_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = v_ws AND m.user_id = (p ->> 'host_user_id')::uuid) THEN
    RAISE EXCEPTION 'El anfitrión tiene que ser del equipo' USING ERRCODE = 'CA002';
  END IF;
  IF v_id IS NULL THEN
    INSERT INTO app_servicio.live_sessions (workspace_id, product_id, title, kind, weekdays, every_weeks, starts_on, ends_on, single_at, start_time,
      duration_minutes, timezone, variant_ids, host_user_id, meeting_url, keyword, track_clicks, click_counts_as_attendance, attendance_base, created_by)
    VALUES (v_ws, p_product_id, btrim(p ->> 'title'), p ->> 'kind',
      CASE WHEN jsonb_typeof(p -> 'weekdays') = 'array' THEN ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p -> 'weekdays') x) END,
      NULLIF(p ->> 'every_weeks', '')::integer, NULLIF(p ->> 'starts_on', '')::date, NULLIF(p ->> 'ends_on', '')::date,
      NULLIF(p ->> 'single_at', '')::timestamptz, NULLIF(p ->> 'start_time', '')::time, COALESCE(NULLIF(p ->> 'duration_minutes', '')::integer, 60),
      COALESCE(NULLIF(p ->> 'timezone', ''), app_servicio.ws_tz(v_ws)),
      CASE WHEN jsonb_typeof(p -> 'variant_ids') = 'array' THEN ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(p -> 'variant_ids') x) END,
      NULLIF(p ->> 'host_user_id', '')::uuid, NULLIF(p ->> 'meeting_url', ''), NULLIF(p ->> 'keyword', ''),
      COALESCE((p ->> 'track_clicks')::boolean, true), COALESCE((p ->> 'click_counts_as_attendance')::boolean, false),
      COALESCE(p -> 'attendance_base', '{"type":"active"}'::jsonb), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
    RETURNING id INTO v_id;
  ELSE
    UPDATE app_servicio.live_sessions SET
      title = btrim(p ->> 'title'), kind = p ->> 'kind',
      weekdays = CASE WHEN jsonb_typeof(p -> 'weekdays') = 'array' THEN ARRAY(SELECT (x)::integer FROM jsonb_array_elements_text(p -> 'weekdays') x) END,
      every_weeks = NULLIF(p ->> 'every_weeks', '')::integer, starts_on = NULLIF(p ->> 'starts_on', '')::date, ends_on = NULLIF(p ->> 'ends_on', '')::date,
      single_at = NULLIF(p ->> 'single_at', '')::timestamptz, start_time = NULLIF(p ->> 'start_time', '')::time,
      duration_minutes = COALESCE(NULLIF(p ->> 'duration_minutes', '')::integer, duration_minutes), timezone = COALESCE(NULLIF(p ->> 'timezone', ''), timezone),
      variant_ids = CASE WHEN jsonb_typeof(p -> 'variant_ids') = 'array' THEN ARRAY(SELECT (x)::uuid FROM jsonb_array_elements_text(p -> 'variant_ids') x) END,
      host_user_id = NULLIF(p ->> 'host_user_id', '')::uuid, meeting_url = NULLIF(p ->> 'meeting_url', ''), keyword = NULLIF(p ->> 'keyword', ''),
      track_clicks = COALESCE((p ->> 'track_clicks')::boolean, track_clicks),
      click_counts_as_attendance = COALESCE((p ->> 'click_counts_as_attendance')::boolean, click_counts_as_attendance),
      attendance_base = COALESCE(p -> 'attendance_base', attendance_base), updated_at = now()
    WHERE id = v_id AND product_id = p_product_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  END IF;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'live_session.saved', jsonb_build_object('live_session_id', v_id));
  RETURN v_id;
END;
$$;

-- Archivar (o volver a mostrar) una serie: no se borra, deja de dar fechas. Su asistencia y sus grabaciones quedan.
CREATE OR REPLACE FUNCTION app_servicio.live_session_archive(p_live_session_id uuid, p_archived boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ls record;
BEGIN
  SELECT id, workspace_id, product_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(ls.workspace_id, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  UPDATE app_servicio.live_sessions SET archived_at = CASE WHEN p_archived THEN COALESCE(archived_at, now()) END, updated_at = now() WHERE id = ls.id;
  PERFORM app_servicio.audit(ls.workspace_id, 'product', ls.product_id, CASE WHEN p_archived THEN 'live_session.archived' ELSE 'live_session.restored' END, jsonb_build_object('live_session_id', ls.id));
END;
$$;

-- Cancelar, mover o cargar la grabacion de UNA fecha. Una grabacion cargada a mano no la pisa un proceso automatico.
CREATE OR REPLACE FUNCTION app_servicio.live_date_save(p_live_session_id uuid, p_occurs_on date, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ls record;
  cur record;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT public.has_permission(ls.workspace_id, 'live_sessions.manage') THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  SELECT * INTO cur FROM app_servicio.live_session_dates WHERE live_session_id = ls.id AND occurs_on = p_occurs_on FOR UPDATE;
  IF app_servicio.is_system() AND cur.recording_source = 'manual' AND (p ? 'recording_url' OR p ? 'recording_call_id') THEN
    p := p - 'recording_url' - 'recording_call_id' - 'recording_source';
  END IF;
  -- La grabacion elegida tiene que ser del mismo negocio (el id viene del navegador).
  IF NULLIF(p ->> 'recording_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'recording_call_id')::uuid AND c.workspace_id = ls.workspace_id) THEN
    RAISE EXCEPTION 'No existe esa grabación' USING ERRCODE = 'CA002';
  END IF;
  INSERT INTO app_servicio.live_session_dates (workspace_id, live_session_id, occurs_on, status, moved_to, recording_url, recording_call_id, recording_source, recording_active, note)
  VALUES (ls.workspace_id, ls.id, p_occurs_on, COALESCE(p ->> 'status', 'normal'), NULLIF(p ->> 'moved_to', '')::timestamptz,
          NULLIF(p ->> 'recording_url', ''), NULLIF(p ->> 'recording_call_id', '')::uuid, NULLIF(p ->> 'recording_source', ''),
          COALESCE((p ->> 'recording_active')::boolean, true), NULLIF(p ->> 'note', ''))
  ON CONFLICT (live_session_id, occurs_on) DO UPDATE SET
    status = CASE WHEN p ? 'status' THEN p ->> 'status' ELSE app_servicio.live_session_dates.status END,
    moved_to = CASE WHEN p ? 'moved_to' THEN NULLIF(p ->> 'moved_to', '')::timestamptz ELSE app_servicio.live_session_dates.moved_to END,
    recording_url = CASE WHEN p ? 'recording_url' THEN NULLIF(p ->> 'recording_url', '') ELSE app_servicio.live_session_dates.recording_url END,
    recording_call_id = CASE WHEN p ? 'recording_call_id' THEN NULLIF(p ->> 'recording_call_id', '')::uuid ELSE app_servicio.live_session_dates.recording_call_id END,
    recording_source = CASE WHEN p ? 'recording_source' THEN NULLIF(p ->> 'recording_source', '') ELSE app_servicio.live_session_dates.recording_source END,
    recording_active = CASE WHEN p ? 'recording_active' THEN (p ->> 'recording_active')::boolean ELSE app_servicio.live_session_dates.recording_active END,
    note = CASE WHEN p ? 'note' THEN NULLIF(p ->> 'note', '') ELSE app_servicio.live_session_dates.note END,
    updated_at = now();
  PERFORM app_servicio.audit(ls.workspace_id, 'live_session', ls.id, 'live_session.date_saved', jsonb_build_object('occurs_on', p_occurs_on, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END;
$$;

-- Marcar asistencia (F61): el equipo (`team`) o un clic dentro de la ventana (`click`, lo pide el sistema).
CREATE OR REPLACE FUNCTION app_servicio.attendance_mark(p_live_session_id uuid, p_occurs_on date, p_contact_id uuid, p_source text DEFAULT 'team')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ls record;
  v_id uuid;
  v_in_base boolean;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RAISE EXCEPTION 'No existe la sesión' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(ls.workspace_id, 'attendance.manage')
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = ls.workspace_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = p_contact_id AND c.workspace_id = ls.workspace_id) THEN
    RAISE EXCEPTION 'No existe el contacto' USING ERRCODE = 'CA002';
  END IF;
  -- Solo el sistema (el portal) marca `self` o `click`; una persona del equipo siempre marca `team`.
  IF NOT app_servicio.is_system() THEN p_source := 'team'; END IF;
  SELECT id INTO v_id FROM app_servicio_portal.live_attendance
   WHERE live_session_id = ls.id AND occurs_on = p_occurs_on AND contact_id = p_contact_id AND removed_at IS NULL;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  v_in_base := EXISTS (SELECT 1 FROM app_servicio.attendance_base_members(ls.id, p_occurs_on) b WHERE b.contact_id = p_contact_id);
  INSERT INTO app_servicio_portal.live_attendance (workspace_id, live_session_id, occurs_on, contact_id, source, added_manually, marked_by)
  VALUES (ls.workspace_id, ls.id, p_occurs_on, p_contact_id, CASE WHEN p_source IN ('self', 'team', 'click') THEN p_source ELSE 'team' END,
          p_source = 'team' AND NOT v_in_base, CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(ls.workspace_id, 'contact', p_contact_id, 'attendance.marked',
    jsonb_build_object('live_session_id', ls.id, 'occurs_on', p_occurs_on, 'source', p_source, 'in_base', v_in_base));
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.attendance_remove(p_attendance_id uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a record;
BEGIN
  SELECT * INTO a FROM app_servicio_portal.live_attendance WHERE id = p_attendance_id FOR UPDATE;
  IF a.id IS NULL THEN RAISE EXCEPTION 'No existe esa asistencia' USING ERRCODE = 'CA002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.has_permission(a.workspace_id, 'attendance.manage')
       AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = a.contact_id AND public.can_see_contact(c))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NULLIF(btrim(COALESCE(p_reason, '')), '') IS NULL THEN RAISE EXCEPTION 'Escribí el motivo' USING ERRCODE = 'CA001'; END IF;
  IF a.removed_at IS NOT NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.live_attendance SET removed_at = now(), removed_by = auth.uid(), removed_reason = btrim(p_reason) WHERE id = a.id;
  PERFORM app_servicio.audit(a.workspace_id, 'contact', a.contact_id, 'attendance.removed',
    jsonb_build_object('live_session_id', a.live_session_id, 'occurs_on', a.occurs_on, 'reason', btrim(p_reason)));
END;
$$;

-- La asistencia de una sesion en una fecha, para la ficha de la sesion (sin datos de mas: contacto, origen y si cuenta).
CREATE OR REPLACE FUNCTION app_servicio.live_session_attendance(p_live_session_id uuid, p_occurs_on date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  ls record;
BEGIN
  SELECT id, workspace_id INTO ls FROM app_servicio.live_sessions WHERE id = p_live_session_id;
  IF ls.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(ls.workspace_id)
       AND (public.has_permission(ls.workspace_id, 'attendance.manage') OR public.has_permission(ls.workspace_id, 'live_sessions.manage') OR public.has_permission(ls.workspace_id, 'portal.view'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'base', COALESCE((SELECT jsonb_agg(b.contact_id) FROM app_servicio.attendance_base_members(ls.id, p_occurs_on) b), '[]'::jsonb),
    'attended', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'contact_id', a.contact_id, 'source', a.source, 'added_manually', a.added_manually))
                            FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = ls.id AND a.occurs_on = p_occurs_on AND a.removed_at IS NULL), '[]'::jsonb),
    'clicks', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'clicked_at', c.clicked_at))
                          FROM app_servicio.link_clicks c WHERE c.target_type = 'live_session' AND c.target_id = ls.id AND c.target_date = p_occurs_on AND NOT c.is_bot), '[]'::jsonb));
END;
$$;

-- La asistencia de las fechas YA PASADAS de un programa en un periodo (hasta 120 dias), para la Lista, el Mes, las
-- Sesiones recurrentes y la grilla por estudiante: por fecha, la base, quienes asistieron y los clics. Una consulta.
CREATE OR REPLACE FUNCTION app_servicio.live_attendance_overview(p_product_id uuid, p_from date, p_to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN '[]'::jsonb; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws)
       AND (public.has_permission(v_ws, 'attendance.manage') OR public.has_permission(v_ws, 'live_sessions.manage') OR public.has_permission(v_ws, 'portal.view'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_to < p_from OR p_to - p_from > 120 THEN RAISE EXCEPTION 'El período es de hasta 120 días' USING ERRCODE = 'CA001'; END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'live_session_id', o.live_session_id, 'occurs_on', o.occurs_on, 'starts_at', o.starts_at, 'ends_at', o.ends_at, 'status', o.status,
      'base', COALESCE((SELECT jsonb_agg(b.contact_id) FROM app_servicio.attendance_base_members(o.live_session_id, o.occurs_on) b), '[]'::jsonb),
      'attended', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', a.id, 'contact_id', a.contact_id, 'source', a.source, 'added_manually', a.added_manually))
                              FROM app_servicio_portal.live_attendance a WHERE a.live_session_id = o.live_session_id AND a.occurs_on = o.occurs_on AND a.removed_at IS NULL), '[]'::jsonb),
      'clicks', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', c.contact_id, 'clicked_at', c.clicked_at))
                            FROM app_servicio.link_clicks c WHERE c.target_type = 'live_session' AND c.target_id = o.live_session_id AND c.target_date = o.occurs_on AND NOT c.is_bot), '[]'::jsonb))
      ORDER BY o.starts_at)
      FROM app_servicio.live_session_occurrences(p_product_id, p_from, p_to) o
     WHERE o.status <> 'cancelled' AND o.starts_at <= now()), '[]'::jsonb);
END;
$$;

-- ─── 5. El tipo «Clase» (F64) ───────────────────────────────────────────────
-- Si el area Servicio ya tiene un tipo llamado «Clase» sin clave, se le pone; si no, se crea. Nunca se toca una grabacion.
UPDATE public.booking_categories c SET system_key = 'servicio.clase', description = COALESCE(c.description, 'Clase grupal o sesión en vivo de un programa para sus estudiantes')
  FROM public.booking_categories a
 WHERE a.system_key = 'servicio' AND c.parent_id = a.id AND lower(btrim(c.name)) = 'clase' AND c.system_key IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.booking_categories x WHERE x.workspace_id = c.workspace_id AND x.system_key = 'servicio.clase');
INSERT INTO public.booking_categories (workspace_id, parent_id, name, color, position, is_system, description, system_key)
SELECT a.workspace_id, a.id, 'Clase', a.color,
       COALESCE((SELECT max(c.position) + 1 FROM public.booking_categories c WHERE c.parent_id = a.id), 0),
       true, 'Clase grupal o sesión en vivo de un programa para sus estudiantes', 'servicio.clase'
  FROM public.booking_categories a
 WHERE a.system_key = 'servicio'
   AND NOT EXISTS (SELECT 1 FROM public.booking_categories x WHERE x.workspace_id = a.workspace_id AND x.system_key = 'servicio.clase');

-- Un negocio que se crea despues lo recibe AL PRENDER EL MODULO (o al nacer su area Servicio con el modulo prendido).
-- Asi un negocio nuevo con el modulo apagado nace igual que antes (las areas y tipos de la Agenda no cambian) y
-- `seed_booking_categories_for_workspace` (de la Agenda) no se toca. Nunca hace fallar lo que lo dispara.
CREATE OR REPLACE FUNCTION app_servicio.ensure_clase_type(p_workspace_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  INSERT INTO public.booking_categories (workspace_id, parent_id, name, color, position, is_system, description, system_key)
  SELECT a.workspace_id, a.id, 'Clase', a.color,
         COALESCE((SELECT max(c.position) + 1 FROM public.booking_categories c WHERE c.parent_id = a.id), 0),
         true, 'Clase grupal o sesión en vivo de un programa para sus estudiantes', 'servicio.clase'
    FROM public.booking_categories a
   WHERE a.workspace_id = p_workspace_id AND a.system_key = 'servicio' AND a.archived_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM public.booking_categories x WHERE x.workspace_id = a.workspace_id AND x.system_key = 'servicio.clase')
   LIMIT 1;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.booking_area_clase_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  PERFORM app_servicio.ensure_clase_type(NEW.workspace_id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.booking_area_clase_hook: %', SQLERRM;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.module_enabled_clase_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT app_servicio.module_on(NEW.id) THEN RETURN NULL; END IF;
  PERFORM app_servicio.ensure_clase_type(NEW.id);
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'app_servicio.module_enabled_clase_hook: %', SQLERRM;
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION app_servicio.ensure_clase_type(uuid), app_servicio.booking_area_clase_hook(), app_servicio.module_enabled_clase_hook() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.ensure_clase_type(uuid) TO service_role;
DROP TRIGGER IF EXISTS trg_app_servicio_booking_area_clase ON public.booking_categories;
CREATE TRIGGER trg_app_servicio_booking_area_clase AFTER INSERT ON public.booking_categories
  FOR EACH ROW WHEN (NEW.system_key = 'servicio') EXECUTE FUNCTION app_servicio.booking_area_clase_hook();
DROP TRIGGER IF EXISTS trg_app_servicio_module_clase ON public.workspaces;
CREATE TRIGGER trg_app_servicio_module_clase AFTER UPDATE OF services_enabled ON public.workspaces
  FOR EACH ROW WHEN (NEW.services_enabled IS TRUE AND OLD.services_enabled IS DISTINCT FROM TRUE) EXECUTE FUNCTION app_servicio.module_enabled_clase_hook();

-- ─── 6. Permisos de ejecucion ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.live_occurrences_plan(jsonb), app_servicio.live_attendance_window(timestamptz, timestamptz, timestamptz), app_servicio.attendance_base_plan(jsonb),
  app_servicio.live_session_occurrences(uuid, date, date), app_servicio.attendance_base_members(uuid, date), app_servicio.program_live_recordings(uuid),
  app_servicio.live_session_save(uuid, uuid, jsonb), app_servicio.live_date_save(uuid, date, jsonb), app_servicio.attendance_mark(uuid, date, uuid, text),
  app_servicio.attendance_remove(uuid, text), app_servicio.live_session_attendance(uuid, date),
  app_servicio.live_session_archive(uuid, boolean), app_servicio.live_attendance_overview(uuid, date, date)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.live_occurrences_plan(jsonb), app_servicio.live_attendance_window(timestamptz, timestamptz, timestamptz), app_servicio.attendance_base_plan(jsonb),
  app_servicio.live_session_occurrences(uuid, date, date), app_servicio.attendance_base_members(uuid, date), app_servicio.program_live_recordings(uuid),
  app_servicio.live_session_save(uuid, uuid, jsonb), app_servicio.live_date_save(uuid, date, jsonb), app_servicio.attendance_mark(uuid, date, uuid, text),
  app_servicio.attendance_remove(uuid, text), app_servicio.live_session_attendance(uuid, date),
  app_servicio.live_session_archive(uuid, boolean), app_servicio.live_attendance_overview(uuid, date, date)
TO service_role;
GRANT EXECUTE ON FUNCTION
  app_servicio.live_session_occurrences(uuid, date, date), app_servicio.program_live_recordings(uuid), app_servicio.live_session_save(uuid, uuid, jsonb),
  app_servicio.live_date_save(uuid, date, jsonb), app_servicio.attendance_mark(uuid, date, uuid, text), app_servicio.attendance_remove(uuid, text),
  app_servicio.live_session_attendance(uuid, date), app_servicio.live_session_archive(uuid, boolean), app_servicio.live_attendance_overview(uuid, date, date)
TO authenticated;
