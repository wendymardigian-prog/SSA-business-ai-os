-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00352_app_servicio_tutor  (Servicios v12, Corrida A1 · S15 · bloque IA)
-- ============================================================================
-- (El plano la numeraba 00348; la 00347 a la 00350 las ocuparon otras sesiones el 8/11.)
--
-- 1. CHECK de `agent_runs.source` y `agent_runs_agent_only_for_agent_sources` suman `portal_tutor` (D23), partiendo
--    de lo que esta EN LA BASE (leido el 8/11 con pg_get_constraintdef; las definiciones viejas, abajo).
-- 2. `products.tutor_agent_id` → agents (UNICO, F83): un tutor por programa, atado para siempre. Lo escribe solo
--    `program_ensure_tutor` / `program_duplicate_tutor` (guardia SV003 para la sesion). Y el `type` y el
--    `config.program_id` de un tutor no los cambia la sesion.
-- 3. Politica ADICIONAL `ai_threads_select_portal` (D24, F87): las conversaciones del canal `portal` las lee quien ve
--    el contacto. La de mensajes ya la cubre `ai_messages_select` (lee si ve el hilo).
-- 4. El tutor: `program_ensure_tutor`, `program_tutor_set_enabled`, `program_duplicate_tutor` (F84).
-- 5. Limites y creditos (F85): gemela `assistant_credits_plan(jsonb)` (lib/program/assistant.ts, assistant.cases.json),
--    `assistant_month_spend(contacto, agente)`, `assistant_credits(contacto, producto)`.
-- 6. Que puede usar el tutor (F83, F110): `tutor_knowledge_ids(contacto, producto)` (para un estudiante, solo las
--    clases que tiene abiertas, activas e incluidas en su variante; nunca evaluaciones, internos ni excluidos),
--    `tutor_knowledge_list`, excluir/incluir un material y sumar un documento de Conocimiento (`tutor.knowledge`).
-- 7. El uso del mes para el equipo (F86): `assistant_usage(producto)`; los montos solo con `ai_costs.view`.
--
-- Definiciones viejas (para volver atras):
--   agent_runs_source_check: CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text, 'sequence_ai_step'::text,
--     'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text, 'message_classification_eval'::text,
--     'content_copy'::text, 'ads_analysis'::text, 'audio_transcription'::text, 'media_description'::text,
--     'call_classification'::text, 'call_analysis'::text, 'call_correction'::text, 'call_summary'::text,
--     'call_prompt_test'::text, 'ads_matching'::text, 'designer'::text])))
--   agent_runs_agent_only_for_agent_sources: CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent'::text,
--     'conversation_summary'::text, 'content_copy'::text]))))
--
-- Cómo volver atrás:
--   ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_source_check, ADD CONSTRAINT agent_runs_source_check <la vieja>;
--   ALTER TABLE public.agent_runs DROP CONSTRAINT agent_runs_agent_only_for_agent_sources, ADD CONSTRAINT ... <la vieja>;
--     (aborta si ya hay corridas `portal_tutor`: borrarlas o dejarlas)
--   DROP POLICY IF EXISTS ai_threads_select_portal ON public.ai_threads;
--   DROP TRIGGER trg_app_servicio_tutor_guard ON public.products; DROP TRIGGER trg_app_servicio_tutor_agent_guard ON public.agents;
--   ALTER TABLE public.products DROP COLUMN IF EXISTS tutor_agent_id;
--   DROP FUNCTION de cada funcion nueva.
--
-- Riesgo: alto por los CHECK de agent_runs (tabla en uso): solo se SUMA un valor; todo lo que ya existe sigue valiendo.
-- ============================================================================

-- ─── 1. Origenes de corridas ────────────────────────────────────────────────
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text,
  'sequence_ai_step'::text, 'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text,
  'message_classification_eval'::text, 'content_copy'::text, 'ads_analysis'::text, 'audio_transcription'::text,
  'media_description'::text, 'call_classification'::text, 'call_analysis'::text, 'call_correction'::text, 'call_summary'::text,
  'call_prompt_test'::text, 'ads_matching'::text, 'designer'::text, 'portal_tutor'::text])));
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_only_for_agent_sources;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_only_for_agent_sources CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent'::text,
  'conversation_summary'::text, 'content_copy'::text, 'portal_tutor'::text]))));
CREATE INDEX IF NOT EXISTS idx_agent_runs_portal_tutor ON public.agent_runs (agent_id, contact_id, created_at) WHERE source = 'portal_tutor';

-- ─── 2. Un tutor por programa ───────────────────────────────────────────────
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS tutor_agent_id uuid NULL REFERENCES public.agents(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_products_tutor_agent ON public.products (tutor_agent_id) WHERE tutor_agent_id IS NOT NULL;

CREATE OR REPLACE FUNCTION app_servicio.tutor_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.tutor_agent_id := NULL;
  ELSIF NEW.tutor_agent_id IS DISTINCT FROM OLD.tutor_agent_id THEN
    RAISE EXCEPTION 'El tutor del programa se cambia desde sus pantallas' USING ERRCODE = 'SV003';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_tutor_guard ON public.products;
CREATE TRIGGER trg_app_servicio_tutor_guard BEFORE INSERT OR UPDATE OF tutor_agent_id ON public.products
  FOR EACH ROW EXECUTE FUNCTION app_servicio.tutor_guard();

CREATE OR REPLACE FUNCTION app_servicio.tutor_agent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.type = 'student_tutor' THEN
    RAISE EXCEPTION 'El tutor de un programa se crea al prender el Asistente IA del programa' USING ERRCODE = 'SV003';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.type = 'student_tutor' OR NEW.type = 'student_tutor')
     AND (NEW.type IS DISTINCT FROM OLD.type OR (NEW.config ->> 'program_id') IS DISTINCT FROM (OLD.config ->> 'program_id')) THEN
    RAISE EXCEPTION 'El programa de un tutor no se cambia' USING ERRCODE = 'SV003';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_tutor_agent_guard ON public.agents;
CREATE TRIGGER trg_app_servicio_tutor_agent_guard BEFORE INSERT OR UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION app_servicio.tutor_agent_guard();
REVOKE ALL ON FUNCTION app_servicio.tutor_guard(), app_servicio.tutor_agent_guard() FROM PUBLIC, anon, authenticated;

-- ─── 3. Conversaciones del canal portal ─────────────────────────────────────
DROP POLICY IF EXISTS ai_threads_select_portal ON public.ai_threads;
CREATE POLICY ai_threads_select_portal ON public.ai_threads FOR SELECT TO authenticated USING (
  channel = 'portal'
  AND (SELECT public.is_workspace_member(ai_threads.workspace_id))
  AND contact_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = ai_threads.contact_id AND public.can_see_contact(c)));

-- ─── 4. El tutor ────────────────────────────────────────────────────────────
-- Crea (o vuelve a prender) el tutor del programa y lo ata. Nace con el tope mensual en «avisar». Idempotente: dos
-- veces = uno. Lo llama SSA al prender el Asistente IA del programa (tutor.manage o portal.sections).
CREATE OR REPLACE FUNCTION app_servicio.program_ensure_tutor(p_product_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_id uuid;
BEGIN
  SELECT id, workspace_id, name, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'tutor.manage') OR public.has_permission(pr.workspace_id, 'portal.sections'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio.module_on(pr.workspace_id) THEN RAISE EXCEPTION 'El módulo de Servicios está apagado' USING ERRCODE = 'SV005'; END IF;
  IF pr.tutor_agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = pr.tutor_agent_id AND a.deleted_at IS NULL) THEN
    UPDATE public.agents SET is_enabled = true, updated_at = now() WHERE id = pr.tutor_agent_id AND NOT is_enabled;
    RETURN pr.tutor_agent_id;
  END IF;
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, knowledge_enabled, knowledge_tags, daily_cost_limit_action, monthly_cost_limit_action, config, created_by)
  VALUES (pr.workspace_id, left('Tutor · ' || pr.name, 80), 'student_tutor', true, true, ARRAY['programa:' || pr.id::text], 'notify', 'notify',
          jsonb_build_object('program_id', pr.id), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  UPDATE public.products SET tutor_agent_id = v_id WHERE id = pr.id;
  PERFORM app_servicio.audit(pr.workspace_id, 'product', pr.id, 'tutor.created', jsonb_build_object('agent_id', v_id));
  RETURN v_id;
END;
$$;

-- Apagar el Asistente IA del programa deja el tutor inactivo (no se borra).
CREATE OR REPLACE FUNCTION app_servicio.program_tutor_set_enabled(p_product_id uuid, p_enabled boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
BEGIN
  SELECT id, workspace_id, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'tutor.manage') OR public.has_permission(pr.workspace_id, 'portal.sections'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF p_enabled THEN RETURN app_servicio.program_ensure_tutor(p_product_id); END IF;
  IF pr.tutor_agent_id IS NOT NULL THEN
    UPDATE public.agents SET is_enabled = false, updated_at = now() WHERE id = pr.tutor_agent_id AND is_enabled;
  END IF;
  RETURN pr.tutor_agent_id;
END;
$$;

-- Duplicar un tutor a otro programa (F84). Si el destino ya tiene uno: con `p_replace` se archiva y se reemplaza; si no,
-- IA001. La copia lleva instrucciones, modelo, limites y los documentos GENERALES (no las transcripciones).
CREATE OR REPLACE FUNCTION app_servicio.program_duplicate_tutor(p_agent_id uuid, p_dest_product_id uuid, p_replace boolean DEFAULT false)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  src public.agents;
  dest record;
  v_id uuid;
BEGIN
  SELECT * INTO src FROM public.agents WHERE id = p_agent_id AND type = 'student_tutor' AND deleted_at IS NULL;
  IF src.id IS NULL THEN RAISE EXCEPTION 'Solo se duplica el tutor de un programa' USING ERRCODE = 'IA001'; END IF;
  SELECT id, workspace_id, name, tutor_agent_id INTO dest FROM public.products WHERE id = p_dest_product_id FOR UPDATE;
  IF dest.id IS NULL OR dest.workspace_id <> src.workspace_id THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() THEN PERFORM app_servicio.require_permission(src.workspace_id, 'tutor.manage'); END IF;
  IF (src.config ->> 'program_id') = dest.id::text THEN RAISE EXCEPTION 'Elegí otro programa' USING ERRCODE = 'IA001'; END IF;
  IF dest.tutor_agent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = dest.tutor_agent_id AND a.deleted_at IS NULL) THEN
    IF NOT p_replace THEN RAISE EXCEPTION 'Ese programa ya tiene tutor' USING ERRCODE = 'IA001'; END IF;
    UPDATE public.agents SET deleted_at = now(), is_enabled = false, updated_at = now() WHERE id = dest.tutor_agent_id;
    UPDATE public.products SET tutor_agent_id = NULL WHERE id = dest.id;
  END IF;
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt, provider, model, fallback_provider, fallback_model, temperature,
                             max_output_tokens, knowledge_enabled, knowledge_tags, knowledge_fallback, daily_cost_limit_usd, daily_cost_limit_action,
                             monthly_cost_limit_usd, monthly_cost_limit_action, guardrails, config, created_by)
  VALUES (src.workspace_id, left('Tutor · ' || dest.name, 80), 'student_tutor', src.is_enabled, src.system_prompt, src.provider, src.model,
          src.fallback_provider, src.fallback_model, src.temperature, src.max_output_tokens, true, ARRAY['programa:' || dest.id::text],
          src.knowledge_fallback, src.daily_cost_limit_usd, src.daily_cost_limit_action, src.monthly_cost_limit_usd, src.monthly_cost_limit_action,
          src.guardrails, jsonb_build_object('program_id', dest.id), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  UPDATE public.products SET tutor_agent_id = v_id WHERE id = dest.id;
  -- Los documentos generales del programa de origen (sin clase) tambien son del destino.
  UPDATE public.knowledge_base SET tags = array_append(tags, 'programa:' || dest.id::text), updated_at = now()
   WHERE workspace_id = src.workspace_id AND deleted_at IS NULL AND program_item_id IS NULL AND NOT internal_only
     AND tags @> ARRAY['programa:' || (src.config ->> 'program_id')] AND NOT (tags @> ARRAY['programa:' || dest.id::text]);
  PERFORM app_servicio.audit(src.workspace_id, 'product', dest.id, 'tutor.duplicated', jsonb_build_object('from_agent_id', src.id, 'agent_id', v_id, 'replaced', p_replace));
  RETURN v_id;
END;
$$;

-- ─── 5. Limites y creditos ──────────────────────────────────────────────────
-- Gemela de assistantCreditsPlan. Entrada: {own, variant, program, spentUsd, creditsPerUsd}.
CREATE OR REPLACE FUNCTION app_servicio.assistant_credits_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_limit numeric := 10;
  v_spent numeric := GREATEST(0, COALESCE((p ->> 'spentUsd')::numeric, 0));
  v_per numeric := GREATEST(0, COALESCE((p ->> 'creditsPerUsd')::numeric, 100));
  k text;
BEGIN
  FOREACH k IN ARRAY ARRAY['own', 'variant', 'program'] LOOP
    IF jsonb_typeof(p -> k) = 'number' AND (p ->> k)::numeric >= 0 THEN v_limit := (p ->> k)::numeric; EXIT; END IF;
  END LOOP;
  RETURN jsonb_build_object('limitUsd', v_limit,
    'credits', GREATEST(0, floor(GREATEST(0, v_limit - v_spent) * v_per + 0.000000001))::bigint,
    'reached', v_spent >= v_limit);
END;
$$;

-- Lo que gasto el estudiante con ese tutor en el mes del negocio.
CREATE OR REPLACE FUNCTION app_servicio.assistant_month_spend(p_contact_id uuid, p_agent_id uuid)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(sum(r.cost_usd), 0)::numeric
    FROM public.agent_runs r
    JOIN public.agents a ON a.id = r.agent_id
   WHERE r.agent_id = p_agent_id AND r.contact_id = p_contact_id AND r.source = 'portal_tutor'
     AND r.created_at >= (date_trunc('month', now() AT TIME ZONE app_servicio.ws_tz(a.workspace_id)) AT TIME ZONE app_servicio.ws_tz(a.workspace_id));
$$;

-- {limitUsd, credits, reached, spentUsd} de un estudiante en un programa.
CREATE OR REPLACE FUNCTION app_servicio.assistant_credits_detail(p_contact_id uuid, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_own numeric;
  v_variant numeric;
  v_spent numeric := 0;
BEGIN
  SELECT id, tutor_agent_id, portal_settings INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  SELECT a.ai_monthly_limit_usd INTO v_own FROM app_servicio_portal.portal_access a
   WHERE a.contact_id = p_contact_id AND a.product_id = p_product_id AND a.section = 'assistant' AND a.revoked_at IS NULL
     AND a.ai_monthly_limit_usd IS NOT NULL ORDER BY a.created_at DESC LIMIT 1;
  SELECT (app_servicio.portal_section_rule(s.product_variant_id, 'assistant') ->> 'ai_limit_usd')::numeric INTO v_variant
    FROM app_servicio.services s WHERE s.contact_id = p_contact_id AND s.product_id = p_product_id AND s.status IN ('active', 'paused')
   ORDER BY s.created_at DESC LIMIT 1;
  IF pr.tutor_agent_id IS NOT NULL THEN v_spent := app_servicio.assistant_month_spend(p_contact_id, pr.tutor_agent_id); END IF;
  RETURN app_servicio.assistant_credits_plan(jsonb_build_object('own', v_own, 'variant', v_variant,
           'program', pr.portal_settings #> '{assistant,monthly_limit_usd_per_student}', 'spentUsd', v_spent,
           'creditsPerUsd', pr.portal_settings #> '{assistant,credits_per_usd}')) || jsonb_build_object('spentUsd', v_spent);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.assistant_credits(p_contact_id uuid, p_product_id uuid)
RETURNS bigint LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((app_servicio.assistant_credits_detail(p_contact_id, p_product_id) ->> 'credits')::bigint, 0);
$$;

-- ─── 6. Que puede usar el tutor ─────────────────────────────────────────────
-- Los documentos de Conocimiento que puede devolver la busqueda del tutor. Con `p_contact_id`, para ESE estudiante:
-- de las clases, solo las que tiene abiertas (program_item_unlocked: activas, incluidas en su variante, abiertas).
-- Sin estudiante, lo del programa (la lista del equipo). Nunca internos, excluidos, borrados ni evaluaciones.
CREATE OR REPLACE FUNCTION app_servicio.tutor_knowledge_ids(p_contact_id uuid, p_product_id uuid)
RETURNS TABLE (knowledge_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH pr AS (
    SELECT id, workspace_id, COALESCE(portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb) AS excluded FROM public.products WHERE id = p_product_id
  )
  SELECT k.id
    FROM pr JOIN public.knowledge_base k ON k.workspace_id = pr.workspace_id
    LEFT JOIN app_servicio.program_items i ON i.id = k.program_item_id
   WHERE k.deleted_at IS NULL AND NOT k.internal_only AND k.tags @> ARRAY['programa:' || pr.id::text]
     AND NOT (pr.excluded ? k.id::text)
     AND (k.program_item_id IS NULL OR (
           i.product_id = pr.id AND i.status = 'active' AND COALESCE(i.lesson_type, '') <> 'quiz'
           AND (p_contact_id IS NULL OR COALESCE((app_servicio.program_item_unlocked(p_contact_id, i.id) ->> 'unlocked')::boolean, false))));
$$;

-- La tarjeta «Base de conocimiento» (F110): cada clase (con su tipo y si el tutor la tiene) y los documentos propios.
-- Las evaluaciones nunca aparecen.
CREATE OR REPLACE FUNCTION app_servicio.tutor_knowledge_list(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_excluded jsonb;
BEGIN
  SELECT workspace_id, COALESCE(portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb) INTO v_ws, v_excluded FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws) AND (public.has_permission(v_ws, 'tutor.knowledge') OR public.has_permission(v_ws, 'tutor.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  RETURN jsonb_build_object(
    'lessons', COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'item_id', i.id, 'title', i.title, 'lesson_type', i.lesson_type, 'status', i.status, 'thumbnail_url', i.thumbnail_url,
        'knowledge_id', k.id, 'knowledge_status', k.status, 'excluded', k.id IS NOT NULL AND v_excluded ? k.id::text) ORDER BY i.position, i.created_at)
      FROM app_servicio.program_items i
      LEFT JOIN LATERAL (SELECT kb.id, kb.status FROM public.knowledge_base kb WHERE kb.program_item_id = i.id AND kb.deleted_at IS NULL ORDER BY kb.created_at DESC LIMIT 1) k ON true
     WHERE i.product_id = p_product_id AND i.kind = 'lesson' AND i.status <> 'archived' AND COALESCE(i.lesson_type, '') <> 'quiz'), '[]'::jsonb),
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('knowledge_id', k.id, 'title', k.title, 'status', k.status, 'excluded', v_excluded ? k.id::text,
        'filename', k.source_filename) ORDER BY k.created_at DESC)
      FROM public.knowledge_base k WHERE k.workspace_id = v_ws AND k.deleted_at IS NULL AND k.program_item_id IS NULL AND NOT k.internal_only
        AND k.tags @> ARRAY['programa:' || p_product_id::text]), '[]'::jsonb));
END;
$$;

-- «Lo usa el tutor»: excluir o volver a incluir un material (queda en assistant.excluded_kb_ids; no se borra).
CREATE OR REPLACE FUNCTION app_servicio.tutor_set_excluded(p_product_id uuid, p_knowledge_id uuid, p_excluded boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_list jsonb;
BEGIN
  SELECT id, workspace_id, portal_settings INTO pr FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(pr.workspace_id, 'tutor.knowledge');
  IF NOT EXISTS (SELECT 1 FROM public.knowledge_base k WHERE k.id = p_knowledge_id AND k.workspace_id = pr.workspace_id) THEN
    RAISE EXCEPTION 'No existe ese material' USING ERRCODE = 'SV002';
  END IF;
  v_list := COALESCE((SELECT jsonb_agg(x) FROM jsonb_array_elements(COALESCE(pr.portal_settings #> '{assistant,excluded_kb_ids}', '[]'::jsonb)) x
                       WHERE x #>> '{}' <> p_knowledge_id::text), '[]'::jsonb);
  IF p_excluded THEN v_list := v_list || to_jsonb(p_knowledge_id::text); END IF;
  UPDATE public.products
     SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{assistant}', COALESCE(portal_settings -> 'assistant', '{}'::jsonb) || jsonb_build_object('excluded_kb_ids', v_list)),
         portal_settings_rev = portal_settings_rev + 1
   WHERE id = pr.id;
  PERFORM app_servicio.audit(pr.workspace_id, 'product', pr.id, CASE WHEN p_excluded THEN 'tutor.material_excluded' ELSE 'tutor.material_included' END,
    jsonb_build_object('knowledge_id', p_knowledge_id));
END;
$$;

-- «Agregar desde Conocimiento»: un documento del negocio (nunca uno interno) pasa a ser del programa.
CREATE OR REPLACE FUNCTION app_servicio.tutor_add_document(p_product_id uuid, p_knowledge_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  PERFORM app_servicio.require_permission(v_ws, 'tutor.knowledge');
  UPDATE public.knowledge_base SET tags = array_append(tags, 'programa:' || p_product_id::text), updated_at = now()
   WHERE id = p_knowledge_id AND workspace_id = v_ws AND deleted_at IS NULL AND NOT internal_only AND program_item_id IS NULL
     AND NOT (tags @> ARRAY['programa:' || p_product_id::text]);
  IF NOT FOUND AND NOT EXISTS (SELECT 1 FROM public.knowledge_base WHERE id = p_knowledge_id AND workspace_id = v_ws AND tags @> ARRAY['programa:' || p_product_id::text]) THEN
    RAISE EXCEPTION 'Ese documento no se puede sumar (es interno o no existe)' USING ERRCODE = 'IA001';
  END IF;
END;
$$;

-- ─── 7. El uso del mes (F86) ────────────────────────────────────────────────
-- Estudiantes que lo usaron, gasto (solo con ai_costs.view), quiénes llegaron al límite y los límites propios.
CREATE OR REPLACE FUNCTION app_servicio.assistant_usage(p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_money boolean;
BEGIN
  SELECT id, workspace_id, tutor_agent_id INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL THEN RETURN NULL; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'services.view') OR public.has_permission(pr.workspace_id, 'tutor.manage'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  v_money := app_servicio.is_system() OR public.has_permission(pr.workspace_id, 'ai_costs.view');
  RETURN jsonb_build_object(
    'agent_id', pr.tutor_agent_id,
    'students', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', u.contact_id, 'name', c.display_name,
        'spent_usd', CASE WHEN v_money THEN u.spent END, 'reached', COALESCE((d.detail ->> 'reached')::boolean, false),
        'limit_usd', CASE WHEN v_money THEN (d.detail ->> 'limitUsd')::numeric END) ORDER BY u.spent DESC)
      FROM (SELECT r.contact_id, sum(r.cost_usd) AS spent FROM public.agent_runs r
             WHERE pr.tutor_agent_id IS NOT NULL AND r.agent_id = pr.tutor_agent_id AND r.source = 'portal_tutor' AND r.contact_id IS NOT NULL
               AND r.created_at >= (date_trunc('month', now() AT TIME ZONE app_servicio.ws_tz(pr.workspace_id)) AT TIME ZONE app_servicio.ws_tz(pr.workspace_id))
             GROUP BY r.contact_id) u
      JOIN public.contacts c ON c.id = u.contact_id
      CROSS JOIN LATERAL (SELECT app_servicio.assistant_credits_detail(u.contact_id, pr.id) AS detail) d), '[]'::jsonb),
    'own_limits', COALESCE((SELECT jsonb_agg(jsonb_build_object('contact_id', a.contact_id, 'name', c.display_name, 'limit_usd', CASE WHEN v_money THEN a.ai_monthly_limit_usd END))
      FROM app_servicio_portal.portal_access a JOIN public.contacts c ON c.id = a.contact_id
     WHERE a.product_id = pr.id AND a.section = 'assistant' AND a.revoked_at IS NULL AND a.ai_monthly_limit_usd IS NOT NULL), '[]'::jsonb),
    'money', v_money);
END;
$$;

-- ─── Permisos de ejecucion ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.program_ensure_tutor(uuid), app_servicio.program_tutor_set_enabled(uuid, boolean), app_servicio.program_duplicate_tutor(uuid, uuid, boolean),
  app_servicio.assistant_credits_plan(jsonb), app_servicio.assistant_month_spend(uuid, uuid), app_servicio.assistant_credits_detail(uuid, uuid),
  app_servicio.assistant_credits(uuid, uuid), app_servicio.tutor_knowledge_ids(uuid, uuid), app_servicio.tutor_knowledge_list(uuid),
  app_servicio.tutor_set_excluded(uuid, uuid, boolean), app_servicio.tutor_add_document(uuid, uuid), app_servicio.assistant_usage(uuid)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.program_ensure_tutor(uuid), app_servicio.program_tutor_set_enabled(uuid, boolean), app_servicio.program_duplicate_tutor(uuid, uuid, boolean),
  app_servicio.assistant_credits_plan(jsonb), app_servicio.assistant_month_spend(uuid, uuid), app_servicio.assistant_credits_detail(uuid, uuid),
  app_servicio.assistant_credits(uuid, uuid), app_servicio.tutor_knowledge_ids(uuid, uuid), app_servicio.tutor_knowledge_list(uuid),
  app_servicio.tutor_set_excluded(uuid, uuid, boolean), app_servicio.tutor_add_document(uuid, uuid), app_servicio.assistant_usage(uuid)
TO service_role;
GRANT EXECUTE ON FUNCTION
  app_servicio.program_ensure_tutor(uuid), app_servicio.program_tutor_set_enabled(uuid, boolean), app_servicio.program_duplicate_tutor(uuid, uuid, boolean),
  app_servicio.tutor_knowledge_list(uuid), app_servicio.tutor_set_excluded(uuid, uuid, boolean), app_servicio.tutor_add_document(uuid, uuid),
  app_servicio.assistant_usage(uuid)
TO authenticated;
