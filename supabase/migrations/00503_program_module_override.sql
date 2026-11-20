-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00503_program_module_override  (Programa: abrir, cerrar o programar un módulo para UNA persona)
-- ============================================================================
-- Desde la ficha del servicio, el equipo (services.access) puede, para el estudiante de ese servicio y en un módulo:
--   * abrirlo ya (aunque la regla del programa diga que todavía no, o aunque su variante no lo incluya);
--   * cerrarlo (aunque la regla, un paso del camino o una automatización ya lo hayan abierto);
--   * darle una regla propia (fecha, días desde que empezó, al completar algo, cuando empiece el Reto), que reemplaza
--     a la del programa y también incluye el módulo aunque la variante no lo incluya;
--   * volver a la regla del programa.
-- Se guarda por contacto y módulo en `app_servicio_portal.program_progress` (override_mode, override_rule,
-- override_by, override_at), igual que `unlocked_at`. Como todo pasa por `program_item_unlocked`, el portal, el tutor
-- y la comunidad lo respetan sin cambios. Un módulo cerrado a mano le dice al estudiante «Todavía no está disponible».
--
-- Gemela: `unlockPlan` en lib/program/unlock.ts (ctx.overrides); los casos de lib/program/unlock.cases.json corren
-- contra las dos (vitest y scripts/verify-program.mjs). Sin overrides, la salida es idéntica a la de la 00502.
--
-- Cambia:
--   * program_progress: cuatro columnas nuevas y un CHECK de forma (aditivo).
--   * program_unlock_plan: ctx.overrides (misma firma).
--   * program_item_unlocked: arma ctx.overrides (misma firma).
--   * service_classroom: cada módulo suma `override` (misma firma).
--   * svc_module_override: nueva (services.access).
--   * merge_contacts_hook: al unir dos contactos, lo cambiado a mano en un módulo pasa al principal si este no tiene.
--
-- Aditiva. Va ANTES de desplegar el código (la ficha llama a svc_module_override y lee `override`).
--
-- Volver atrás: DROP FUNCTION app_servicio.svc_module_override(uuid, uuid, text, jsonb); correr las definiciones
-- viejas de abajo (copiadas de `pg_get_functiondef` de producción el 19/11/2026) y, si hace falta,
-- ALTER TABLE app_servicio_portal.program_progress DROP CONSTRAINT program_progress_override_check,
--   DROP COLUMN override_mode, DROP COLUMN override_rule, DROP COLUMN override_by, DROP COLUMN override_at;
--
-- program_unlock_plan (md5 d764d7adfe210ae2102f05cce7baada8, la de la 00502):
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
--         -- 00502: el texto propio del candado gana sobre el automático, sea cual sea el tipo.
--         WHEN v_display <> 'coming_soon' AND NULLIF(r ->> 'locked_text', '') IS NOT NULL THEN r ->> 'locked_text'
--         WHEN t IN ('fixed_date', 'days_after_start') THEN CASE WHEN v_opens IS NULL THEN 'Se abre cuando empiece tu acceso' ELSE 'Se abre el ' || to_char(v_opens, 'DD/MM/YYYY') END
--         WHEN t = 'after_complete' THEN 'Se abre cuando completes lo anterior'
--         WHEN t = 'challenge_started' THEN 'Se abre cuando empiece el Reto'
--         ELSE COALESCE(NULLIF(r ->> 'locked_text', ''), 'Todavía no está disponible') END;
--       RETURN jsonb_build_object('visible', true, 'unlocked', false, 'included', true, 'display', v_display, 'reason', v_reason,
--                                 'opensOn', CASE WHEN v_own AND v_opens IS NOT NULL THEN to_char(v_opens, 'YYYY-MM-DD') END);
--     END LOOP;
--     RETURN jsonb_build_object('visible', true, 'unlocked', true, 'included', true, 'display', 'open', 'reason', NULL, 'opensOn', NULL);
--   END;
--   $function$;
--
-- program_item_unlocked (md5 bc8af077ba1742ff51c0431e04ba6497, la de la 00342):
--   CREATE OR REPLACE FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     it record;
--     v_chain jsonb := '[]'::jsonb;
--     cur record;
--     v_module uuid;
--     v_all boolean := false;
--     v_included uuid[] := ARRAY[]::uuid[];
--     v_services uuid[];
--     v_access uuid;
--     v_start date;
--     v_ctx jsonb;
--   BEGIN
--     SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id;
--     IF it.id IS NULL THEN RETURN NULL; END IF;
--     -- La cadena, de abajo hacia arriba.
--     SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = p_item_id;
--     WHILE cur.id IS NOT NULL LOOP
--       v_chain := jsonb_build_array(jsonb_build_object('id', cur.id, 'status', cur.status, 'rule', cur.unlock_rule)) || v_chain;
--       IF cur.kind = 'module' THEN v_module := cur.id; END IF;
--       EXIT WHEN cur.parent_id IS NULL;
--       SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = cur.parent_id;
--     END LOOP;
--     -- Lo que incluye la variante: union de los servicios vigentes del contacto en este producto.
--     SELECT array_agg(s.id) INTO v_services FROM app_servicio.services s
--      WHERE s.contact_id = p_contact_id AND s.product_id = it.product_id AND s.status IN ('active', 'paused', 'completed');
--     SELECT bool_or(COALESCE(x -> 'content' ->> 'modules', 'all') = 'all' OR jsonb_typeof(x -> 'content' -> 'modules') IS DISTINCT FROM 'array'),
--            COALESCE(array_agg(DISTINCT m::uuid) FILTER (WHERE m IS NOT NULL), ARRAY[]::uuid[])
--       INTO v_all, v_included
--       FROM app_servicio.services s
--       JOIN public.product_variants v ON v.id = s.product_variant_id
--       CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.portal_settings -> 'sections', '[]'::jsonb)) x
--       LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x -> 'content' -> 'modules') = 'array' THEN x -> 'content' -> 'modules' ELSE '[]'::jsonb END) m ON true
--      WHERE s.id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND x ->> 'section' = 'program';
--     IF v_module IS NOT NULL AND NOT COALESCE(v_all, false) THEN
--       v_chain := jsonb_set(v_chain, '{0,included}', to_jsonb(v_module = ANY (v_included)));
--     END IF;
--     v_access := app_servicio.portal_access_effective(p_contact_id, it.product_id, 'program');
--     SELECT app_servicio.local_date(a.starts_at, it.workspace_id) INTO v_start FROM app_servicio_portal.portal_access a WHERE a.id = v_access;
--     v_ctx := jsonb_build_object(
--       'today', app_servicio.today_in(it.workspace_id),
--       'accessStartsOn', v_start,
--       'completed', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.completed_at IS NOT NULL), '[]'::jsonb)
--                  || COALESCE((SELECT jsonb_agg(i.template_key) FROM app_servicio.service_items i WHERE i.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND i.status = 'completed'), '[]'::jsonb),
--       'inactiveIds', COALESCE((SELECT jsonb_agg(pi.id::text) FROM app_servicio.program_items pi WHERE pi.product_id = it.product_id AND pi.status <> 'active'), '[]'::jsonb),
--       'challengeStarted', EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND ph.challenge IS NOT NULL AND ph.status IN ('in_progress', 'completed')),
--       'unlockedIds', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.unlocked_at IS NOT NULL), '[]'::jsonb));
--     RETURN app_servicio.program_unlock_plan(jsonb_build_object('chain', v_chain, 'ctx', v_ctx));
--   END;
--   $function$;
--
-- service_classroom (md5 95aff04b3a9fd098f53d74694dc6ffac, la de la 00361):
--   CREATE OR REPLACE FUNCTION app_servicio.service_classroom(p_service_id uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    STABLE SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     s app_servicio.services;
--   BEGIN
--     SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
--     IF s.id IS NULL THEN RETURN NULL; END IF;
--     IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
--       RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
--     END IF;
--     RETURN jsonb_build_object(
--       'items', COALESCE((
--         SELECT jsonb_agg(jsonb_build_object(
--           'id', i.id, 'parent_id', i.parent_id, 'kind', i.kind, 'lesson_type', i.lesson_type, 'title', i.title,
--           'position', i.position, 'required', i.required,
--           'viewed_at', pp.viewed_at, 'completed_at', pp.completed_at,
--           -- La ultima entrega de una actividad o evaluacion de esa persona (sin revelar respuestas ni notas internas).
--           'submission', CASE WHEN i.form_id IS NULL THEN NULL ELSE (
--             SELECT jsonb_build_object('created_at', fs.created_at, 'review_status', fs.review_status)
--               FROM public.form_submissions fs
--              WHERE fs.form_id = i.form_id AND fs.contact_id = s.contact_id AND fs.workspace_id = s.workspace_id
--              ORDER BY fs.created_at DESC LIMIT 1) END,
--           -- Solo los modulos llevan su apertura: una clase hereda la de su modulo y el portal decide el resto.
--           'unlock', CASE WHEN i.kind = 'module' THEN app_servicio.program_item_unlocked(s.contact_id, i.id) END)
--           ORDER BY i.position, i.created_at)
--           FROM app_servicio.program_items i
--           LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = i.id AND pp.contact_id = s.contact_id
--          WHERE i.product_id = s.product_id AND i.workspace_id = s.workspace_id AND i.status = 'active'), '[]'::jsonb));
--   END;
--   $function$;
--
-- merge_contacts_hook (md5 81fa4e27e06f4ec7ea2e03449bdb842a, la de la 00378):
--   CREATE OR REPLACE FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid)
--    RETURNS jsonb
--    LANGUAGE plpgsql
--    SECURITY DEFINER
--    SET search_path TO ''
--   AS $function$
--   DECLARE
--     v_ws uuid;
--     v_out jsonb := '{}'::jsonb;
--     n integer;
--     acc_main uuid;
--     acc_dup uuid;
--     dupe record;
--   BEGIN
--     SELECT workspace_id INTO v_ws FROM public.contacts WHERE id = p_main;
--     -- Servicios: los dos quedan (si son del mismo producto y estan activos, se avisa).
--     UPDATE app_servicio.services SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('services', n);
--     FOR dupe IN SELECT product_id, count(*) c FROM app_servicio.services WHERE contact_id = p_main AND status IN ('active', 'paused') GROUP BY product_id HAVING count(*) > 1 LOOP
--       PERFORM app_servicio.notify_admins(v_ws, 'svc_merge_two_services', 'Dos servicios del mismo producto',
--         'Al unir dos contactos quedaron dos servicios activos del mismo producto. Revisá si hay que cancelar uno.', 'contact', p_main,
--         jsonb_build_object('product_id', dupe.product_id));
--     END LOOP;
--     -- La cuenta del portal: si los dos tienen, queda la del principal; la otra se suspende y sus sesiones se revocan.
--     SELECT id INTO acc_main FROM app_servicio_portal.portal_accounts WHERE contact_id = p_main;
--     SELECT id INTO acc_dup FROM app_servicio_portal.portal_accounts WHERE contact_id = p_duplicate;
--     IF acc_dup IS NOT NULL THEN
--       IF acc_main IS NULL THEN
--         UPDATE app_servicio_portal.portal_accounts SET contact_id = p_main, updated_at = now() WHERE id = acc_dup;
--         v_out := v_out || jsonb_build_object('portal_accounts', 1);
--       ELSE
--         UPDATE app_servicio_portal.portal_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = acc_dup;
--         UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = COALESCE(suspended_at, now()),
--                suspended_reason = 'Se unió con otro contacto', updated_at = now() WHERE id = acc_dup;
--         v_out := v_out || jsonb_build_object('portal_accounts_suspended', 1);
--       END IF;
--     END IF;
--     UPDATE app_servicio_portal.portal_sessions SET preview_contact_id = p_main WHERE preview_contact_id = p_duplicate;
--     UPDATE app_servicio_portal.portal_access SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('portal_access', n);
--     -- Avance: si los dos vieron la misma clase, queda la fecha mas vieja.
--     UPDATE app_servicio_portal.program_progress m
--        SET viewed_at = LEAST(m.viewed_at, d.viewed_at), completed_at = LEAST(m.completed_at, d.completed_at),
--            unlocked_at = LEAST(m.unlocked_at, d.unlocked_at), last_position_seconds = GREATEST(m.last_position_seconds, d.last_position_seconds), updated_at = now()
--       FROM app_servicio_portal.program_progress d
--      WHERE m.contact_id = p_main AND d.contact_id = p_duplicate AND d.program_item_id = m.program_item_id;
--     DELETE FROM app_servicio_portal.program_progress d
--      WHERE d.contact_id = p_duplicate AND EXISTS (SELECT 1 FROM app_servicio_portal.program_progress m WHERE m.contact_id = p_main AND m.program_item_id = d.program_item_id);
--     UPDATE app_servicio_portal.program_progress SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('program_progress', n);
--     -- Asistencia: una por sesion y fecha.
--     DELETE FROM app_servicio_portal.live_attendance d
--      WHERE d.contact_id = p_duplicate AND d.removed_at IS NULL
--        AND EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance m WHERE m.contact_id = p_main AND m.live_session_id = d.live_session_id
--                      AND m.occurs_on = d.occurs_on AND m.removed_at IS NULL);
--     UPDATE app_servicio_portal.live_attendance SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('live_attendance', n);
--     UPDATE app_servicio.link_clicks SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('link_clicks', n);
--     -- Comunidad: los posts pasan al principal; una reaccion repetida queda una.
--     UPDATE app_servicio_portal.community_posts SET author_contact_id = p_main WHERE author_contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('community_posts', n);
--     DELETE FROM app_servicio_portal.community_reactions d
--      WHERE d.contact_id = p_duplicate
--        AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions m WHERE m.contact_id = p_main AND m.post_id = d.post_id AND m.kind = d.kind);
--     UPDATE app_servicio_portal.community_reactions SET contact_id = p_main WHERE contact_id = p_duplicate;
--     -- Las conversaciones con el tutor.
--     UPDATE public.ai_threads SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate AND channel = 'portal';
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('ai_threads_portal', n);
--     -- A3 (00378): los puntos. Si los dos sumaron por lo mismo en el mismo programa, queda la del principal.
--     DELETE FROM app_servicio_portal.points_ledger d
--      WHERE d.contact_id = p_duplicate
--        AND EXISTS (SELECT 1 FROM app_servicio_portal.points_ledger m WHERE m.contact_id = p_main AND m.product_id = d.product_id AND m.source_key = d.source_key);
--     UPDATE app_servicio_portal.points_ledger SET contact_id = p_main WHERE contact_id = p_duplicate;
--     GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('points_ledger', n);
--     -- La extension de proyectos (Corrida C), si existe.
--     IF to_regprocedure('app_servicio_proyectos.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
--       EXECUTE 'SELECT app_servicio_proyectos.merge_contacts_hook($1, $2)' INTO dupe USING p_main, p_duplicate;
--     END IF;
--     RETURN v_out;
--   END;
--   $function$;
-- ============================================================================

-- ─── 1. Lo que el equipo cambió a mano, por persona y módulo ────────────────
ALTER TABLE app_servicio_portal.program_progress ADD COLUMN IF NOT EXISTS override_mode text NULL;
ALTER TABLE app_servicio_portal.program_progress ADD COLUMN IF NOT EXISTS override_rule jsonb NULL;
ALTER TABLE app_servicio_portal.program_progress ADD COLUMN IF NOT EXISTS override_by uuid NULL;
ALTER TABLE app_servicio_portal.program_progress ADD COLUMN IF NOT EXISTS override_at timestamptz NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'program_progress_override_check'
                   AND conrelid = 'app_servicio_portal.program_progress'::regclass) THEN
    ALTER TABLE app_servicio_portal.program_progress ADD CONSTRAINT program_progress_override_check CHECK (
      (override_mode IS NULL AND override_rule IS NULL)
      OR (override_mode IN ('open', 'closed') AND override_rule IS NULL)
      OR (override_mode = 'rule' AND override_rule IS NOT NULL AND jsonb_typeof(override_rule) = 'object'));
  END IF;
END $$;

COMMENT ON COLUMN app_servicio_portal.program_progress.override_mode IS
  '00503: lo que el equipo decidió para ESTA persona en un módulo: open (abierto), closed (cerrado) o rule (su propia regla, override_rule). NULL = la regla del programa.';

-- ─── 2. La regla pura, con lo cambiado a mano ───────────────────────────────
-- ctx.overrides = { "<id>": { "mode": "open"|"closed"|"rule", "rule": {...} } }. Sin overrides, igual que la 00502.
CREATE OR REPLACE FUNCTION app_servicio.program_unlock_plan(p jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
DECLARE
  chain jsonb := COALESCE(p -> 'chain', '[]'::jsonb);
  ctx jsonb := COALESCE(p -> 'ctx', '{}'::jsonb);
  v_ov jsonb := CASE WHEN jsonb_typeof(ctx -> 'overrides') = 'object' THEN ctx -> 'overrides' ELSE '{}'::jsonb END;
  v_today date := (ctx ->> 'today')::date;
  v_start date := NULLIF(ctx ->> 'accessStartsOn', '')::date;
  n integer := jsonb_array_length(chain);
  i integer;
  node jsonb;
  r jsonb;
  t text;
  om text;
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
  -- 00503: abierto a mano o con regla propia incluye el módulo aunque la variante no lo incluya.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(chain) x WHERE x ? 'included' AND (x ->> 'included')::boolean = false
               AND COALESCE(v_ov -> (x ->> 'id') ->> 'mode', '') NOT IN ('open', 'rule')) THEN
    RETURN v_hidden || jsonb_build_object('included', false);
  END IF;
  FOR i IN 0 .. n - 1 LOOP
    node := chain -> i;
    om := v_ov -> (node ->> 'id') ->> 'mode';
    -- 00503: abierto a mano pasa; cerrado a mano no lo abre nada; con regla propia se mira esa regla.
    CONTINUE WHEN om = 'open';
    r := CASE
      WHEN om = 'closed' THEN '{"type":"closed"}'::jsonb
      WHEN om = 'rule' AND jsonb_typeof(v_ov -> (node ->> 'id') -> 'rule') = 'object' THEN v_ov -> (node ->> 'id') -> 'rule'
      ELSE COALESCE(NULLIF(node -> 'rule', 'null'::jsonb), '{"type":"open"}'::jsonb) END;
    t := COALESCE(r ->> 'type', 'open');
    v_opens := CASE
      WHEN t = 'fixed_date' THEN NULLIF(r ->> 'date', '')::date
      WHEN t = 'days_after_start' AND v_start IS NOT NULL THEN v_start + CASE WHEN jsonb_typeof(r -> 'days') = 'number' AND (r ->> 'days')::numeric > 0 THEN (r ->> 'days')::numeric::integer ELSE 0 END
      ELSE NULL END;
    v_open := (om IS DISTINCT FROM 'closed' AND COALESCE(ctx -> 'unlockedIds', '[]'::jsonb) ? (node ->> 'id'))
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

-- ─── 3. Lo que una persona ve: suma lo cambiado a mano al contexto ──────────
CREATE OR REPLACE FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  it record;
  v_chain jsonb := '[]'::jsonb;
  cur record;
  v_module uuid;
  v_all boolean := false;
  v_included uuid[] := ARRAY[]::uuid[];
  v_services uuid[];
  v_access uuid;
  v_start date;
  v_ctx jsonb;
BEGIN
  SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id;
  IF it.id IS NULL THEN RETURN NULL; END IF;
  -- La cadena, de abajo hacia arriba.
  SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = p_item_id;
  WHILE cur.id IS NOT NULL LOOP
    v_chain := jsonb_build_array(jsonb_build_object('id', cur.id, 'status', cur.status, 'rule', cur.unlock_rule)) || v_chain;
    IF cur.kind = 'module' THEN v_module := cur.id; END IF;
    EXIT WHEN cur.parent_id IS NULL;
    SELECT id, parent_id, kind, status, unlock_rule INTO cur FROM app_servicio.program_items WHERE id = cur.parent_id;
  END LOOP;
  -- Lo que incluye la variante: union de los servicios vigentes del contacto en este producto.
  SELECT array_agg(s.id) INTO v_services FROM app_servicio.services s
   WHERE s.contact_id = p_contact_id AND s.product_id = it.product_id AND s.status IN ('active', 'paused', 'completed');
  SELECT bool_or(COALESCE(x -> 'content' ->> 'modules', 'all') = 'all' OR jsonb_typeof(x -> 'content' -> 'modules') IS DISTINCT FROM 'array'),
         COALESCE(array_agg(DISTINCT m::uuid) FILTER (WHERE m IS NOT NULL), ARRAY[]::uuid[])
    INTO v_all, v_included
    FROM app_servicio.services s
    JOIN public.product_variants v ON v.id = s.product_variant_id
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.portal_settings -> 'sections', '[]'::jsonb)) x
    LEFT JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(x -> 'content' -> 'modules') = 'array' THEN x -> 'content' -> 'modules' ELSE '[]'::jsonb END) m ON true
   WHERE s.id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND x ->> 'section' = 'program';
  IF v_module IS NOT NULL AND NOT COALESCE(v_all, false) THEN
    v_chain := jsonb_set(v_chain, '{0,included}', to_jsonb(v_module = ANY (v_included)));
  END IF;
  v_access := app_servicio.portal_access_effective(p_contact_id, it.product_id, 'program');
  SELECT app_servicio.local_date(a.starts_at, it.workspace_id) INTO v_start FROM app_servicio_portal.portal_access a WHERE a.id = v_access;
  v_ctx := jsonb_build_object(
    'today', app_servicio.today_in(it.workspace_id),
    'accessStartsOn', v_start,
    'completed', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.completed_at IS NOT NULL), '[]'::jsonb)
               || COALESCE((SELECT jsonb_agg(i.template_key) FROM app_servicio.service_items i WHERE i.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND i.status = 'completed'), '[]'::jsonb),
    'inactiveIds', COALESCE((SELECT jsonb_agg(pi.id::text) FROM app_servicio.program_items pi WHERE pi.product_id = it.product_id AND pi.status <> 'active'), '[]'::jsonb),
    'challengeStarted', EXISTS (SELECT 1 FROM app_servicio.service_phases ph WHERE ph.service_id = ANY (COALESCE(v_services, ARRAY[]::uuid[])) AND ph.challenge IS NOT NULL AND ph.status IN ('in_progress', 'completed')),
    'unlockedIds', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.unlocked_at IS NOT NULL), '[]'::jsonb),
    -- 00503: lo que el equipo abrió, cerró o programó a mano para esta persona.
    'overrides', COALESCE((SELECT jsonb_object_agg(pp.program_item_id::text, jsonb_strip_nulls(jsonb_build_object('mode', pp.override_mode, 'rule', pp.override_rule)))
                             FROM app_servicio_portal.program_progress pp
                            WHERE pp.contact_id = p_contact_id AND pp.override_mode IS NOT NULL), '{}'::jsonb));
  RETURN app_servicio.program_unlock_plan(jsonb_build_object('chain', v_chain, 'ctx', v_ctx));
END;
$function$;

-- ─── 4. La ficha: cada módulo dice si se cambió a mano ──────────────────────
CREATE OR REPLACE FUNCTION app_servicio.service_classroom(p_service_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT app_servicio.can_see_service_row(s) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'items', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', i.id, 'parent_id', i.parent_id, 'kind', i.kind, 'lesson_type', i.lesson_type, 'title', i.title,
        'position', i.position, 'required', i.required,
        'viewed_at', pp.viewed_at, 'completed_at', pp.completed_at,
        -- La ultima entrega de una actividad o evaluacion de esa persona (sin revelar respuestas ni notas internas).
        'submission', CASE WHEN i.form_id IS NULL THEN NULL ELSE (
          SELECT jsonb_build_object('created_at', fs.created_at, 'review_status', fs.review_status)
            FROM public.form_submissions fs
           WHERE fs.form_id = i.form_id AND fs.contact_id = s.contact_id AND fs.workspace_id = s.workspace_id
           ORDER BY fs.created_at DESC LIMIT 1) END,
        -- Solo los modulos llevan su apertura: una clase hereda la de su modulo y el portal decide el resto.
        'unlock', CASE WHEN i.kind = 'module' THEN app_servicio.program_item_unlocked(s.contact_id, i.id) END,
        -- 00503: lo que el equipo cambió a mano en ese módulo para esta persona.
        'override', CASE WHEN i.kind = 'module' AND pp.override_mode IS NOT NULL
                         THEN jsonb_build_object('mode', pp.override_mode, 'rule', pp.override_rule, 'at', pp.override_at) END)
        ORDER BY i.position, i.created_at)
        FROM app_servicio.program_items i
        LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = i.id AND pp.contact_id = s.contact_id
       WHERE i.product_id = s.product_id AND i.workspace_id = s.workspace_id AND i.status = 'active'), '[]'::jsonb));
END;
$function$;

-- ─── 5. Abrir, cerrar o programar un módulo para el estudiante de un servicio ─
-- p_mode: 'open', 'closed', 'rule' (con p_rule) o NULL (volver a la regla del programa). Pide services.access.
CREATE OR REPLACE FUNCTION app_servicio.svc_module_override(p_service_id uuid, p_program_item_id uuid, p_mode text, p_rule jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
  it record;
  t text;
  v_prev text;
  v_rule jsonb;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  IF NOT app_servicio.module_on(s.workspace_id) THEN RAISE EXCEPTION 'El módulo de Servicios está apagado' USING ERRCODE = 'SV001'; END IF;
  IF s.status NOT IN ('active', 'paused', 'completed') THEN RAISE EXCEPTION 'Este servicio ya no está vigente' USING ERRCODE = 'SV001'; END IF;
  SELECT id, kind, status INTO it FROM app_servicio.program_items
   WHERE id = p_program_item_id AND product_id = s.product_id AND workspace_id = s.workspace_id;
  IF it.id IS NULL OR it.kind <> 'module' THEN RAISE EXCEPTION 'Ese módulo no es de este programa' USING ERRCODE = 'SV002'; END IF;
  IF p_mode IS NOT NULL AND p_mode NOT IN ('open', 'closed', 'rule') THEN RAISE EXCEPTION 'La opción no es válida' USING ERRCODE = 'SV001'; END IF;

  IF p_mode = 'rule' THEN
    IF p_rule IS NULL OR jsonb_typeof(p_rule) <> 'object' THEN RAISE EXCEPTION 'Elegí la regla' USING ERRCODE = 'SV001'; END IF;
    t := p_rule ->> 'type';
    IF t IS NULL OR t NOT IN ('fixed_date', 'days_after_start', 'after_complete', 'challenge_started') THEN
      RAISE EXCEPTION 'Elegí cuándo se abre' USING ERRCODE = 'SV001';
    END IF;
    IF t = 'fixed_date' AND COALESCE(p_rule ->> 'date', '') !~ '^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'Elegí la fecha' USING ERRCODE = 'SV001'; END IF;
    IF t = 'fixed_date' THEN PERFORM (p_rule ->> 'date')::date; END IF;
    IF t = 'days_after_start' AND NOT (jsonb_typeof(p_rule -> 'days') = 'number' AND (p_rule ->> 'days')::numeric = trunc((p_rule ->> 'days')::numeric)
                                       AND (p_rule ->> 'days')::numeric BETWEEN 0 AND 3650) THEN
      RAISE EXCEPTION 'Los días tienen que ser de 0 a 3650' USING ERRCODE = 'SV001';
    END IF;
    IF t = 'after_complete' THEN
      IF NULLIF(p_rule ->> 'id', '') IS NULL THEN RAISE EXCEPTION 'Elegí qué hay que completar' USING ERRCODE = 'SV001'; END IF;
      IF COALESCE(p_rule ->> 'target', 'journey_item') NOT IN ('journey_item', 'program_item') THEN
        RAISE EXCEPTION 'Lo que hay que completar no es válido' USING ERRCODE = 'SV001';
      END IF;
      IF p_rule ->> 'target' = 'program_item' AND NOT EXISTS (
           SELECT 1 FROM app_servicio.program_items x WHERE x.id::text = p_rule ->> 'id' AND x.product_id = s.product_id) THEN
        RAISE EXCEPTION 'Lo que hay que completar no es de este programa' USING ERRCODE = 'SV001';
      END IF;
    END IF;
    IF COALESCE(p_rule ->> 'display', 'locked') NOT IN ('locked', 'coming_soon', 'hidden') THEN RAISE EXCEPTION '«Cómo se ve» no es válido' USING ERRCODE = 'SV001'; END IF;
    IF length(COALESCE(p_rule ->> 'locked_text', '')) > 80 OR length(COALESCE(p_rule ->> 'coming_soon_text', '')) > 80 THEN
      RAISE EXCEPTION 'El texto tiene hasta 80 caracteres' USING ERRCODE = 'SV001';
    END IF;
    -- Solo lo que entiende la regla (nada suelto).
    SELECT jsonb_object_agg(k, p_rule -> k) INTO v_rule
      FROM unnest(ARRAY['type', 'date', 'days', 'target', 'id', 'display', 'coming_soon_text', 'locked_text']) k
     WHERE p_rule ? k AND p_rule -> k <> 'null'::jsonb;
  END IF;

  SELECT override_mode INTO v_prev FROM app_servicio_portal.program_progress WHERE contact_id = s.contact_id AND program_item_id = it.id;

  IF p_mode IS NULL THEN
    UPDATE app_servicio_portal.program_progress
       SET override_mode = NULL, override_rule = NULL, override_by = NULL, override_at = NULL, updated_at = now()
     WHERE contact_id = s.contact_id AND program_item_id = it.id;
  ELSE
    INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, override_mode, override_rule, override_by, override_at)
    VALUES (s.workspace_id, s.contact_id, it.id, p_mode, v_rule, auth.uid(), now())
    ON CONFLICT (contact_id, program_item_id) DO UPDATE
      SET override_mode = EXCLUDED.override_mode, override_rule = EXCLUDED.override_rule,
          override_by = EXCLUDED.override_by, override_at = EXCLUDED.override_at, updated_at = now();
  END IF;

  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.module_override',
    jsonb_build_object('program_item_id', it.id, 'mode', p_mode, 'previous', v_prev, 'rule_type', v_rule ->> 'type'));
  RETURN app_servicio.program_item_unlocked(s.contact_id, it.id);
END;
$$;

REVOKE ALL ON FUNCTION app_servicio.svc_module_override(uuid, uuid, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_module_override(uuid, uuid, text, jsonb) TO authenticated, service_role;

-- ─── 6. Unir contactos: lo cambiado a mano viaja al principal ───────────────
CREATE OR REPLACE FUNCTION app_servicio.merge_contacts_hook(p_main uuid, p_duplicate uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_ws uuid;
  v_out jsonb := '{}'::jsonb;
  n integer;
  acc_main uuid;
  acc_dup uuid;
  dupe record;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.contacts WHERE id = p_main;
  -- Servicios: los dos quedan (si son del mismo producto y estan activos, se avisa).
  UPDATE app_servicio.services SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('services', n);
  FOR dupe IN SELECT product_id, count(*) c FROM app_servicio.services WHERE contact_id = p_main AND status IN ('active', 'paused') GROUP BY product_id HAVING count(*) > 1 LOOP
    PERFORM app_servicio.notify_admins(v_ws, 'svc_merge_two_services', 'Dos servicios del mismo producto',
      'Al unir dos contactos quedaron dos servicios activos del mismo producto. Revisá si hay que cancelar uno.', 'contact', p_main,
      jsonb_build_object('product_id', dupe.product_id));
  END LOOP;
  -- La cuenta del portal: si los dos tienen, queda la del principal; la otra se suspende y sus sesiones se revocan.
  SELECT id INTO acc_main FROM app_servicio_portal.portal_accounts WHERE contact_id = p_main;
  SELECT id INTO acc_dup FROM app_servicio_portal.portal_accounts WHERE contact_id = p_duplicate;
  IF acc_dup IS NOT NULL THEN
    IF acc_main IS NULL THEN
      UPDATE app_servicio_portal.portal_accounts SET contact_id = p_main, updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts', 1);
    ELSE
      UPDATE app_servicio_portal.portal_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE account_id = acc_dup;
      UPDATE app_servicio_portal.portal_accounts SET status = 'suspended', suspended_at = COALESCE(suspended_at, now()),
             suspended_reason = 'Se unió con otro contacto', updated_at = now() WHERE id = acc_dup;
      v_out := v_out || jsonb_build_object('portal_accounts_suspended', 1);
    END IF;
  END IF;
  UPDATE app_servicio_portal.portal_sessions SET preview_contact_id = p_main WHERE preview_contact_id = p_duplicate;
  UPDATE app_servicio_portal.portal_access SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('portal_access', n);
  -- Avance: si los dos vieron la misma clase, queda la fecha mas vieja.
  UPDATE app_servicio_portal.program_progress m
     SET viewed_at = LEAST(m.viewed_at, d.viewed_at), completed_at = LEAST(m.completed_at, d.completed_at),
         unlocked_at = LEAST(m.unlocked_at, d.unlocked_at), last_position_seconds = GREATEST(m.last_position_seconds, d.last_position_seconds),
         -- 00503: lo cambiado a mano en un módulo: queda el del principal; si no tiene, el del duplicado.
         override_mode = COALESCE(m.override_mode, d.override_mode),
         override_rule = CASE WHEN m.override_mode IS NULL THEN d.override_rule ELSE m.override_rule END,
         override_by = CASE WHEN m.override_mode IS NULL THEN d.override_by ELSE m.override_by END,
         override_at = CASE WHEN m.override_mode IS NULL THEN d.override_at ELSE m.override_at END,
         updated_at = now()
    FROM app_servicio_portal.program_progress d
   WHERE m.contact_id = p_main AND d.contact_id = p_duplicate AND d.program_item_id = m.program_item_id;
  DELETE FROM app_servicio_portal.program_progress d
   WHERE d.contact_id = p_duplicate AND EXISTS (SELECT 1 FROM app_servicio_portal.program_progress m WHERE m.contact_id = p_main AND m.program_item_id = d.program_item_id);
  UPDATE app_servicio_portal.program_progress SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('program_progress', n);
  -- Asistencia: una por sesion y fecha.
  DELETE FROM app_servicio_portal.live_attendance d
   WHERE d.contact_id = p_duplicate AND d.removed_at IS NULL
     AND EXISTS (SELECT 1 FROM app_servicio_portal.live_attendance m WHERE m.contact_id = p_main AND m.live_session_id = d.live_session_id
                   AND m.occurs_on = d.occurs_on AND m.removed_at IS NULL);
  UPDATE app_servicio_portal.live_attendance SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('live_attendance', n);
  UPDATE app_servicio.link_clicks SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('link_clicks', n);
  -- Comunidad: los posts pasan al principal; una reaccion repetida queda una.
  UPDATE app_servicio_portal.community_posts SET author_contact_id = p_main WHERE author_contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('community_posts', n);
  DELETE FROM app_servicio_portal.community_reactions d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.community_reactions m WHERE m.contact_id = p_main AND m.post_id = d.post_id AND m.kind = d.kind);
  UPDATE app_servicio_portal.community_reactions SET contact_id = p_main WHERE contact_id = p_duplicate;
  -- Las conversaciones con el tutor.
  UPDATE public.ai_threads SET contact_id = p_main, updated_at = now() WHERE contact_id = p_duplicate AND channel = 'portal';
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('ai_threads_portal', n);
  -- A3 (00378): los puntos. Si los dos sumaron por lo mismo en el mismo programa, queda la del principal.
  DELETE FROM app_servicio_portal.points_ledger d
   WHERE d.contact_id = p_duplicate
     AND EXISTS (SELECT 1 FROM app_servicio_portal.points_ledger m WHERE m.contact_id = p_main AND m.product_id = d.product_id AND m.source_key = d.source_key);
  UPDATE app_servicio_portal.points_ledger SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS n = ROW_COUNT; v_out := v_out || jsonb_build_object('points_ledger', n);
  -- La extension de proyectos (Corrida C), si existe.
  IF to_regprocedure('app_servicio_proyectos.merge_contacts_hook(uuid,uuid)') IS NOT NULL THEN
    EXECUTE 'SELECT app_servicio_proyectos.merge_contacts_hook($1, $2)' INTO dupe USING p_main, p_duplicate;
  END IF;
  RETURN v_out;
END;
$function$;
