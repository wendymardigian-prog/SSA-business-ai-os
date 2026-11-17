-- @plantilla-quitar(proyectos)
-- ============================================================================
-- 00397_portal_projects  (Corrida C · C3: lo que usa el portal, P10 · F232–F235, F237–F242)
-- ============================================================================
-- El portal no genera documentos: arma el prompt de cada paso (con las instrucciones del equipo, los datos del
-- proyecto y los documentos anteriores) y guarda lo que el estudiante pega, con versiones. Los textos viven en el
-- bucket privado `student-projects`; la fila guarda solo la ruta, el origen, el tamaño y la huella (nunca el texto).
--
-- Acceso (F242): la sección `projects` abierta = todo; vencida = solo lectura (escribir, copiar el prompt y analizar
-- dan PO410 «Renová para usarlo»); si no, PO403. La Facturación vale con `projects` o con `fame` abierta.
--
-- Portal (rol portal_app):
--   portal_projects, portal_project_get, portal_project_create, portal_project_update, portal_project_archive,
--   portal_ideas_draw, portal_builder_step_save, portal_builder_version_add, portal_builder_save (links · roadmap ·
--   build), portal_revenue, portal_revenue_report, portal_revenue_attach_receipt.
-- Servidor de SSA (service_role):
--   app_servicio.portal_project_file_grant  dónde subir o qué bajar (documento del paso, comprobante).
--   app_servicio.portal_builder_prompt_parts  todo lo que hace falta para armar el prompt (el panel lee los textos).
--   app_servicio.projects_set_enabled  prender Mis proyectos crea el revisor (F119); apagarlo lo deja inactivo.
-- Envoltorios (la función original queda con otro nombre y la nueva la llama):
--   portal_context suma las secciones `proyectos` y `fama` con la extensión prendida.
--   portal_fame suma la facturación (Sala de la fama) con la extensión prendida.
--
-- Volver atrás: DROP de las funciones nuevas; DROP FUNCTION app_servicio_portal.portal_context(text, text, uuid) y
--   ALTER FUNCTION app_servicio_portal.ctx_context_base(text, text, uuid) RENAME TO portal_context (y su GRANT a
--   portal_app); portal_fame de la 00390.
-- ============================================================================

-- ─── Acceso ─────────────────────────────────────────────────────────────────
-- p_section: 'projects' o 'revenue' (projects o fame). p_write: si escribe. Devuelve pf + {readonly}.
CREATE OR REPLACE FUNCTION app_servicio_portal.proj_access(p_sess jsonb, p_product uuid, p_section text, p_write boolean)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pf jsonb := app_servicio_portal.program_for(p_sess, p_product, true);
  v jsonb;
  s text;
  v_expired boolean := false;
BEGIN
  IF NOT app_servicio_proyectos.enabled((pf ->> 'workspace_id')::uuid) THEN PERFORM app_servicio_portal.err('PO403', 'Esta sección no está abierta'); END IF;
  FOREACH s IN ARRAY CASE WHEN p_section = 'revenue' THEN ARRAY['projects', 'fame'] ELSE ARRAY['projects'] END LOOP
    v := app_servicio_portal.ctx_section((pf ->> 'contact_id')::uuid, p_product, (pf ->> 'variant_id')::uuid, s, (pf ->> 'starts_on')::date);
    IF v ->> 'display' = 'open' THEN
      IF p_write AND p_sess ->> 'kind' <> 'student' THEN PERFORM app_servicio_portal.err('PO403', 'En la vista previa no se puede cambiar nada'); END IF;
      RETURN pf || jsonb_build_object('readonly', p_sess ->> 'kind' <> 'student');
    END IF;
    IF COALESCE((v ->> 'expired')::boolean, false) THEN v_expired := true; END IF;
  END LOOP;
  IF v_expired THEN
    IF p_write THEN PERFORM app_servicio_portal.err('PO410', 'Renová para usarlo'); END IF;
    RETURN pf || jsonb_build_object('readonly', true);
  END IF;
  PERFORM app_servicio_portal.err('PO403', COALESCE(v ->> 'reason', 'Esta sección no está abierta'));
  RETURN NULL;
END;
$$;

-- Un proyecto propio (no archivado).
CREATE OR REPLACE FUNCTION app_servicio_portal.own_project(p_sess jsonb, p_project_id uuid)
RETURNS app_servicio_proyectos.student_projects LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pj app_servicio_proyectos.student_projects;
BEGIN
  SELECT * INTO pj FROM app_servicio_proyectos.student_projects
   WHERE id = p_project_id AND workspace_id = (p_sess ->> 'workspace_id')::uuid AND contact_id = (p_sess ->> 'contact_id')::uuid AND archived_at IS NULL;
  IF pj.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos ese proyecto'); END IF;
  RETURN pj;
END;
$$;

-- Los pasos del método del programa (la Mesa de trabajo), sin las instrucciones (esas solo van en el prompt).
CREATE OR REPLACE FUNCTION app_servicio_portal.proj_steps(p_product uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT jsonb_agg(jsonb_build_object('key', s ->> 'key', 'name', s ->> 'name', 'description', s ->> 'description',
            'depends_on', COALESCE(s -> 'depends_on', '[]'::jsonb), 'has_prompt', COALESCE(jsonb_typeof(s -> 'prompt') = 'object', false),
            'has_analysis', COALESCE(jsonb_typeof(s -> 'analysis') = 'object', false), 'tasks', COALESCE(s -> 'tasks', '[]'::jsonb),
            'lesson_item_id', s -> 'lesson_item_id', 'fields', COALESCE(s -> 'fields', '[]'::jsonb)) ORDER BY o)
     FROM public.products p, jsonb_array_elements(COALESCE(p.portal_settings #> '{projects,steps}', '[]'::jsonb)) WITH ORDINALITY x(s, o)
    WHERE p.id = p_product), '[]'::jsonb);
$$;

-- La forma de cada parte del builder. Nada de textos largos: los documentos van en el bucket.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.builder_part_problems(p_part text, v jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  o text[] := ARRAY[]::text[];
  x jsonb; st jsonb; ph jsonb; bl jsonb;
  states text[] := ARRAY['pending', 'building', 'review', 'done'];
BEGIN
  IF v IS NULL THEN RETURN ARRAY['falta lo que querés guardar']; END IF;
  IF p_part = 'links' THEN
    IF jsonb_typeof(v) <> 'array' OR jsonb_array_length(v) > 30 THEN RETURN ARRAY['los links tienen que ser una lista de hasta 30']; END IF;
    FOR x IN SELECT e FROM jsonb_array_elements(v) e LOOP
      IF jsonb_typeof(x) <> 'object' OR NOT COALESCE(x ->> 'type' = ANY (ARRAY['flows', 'design']), false)
         OR char_length(btrim(COALESCE(x ->> 'name', ''))) NOT BETWEEN 1 AND 120 OR char_length(COALESCE(x ->> 'note', '')) > 500 THEN
        o := o || 'cada link lleva tipo y nombre'::text;
      ELSIF COALESCE(x ->> 'url', '') !~ '^https://[^\s]+$' OR char_length(x ->> 'url') > 2000 THEN
        o := o || format('el link «%s» tiene que empezar con https://', x ->> 'name');
      END IF;
    END LOOP;
  ELSIF p_part = 'build' THEN
    IF jsonb_typeof(v) <> 'object' THEN RETURN ARRAY['la construcción no es válida']; END IF;
    o := o || app_servicio.unknown_keys(v, ARRAY['tool', 'repo_url', 'app_url', 'target']);
    IF v ? 'tool' AND jsonb_typeof(v -> 'tool') <> 'null' AND NOT COALESCE(v ->> 'tool' = ANY (ARRAY['claude_code', 'lovable']), false) THEN o := o || 'elegí con qué construís'::text; END IF;
    IF (v ? 'repo_url' AND jsonb_typeof(v -> 'repo_url') <> 'null' AND COALESCE(v ->> 'repo_url', '') !~ '^https://[^\s]+$')
       OR (v ? 'app_url' AND jsonb_typeof(v -> 'app_url') <> 'null' AND COALESCE(v ->> 'app_url', '') !~ '^https://[^\s]+$') THEN
      o := o || 'los links tienen que empezar con https://'::text;
    END IF;
    IF v ? 'target' AND jsonb_typeof(v -> 'target') NOT IN ('null', 'string') THEN o := o || 'elegí qué vas a construir'::text; END IF;
  ELSIF p_part = 'roadmap' THEN
    IF jsonb_typeof(v) <> 'object' THEN RETURN ARRAY['el roadmap no es válido']; END IF;
    o := o || app_servicio.unknown_keys(v, ARRAY['mode', 'reqs_by', 'stages']);
    IF v ? 'mode' AND NOT COALESCE(v ->> 'mode' = ANY (ARRAY['block', 'phase', 'stage']), false) THEN o := o || 'elegí el modo de construir'::text; END IF;
    IF v ? 'reqs_by' AND NOT COALESCE(v ->> 'reqs_by' = ANY (ARRAY['phase', 'stage']), false) THEN o := o || 'elegí por qué va cada documento de requerimientos'::text; END IF;
    IF v ? 'stages' THEN
      IF jsonb_typeof(v -> 'stages') <> 'array' OR jsonb_array_length(v -> 'stages') > 30 THEN RETURN o || 'las etapas tienen que ser una lista de hasta 30'::text; END IF;
      FOR st IN SELECT e FROM jsonb_array_elements(v -> 'stages') e LOOP
        IF jsonb_typeof(st) <> 'object' OR COALESCE(st ->> 'key', '') !~ '^[a-z0-9_]{1,40}$' OR char_length(btrim(COALESCE(st ->> 'name', ''))) NOT BETWEEN 1 AND 120
           OR (st ? 'state' AND NOT COALESCE(st ->> 'state' = ANY (states), false)) THEN
          o := o || 'hay una etapa sin nombre o con un estado que no existe'::text; CONTINUE;
        END IF;
        FOR ph IN SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(st -> 'phases') = 'array' THEN st -> 'phases' ELSE '[]'::jsonb END) e LOOP
          IF jsonb_typeof(ph) <> 'object' OR COALESCE(ph ->> 'key', '') !~ '^[a-z0-9_]{1,40}$' OR char_length(btrim(COALESCE(ph ->> 'name', ''))) NOT BETWEEN 1 AND 120
             OR (ph ? 'state' AND NOT COALESCE(ph ->> 'state' = ANY (states), false)) THEN
            o := o || 'hay una fase sin nombre o con un estado que no existe'::text; CONTINUE;
          END IF;
          FOR bl IN SELECT e FROM jsonb_array_elements(CASE WHEN jsonb_typeof(ph -> 'blocks') = 'array' THEN ph -> 'blocks' ELSE '[]'::jsonb END) e LOOP
            IF jsonb_typeof(bl) <> 'object' OR COALESCE(bl ->> 'key', '') !~ '^[a-z0-9_]{1,40}$' OR char_length(btrim(COALESCE(bl ->> 'name', ''))) NOT BETWEEN 1 AND 120
               OR (bl ? 'state' AND NOT COALESCE(bl ->> 'state' = ANY (states), false)) THEN
              o := o || 'hay un bloque sin nombre o con un estado que no existe'::text;
            END IF;
          END LOOP;
        END LOOP;
      END LOOP;
    END IF;
  ELSE
    RETURN ARRAY['esa parte no existe'];
  END IF;
  RETURN (SELECT COALESCE(array_agg(DISTINCT x2), ARRAY[]::text[]) FROM unnest(o) x2);
END;
$$;

-- ─── Proyectos ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_projects(p_session text, p_product_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.proj_access(sess, p_product_id, 'projects', false);
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_steps jsonb := app_servicio_portal.proj_steps(p_product_id);
BEGIN
  RETURN jsonb_build_object(
    'readonly', (pf ->> 'readonly')::boolean,
    'steps_total', jsonb_array_length(v_steps),
    'numbers', (SELECT jsonb_build_object(
        'billed_cents', COALESCE((SELECT sum(r.amount_cents) FROM app_servicio_proyectos.student_revenue_entries r
                                   WHERE r.contact_id = v_contact AND r.product_id = p_product_id AND r.deleted_at IS NULL), 0),
        'sold_cents', COALESCE(sum(pj.sold_cents) FILTER (WHERE pj.status IN ('won', 'in_build', 'delivered')), 0),
        'receivable_cents', COALESCE(sum(GREATEST(COALESCE(pj.sold_cents, 0) - COALESCE((SELECT sum(r.amount_cents) FROM app_servicio_proyectos.student_revenue_entries r
                                     WHERE r.project_id = pj.id AND r.deleted_at IS NULL), 0), 0)) FILTER (WHERE pj.status IN ('won', 'in_build', 'delivered')), 0),
        'proposal_cents', COALESCE(sum(pj.sold_cents) FILTER (WHERE pj.status = 'proposal_sent'), 0))
       FROM app_servicio_proyectos.student_projects pj WHERE pj.contact_id = v_contact AND pj.product_id = p_product_id AND pj.archived_at IS NULL),
    'industries', COALESCE((SELECT jsonb_agg(DISTINCT i.industry) FROM app_servicio_proyectos.project_ideas i
                            WHERE i.workspace_id = (pf ->> 'workspace_id')::uuid AND i.active AND i.industry IS NOT NULL
                              AND (i.product_id IS NULL OR i.product_id = p_product_id)), '[]'::jsonb),
    'projects', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', pj.id, 'kind', pj.kind, 'title', pj.title, 'status', pj.status,
                 'client', pj.client ->> 'company', 'sold_cents', pj.sold_cents, 'closed_on', pj.closed_on,
                 'paid_cents', (SELECT COALESCE(sum(r.amount_cents), 0) FROM app_servicio_proyectos.student_revenue_entries r WHERE r.project_id = pj.id AND r.deleted_at IS NULL),
                 'steps_done', (SELECT count(*) FROM jsonb_each(COALESCE(pj.builder -> 'steps', '{}'::jsonb)) s WHERE s.value ->> 'state' = 'done'),
                 'current_step', pj.builder ->> 'current_step', 'updated_at', pj.updated_at) ORDER BY pj.updated_at DESC)
       FROM app_servicio_proyectos.student_projects pj WHERE pj.contact_id = v_contact AND pj.product_id = p_product_id AND pj.archived_at IS NULL), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_project_get(p_session text, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', false);
BEGIN
  RETURN jsonb_build_object(
    'readonly', (pf ->> 'readonly')::boolean,
    'project', jsonb_build_object('id', pj.id, 'product_id', pj.product_id, 'kind', pj.kind, 'title', pj.title, 'description', pj.description,
                                  'client', pj.client, 'status', pj.status, 'sold_cents', pj.sold_cents, 'currency', pj.currency, 'closed_on', pj.closed_on,
                                  'phases', pj.phases, 'idea_id', pj.idea_id, 'updated_at', pj.updated_at),
    'builder', pj.builder,
    'steps', app_servicio_portal.proj_steps(pj.product_id),
    'budget_ranges', COALESCE((SELECT portal_settings #> '{projects,budget_ranges}' FROM public.products WHERE id = pj.product_id), '[]'::jsonb),
    'payments', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'title', r.title, 'amount_cents', r.amount_cents, 'received_on', r.received_on,
                 'phase_key', r.project_phase_key, 'state', app_servicio_proyectos.payment_state(r), 'entered_by_kind', r.entered_by_kind) ORDER BY r.received_on DESC)
       FROM app_servicio_proyectos.student_revenue_entries r WHERE r.project_id = pj.id AND r.deleted_at IS NULL), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_project_create(p_session text, p_product_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.proj_access(sess, p_product_id, 'projects', true);
  v_kind text := p ->> 'kind';
  v_in jsonb;
  v_problems text[];
  v_service uuid;
  v_phase text;
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN PERFORM app_servicio_portal.err('PO400', 'El proyecto no es válido'); END IF;
  IF (SELECT count(*) FROM app_servicio_proyectos.student_projects WHERE contact_id = (pf ->> 'contact_id')::uuid AND archived_at IS NULL) >= 100 THEN
    PERFORM app_servicio_portal.err('PO429', 'Llegaste al máximo de proyectos. Archivá alguno para seguir');
  END IF;
  IF v_kind = 'challenge' THEN
    -- El reto: la fase Reto de su servicio en este programa.
    SELECT s.id, ph.template_key INTO v_service, v_phase
      FROM app_servicio.services s JOIN app_servicio.service_phases ph ON ph.service_id = s.id
     WHERE s.contact_id = (pf ->> 'contact_id')::uuid AND s.product_id = p_product_id AND ph.challenge -> 'enabled' = 'true'::jsonb
     ORDER BY (s.status IN ('active', 'paused')) DESC, s.created_at DESC, ph.position LIMIT 1;
    IF v_service IS NULL THEN PERFORM app_servicio_portal.err('PO400', 'Tu programa no tiene un reto'); END IF;
  END IF;
  v_in := jsonb_build_object('kind', v_kind, 'title', p -> 'title', 'client', p -> 'client',
                             'status', CASE WHEN v_kind = 'real' THEN COALESCE(NULLIF(p -> 'status', 'null'::jsonb), '"draft"'::jsonb) ELSE p -> 'status' END,
                             'sold_cents', p -> 'sold_cents',
                             'closed_on', p -> 'closed_on', 'phases', COALESCE(p -> 'phases', '[]'::jsonb), 'service_id', v_service, 'phase_key', v_phase);
  IF v_kind = 'practice' THEN v_in := v_in - 'client' - 'status' - 'sold_cents'; END IF;
  v_problems := app_servicio_proyectos.project_problems(jsonb_strip_nulls(v_in) || jsonb_build_object('phases', COALESCE(p -> 'phases', '[]'::jsonb)));
  IF array_length(v_problems, 1) > 0 THEN PERFORM app_servicio_portal.err('PO400', array_to_string(v_problems, '. ')); END IF;
  INSERT INTO app_servicio_proyectos.student_projects (workspace_id, contact_id, product_id, service_id, phase_key, idea_id, kind, title, description,
              client, status, sold_cents, currency, closed_on, phases, builder)
  VALUES ((pf ->> 'workspace_id')::uuid, (pf ->> 'contact_id')::uuid, p_product_id, v_service, v_phase,
          CASE WHEN v_kind = 'practice' THEN (SELECT i.id FROM app_servicio_proyectos.project_ideas i WHERE i.id::text = p ->> 'idea_id'
                                               AND i.workspace_id = (pf ->> 'workspace_id')::uuid) END,
          v_kind, btrim(p ->> 'title'), NULLIF(btrim(COALESCE(p ->> 'description', '')), ''),
          CASE WHEN v_kind = 'practice' THEN NULL ELSE NULLIF(p -> 'client', 'null'::jsonb) END,
          CASE WHEN v_kind = 'practice' THEN NULL ELSE COALESCE(p ->> 'status', CASE WHEN v_kind = 'real' THEN 'draft' END) END,
          CASE WHEN v_kind = 'practice' THEN NULL ELSE (p ->> 'sold_cents')::bigint END, NULLIF(p ->> 'currency', ''),
          NULLIF(p ->> 'closed_on', '')::date, COALESCE(p -> 'phases', '[]'::jsonb), '{}'::jsonb)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_project_update(p_session text, p_project_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_new jsonb;
  v_problems text[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) k
       WHERE k NOT IN ('title', 'description', 'client', 'status', 'sold_cents', 'closed_on', 'phases', 'currency')) THEN
    PERFORM app_servicio_portal.err('PO400', 'El cambio no es válido');
  END IF;
  v_new := jsonb_build_object('kind', pj.kind, 'title', pj.title, 'client', pj.client, 'status', pj.status, 'sold_cents', pj.sold_cents,
                              'closed_on', pj.closed_on, 'phases', pj.phases, 'service_id', pj.service_id, 'phase_key', pj.phase_key) || p;
  v_problems := app_servicio_proyectos.project_problems(v_new);
  IF array_length(v_problems, 1) > 0 THEN PERFORM app_servicio_portal.err('PO400', array_to_string(v_problems, '. ')); END IF;
  UPDATE app_servicio_proyectos.student_projects
     SET title = btrim(v_new ->> 'title'),
         description = CASE WHEN p ? 'description' THEN NULLIF(btrim(COALESCE(p ->> 'description', '')), '') ELSE description END,
         client = NULLIF(v_new -> 'client', 'null'::jsonb), status = v_new ->> 'status', sold_cents = (v_new ->> 'sold_cents')::bigint,
         closed_on = NULLIF(v_new ->> 'closed_on', '')::date, phases = COALESCE(v_new -> 'phases', '[]'::jsonb),
         currency = CASE WHEN p ? 'currency' THEN NULLIF(p ->> 'currency', '') ELSE currency END
   WHERE id = pj.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_project_archive(p_session text, p_project_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
BEGIN
  UPDATE app_servicio_proyectos.student_projects SET archived_at = now() WHERE id = pj.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- El sorteador: una idea activa del rubro y el tamaño (o de cualquiera, si no hay de ese rubro). null si no hay.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_ideas_draw(p_session text, p_product_id uuid, p_industry text, p_size text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.proj_access(sess, p_product_id, 'projects', false);
BEGIN
  RETURN (SELECT jsonb_build_object('id', i.id, 'title', i.title, 'description', i.description, 'industry', i.industry, 'size', i.size)
            FROM app_servicio_proyectos.project_ideas i
           WHERE i.workspace_id = (pf ->> 'workspace_id')::uuid AND i.active AND (i.product_id IS NULL OR i.product_id = p_product_id)
             AND (NULLIF(p_size, '') IS NULL OR i.size = p_size)
           ORDER BY (NULLIF(p_industry, '') IS NULL OR i.industry = p_industry) DESC, random() LIMIT 1);
END;
$$;

-- ─── Mesa de trabajo del proyecto ───────────────────────────────────────────
-- Un paso: estado (pending · in_progress · done), los campos propios, las tareas tildadas y el paso actual.
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_builder_step_save(p_session text, p_project_id uuid, p_step text, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_step jsonb;
  k text; val jsonb;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.proj_steps(pj.product_id)) s WHERE s ->> 'key' = p_step) THEN
    PERFORM app_servicio_portal.err('PO404', 'Ese paso no existe');
  END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR EXISTS (SELECT 1 FROM jsonb_object_keys(p) x WHERE x NOT IN ('state', 'fields', 'tasks_done', 'current')) THEN
    PERFORM app_servicio_portal.err('PO400', 'El cambio no es válido');
  END IF;
  IF p ? 'state' AND NOT COALESCE(p ->> 'state' = ANY (ARRAY['pending', 'in_progress', 'done']), false) THEN PERFORM app_servicio_portal.err('PO400', 'Ese estado no existe'); END IF;
  IF p ? 'fields' THEN
    IF jsonb_typeof(p -> 'fields') <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(p -> 'fields')) > 40 THEN PERFORM app_servicio_portal.err('PO400', 'Los datos del paso no son válidos'); END IF;
    FOR k, val IN SELECT key, value FROM jsonb_each(p -> 'fields') LOOP
      IF k !~ '^[a-z0-9_]{1,40}$' OR jsonb_typeof(val) NOT IN ('string', 'number', 'boolean', 'null')
         OR (jsonb_typeof(val) = 'string' AND char_length(val #>> '{}') > 4000) THEN
        PERFORM app_servicio_portal.err('PO400', 'Un dato del paso es muy largo o no es válido (hasta 4000 caracteres; los documentos van aparte)');
      END IF;
    END LOOP;
  END IF;
  IF p ? 'tasks_done' AND NOT (jsonb_typeof(p -> 'tasks_done') = 'array' AND jsonb_array_length(p -> 'tasks_done') <= 20
       AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p -> 'tasks_done') x WHERE NOT app_servicio.j_int(x) OR app_servicio.j_num(x) NOT BETWEEN 0 AND 19)) THEN
    PERFORM app_servicio_portal.err('PO400', 'Las tareas no son válidas');
  END IF;
  v_step := COALESCE(pj.builder #> ARRAY['steps', p_step], '{}'::jsonb) || (p - 'current');
  UPDATE app_servicio_proyectos.student_projects
     SET builder = jsonb_set(jsonb_set(builder, '{steps}', COALESCE(builder -> 'steps', '{}'::jsonb)), ARRAY['steps', p_step], v_step)
                   || CASE WHEN COALESCE((p ->> 'current')::boolean, false) THEN jsonb_build_object('current_step', p_step) ELSE '{}'::jsonb END
   WHERE id = pj.id;
  RETURN jsonb_build_object('ok', true, 'step', v_step);
END;
$$;

-- Una versión nueva del documento de un paso (o de los requerimientos de una parte: p_unit). El archivo ya está
-- subido en `student-projects`, en la carpeta del proyecto; la versión guarda ruta, origen, nombre, tamaño, caracteres
-- y huella. Si la huella es igual a la anterior, se guarda igual y se avisa (`same`).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_builder_version_add(p_session text, p_project_id uuid, p_step text, p_unit text, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_path text[] := CASE WHEN NULLIF(p_unit, '') IS NULL THEN ARRAY['steps', p_step, 'versions'] ELSE ARRAY['requirements', p_unit, 'versions'] END;
  v_versions jsonb := COALESCE(pj.builder #> v_path, '[]'::jsonb);
  v_n integer := jsonb_array_length(COALESCE(pj.builder #> v_path, '[]'::jsonb)) + 1;
  v_prefix text := pj.workspace_id::text || '/' || pj.id::text || '/';
  v_ver jsonb;
  v_builder jsonb := pj.builder;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(app_servicio_portal.proj_steps(pj.product_id)) s WHERE s ->> 'key' = p_step) THEN
    PERFORM app_servicio_portal.err('PO404', 'Ese paso no existe');
  END IF;
  IF NULLIF(p_unit, '') IS NOT NULL AND p_unit !~ '^[a-z0-9_]{1,40}$' THEN PERFORM app_servicio_portal.err('PO400', 'Esa parte no existe'); END IF;
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR NOT starts_with(COALESCE(p ->> 'path', ''), v_prefix) OR strpos(p ->> 'path', '..') > 0
     OR NOT COALESCE(p ->> 'source' = ANY (ARRAY['paste', 'upload', 'restore']), false) OR NOT app_servicio.j_int(p -> 'size')
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'student-projects' AND o.name = p ->> 'path') THEN
    PERFORM app_servicio_portal.err('PO400', 'El documento no se guardó bien. Probá de nuevo');
  END IF;
  IF v_n > 200 THEN PERFORM app_servicio_portal.err('PO429', 'Llegaste al máximo de versiones de este documento'); END IF;
  v_ver := jsonb_build_object('n', v_n, 'path', p ->> 'path', 'source', p ->> 'source', 'name', left(COALESCE(p ->> 'name', ''), 200),
                              'size', (p ->> 'size')::bigint, 'chars', COALESCE((p ->> 'chars')::integer, 0),
                              'original_path', CASE WHEN starts_with(COALESCE(p ->> 'original_path', ''), v_prefix) THEN p ->> 'original_path' END,
                              'sha', left(COALESCE(p ->> 'sha', ''), 64), 'at', now());
  IF v_builder #> v_path IS NULL THEN
    v_builder := jsonb_set(v_builder, ARRAY[v_path[1]], COALESCE(v_builder -> v_path[1], '{}'::jsonb));
    v_builder := jsonb_set(v_builder, ARRAY[v_path[1], v_path[2]], COALESCE(v_builder #> ARRAY[v_path[1], v_path[2]], '{}'::jsonb));
  END IF;
  v_builder := jsonb_set(v_builder, v_path, v_versions || jsonb_build_array(v_ver));
  -- El paso pasa a «En curso» al guardar su primera versión (F233).
  IF NULLIF(p_unit, '') IS NULL AND COALESCE(v_builder #>> ARRAY['steps', p_step, 'state'], 'pending') = 'pending' THEN
    v_builder := jsonb_set(v_builder, ARRAY['steps', p_step, 'state'], '"in_progress"');
  END IF;
  UPDATE app_servicio_proyectos.student_projects SET builder = v_builder WHERE id = pj.id;
  RETURN jsonb_build_object('n', v_n, 'same', jsonb_array_length(v_versions) > 0 AND (v_versions -> -1 ->> 'sha') = (v_ver ->> 'sha') AND (v_ver ->> 'sha') <> '');
END;
$$;

-- Links (F238), roadmap (F239) y construcción (F240).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_builder_save(p_session text, p_project_id uuid, p_part text, p_value jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_problems text[] := app_servicio_proyectos.builder_part_problems(p_part, p_value);
BEGIN
  IF array_length(v_problems, 1) > 0 THEN PERFORM app_servicio_portal.err('PO400', array_to_string(v_problems, '. ')); END IF;
  UPDATE app_servicio_proyectos.student_projects SET builder = jsonb_set(builder, ARRAY[p_part], p_value) WHERE id = pj.id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ─── Facturación (F241) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_revenue(p_session text, p_product_id uuid, p_period text DEFAULT 'month')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.proj_access(sess, p_product_id, 'revenue', false);
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_unit text := CASE WHEN p_period = 'week' THEN 'week' ELSE 'month' END;
  v_today date := (now() AT TIME ZONE app_servicio.ws_tz((pf ->> 'workspace_id')::uuid))::date;
BEGIN
  RETURN jsonb_build_object(
    'readonly', (pf ->> 'readonly')::boolean,
    'totals', COALESCE((SELECT to_jsonb(t) - 'workspace_id' - 'contact_id' - 'product_id' FROM app_servicio_proyectos.student_revenue_totals t
                         WHERE t.contact_id = v_contact AND t.product_id = p_product_id), '{}'::jsonb),
    'series', (SELECT jsonb_agg(jsonb_build_object('from', g::date, 'cents', COALESCE((SELECT sum(r.amount_cents) FROM app_servicio_proyectos.student_revenue_entries r
                 WHERE r.contact_id = v_contact AND r.product_id = p_product_id AND r.deleted_at IS NULL AND NOT r.before_program
                   AND date_trunc(v_unit, r.received_on) = g), 0)) ORDER BY g)
                 FROM generate_series(date_trunc(v_unit, v_today) - (CASE WHEN v_unit = 'week' THEN interval '11 weeks' ELSE interval '11 months' END),
                                      date_trunc(v_unit, v_today), CASE WHEN v_unit = 'week' THEN interval '1 week' ELSE interval '1 month' END) g),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'description', r.description,
                 'amount_cents', r.amount_cents, 'received_on', r.received_on, 'before_program', r.before_program, 'project_id', r.project_id,
                 'project_title', pj.title, 'phase_key', r.project_phase_key, 'entered_by_kind', r.entered_by_kind,
                 'state', app_servicio_proyectos.payment_state(r), 'has_receipt', r.receipt_path IS NOT NULL,
                 'receipt_requested', r.receipt_requested_at IS NOT NULL) ORDER BY r.received_on DESC, r.created_at DESC)
       FROM app_servicio_proyectos.student_revenue_entries r LEFT JOIN app_servicio_proyectos.student_projects pj ON pj.id = r.project_id
      WHERE r.contact_id = v_contact AND r.product_id = p_product_id AND r.deleted_at IS NULL), '[]'::jsonb));
END;
$$;

-- Reportar un pago. Sin comprobante se guarda igual, sin verificar (needs_receipt = true).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_revenue_report(p_session text, p_product_id uuid, p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.proj_access(sess, p_product_id, 'revenue', true);
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_contact uuid := (pf ->> 'contact_id')::uuid;
  v_amount numeric;
  v_receipt text := NULLIF(p ->> 'receipt_path', '');
  v_id uuid;
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR char_length(btrim(COALESCE(p ->> 'title', ''))) NOT BETWEEN 1 AND 200 THEN
    PERFORM app_servicio_portal.err('PO400', 'Escribí un título para el pago');
  END IF;
  v_amount := CASE WHEN jsonb_typeof(p -> 'amount_cents') = 'number' THEN (p ->> 'amount_cents')::numeric END;
  IF v_amount IS NULL OR v_amount <= 0 OR v_amount <> trunc(v_amount) OR v_amount > 100000000000 THEN PERFORM app_servicio_portal.err('PO400', 'El monto tiene que ser mayor que cero'); END IF;
  IF COALESCE(p ->> 'received_on', '') !~ '^\d{4}-\d{2}-\d{2}$' OR (p ->> 'received_on')::date > (now() AT TIME ZONE app_servicio.ws_tz(v_ws))::date + 1 THEN
    PERFORM app_servicio_portal.err('PO400', 'Elegí la fecha en que lo cobraste');
  END IF;
  IF v_receipt IS NOT NULL AND (NOT starts_with(v_receipt, v_ws::text || '/' || v_contact::text || '/') OR strpos(v_receipt, '..') > 0
       OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'student-revenue' AND o.name = v_receipt)) THEN
    PERFORM app_servicio_portal.err('PO400', 'El comprobante no se subió bien. Volvé a adjuntarlo');
  END IF;
  IF public.bump_rate_limit('portal-revenue:' || v_contact::text, date_trunc('hour', now())) > 30 THEN
    PERFORM app_servicio_portal.err('PO429', 'Esperá un rato y volvé a probar');
  END IF;
  BEGIN
    INSERT INTO app_servicio_proyectos.student_revenue_entries (workspace_id, contact_id, product_id, project_id, project_phase_key, kind, title, description,
                amount_cents, currency, received_on, before_program, receipt_path, entered_by_kind)
    VALUES (v_ws, v_contact, p_product_id, NULLIF(p ->> 'project_id', '')::uuid, NULLIF(p ->> 'project_phase_key', ''), 'payment', btrim(p ->> 'title'),
            NULLIF(btrim(COALESCE(p ->> 'description', '')), ''), v_amount::bigint, NULLIF(p ->> 'currency', ''), (p ->> 'received_on')::date,
            COALESCE((p ->> 'before_program')::boolean, false), v_receipt, 'student')
    RETURNING id INTO v_id;
  EXCEPTION
    WHEN SQLSTATE 'CO010' THEN PERFORM app_servicio_portal.err('PO400', 'Un proyecto de práctica no lleva pagos');
    WHEN SQLSTATE 'CO011' THEN PERFORM app_servicio_portal.err('PO400', 'Esa fase no existe en el proyecto');
    WHEN SQLSTATE 'CO012' THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos ese proyecto');
    WHEN foreign_key_violation THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos ese proyecto');
  END;
  RETURN jsonb_build_object('id', v_id, 'needs_receipt', v_receipt IS NULL);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_revenue_attach_receipt(p_session text, p_entry_id uuid, p_path text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  r app_servicio_proyectos.student_revenue_entries;
  pf jsonb;
BEGIN
  SELECT * INTO r FROM app_servicio_proyectos.student_revenue_entries
   WHERE id = p_entry_id AND contact_id = (sess ->> 'contact_id')::uuid AND workspace_id = (sess ->> 'workspace_id')::uuid AND deleted_at IS NULL;
  IF r.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos ese pago'); END IF;
  pf := app_servicio_portal.proj_access(sess, r.product_id, 'revenue', true);
  IF r.kind <> 'payment' OR r.verified_at IS NOT NULL THEN PERFORM app_servicio_portal.err('PO409', 'Ese pago ya está verificado'); END IF;
  IF NOT starts_with(COALESCE(p_path, ''), r.workspace_id::text || '/' || r.contact_id::text || '/') OR strpos(p_path, '..') > 0
     OR NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'student-revenue' AND o.name = p_path) THEN
    PERFORM app_servicio_portal.err('PO400', 'El comprobante no se subió bien. Volvé a adjuntarlo');
  END IF;
  UPDATE app_servicio_proyectos.student_revenue_entries SET receipt_path = p_path WHERE id = r.id;
  RETURN jsonb_build_object('ok', true, 'state', 'pending');
END;
$$;

-- ─── Lo que usa el servidor de SSA ──────────────────────────────────────────
-- Archivos de Mis proyectos. kind: project_doc_upload (item = proyecto, ref = «paso/ext» o «req/unidad/ext»),
-- project_doc (item = proyecto, ref = ruta), revenue_receipt_upload (ref = ext), revenue_receipt (item = pago).
CREATE OR REPLACE FUNCTION app_servicio.portal_project_file_grant(p_session text, p_kind text, p_item_id uuid, p_ref text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pj app_servicio_proyectos.student_projects;
  r app_servicio_proyectos.student_revenue_entries;
  v_ext text;
  v_part text;
  v_pf jsonb;
BEGIN
  IF p_kind IN ('project_doc_upload', 'project_doc') THEN
    pj := app_servicio_portal.own_project(sess, p_item_id);
    v_pf := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', p_kind = 'project_doc_upload');
    IF p_kind = 'project_doc' THEN
      IF NOT starts_with(COALESCE(p_ref, ''), pj.workspace_id::text || '/' || pj.id::text || '/') OR strpos(p_ref, '..') > 0 THEN
        PERFORM app_servicio_portal.err('PO404', 'No encontramos ese documento');
      END IF;
      RETURN jsonb_build_object('bucket', 'student-projects', 'path', p_ref, 'upload', false);
    END IF;
    v_part := split_part(COALESCE(p_ref, ''), '/', 1);
    v_ext := lower(regexp_replace(COALESCE(p_ref, ''), '^.*/', ''));
    IF v_part !~ '^[a-z0-9_]{1,40}$' OR v_ext NOT IN ('md', 'txt', 'pdf', 'docx', 'vtt', 'srt') THEN PERFORM app_servicio_portal.err('PO400', 'Ese tipo de archivo no se puede subir'); END IF;
    RETURN jsonb_build_object('bucket', 'student-projects', 'upload', true,
      'path', pj.workspace_id::text || '/' || pj.id::text || '/' || v_part || '/' || gen_random_uuid()::text || '.' || v_ext);
  ELSIF p_kind = 'revenue_receipt_upload' THEN
    v_ext := lower(COALESCE(p_ref, ''));
    IF v_ext NOT IN ('jpg', 'jpeg', 'png', 'webp', 'pdf') THEN PERFORM app_servicio_portal.err('PO400', 'El comprobante puede ser JPG, PNG, WebP o PDF'); END IF;
    IF sess ->> 'kind' <> 'student' THEN PERFORM app_servicio_portal.err('PO403', 'En la vista previa no se puede subir nada'); END IF;
    RETURN jsonb_build_object('bucket', 'student-revenue', 'upload', true,
      'path', (sess ->> 'workspace_id') || '/' || (sess ->> 'contact_id') || '/' || gen_random_uuid()::text || '.' || v_ext);
  ELSIF p_kind = 'revenue_receipt' THEN
    SELECT * INTO r FROM app_servicio_proyectos.student_revenue_entries
     WHERE id = p_item_id AND contact_id = (sess ->> 'contact_id')::uuid AND workspace_id = (sess ->> 'workspace_id')::uuid AND deleted_at IS NULL AND receipt_path IS NOT NULL;
    IF r.id IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'No encontramos ese comprobante'); END IF;
    RETURN jsonb_build_object('bucket', 'student-revenue', 'path', r.receipt_path, 'upload', false);
  END IF;
  PERFORM app_servicio_portal.err('PO400', 'Pedido no válido');
  RETURN NULL;
END;
$$;

-- Todo para armar el prompt de un paso (F234). El panel lee los textos de las rutas y reemplaza las variables.
-- Copiar no gasta créditos ni escribe nada; con el acceso vencido, PO410.
CREATE OR REPLACE FUNCTION app_servicio.portal_builder_prompt_parts(p_session text, p_project_id uuid, p_step text, p_unit text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session, false);
  pj app_servicio_proyectos.student_projects := app_servicio_portal.own_project(sess, p_project_id);
  pf jsonb := app_servicio_portal.proj_access(sess, pj.product_id, 'projects', true);
  v_step jsonb;
  v_steps jsonb;
BEGIN
  SELECT s INTO v_step FROM public.products p, jsonb_array_elements(COALESCE(p.portal_settings #> '{projects,steps}', '[]'::jsonb)) s
   WHERE p.id = pj.product_id AND s ->> 'key' = p_step;
  IF v_step IS NULL THEN PERFORM app_servicio_portal.err('PO404', 'Ese paso no existe'); END IF;
  IF jsonb_typeof(v_step -> 'prompt') IS DISTINCT FROM 'object' THEN PERFORM app_servicio_portal.err('PO404', 'Este paso todavía no tiene prompt'); END IF;
  v_steps := app_servicio_portal.proj_steps(pj.product_id);
  RETURN jsonb_build_object(
    'step', jsonb_build_object('key', v_step ->> 'key', 'name', v_step ->> 'name'),
    'template', v_step -> 'prompt',
    'project', jsonb_build_object('kind', pj.kind, 'title', pj.title, 'description', pj.description, 'client', pj.client, 'status', pj.status,
                                  'sold_cents', pj.sold_cents, 'phases', pj.phases),
    'fields', COALESCE((SELECT jsonb_object_agg(e.key, e.value -> 'fields') FROM jsonb_each(COALESCE(pj.builder -> 'steps', '{}'::jsonb)) e
                         WHERE jsonb_typeof(e.value -> 'fields') = 'object'), '{}'::jsonb),
    'roadmap', pj.builder -> 'roadmap', 'build', pj.builder -> 'build', 'unit', NULLIF(p_unit, ''),
    'budget_ranges', COALESCE((SELECT portal_settings #> '{projects,budget_ranges}' FROM public.products WHERE id = pj.product_id), '[]'::jsonb),
    -- La última versión de cada documento que usa el paso (o null si falta), en el orden de los pasos.
    'documents', COALESCE((SELECT jsonb_agg(jsonb_build_object('step', d #>> '{}', 'name', (SELECT s ->> 'name' FROM jsonb_array_elements(v_steps) s WHERE s ->> 'key' = d #>> '{}'),
                   'version', pj.builder #> ARRAY['steps', d #>> '{}', 'versions', '-1']) ORDER BY o)
       FROM jsonb_array_elements(COALESCE(v_step -> 'depends_on', '[]'::jsonb)) WITH ORDINALITY x(d, o)), '[]'::jsonb),
    'requirements', CASE WHEN NULLIF(p_unit, '') IS NOT NULL THEN pj.builder #> ARRAY['requirements', p_unit, 'versions', '-1'] END);
END;
$$;

-- Prender Mis proyectos crea (o prende) el revisor; apagarlo lo deja inactivo (F119). Lo llama el panel al guardar
-- las secciones del programa; vuelve a pedir el permiso.
CREATE OR REPLACE FUNCTION app_servicio.projects_set_enabled(p_product_id uuid, p_enabled boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_id uuid;
BEGIN
  SELECT workspace_id, NULLIF(portal_settings #>> '{projects,reviewer_agent_id}', '')::uuid INTO v_ws, v_id FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(v_ws)
       AND (public.has_permission(v_ws, 'portal.sections') OR public.has_permission(v_ws, 'projects.templates'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio_proyectos.enabled(v_ws) THEN RETURN NULL; END IF;
  IF p_enabled THEN RETURN app_servicio_proyectos.projects_ensure_reviewer(p_product_id); END IF;
  IF v_id IS NOT NULL THEN UPDATE public.agents SET is_enabled = false, updated_at = now() WHERE id = v_id AND is_enabled; END IF;
  RETURN v_id;
END;
$$;

-- ─── Envoltorios ────────────────────────────────────────────────────────────
-- portal_context: la original queda como ctx_context_base; la nueva suma `proyectos` (projects) y `fama` (fame).
DO $do$
BEGIN
  IF to_regprocedure('app_servicio_portal.ctx_context_base(text,text,uuid)') IS NULL THEN
    ALTER FUNCTION app_servicio_portal.portal_context(text, text, uuid) RENAME TO ctx_context_base;
  END IF;
END
$do$;
REVOKE ALL ON FUNCTION app_servicio_portal.ctx_context_base(text, text, uuid) FROM PUBLIC, anon, authenticated, portal_app;

CREATE OR REPLACE FUNCTION app_servicio_portal.portal_context(p_session text, p_host text, p_product_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  r jsonb := app_servicio_portal.ctx_context_base(p_session, p_host, p_product_id);
  sess jsonb;
  pr record;
  v_extra jsonb := '[]'::jsonb;
  v_excl jsonb := '[]'::jsonb;
  v_st jsonb;
  k record;
  v_sections jsonb;
BEGIN
  IF r -> 'program' IS NULL OR jsonb_typeof(r -> 'program') <> 'object' THEN RETURN r; END IF;
  sess := app_servicio_portal.session_resolve(p_session, false);
  IF NOT app_servicio_proyectos.enabled((sess ->> 'workspace_id')::uuid) THEN RETURN r; END IF;
  SELECT * INTO pr FROM app_servicio_portal.ctx_programs((sess ->> 'workspace_id')::uuid, (sess ->> 'contact_id')::uuid) x
   WHERE x.product_id = (r #>> '{program,id}')::uuid LIMIT 1;
  IF pr.product_id IS NULL THEN RETURN r; END IF;
  FOR k IN SELECT * FROM (VALUES (1, 'proyectos', 'projects'), (2, 'fama', 'fame')) t(pos, key, section) ORDER BY pos LOOP
    v_st := app_servicio_portal.ctx_section((sess ->> 'contact_id')::uuid, pr.product_id, pr.variant_id, k.section, pr.starts_on);
    IF v_st IS NULL THEN
      v_excl := v_excl || to_jsonb(k.key);
    ELSE
      v_extra := v_extra || (jsonb_build_object('key', k.key) || v_st);
    END IF;
  END LOOP;
  -- Antes de «referidos» (o al final, antes de «perfil»).
  SELECT COALESCE(jsonb_agg(e ORDER BY o), '[]'::jsonb) INTO v_sections FROM (
    SELECT e, (o * 10) AS o FROM jsonb_array_elements(COALESCE(r -> 'sections', '[]'::jsonb)) WITH ORDINALITY x(e, o)
    UNION ALL
    SELECT e, (COALESCE((SELECT o2 FROM jsonb_array_elements(COALESCE(r -> 'sections', '[]'::jsonb)) WITH ORDINALITY y(e2, o2)
                          WHERE e2 ->> 'key' IN ('referidos', 'asistente', 'perfil') ORDER BY o2 LIMIT 1), 1000) * 10 - 5 + oe) AS o
      FROM jsonb_array_elements(v_extra) WITH ORDINALITY z(e, oe)) q;
  RETURN jsonb_set(jsonb_set(r, '{sections}', v_sections), '{excluded}', COALESCE(r -> 'excluded', '[]'::jsonb) || v_excl);
END;
$$;

-- portal_fame: con la extensión, la facturación del programa (los montos solo de quien eligió mostrarlos; el propio, siempre).
CREATE OR REPLACE FUNCTION app_servicio_portal.portal_fame(p_session text, p_product_id uuid, p_period text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  sess jsonb := app_servicio_portal.session_resolve(p_session);
  pf jsonb := app_servicio_portal.program_for(sess, p_product_id, true);
  v_ws uuid := (pf ->> 'workspace_id')::uuid;
  v_rev jsonb := NULL;
BEGIN
  IF app_servicio_proyectos.enabled(v_ws) AND app_servicio.portal_section_enabled(p_product_id, 'fame') THEN
    v_rev := COALESCE((SELECT jsonb_agg(jsonb_build_object(
               'name', app_servicio_portal.public_name(COALESCE(a.display_name, c.display_name)),
               'me', c.id = (pf ->> 'contact_id')::uuid,
               'amount_cents', CASE WHEN COALESCE(a.show_amount_in_fame, false) OR c.id = (pf ->> 'contact_id')::uuid THEN (f ->> 'amount_cents')::bigint END,
               'projects_won', (f ->> 'projects_won')::integer) ORDER BY o)
      FROM jsonb_array_elements(app_servicio_proyectos.fame_ranking(p_product_id, CASE WHEN p_period = 'month' THEN 'month' ELSE 'all' END)) WITH ORDINALITY x(f, o)
      JOIN public.contacts c ON c.id = (f ->> 'contact_id')::uuid
      LEFT JOIN app_servicio_portal.portal_accounts a ON a.contact_id = c.id AND a.workspace_id = v_ws
     WHERE NOT COALESCE((a.notification_prefs ->> 'hide_from_ranking')::boolean, false) OR c.id = (pf ->> 'contact_id')::uuid), '[]'::jsonb);
  END IF;
  RETURN jsonb_build_object(
    'show_amount', COALESCE((SELECT a.show_amount_in_fame FROM app_servicio_portal.portal_accounts a WHERE a.id = (sess ->> 'account_id')::uuid), false),
    'points_enabled', (SELECT portal_settings #> '{points,enabled}' = 'true'::jsonb FROM public.products WHERE id = p_product_id),
    'revenue', v_rev);
END;
$$;

-- ─── Permisos ───────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio_portal.proj_access(jsonb, uuid, text, boolean), app_servicio_portal.own_project(jsonb, uuid), app_servicio_portal.proj_steps(uuid),
  app_servicio_proyectos.builder_part_problems(text, jsonb)
FROM PUBLIC, anon, authenticated, portal_app;
REVOKE ALL ON FUNCTION
  app_servicio_portal.portal_projects(text, uuid), app_servicio_portal.portal_project_get(text, uuid), app_servicio_portal.portal_project_create(text, uuid, jsonb),
  app_servicio_portal.portal_project_update(text, uuid, jsonb), app_servicio_portal.portal_project_archive(text, uuid),
  app_servicio_portal.portal_ideas_draw(text, uuid, text, text), app_servicio_portal.portal_builder_step_save(text, uuid, text, jsonb),
  app_servicio_portal.portal_builder_version_add(text, uuid, text, text, jsonb), app_servicio_portal.portal_builder_save(text, uuid, text, jsonb),
  app_servicio_portal.portal_revenue(text, uuid, text), app_servicio_portal.portal_revenue_report(text, uuid, jsonb),
  app_servicio_portal.portal_revenue_attach_receipt(text, uuid, text), app_servicio_portal.portal_context(text, text, uuid),
  app_servicio_portal.portal_fame(text, uuid, text)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio_portal.portal_projects(text, uuid), app_servicio_portal.portal_project_get(text, uuid), app_servicio_portal.portal_project_create(text, uuid, jsonb),
  app_servicio_portal.portal_project_update(text, uuid, jsonb), app_servicio_portal.portal_project_archive(text, uuid),
  app_servicio_portal.portal_ideas_draw(text, uuid, text, text), app_servicio_portal.portal_builder_step_save(text, uuid, text, jsonb),
  app_servicio_portal.portal_builder_version_add(text, uuid, text, text, jsonb), app_servicio_portal.portal_builder_save(text, uuid, text, jsonb),
  app_servicio_portal.portal_revenue(text, uuid, text), app_servicio_portal.portal_revenue_report(text, uuid, jsonb),
  app_servicio_portal.portal_revenue_attach_receipt(text, uuid, text), app_servicio_portal.portal_context(text, text, uuid),
  app_servicio_portal.portal_fame(text, uuid, text)
TO portal_app, service_role;
REVOKE ALL ON FUNCTION app_servicio.portal_project_file_grant(text, text, uuid, text), app_servicio.portal_builder_prompt_parts(text, uuid, text, text)
  FROM PUBLIC, anon, authenticated, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.portal_project_file_grant(text, text, uuid, text), app_servicio.portal_builder_prompt_parts(text, uuid, text, text) TO service_role;
REVOKE ALL ON FUNCTION app_servicio.projects_set_enabled(uuid, boolean) FROM PUBLIC, anon, portal_app;
GRANT EXECUTE ON FUNCTION app_servicio.projects_set_enabled(uuid, boolean) TO authenticated, service_role;
