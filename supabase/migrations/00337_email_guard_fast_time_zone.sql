-- ============================================================================
-- 00337 — La guardia de entrega de email deja de leer el catalogo de zonas
-- ============================================================================
--
-- Por que: `private.email_guard_state` (00287) validaba la zona del negocio con
--   EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = v_tz)
-- y esa vista no es una tabla: cada vez que se la mira, Postgres abre y lee los
-- ~600 archivos de zonas del disco. En produccion (8/11/2026) eso costaba
-- ~337 ms por llamada, y la guardia corre en CADA email de marketing
-- (`reserve_email_send`, adentro del candado del negocio: diez envios a la vez
-- esperan uno detras del otro) y cada vez que la cola de broadcasts pregunta el
-- cupo (`email_send_capacity`). `reserve_email_send` promediaba 803 ms.
--
-- Que cambia: la regla de que zona vale sale a una funcion chica,
-- `private.email_guard_time_zone(text)`, que da EL MISMO resultado sin leer el
-- catalogo en los casos de todos los dias:
--   - NULL -> 'UTC' (igual que antes).
--   - 'UTC' -> 'UTC' (el valor por defecto de workspaces.timezone, 00122).
--   - Un nombre con forma IANA (Zona/Ciudad, cada parte empieza con mayuscula:
--     'America/Costa_Rica', 'America/Argentina/Buenos_Aires', 'Etc/GMT+3') se
--     prueba directo con AT TIME ZONE; si Postgres no lo conoce, 'UTC'.
--   - Cualquier otra cosa (sin barra como 'GMT' o 'EST', abreviaturas como
--     'ART', minusculas, POSIX como 'UTC+3' o '+03:00', espacios) sigue
--     mirando el catalogo, como antes. Asi una abreviatura o un POSIX, que
--     AT TIME ZONE acepta pero el catalogo no, sigue cayendo a 'UTC'. Son raros:
--     el selector de Ajustes solo guarda nombres IANA y 'UTC'.
--
-- Las unicas diferencias con la regla vieja, las dos con forma IANA:
--   - un nombre escrito con otras mayusculas en el medio ('America/New_york'):
--     AT TIME ZONE no distingue mayusculas, asi que ahora vale como
--     'America/New_York'; antes caia a 'UTC'.
--   - un nombre viejo que Postgres conoce pero no lista ('SystemV/AST4'):
--     ahora vale; antes caia a 'UTC'.
-- Ninguno de los dos lo puede guardar la app (el selector usa la lista IANA).
-- Comparado en produccion el 8/11/2026, en una transaccion que se deshizo:
-- los 553 nombres IANA del catalogo dan igual, la guardia devuelve lo mismo
-- para los dos negocios, y de 30 casos raros solo 'SystemV/AST4' cambia.
-- Tiempo de la guardia para los dos negocios: 718 ms -> 1 ms.
-- `scripts/verify-email-subscription.mjs` (bloque 11) compara la regla nueva
-- con la vieja en todas las zonas del catalogo y en una lista de casos raros.
--
-- Nada mas cambia en `email_guard_state`: el cuerpo es el de la base
-- (pg_get_functiondef, igual al de la 00287) con las cuatro lineas de la zona
-- reemplazadas por una llamada a la funcion nueva. `email_guard_decide` y su
-- gemela de TypeScript (`decideEmailSend`) no se tocan.
--
-- Aditiva y reversible: puede ir antes o despues de un deploy (el codigo no
-- cambia). Para volver atras, correr la definicion vieja de abajo y
--   DROP FUNCTION IF EXISTS private.email_guard_time_zone(text);
--
-- ----------------------------------------------------------------------------
-- La definicion vieja, leida de la base el 8/11/2026
-- (md5 de pg_get_functiondef: 955f7b7bed9ba0dae4ca15c03cc64c70):
-- ----------------------------------------------------------------------------
-- CREATE OR REPLACE FUNCTION private.email_guard_state(p_workspace_id uuid, p_now timestamp with time zone, p_category text)
--  RETURNS jsonb
--  LANGUAGE plpgsql
--  STABLE SECURITY DEFINER
--  SET search_path TO ''
-- AS $function$
-- DECLARE
--   v_cfg jsonb;
--   v_tz text;
--   v_today date;
--   v_day_start timestamptz;
--   v_next_day timestamptz;
--   v_level_date date;
--   v_level_start timestamptz;
--   v_quota integer;
--   v_input jsonb;
--   v_out jsonb;
--   v_retry timestamptz;
--   v_int_re text := '^\s*[0-9]+\s*$';
-- BEGIN
--   SELECT ic.config INTO v_cfg
--     FROM public.integration_configs ic
--    WHERE ic.workspace_id = p_workspace_id AND ic.type = 'email_provider' AND ic.provider = 'resend'
--    LIMIT 1;
--   v_cfg := coalesce(v_cfg, '{}'::jsonb);
--
--   SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
--   IF v_tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = v_tz) THEN
--     v_tz := 'UTC';
--   END IF;
--
--   v_today := (p_now AT TIME ZONE v_tz)::date;
--   v_day_start := v_today::timestamp AT TIME ZONE v_tz;
--   v_next_day := (v_today + 1)::timestamp AT TIME ZONE v_tz;
--
--   v_level_date := CASE WHEN coalesce(v_cfg->>'warmup_level_date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_cfg->>'warmup_level_date')::date END;
--   v_level_start := CASE WHEN v_level_date IS NOT NULL THEN v_level_date::timestamp AT TIME ZONE v_tz END;
--   v_quota := CASE WHEN coalesce(v_cfg->>'daily_quota', '') ~ v_int_re THEN (v_cfg->>'daily_quota')::integer END;
--
--   v_input := jsonb_build_object(
--     'category', p_category,
--     'today', v_today,
--     'manual_cap', CASE WHEN coalesce(v_cfg->>'marketing_daily_cap', '') ~ v_int_re THEN (v_cfg->>'marketing_daily_cap')::integer END,
--     'warmup_enabled', CASE v_cfg->>'warmup_enabled' WHEN 'true' THEN to_jsonb(true) WHEN 'false' THEN to_jsonb(false) ELSE 'null'::jsonb END,
--     'warmup_level', CASE WHEN coalesce(v_cfg->>'warmup_level', '') ~ v_int_re THEN (v_cfg->>'warmup_level')::integer END,
--     'warmup_level_date', v_level_date,
--     'paused', nullif(v_cfg->>'marketing_paused_at', '') IS NOT NULL,
--     'quota', v_quota,
--     'marketing_today', (
--       SELECT count(*) FROM public.email_log l
--        WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing'
--          AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
--     ),
--     'all_today', CASE WHEN v_quota IS NULL THEN 0 ELSE (
--       SELECT count(*) FROM public.email_log l
--        WHERE l.workspace_id = p_workspace_id AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
--     ) END,
--     'lifetime_marketing_sent', CASE WHEN v_cfg ? 'warmup_enabled' THEN 0 ELSE (
--       SELECT count(*) FROM public.email_log l
--        WHERE l.workspace_id = p_workspace_id AND l.status = 'sent'
--          AND (l.category = 'marketing' OR (l.category IS NULL AND l.kind IN ('broadcast', 'flow', 'flow_message', 'sequence')))
--     ) END,
--     'sent_since_level', CASE WHEN v_level_start IS NULL THEN false ELSE EXISTS (
--       SELECT 1 FROM public.email_log l
--        WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing' AND l.status = 'sent'
--          AND l.created_at >= v_level_start AND l.created_at < v_day_start
--     ) END,
--     'brake_since_level', CASE
--       WHEN v_level_start IS NULL OR coalesce(v_cfg->>'marketing_last_brake_at', '') = '' THEN false
--       ELSE (v_cfg->>'marketing_last_brake_at')::timestamptz >= v_level_start
--     END
--   );
--
--   v_out := private.email_guard_decide(v_input);
--   v_retry := CASE v_out->>'status'
--     WHEN 'deferred_cap' THEN v_next_day
--     WHEN 'deferred_quota' THEN v_next_day
--     WHEN 'paused' THEN p_now + interval '1 hour'
--   END;
--
--   RETURN v_out || jsonb_build_object(
--     'retry_at', v_retry,
--     'used_today', (v_input->>'marketing_today')::integer,
--     'all_today', (v_input->>'all_today')::integer,
--     'quota', v_quota,
--     'manual_cap', coalesce((v_input->>'manual_cap')::integer, 100),
--     'day_start', v_day_start,
--     'next_day_start', v_next_day,
--     'time_zone', v_tz,
--     'paused_at', nullif(v_cfg->>'marketing_paused_at', ''),
--     'paused_reason', nullif(v_cfg->>'marketing_paused_reason', '')
--   );
-- END;
-- $function$
-- ============================================================================

-- La zona del negocio que usa la guardia. Misma regla que antes (la del
-- catalogo pg_timezone_names), sin leer el catalogo para un nombre IANA.
CREATE OR REPLACE FUNCTION private.email_guard_time_zone(p_tz text)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = ''
AS $$
DECLARE
  v_probe timestamp;
BEGIN
  IF p_tz IS NULL THEN
    RETURN 'UTC';
  END IF;
  IF p_tz = 'UTC' THEN
    RETURN 'UTC';
  END IF;

  -- Forma de nombre IANA: se prueba directo. AT TIME ZONE con un nombre carga
  -- solo ESE archivo (y queda en memoria); el catalogo los lee todos.
  IF p_tz ~ '^[A-Z][A-Za-z0-9_+-]*(/[A-Z][A-Za-z0-9_+-]*)+$' THEN
    BEGIN
      v_probe := now() AT TIME ZONE p_tz;
      RETURN p_tz;
    EXCEPTION WHEN OTHERS THEN
      RETURN 'UTC';
    END;
  END IF;

  -- Lo demas, como siempre: solo vale si esta en el catalogo.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_timezone_names n WHERE n.name = p_tz) THEN
    RETURN p_tz;
  END IF;
  RETURN 'UTC';
END;
$$;

COMMENT ON FUNCTION private.email_guard_time_zone(text) IS
  'La zona del negocio para la guardia de entrega (00337): la misma regla que pg_timezone_names, sin leer el catalogo para un nombre IANA. Nunca lanza; lo que no vale es UTC.';

REVOKE ALL ON FUNCTION private.email_guard_time_zone(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.email_guard_time_zone(text) TO service_role;

-- El estado del negocio: lee la config de Resend y cuenta en el dia del NEGOCIO (workspaces.timezone).
CREATE OR REPLACE FUNCTION private.email_guard_state(p_workspace_id uuid, p_now timestamp with time zone, p_category text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
DECLARE
  v_cfg jsonb;
  v_tz text;
  v_today date;
  v_day_start timestamptz;
  v_next_day timestamptz;
  v_level_date date;
  v_level_start timestamptz;
  v_quota integer;
  v_input jsonb;
  v_out jsonb;
  v_retry timestamptz;
  v_int_re text := '^\s*[0-9]+\s*$';
BEGIN
  SELECT ic.config INTO v_cfg
    FROM public.integration_configs ic
   WHERE ic.workspace_id = p_workspace_id AND ic.type = 'email_provider' AND ic.provider = 'resend'
   LIMIT 1;
  v_cfg := coalesce(v_cfg, '{}'::jsonb);

  SELECT w.timezone INTO v_tz FROM public.workspaces w WHERE w.id = p_workspace_id;
  -- 00337: la regla de la zona, sin leer el catalogo de zonas en cada email.
  v_tz := private.email_guard_time_zone(v_tz);

  v_today := (p_now AT TIME ZONE v_tz)::date;
  v_day_start := v_today::timestamp AT TIME ZONE v_tz;
  v_next_day := (v_today + 1)::timestamp AT TIME ZONE v_tz;

  v_level_date := CASE WHEN coalesce(v_cfg->>'warmup_level_date', '') ~ '^\d{4}-\d{2}-\d{2}$' THEN (v_cfg->>'warmup_level_date')::date END;
  v_level_start := CASE WHEN v_level_date IS NOT NULL THEN v_level_date::timestamp AT TIME ZONE v_tz END;
  v_quota := CASE WHEN coalesce(v_cfg->>'daily_quota', '') ~ v_int_re THEN (v_cfg->>'daily_quota')::integer END;

  v_input := jsonb_build_object(
    'category', p_category,
    'today', v_today,
    'manual_cap', CASE WHEN coalesce(v_cfg->>'marketing_daily_cap', '') ~ v_int_re THEN (v_cfg->>'marketing_daily_cap')::integer END,
    'warmup_enabled', CASE v_cfg->>'warmup_enabled' WHEN 'true' THEN to_jsonb(true) WHEN 'false' THEN to_jsonb(false) ELSE 'null'::jsonb END,
    'warmup_level', CASE WHEN coalesce(v_cfg->>'warmup_level', '') ~ v_int_re THEN (v_cfg->>'warmup_level')::integer END,
    'warmup_level_date', v_level_date,
    'paused', nullif(v_cfg->>'marketing_paused_at', '') IS NOT NULL,
    'quota', v_quota,
    'marketing_today', (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing'
         AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
    ),
    'all_today', CASE WHEN v_quota IS NULL THEN 0 ELSE (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.status IN ('sent', 'reserved') AND l.created_at >= v_day_start
    ) END,
    'lifetime_marketing_sent', CASE WHEN v_cfg ? 'warmup_enabled' THEN 0 ELSE (
      SELECT count(*) FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.status = 'sent'
         AND (l.category = 'marketing' OR (l.category IS NULL AND l.kind IN ('broadcast', 'flow', 'flow_message', 'sequence')))
    ) END,
    'sent_since_level', CASE WHEN v_level_start IS NULL THEN false ELSE EXISTS (
      SELECT 1 FROM public.email_log l
       WHERE l.workspace_id = p_workspace_id AND l.category = 'marketing' AND l.status = 'sent'
         AND l.created_at >= v_level_start AND l.created_at < v_day_start
    ) END,
    'brake_since_level', CASE
      WHEN v_level_start IS NULL OR coalesce(v_cfg->>'marketing_last_brake_at', '') = '' THEN false
      ELSE (v_cfg->>'marketing_last_brake_at')::timestamptz >= v_level_start
    END
  );

  v_out := private.email_guard_decide(v_input);
  v_retry := CASE v_out->>'status'
    WHEN 'deferred_cap' THEN v_next_day
    WHEN 'deferred_quota' THEN v_next_day
    WHEN 'paused' THEN p_now + interval '1 hour'
  END;

  RETURN v_out || jsonb_build_object(
    'retry_at', v_retry,
    'used_today', (v_input->>'marketing_today')::integer,
    'all_today', (v_input->>'all_today')::integer,
    'quota', v_quota,
    'manual_cap', coalesce((v_input->>'manual_cap')::integer, 100),
    'day_start', v_day_start,
    'next_day_start', v_next_day,
    'time_zone', v_tz,
    'paused_at', nullif(v_cfg->>'marketing_paused_at', ''),
    'paused_reason', nullif(v_cfg->>'marketing_paused_reason', '')
  );
END;
$$;

REVOKE ALL ON FUNCTION private.email_guard_state(uuid, timestamptz, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.email_guard_state(uuid, timestamptz, text) TO service_role;
