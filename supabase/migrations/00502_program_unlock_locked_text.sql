-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00502_program_unlock_locked_text  (Programa: texto propio en el candado de cualquier regla)
-- ============================================================================
-- Hasta ahora el texto que ve el estudiante en un módulo con candado salía fijo según el tipo de regla («Se abre
-- cuando completes lo anterior», «Se abre el DD/MM/AAAA»…) y `locked_text` solo se usaba en `journey_item` y
-- `automation`. Desde acá, con candado (no «Próximamente»), un `locked_text` no vacío reemplaza al texto automático
-- en cualquier tipo. Sin `locked_text` todo sale igual que antes. «Próximamente» sigue usando `coming_soon_text`.
--
-- Gemela: `reasonOf` en lib/program/unlock.ts; los casos de lib/program/unlock.cases.json corren contra las dos
-- (vitest y scripts/verify-program.mjs). Misma firma; solo cambia una línea del CASE de `v_reason`.
--
-- Aditiva (reemplaza una función pura, sin tocar datos). Puede ir antes o después del deploy. En producción, el
-- 19/11/2026 el único `locked_text` era de una regla `automation`, que ya lo mostraba: nada cambia de lo que se ve.
--
-- Volver atrás: correr la definición vieja (copiada de `pg_get_functiondef` de producción el 19/11/2026,
-- md5 8bdb018cf0ade78f8e6aee5ae27f2175, igual a la de la 00342):
--
--   CREATE OR REPLACE FUNCTION app_servicio.program_unlock_plan(p jsonb)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    IMMUTABLE
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     chain jsonb := COALESCE(p -> 'chain', '[]'::jsonb);
--     ctx jsonb := COALESCE(p -> 'ctx', '{}'::jsonb);
--     v_today date := (ctx ->> 'today')::date;
--     v_start date := NULLIF(ctx ->> 'accessStartsOn', '')::date;
--     n integer := jsonb_array_length(chain);
--     i integer;
--     node jsonb;
--     r jsonb;
--     t text;
--     v_open boolean;
--     v_opens date;
--     v_display text;
--     v_visible boolean;
--     v_own boolean;
--     v_reason text;
--     v_hidden jsonb := jsonb_build_object('visible', false, 'unlocked', false, 'included', true, 'display', 'hidden', 'reason', NULL, 'opensOn', NULL);
--   BEGIN
--     IF n = 0 THEN RETURN v_hidden; END IF;
--     IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ->> 'status' <> 'active') THEN RETURN v_hidden; END IF;
--     IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ? 'included' AND (x ->> 'included')::boolean = false) THEN
--       RETURN v_hidden || jsonb_build_object('included', false);
--     END IF;
--     FOR i IN 0 .. n - 1 LOOP
--       node := chain -> i;
--       r := COALESCE(NULLIF(node -> 'rule', 'null'::jsonb), '{"type":"open"}'::jsonb);
--       t := COALESCE(r ->> 'type', 'open');
--       v_opens := CASE
--         WHEN t = 'fixed_date' THEN NULLIF(r ->> 'date', '')::date
--         WHEN t = 'days_after_start' AND v_start IS NOT NULL THEN v_start + CASE WHEN jsonb_typeof(r -> 'days') = 'number' AND (r ->> 'days')::numeric > 0 THEN (r ->> 'days')::numeric::integer ELSE 0 END
--         ELSE NULL END;
--       v_open := COALESCE(ctx -> 'unlockedIds', '[]'::jsonb) ? (node ->> 'id')
--         OR CASE t
--           WHEN 'open' THEN true
--           WHEN 'fixed_date' THEN v_opens IS NOT NULL AND v_today >= v_opens
--           WHEN 'days_after_start' THEN v_opens IS NOT NULL AND v_today >= v_opens
--           WHEN 'after_complete' THEN NULLIF(r ->> 'id', '') IS NOT NULL
--                AND (COALESCE(ctx -> 'completed', '[]'::jsonb) ? (r ->> 'id') OR COALESCE(ctx -> 'inactiveIds', '[]'::jsonb) ? (r ->> 'id'))
--           WHEN 'challenge_started' THEN COALESCE((ctx ->> 'challengeStarted')::boolean, false)
--           ELSE false END;
--       CONTINUE WHEN v_open;
--       v_display := COALESCE(NULLIF(r ->> 'display', ''), CASE WHEN t = 'fixed_date' THEN 'coming_soon' ELSE 'locked' END);
--       v_own := i = n - 1;
--       v_visible := CASE WHEN v_own THEN v_display <> 'hidden' ELSE v_display = 'locked' END;
--       IF NOT v_visible THEN RETURN v_hidden; END IF;
--       v_reason := CASE
--         WHEN v_display = 'coming_soon' AND NULLIF(r ->> 'coming_soon_text', '') IS NOT NULL THEN r ->> 'coming_soon_text'
--         WHEN t IN ('fixed_date', 'days_after_start') THEN CASE WHEN v_opens IS NULL THEN 'Se abre cuando empiece tu acceso' ELSE 'Se abre el ' || to_char(v_opens, 'DD/MM/YYYY') END
--         WHEN t = 'after_complete' THEN 'Se abre cuando completes lo anterior'
--         WHEN t = 'challenge_started' THEN 'Se abre cuando empiece el Reto'
--         ELSE COALESCE(NULLIF(r ->> 'locked_text', ''), 'Todavía no está disponible') END;
--       RETURN jsonb_build_object('visible', true, 'unlocked', false, 'included', true, 'display', v_display, 'reason', v_reason,
--                                 'opensOn', CASE WHEN v_own AND v_opens IS NOT NULL THEN to_char(v_opens, 'YYYY-MM-DD') END);
--     END LOOP;
--     RETURN jsonb_build_object('visible', true, 'unlocked', true, 'included', true, 'display', 'open', 'reason', NULL, 'opensOn', NULL);
--   END;
--   $function$
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio.program_unlock_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  chain jsonb := COALESCE(p -> 'chain', '[]'::jsonb);
  ctx jsonb := COALESCE(p -> 'ctx', '{}'::jsonb);
  v_today date := (ctx ->> 'today')::date;
  v_start date := NULLIF(ctx ->> 'accessStartsOn', '')::date;
  n integer := jsonb_array_length(chain);
  i integer;
  node jsonb;
  r jsonb;
  t text;
  v_open boolean;
  v_opens date;
  v_display text;
  v_visible boolean;
  v_own boolean;
  v_reason text;
  v_hidden jsonb := jsonb_build_object('visible', false, 'unlocked', false, 'included', true, 'display', 'hidden', 'reason', NULL, 'opensOn', NULL);
BEGIN
  IF n = 0 THEN RETURN v_hidden; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ->> 'status' <> 'active') THEN RETURN v_hidden; END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ? 'included' AND (x ->> 'included')::boolean = false) THEN
    RETURN v_hidden || jsonb_build_object('included', false);
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    node := chain -> i;
    r := COALESCE(NULLIF(node -> 'rule', 'null'::jsonb), '{"type":"open"}'::jsonb);
    t := COALESCE(r ->> 'type', 'open');
    v_opens := CASE
      WHEN t = 'fixed_date' THEN NULLIF(r ->> 'date', '')::date
      WHEN t = 'days_after_start' AND v_start IS NOT NULL THEN v_start + CASE WHEN jsonb_typeof(r -> 'days') = 'number' AND (r ->> 'days')::numeric > 0 THEN (r ->> 'days')::numeric::integer ELSE 0 END
      ELSE NULL END;
    v_open := COALESCE(ctx -> 'unlockedIds', '[]'::jsonb) ? (node ->> 'id')
      OR CASE t
        WHEN 'open' THEN true
        WHEN 'fixed_date' THEN v_opens IS NOT NULL AND v_today >= v_opens
        WHEN 'days_after_start' THEN v_opens IS NOT NULL AND v_today >= v_opens
        WHEN 'after_complete' THEN NULLIF(r ->> 'id', '') IS NOT NULL
             AND (COALESCE(ctx -> 'completed', '[]'::jsonb) ? (r ->> 'id') OR COALESCE(ctx -> 'inactiveIds', '[]'::jsonb) ? (r ->> 'id'))
        WHEN 'challenge_started' THEN COALESCE((ctx ->> 'challengeStarted')::boolean, false)
        ELSE false END;
    CONTINUE WHEN v_open;
    v_display := COALESCE(NULLIF(r ->> 'display', ''), CASE WHEN t = 'fixed_date' THEN 'coming_soon' ELSE 'locked' END);
    v_own := i = n - 1;
    v_visible := CASE WHEN v_own THEN v_display <> 'hidden' ELSE v_display = 'locked' END;
    IF NOT v_visible THEN RETURN v_hidden; END IF;
    v_reason := CASE
      WHEN v_display = 'coming_soon' AND NULLIF(r ->> 'coming_soon_text', '') IS NOT NULL THEN r ->> 'coming_soon_text'
      -- 00502: el texto propio del candado gana sobre el automático, sea cual sea el tipo.
      WHEN v_display <> 'coming_soon' AND NULLIF(r ->> 'locked_text', '') IS NOT NULL THEN r ->> 'locked_text'
      WHEN t IN ('fixed_date', 'days_after_start') THEN CASE WHEN v_opens IS NULL THEN 'Se abre cuando empiece tu acceso' ELSE 'Se abre el ' || to_char(v_opens, 'DD/MM/YYYY') END
      WHEN t = 'after_complete' THEN 'Se abre cuando completes lo anterior'
      WHEN t = 'challenge_started' THEN 'Se abre cuando empiece el Reto'
      ELSE COALESCE(NULLIF(r ->> 'locked_text', ''), 'Todavía no está disponible') END;
    RETURN jsonb_build_object('visible', true, 'unlocked', false, 'included', true, 'display', v_display, 'reason', v_reason,
                              'opensOn', CASE WHEN v_own AND v_opens IS NOT NULL THEN to_char(v_opens, 'YYYY-MM-DD') END);
  END LOOP;
  RETURN jsonb_build_object('visible', true, 'unlocked', true, 'included', true, 'display', 'open', 'reason', NULL, 'opensOn', NULL);
END;
$function$;

REVOKE ALL ON FUNCTION app_servicio.program_unlock_plan(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio.program_unlock_plan(jsonb) TO service_role;
