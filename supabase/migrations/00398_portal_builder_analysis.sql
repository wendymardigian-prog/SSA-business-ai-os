-- @plantilla-quitar(proyectos)
-- ============================================================================
-- 00398_portal_builder_analysis  (Corrida C · C5: el análisis con IA, F236 y P11)
-- ============================================================================
-- Los pasos que la Mesa de trabajo marca «con análisis» se analizan con el revisor del programa (F119). Qué mira cada
-- análisis son las instrucciones del paso (datos del equipo, versionadas); la salida es un JSON con esquema fijo que
-- se valida antes de guardar. El gasto sale del MISMO límite mensual del tutor (F85), mostrado en créditos.
--
--  1. assistant_credits_detail suma lo que gastaron el tutor Y el revisor del programa ese mes (antes, solo el tutor).
--  2. portal_credits(session, product): los créditos del mes para la pantalla (nunca dólares).
--  3. Servidor de SSA (service_role):
--       portal_builder_analyze_begin(session, project, step)  valida acceso (vencido: PO410), que el paso tenga
--         análisis, que haya documento, que no sea una llamada simulada, créditos (PO402), uno por paso a la vez
--         (PO409), el revisor prendido y un tope por hora; marca el análisis en curso y devuelve lo necesario.
--       portal_builder_analyze_finish(project, step, run, of, result, credits)  valida el esquema y lo guarda debajo
--         del documento, con la versión que analizó (se guardan los últimos 10).
--       portal_builder_analyze_fail(project, step)  libera el paso. Un análisis fallido no se cobra: la corrida se
--         cierra sin uso (lo hace el servidor).
--
-- Volver atrás: assistant_credits_detail de la 00352; DROP FUNCTION de las 4 nuevas.
-- ============================================================================

CREATE OR REPLACE FUNCTION app_servicio.assistant_credits_detail(p_contact_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_own numeric;
  v_variant numeric;
  v_spent numeric := 0;
  v_reviewer uuid;
BEGIN
  SELECT id, workspace_id, tutor_agent_id, portal_settings INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  SELECT a.ai_monthly_limit_usd INTO v_own FROM app_servicio_portal.portal_access a
   WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'assistant' AND a.revoked_at IS NULL
     AND a.ai_monthly_limit_usd IS NOT NULL ORDER BY a.created_at DESC LIMIT 1;
  SELECT (app_servicio.portal_section_rule(s.product_variant_id, 'assistant') ->> 'ai_limit_usd')::numeric INTO v_variant
    FROM app_servicio.services s WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused')
   ORDER BY s.created_at DESC LIMIT 1;
  IF pr.tutor_agent_id IS NOT NULL THEN v_spent := app_servicio.assistant_month_spend(p_contact_id, pr.tutor_agent_id); END IF;
  -- Corrida C (F119): el revisor de proyectos gasta del mismo límite.
  v_reviewer := NULLIF(pr.portal_settings #>> '{projects,reviewer_agent_id}', '')::uuid;
  IF v_reviewer IS NOT NULL THEN
    v_spent := v_spent + COALESCE((SELECT sum(r.cost_usd) FROM public.agent_runs r
      WHERE r.agent_id = v_reviewer AND r.contact_id = p_contact_id AND r.source = 'portal_project_review'
        AND r.created_at >= (date_trunc('month', now() AT TIME ZONE app_servicio.ws_tz(pr.workspace_id)) AT TIME ZONE app_servicio.ws_tz(pr.workspace_id))), 0);
  END IF;
  RETURN app_servicio.assistant_credits_plan(jsonb_build_object('own', v_own, 'variant', v_variant,
           'program', pr.portal_settings #> '{assistant,monthly_limit_usd_per_student}', 'spentUsd', v_spent,
           'creditsPerUsd', pr.portal_settings #> '{assistant,credits_per_usd}')) || jsonb_build_object('spentUsd', v_spent);
END;
$$;

-- Los créditos del mes, para la pantalla del análisis.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_credits(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session, false);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_detail jsonb := app_servicio.assistant_credits_detail((pf ->> 'contact_id')::uuid, p_product_id);
  v_per numeric := GREATEST(0, COALESCE((SELECT (portal_settings #>> '{assistant,credits_per_usd}')::numeric FROM public.products WHERE id = p_product_id), 100));
BEGIN
  RETURN jsonb_build_object('left', COALESCE((v_detail ->> 'credits')::bigint, 0),
                            'limit', floor(COALESCE((v_detail ->> 'limitUsd')::numeric, 0) * v_per + 0.000000001)::bigint,
                            'per_usd', v_per,
                            'name', COALESCE(NULLIF(btrim((SELECT portal_settings #>> '{assistant,credits_name}' FROM public.products WHERE id = p_product_id)), ''), 'créditos'));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_builder_analyze_begin(p_session text, p_project_id uuid, p_step text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_step jsonb;
  v_doc jsonb;
  v_started timestamptz;
  v_reviewer uuid;
  v_steps jsonb;
  v_prompt jsonb;
BEGIN
  SELECT s INTO v_step FROM public.products p, jsonb_array_elements(COALESCE(p.portal_settings #> '{projects,steps}', '[]'::jsonb)) s
   WHERE p.id = pj.product_id AND s ->> 'key' = p_step;
  IF v_step IS NULL OR jsonb_typeof(v_step -> 'analysis') IS DISTINCT FROM 'object' THEN PERFORM app_servicio_portal.err('PO404', 'Este paso no tiene análisis'); END IF;
  IF pj.kind = 'practice' AND p_step = 'llamada' THEN PERFORM app_servicio_portal.err('PO400', 'Las llamadas simuladas no se analizan'); END IF;
  v_doc := pj.builder #> ARRAY['steps', p_step, 'versions', '-1'];
  IF v_doc IS NULL OR jsonb_typeof(v_doc) <> 'object' THEN PERFORM app_servicio_portal.err('PO400', 'Pegá el documento primero'); END IF;
  v_started := NULLIF(pj.builder #>> ARRAY['steps', p_step, 'analysis_started_at'], '')::timestamptz;
  IF v_started IS NOT NULL AND v_started > now() - interval '3 minutes' THEN PERFORM app_servicio_portal.err('PO409', 'Ya hay un análisis de este paso en curso'); END IF;
  IF COALESCE((app_servicio.assistant_credits_detail(pj.contact_id, pj.product_id) ->> 'credits')::bigint, 0) <= 0 THEN
    PERFORM app_servicio_portal.err('PO402', 'Llegaste a tu límite de este mes');
  END IF;
  v_reviewer := NULLIF((SELECT portal_settings #>> '{projects,reviewer_agent_id}' FROM public.products WHERE id = pj.product_id), '')::uuid;
  IF v_reviewer IS NULL OR NOT EXISTS (SELECT 1 FROM public.agents a WHERE a.id = v_reviewer AND a.is_enabled AND a.deleted_at IS NULL AND a.type = 'project_reviewer') THEN
    PERFORM app_servicio_portal.err('PO403', 'El análisis no está disponible ahora');
  END IF;
  IF public.bump_rate_limit('portal-review:' || pj.contact_id::text, date_trunc('hour', now())) > 20 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá un rato y volvé a analizar');
  END IF;
  UPDATE app_servicio_proyectos.student_projects
     SET builder = jsonb_set(jsonb_set(builder, '{steps}', COALESCE(builder -> 'steps', '{}'::jsonb)), ARRAY['steps', p_step],
                             COALESCE(builder #> ARRAY['steps', p_step], '{}'::jsonb) || jsonb_build_object('analysis_started_at', now()))
   WHERE id = pj.id;
  v_steps := app_servicio_portal.proj_steps(pj.product_id);
  RETURN jsonb_build_object(
    'workspace_id', pj.workspace_id, 'contact_id', pj.contact_id, 'product_id', pj.product_id, 'agent_id', v_reviewer,
    'step', jsonb_build_object('key', p_step, 'name', v_step ->> 'name'),
    'instructions', v_step -> 'analysis',
    'document', v_doc,
    'project', jsonb_build_object('kind', pj.kind, 'title', pj.title, 'description', pj.description),
    'fields', COALESCE(pj.builder #> ARRAY['steps', p_step, 'fields'], '{}'::jsonb),
    'depends', COALESCE((SELECT jsonb_agg(jsonb_build_object('step', d #>> '{}', 'name', (SELECT s ->> 'name' FROM jsonb_array_elements(v_steps) s WHERE s ->> 'key' = d #>> '{}'),
                 'version', pj.builder #> ARRAY['steps', d #>> '{}', 'versions', '-1']) ORDER BY o)
       FROM jsonb_array_elements(COALESCE(v_step -> 'depends_on', '[]'::jsonb)) WITH ORDINALITY x(d, o)), '[]'::jsonb));
END;
$$;

-- El esquema fijo del resultado (F236). null = válido; si no, el problema.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.analysis_problem(r jsonb)
RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  c jsonb;
BEGIN
  IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RETURN 'no es un objeto'; END IF;
  IF jsonb_typeof(r -> 'summary') IS DISTINCT FROM 'string' OR char_length(r ->> 'summary') NOT BETWEEN 1 AND 800 THEN RETURN 'summary'; END IF;
  IF jsonb_typeof(r -> 'criteria') IS DISTINCT FROM 'array' OR jsonb_array_length(r -> 'criteria') NOT BETWEEN 1 AND 20 THEN RETURN 'criteria'; END IF;
  FOR c IN SELECT x FROM jsonb_array_elements(r -> 'criteria') x LOOP
    IF jsonb_typeof(c) <> 'object' OR jsonb_typeof(c -> 'name') IS DISTINCT FROM 'string' OR char_length(c ->> 'name') NOT BETWEEN 1 AND 160
       OR NOT COALESCE(c ->> 'status' = ANY (ARRAY['ok', 'improve', 'missing']), false)
       OR jsonb_typeof(c -> 'evidence') IS DISTINCT FROM 'string' OR char_length(c ->> 'evidence') > 1000 THEN
      RETURN 'criteria.item';
    END IF;
  END LOOP;
  IF jsonb_typeof(r -> 'top3') IS DISTINCT FROM 'array' OR jsonb_array_length(r -> 'top3') > 3
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'top3') x WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') NOT BETWEEN 1 AND 600) THEN
    RETURN 'top3';
  END IF;
  IF r ? 'follow_up' AND (jsonb_typeof(r -> 'follow_up') <> 'array' OR jsonb_array_length(r -> 'follow_up') > 10
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(r -> 'follow_up') x WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') NOT BETWEEN 1 AND 600)) THEN
    RETURN 'follow_up';
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_builder_analyze_finish(p_project_id uuid, p_step text, p_run_id uuid, p_of integer, p_result jsonb, p_credits integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pj app_servicio_proyectos.student_projects;
  v_problem text := app_servicio_proyectos.analysis_problem(p_result);
  v_list jsonb;
  v_rec jsonb;
BEGIN
  SELECT * INTO pj FROM app_servicio_proyectos.student_projects WHERE id = p_project_id;
  IF pj.id IS NULL THEN RAISE EXCEPTION 'No existe el proyecto' USING ERRCODE = 'SV002'; END IF;
  IF v_problem IS NOT NULL THEN RAISE EXCEPTION 'El análisis no cumple el formato (%)', v_problem USING ERRCODE = 'SV001'; END IF;
  v_rec := jsonb_build_object('of', p_of, 'at', now(), 'run_id', p_run_id, 'credits', GREATEST(COALESCE(p_credits, 0), 0),
                              'result', jsonb_build_object('summary', p_result -> 'summary', 'criteria', p_result -> 'criteria', 'top3', p_result -> 'top3',
                                                           'follow_up', COALESCE(p_result -> 'follow_up', '[]'::jsonb)));
  v_list := COALESCE(pj.builder #> ARRAY['steps', p_step, 'analyses'], '[]'::jsonb) || jsonb_build_array(v_rec);
  IF jsonb_array_length(v_list) > 10 THEN
    v_list := (SELECT jsonb_agg(x ORDER BY o) FROM jsonb_array_elements(v_list) WITH ORDINALITY t(x, o) WHERE o > jsonb_array_length(v_list) - 10);
  END IF;
  UPDATE app_servicio_proyectos.student_projects
     SET builder = jsonb_set(builder, ARRAY['steps', p_step], (COALESCE(builder #> ARRAY['steps', p_step], '{}'::jsonb) - 'analysis_started_at') || jsonb_build_object('analyses', v_list))
   WHERE id = pj.id;
  RETURN v_rec;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_builder_analyze_fail(p_project_id uuid, p_step text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE app_servicio_proyectos.student_projects
     SET builder = jsonb_set(builder, ARRAY['steps', p_step], COALESCE(builder #> ARRAY['steps', p_step], '{}'::jsonb) - 'analysis_started_at')
   WHERE id = p_project_id AND builder #> ARRAY['steps', p_step] IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION app_servicio_proyectos.analysis_problem(jsonb) FROM PUBLIC, anon, authenticated, portal_app;
REVOKE ALL ON FUNCTION app_servicio_portal.portal_credits(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION app_servicio_portal.portal_credits(text, uuid) TO portal_app, service_role;
REVOKE ALL ON FUNCTION app_servicio.portal_builder_analyze_begin(text, uuid, text), app_servicio.portal_builder_analyze_finish(uuid, text, uuid, integer, jsonb, integer),
  app_servicio.portal_builder_analyze_fail(uuid, text)
  FROM PUBLIC, anon, authenticated, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.portal_builder_analyze_begin(text, uuid, text), app_servicio.portal_builder_analyze_finish(uuid, text, uuid, integer, jsonb, integer),
  app_servicio.portal_builder_analyze_fail(uuid, text)
  TO service_role;
