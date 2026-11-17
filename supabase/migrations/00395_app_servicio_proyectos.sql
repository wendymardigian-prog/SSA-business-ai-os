-- @plantilla-quitar(proyectos)
-- ============================================================================
-- 00395_app_servicio_proyectos  (SX1 · Corrida C · la extensión de proyectos, bloque PY: F78, F80–F82, F119)
-- ============================================================================
-- Todo lo de proyectos es propio de este negocio y va aparte (decisión 451). Esta migración deja la ESTRUCTURA; las
-- pantallas del equipo (C2), las funciones del portal (C3) y el revisor que corre (C5) vienen después.
--
--  1. Esquema `app_servicio_proyectos`, cerrado como `app_servicio_portal` (sin USAGE para anon ni authenticated).
--  2. `enabled(workspace)`: el interruptor oculto `workspaces.portal_settings.extensions.projects` (apagado por
--     defecto; solo lo cambia la plataforma). Apagado, nada de esto aparece.
--  3. Tablas (§8.2, 15 a 17): `project_ideas`, `student_projects` y `student_revenue_entries`, con sus CHECK
--     (práctica sin cliente ni monto, reto con servicio y fase, real Ganado o después con fecha de cierre, pago > 0 salvo
--     ajuste, ajuste con motivo) y sus triggers: CO010 (una práctica no lleva pagos), CO011 (la fase del pago tiene que
--     existir en el proyecto), CO012 (proyecto y pago son de la misma persona y programa).
--  4. `project_problems(jsonb)`: los problemas de un proyecto en palabras (gemela de lib/projects/project.ts, casos en
--     lib/projects/student-project.cases.json).
--  5. La facturación es la suma de los pagos: vista `student_revenue_totals`.
--  6. Sala de la fama: `fame_plan(entries, projects, settings, period, today)` (pura, gemela de fameRanking en
--     lib/projects/fame.ts, casos en fame.cases.json) y `fame_ranking(product_id, period)`, que junta los datos y la llama.
--     Los servicios de prueba no cuentan.
--  7. Buckets privados `student-projects` y `student-revenue` (10 MB).
--  8. `agent_runs.source` suma `portal_project_review` (las dos CHECK, partiendo de lo que está EN LA BASE el 17/11).
--  9. El revisor de proyectos (F119): `projects_ensure_reviewer(product_id)`, uno por programa (con bloqueo por producto),
--     su id en `products.portal_settings.projects.reviewer_agent_id`; `tutor_agent_guard` también protege al revisor.
-- 10. Secciones `fame` y `projects` y las claves `fame` y `projects` del programa: se aceptan solo con la extensión
--     prendida (portal_section_rule_problems con p_ext, validate_variant/program_portal_settings, portal_section_enabled).
-- 11. `merge_contacts_hook`: al unir dos contactos, sus proyectos y pagos pasan al principal (lo llama el del módulo).
--
-- Definiciones viejas (para volver atrás): portal_section_rule_problems y validate_variant_portal_settings (00332),
-- validate_program_portal_settings (00378), portal_section_enabled (00341), tutor_agent_guard (00352).
--   agent_runs_source_check: CHECK ((source = ANY (ARRAY['agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
--     'conversation_summary', 'message_classification', 'message_classification_eval', 'content_copy', 'ads_analysis',
--     'audio_transcription', 'media_description', 'call_classification', 'call_analysis', 'call_correction', 'call_summary',
--     'call_prompt_test', 'ads_matching', 'designer', 'portal_tutor'])))
--   agent_runs_agent_only_for_agent_sources: CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent',
--     'conversation_summary', 'content_copy', 'portal_tutor']))))
--
-- Volver atrás: las 5 funciones de arriba con su definición vieja; las dos CHECK viejas (aborta si ya hay corridas
-- `portal_project_review`); DROP SCHEMA app_servicio_proyectos CASCADE; DELETE de los dos buckets (vacíos).
-- Riesgo: ALTO por las CHECK de agent_runs (tabla en uso): solo se SUMA un valor; lo que existe sigue valiendo.
-- ============================================================================

-- ─── 1. Esquema ─────────────────────────────────────────────────────────────
CREATE SCHEMA IF NOT EXISTS app_servicio_proyectos;
REVOKE ALL ON SCHEMA app_servicio_proyectos FROM public, anon, authenticated;
GRANT USAGE ON SCHEMA app_servicio_proyectos TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_servicio_proyectos REVOKE EXECUTE ON FUNCTIONS FROM public;
ALTER DEFAULT PRIVILEGES IN SCHEMA app_servicio_proyectos REVOKE ALL ON TABLES FROM public, anon, authenticated;

-- ─── 2. El interruptor ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.enabled(p_workspace_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT w.portal_settings #> '{extensions,projects}' = 'true'::jsonb FROM public.workspaces w WHERE w.id = p_workspace_id), false);
$$;

-- ─── 3. Tablas ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_proyectos.project_ideas (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id   uuid NULL REFERENCES public.products(id) ON DELETE CASCADE,
  industry     text NULL CHECK (industry IS NULL OR char_length(industry) <= 80),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description  text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  size         text NOT NULL CHECK (size IN ('small', 'medium', 'large')),
  active       boolean NOT NULL DEFAULT true,
  created_by   uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_ideas_pick ON app_servicio_proyectos.project_ideas (workspace_id, product_id, active);

CREATE TABLE IF NOT EXISTS app_servicio_proyectos.student_projects (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  product_id   uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  service_id   uuid NULL REFERENCES app_servicio.services(id) ON DELETE SET NULL,
  phase_key    text NULL,
  idea_id      uuid NULL REFERENCES app_servicio_proyectos.project_ideas(id) ON DELETE SET NULL,
  kind         text NOT NULL CHECK (kind IN ('real', 'practice', 'challenge')),
  title        text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description  text NULL CHECK (description IS NULL OR char_length(description) <= 10000),
  client       jsonb NULL CHECK (client IS NULL OR jsonb_typeof(client) = 'object'),
  status       text NULL CHECK (status IS NULL OR status IN ('draft', 'proposal_sent', 'won', 'in_build', 'delivered', 'lost')),
  sold_cents   bigint NULL CHECK (sold_cents IS NULL OR sold_cents >= 0),
  currency     text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  closed_on    date NULL,
  phases       jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(phases) = 'array'),
  builder      jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(builder) = 'object'),
  notes        text NULL CHECK (notes IS NULL OR char_length(notes) <= 10000),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  archived_at  timestamptz NULL,
  -- Práctica: sin cliente, sin monto y sin estado de venta.
  CONSTRAINT student_projects_practice CHECK (kind <> 'practice' OR (client IS NULL AND sold_cents IS NULL AND status IS NULL)),
  -- Reto: ligado a la fase Reto de su servicio.
  CONSTRAINT student_projects_challenge CHECK (kind <> 'challenge' OR (service_id IS NOT NULL AND phase_key IS NOT NULL)),
  CONSTRAINT student_projects_phase_only_challenge CHECK (kind = 'challenge' OR phase_key IS NULL),
  -- Real: siempre con estado; desde Ganado, con fecha de cierre.
  CONSTRAINT student_projects_real_status CHECK (kind <> 'real' OR status IS NOT NULL),
  CONSTRAINT student_projects_closed_on CHECK (status IS NULL OR status NOT IN ('won', 'in_build', 'delivered') OR closed_on IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_student_projects_contact ON app_servicio_proyectos.student_projects (contact_id, product_id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_student_projects_product ON app_servicio_proyectos.student_projects (product_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS app_servicio_proyectos.student_revenue_entries (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  project_id        uuid NULL REFERENCES app_servicio_proyectos.student_projects(id) ON DELETE SET NULL,
  project_phase_key text NULL,
  kind              text NOT NULL DEFAULT 'payment' CHECK (kind IN ('payment', 'adjustment')),
  title             text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  description       text NULL CHECK (description IS NULL OR char_length(description) <= 4000),
  amount_cents      bigint NOT NULL,
  currency          text NULL CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  received_on       date NOT NULL,
  before_program    boolean NOT NULL DEFAULT false,
  receipt_path      text NULL CHECK (receipt_path IS NULL OR (char_length(receipt_path) <= 500 AND strpos(receipt_path, '..') = 0)),
  entered_by_kind   text NOT NULL CHECK (entered_by_kind IN ('student', 'team')),
  entered_by        uuid NULL,
  verified_at       timestamptz NULL,
  verified_by       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  adjust_reason     text NULL CHECK (adjust_reason IS NULL OR char_length(adjust_reason) <= 1000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz NULL,
  CONSTRAINT revenue_amount CHECK (kind = 'adjustment' OR amount_cents > 0),
  CONSTRAINT revenue_adjustment CHECK (kind <> 'adjustment' OR (entered_by_kind = 'team' AND adjust_reason IS NOT NULL AND btrim(adjust_reason) <> '')),
  CONSTRAINT revenue_phase_needs_project CHECK (project_phase_key IS NULL OR project_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_revenue_contact ON app_servicio_proyectos.student_revenue_entries (contact_id, product_id, received_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_product ON app_servicio_proyectos.student_revenue_entries (product_id, received_on DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_revenue_project ON app_servicio_proyectos.student_revenue_entries (project_id) WHERE project_id IS NOT NULL;

ALTER TABLE app_servicio_proyectos.project_ideas ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio_proyectos.student_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio_proyectos.student_revenue_entries ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_proyectos.project_ideas, app_servicio_proyectos.student_projects, app_servicio_proyectos.student_revenue_entries
  FROM public, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON app_servicio_proyectos.project_ideas, app_servicio_proyectos.student_projects,
  app_servicio_proyectos.student_revenue_entries TO service_role;

DROP TRIGGER IF EXISTS set_updated_at ON app_servicio_proyectos.project_ideas;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio_proyectos.project_ideas FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON app_servicio_proyectos.student_projects;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio_proyectos.student_projects FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
DROP TRIGGER IF EXISTS set_updated_at ON app_servicio_proyectos.student_revenue_entries;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio_proyectos.student_revenue_entries FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- Un pago: CO010 (no en una práctica), CO011 (la fase existe en el proyecto), CO012 (misma persona y programa).
CREATE OR REPLACE FUNCTION app_servicio_proyectos.revenue_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  pj app_servicio_proyectos.student_projects;
BEGIN
  IF NEW.project_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO pj FROM app_servicio_proyectos.student_projects WHERE id = NEW.project_id;
  IF pj.id IS NULL THEN RETURN NEW; END IF;
  IF pj.contact_id <> NEW.contact_id OR pj.product_id <> NEW.product_id OR pj.workspace_id <> NEW.workspace_id THEN
    RAISE EXCEPTION 'Ese proyecto no es de esta persona en este programa' USING ERRCODE = 'CO012';
  END IF;
  IF pj.kind = 'practice' THEN
    RAISE EXCEPTION 'Un proyecto de práctica no lleva pagos' USING ERRCODE = 'CO010';
  END IF;
  IF NEW.project_phase_key IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM jsonb_array_elements(pj.phases) ph WHERE ph ->> 'key' = NEW.project_phase_key) THEN
    RAISE EXCEPTION 'Esa fase no existe en el proyecto' USING ERRCODE = 'CO011';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_revenue_guard ON app_servicio_proyectos.student_revenue_entries;
CREATE TRIGGER trg_revenue_guard BEFORE INSERT OR UPDATE OF project_id, project_phase_key, contact_id, product_id
  ON app_servicio_proyectos.student_revenue_entries FOR EACH ROW EXECUTE FUNCTION app_servicio_proyectos.revenue_guard();

-- Un proyecto que pasa a práctica no puede tener pagos (CO010).
CREATE OR REPLACE FUNCTION app_servicio_proyectos.project_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'practice' AND EXISTS (SELECT 1 FROM app_servicio_proyectos.student_revenue_entries r
                                        WHERE r.project_id = NEW.id AND r.deleted_at IS NULL) THEN
    RAISE EXCEPTION 'Un proyecto de práctica no lleva pagos' USING ERRCODE = 'CO010';
  END IF;
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM app_servicio.services s
       WHERE s.id = NEW.service_id AND s.contact_id = NEW.contact_id AND s.product_id = NEW.product_id) THEN
    RAISE EXCEPTION 'Ese servicio no es de esta persona en este programa' USING ERRCODE = 'CO012';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_project_guard ON app_servicio_proyectos.student_projects;
CREATE TRIGGER trg_project_guard BEFORE INSERT OR UPDATE OF kind, service_id, contact_id, product_id
  ON app_servicio_proyectos.student_projects FOR EACH ROW EXECUTE FUNCTION app_servicio_proyectos.project_guard();
REVOKE ALL ON FUNCTION app_servicio_proyectos.revenue_guard(), app_servicio_proyectos.project_guard() FROM PUBLIC, anon, authenticated;

-- ─── 4. Los problemas de un proyecto, en palabras ──────────────────────────
-- Gemela de projectProblems (lib/projects/project.ts). Entrada: {kind, title, client, status, sold_cents, closed_on,
-- service_id, phase_key, phases}. Las CHECK son la red; esto da el texto para mostrar.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.project_problems(p jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  k text := p ->> 'kind';
  st text := p ->> 'status';
  ph jsonb;
  seen text[] := ARRAY[]::text[];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['el proyecto no es válido']; END IF;
  IF NOT COALESCE(k = ANY (ARRAY['real', 'practice', 'challenge']), false) THEN RETURN ARRAY['elegí el tipo de proyecto']; END IF;
  IF jsonb_typeof(p -> 'title') IS DISTINCT FROM 'string' OR char_length(btrim(p ->> 'title')) NOT BETWEEN 1 AND 200 THEN
    v := v || 'escribí el nombre del proyecto (hasta 200 caracteres)'::text;
  END IF;
  IF k = 'practice' THEN
    IF jsonb_typeof(p -> 'client') NOT IN ('null') AND p ? 'client' THEN v := v || 'un proyecto de práctica no tiene cliente'::text; END IF;
    IF p ? 'sold_cents' AND jsonb_typeof(p -> 'sold_cents') <> 'null' THEN v := v || 'un proyecto de práctica no tiene monto'::text; END IF;
    IF p ? 'status' AND jsonb_typeof(p -> 'status') <> 'null' THEN v := v || 'un proyecto de práctica no tiene estado de venta'::text; END IF;
  END IF;
  IF k = 'challenge' AND (jsonb_typeof(p -> 'service_id') IS DISTINCT FROM 'string' OR jsonb_typeof(p -> 'phase_key') IS DISTINCT FROM 'string') THEN
    v := v || 'un proyecto del reto va ligado a la fase Reto de tu servicio'::text;
  END IF;
  IF k = 'real' THEN
    IF NOT COALESCE(st = ANY (ARRAY['draft', 'proposal_sent', 'won', 'in_build', 'delivered', 'lost']), false) THEN
      v := v || 'elegí el estado del proyecto'::text;
    ELSIF st IN ('won', 'in_build', 'delivered') AND (jsonb_typeof(p -> 'closed_on') IS DISTINCT FROM 'string' OR (p ->> 'closed_on') !~ '^\d{4}-\d{2}-\d{2}$') THEN
      v := v || 'desde Ganado, la fecha de cierre es obligatoria'::text;
    END IF;
    IF p ? 'client' AND jsonb_typeof(p -> 'client') NOT IN ('object', 'null') THEN v := v || 'los datos del cliente no son válidos'::text; END IF;
    IF p ? 'sold_cents' AND jsonb_typeof(p -> 'sold_cents') <> 'null'
       AND NOT (jsonb_typeof(p -> 'sold_cents') = 'number' AND (p ->> 'sold_cents')::numeric >= 0 AND (p ->> 'sold_cents')::numeric = trunc((p ->> 'sold_cents')::numeric)) THEN
      v := v || 'el monto vendido tiene que ser un número positivo'::text;
    END IF;
  END IF;
  IF p ? 'phases' THEN
    IF jsonb_typeof(p -> 'phases') <> 'array' THEN v := v || 'las fases del proyecto no son válidas'::text;
    ELSE
      FOR ph IN SELECT x FROM jsonb_array_elements(p -> 'phases') x LOOP
        IF jsonb_typeof(ph) <> 'object' OR jsonb_typeof(ph -> 'key') IS DISTINCT FROM 'string' OR (ph ->> 'key') !~ '^[a-z0-9_]{1,40}$'
           OR jsonb_typeof(ph -> 'name') IS DISTINCT FROM 'string' OR btrim(ph ->> 'name') = '' THEN
          v := v || 'hay una fase sin nombre'::text; CONTINUE;
        END IF;
        IF (ph ->> 'key') = ANY (seen) THEN v := v || format('la fase %s está repetida', ph ->> 'name'); END IF;
        seen := seen || (ph ->> 'key');
        IF k = 'practice' THEN v := v || 'un proyecto de práctica no se vende por fases'::text; EXIT; END IF;
        IF ph ? 'price_cents' AND jsonb_typeof(ph -> 'price_cents') <> 'null' AND NOT (jsonb_typeof(ph -> 'price_cents') = 'number' AND (ph ->> 'price_cents')::numeric >= 0) THEN
          v := v || format('el precio de la fase %s no es válido', ph ->> 'name');
        END IF;
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$$;

-- ─── 5. La facturación ──────────────────────────────────────────────────────
CREATE OR REPLACE VIEW app_servicio_proyectos.student_revenue_totals AS
  SELECT r.workspace_id, r.contact_id, r.product_id,
         sum(r.amount_cents)::bigint AS total_cents,
         COALESCE(sum(r.amount_cents) FILTER (WHERE r.verified_at IS NOT NULL OR r.kind = 'adjustment'), 0)::bigint AS verified_cents,
         COALESCE(sum(r.amount_cents) FILTER (WHERE r.before_program), 0)::bigint AS before_program_cents,
         COALESCE(sum(r.amount_cents) FILTER (WHERE r.verified_at IS NULL AND r.kind = 'payment'), 0)::bigint AS pending_cents,
         count(*) FILTER (WHERE r.kind = 'payment' AND r.receipt_path IS NULL AND r.verified_at IS NULL)::integer AS without_receipt
    FROM app_servicio_proyectos.student_revenue_entries r
   WHERE r.deleted_at IS NULL
   GROUP BY r.workspace_id, r.contact_id, r.product_id;
REVOKE ALL ON app_servicio_proyectos.student_revenue_totals FROM public, anon, authenticated;
GRANT SELECT ON app_servicio_proyectos.student_revenue_totals TO service_role;

-- ─── 6. Sala de la fama ─────────────────────────────────────────────────────
-- Pura. entries: [{contact_id, kind, amount_cents, received_on, before_program, verified}]; projects: [{contact_id, kind,
-- status, sold_cents, closed_on}]; settings: products.portal_settings.fame; period: 'all' | 'month'; today: fecha del
-- negocio. Devuelve [{contact_id, amount_cents, projects_won}] ordenado de mayor a menor (empate: más proyectos, contact_id).
CREATE OR REPLACE FUNCTION app_servicio_proyectos.fame_plan(p_entries jsonb, p_projects jsonb, p_settings jsonb, p_period text, p_today date)
RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH s AS (
    SELECT COALESCE(NULLIF(p_settings ->> 'counts', ''), 'paid') AS counts,
           COALESCE((p_settings ->> 'verified_only')::boolean, true) AS verified_only,
           COALESCE((p_settings ->> 'include_before_program')::boolean, false) AS before_ok,
           date_trunc('month', p_today)::date AS m0
  ), e AS (
    SELECT x ->> 'contact_id' AS contact_id, (x ->> 'amount_cents')::bigint AS amount, (x ->> 'received_on')::date AS d,
           x ->> 'kind' AS kind, COALESCE((x ->> 'before_program')::boolean, false) AS before, COALESCE((x ->> 'verified')::boolean, false) AS verified
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_entries) = 'array' THEN p_entries ELSE '[]'::jsonb END) x
  ), pj AS (
    SELECT x ->> 'contact_id' AS contact_id, x ->> 'kind' AS kind, x ->> 'status' AS status,
           COALESCE((x ->> 'sold_cents')::bigint, 0) AS sold, NULLIF(x ->> 'closed_on', '')::date AS closed_on
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_projects) = 'array' THEN p_projects ELSE '[]'::jsonb END) x
  ), won AS (
    SELECT pj.* FROM pj, s WHERE pj.kind <> 'practice' AND pj.status IN ('won', 'in_build', 'delivered')
       AND (p_period <> 'month' OR (pj.closed_on >= s.m0 AND pj.closed_on <= p_today))
  ), paid AS (
    SELECT e.contact_id, sum(e.amount) AS amount FROM e, s
     WHERE (e.kind = 'adjustment' OR NOT s.verified_only OR e.verified)
       AND (s.before_ok OR NOT e.before)
       AND (p_period <> 'month' OR (e.d >= s.m0 AND e.d <= p_today))
     GROUP BY e.contact_id
  ), sold AS (
    SELECT contact_id, sum(sold) AS amount FROM won GROUP BY contact_id
  ), wc AS (
    SELECT contact_id, count(*) AS n FROM won GROUP BY contact_id
  ), r AS (
    SELECT c.contact_id, GREATEST(COALESCE(CASE WHEN s.counts = 'sold' THEN sold.amount ELSE paid.amount END, 0), 0)::bigint AS amount,
           COALESCE(wc.n, 0)::integer AS projects_won
      FROM (SELECT contact_id FROM paid UNION SELECT contact_id FROM sold) c
      CROSS JOIN s
      LEFT JOIN paid ON paid.contact_id = c.contact_id
      LEFT JOIN sold ON sold.contact_id = c.contact_id
      LEFT JOIN wc ON wc.contact_id = c.contact_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('contact_id', contact_id, 'amount_cents', amount, 'projects_won', projects_won)
                            ORDER BY amount DESC, projects_won DESC, contact_id), '[]'::jsonb)
    FROM r WHERE amount > 0;
$$;

-- Junta los datos del programa y llama a fame_plan. Solo personas con un servicio que no es de prueba en el programa.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.fame_ranking(p_product_id uuid, p_period text DEFAULT 'all')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
BEGIN
  SELECT id, workspace_id, COALESCE(portal_settings -> 'fame', '{}'::jsonb) AS fame INTO pr FROM public.products WHERE id = p_product_id;
  IF pr.id IS NULL OR NOT app_servicio_proyectos.enabled(pr.workspace_id) THEN RETURN '[]'::jsonb; END IF;
  RETURN app_servicio_proyectos.fame_plan(
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('contact_id', r.contact_id, 'kind', r.kind, 'amount_cents', r.amount_cents,
                                                  'received_on', r.received_on, 'before_program', r.before_program, 'verified', r.verified_at IS NOT NULL)), '[]'::jsonb)
       FROM app_servicio_proyectos.student_revenue_entries r
      WHERE r.product_id = pr.id AND r.deleted_at IS NULL
        AND EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = r.contact_id AND s.product_id = pr.id AND NOT s.is_test)),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object('contact_id', p.contact_id, 'kind', p.kind, 'status', p.status, 'sold_cents', p.sold_cents,
                                                  'closed_on', p.closed_on)), '[]'::jsonb)
       FROM app_servicio_proyectos.student_projects p
      WHERE p.product_id = pr.id AND p.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM app_servicio.services s WHERE s.contact_id = p.contact_id AND s.product_id = pr.id AND NOT s.is_test)),
    pr.fame, COALESCE(NULLIF(p_period, ''), 'all'), (now() AT TIME ZONE app_servicio.ws_tz(pr.workspace_id))::date);
END;
$$;

-- ─── 7. Buckets ─────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('student-projects', 'student-projects', false, 10485760,
        ARRAY['text/markdown', 'text/x-markdown', 'text/plain', 'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/vtt', 'application/x-subrip']),
       ('student-revenue', 'student-revenue', false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO NOTHING;

-- ─── 8. Corridas del revisor ────────────────────────────────────────────────
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_check;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_check CHECK ((source = ANY (ARRAY['agent'::text, 'flow_ai_node'::text,
  'sequence_ai_step'::text, 'kb_indexing'::text, 'conversation_summary'::text, 'message_classification'::text,
  'message_classification_eval'::text, 'content_copy'::text, 'ads_analysis'::text, 'audio_transcription'::text,
  'media_description'::text, 'call_classification'::text, 'call_analysis'::text, 'call_correction'::text, 'call_summary'::text,
  'call_prompt_test'::text, 'ads_matching'::text, 'designer'::text, 'portal_tutor'::text, 'portal_project_review'::text])));
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_only_for_agent_sources;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_agent_only_for_agent_sources CHECK (((agent_id IS NULL) OR (source = ANY (ARRAY['agent'::text,
  'conversation_summary'::text, 'content_copy'::text, 'portal_tutor'::text, 'portal_project_review'::text]))));

-- ─── 9. El revisor de proyectos ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.tutor_agent_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' AND NEW.type = 'student_tutor' THEN
    RAISE EXCEPTION 'El tutor de un programa se crea al prender el Asistente IA del programa' USING ERRCODE = 'SV003';
  END IF;
  IF TG_OP = 'INSERT' AND NEW.type = 'project_reviewer' THEN
    RAISE EXCEPTION 'El revisor de proyectos se crea al prender Mis proyectos en el programa' USING ERRCODE = 'SV003';
  END IF;
  IF TG_OP = 'UPDATE' AND (OLD.type IN ('student_tutor', 'project_reviewer') OR NEW.type IN ('student_tutor', 'project_reviewer'))
     AND (NEW.type IS DISTINCT FROM OLD.type OR (NEW.config ->> 'program_id') IS DISTINCT FROM (OLD.config ->> 'program_id')) THEN
    RAISE EXCEPTION 'El programa de un tutor o un revisor no se cambia' USING ERRCODE = 'SV003';
  END IF;
  RETURN NEW;
END;
$$;

-- Crea (o vuelve a prender) el revisor del programa. Idempotente, con bloqueo por producto: nunca dos.
CREATE OR REPLACE FUNCTION app_servicio_proyectos.projects_ensure_reviewer(p_product_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  pr record;
  v_id uuid;
BEGIN
  SELECT id, workspace_id, name, portal_settings INTO pr FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF pr.id IS NULL THEN RAISE EXCEPTION 'No existe el programa' USING ERRCODE = 'SV002'; END IF;
  IF NOT app_servicio.is_system() AND NOT (public.is_workspace_member(pr.workspace_id)
       AND (public.has_permission(pr.workspace_id, 'projects.templates') OR public.has_permission(pr.workspace_id, 'portal.sections'))) THEN
    RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004';
  END IF;
  IF NOT app_servicio_proyectos.enabled(pr.workspace_id) THEN RAISE EXCEPTION 'La extensión de proyectos está apagada' USING ERRCODE = 'SV005'; END IF;
  v_id := NULLIF(pr.portal_settings #>> '{projects,reviewer_agent_id}', '')::uuid;
  IF v_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.agents a WHERE a.id = v_id AND a.deleted_at IS NULL AND a.type = 'project_reviewer') THEN
    UPDATE public.agents SET is_enabled = true, updated_at = now() WHERE id = v_id AND NOT is_enabled;
    RETURN v_id;
  END IF;
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, knowledge_enabled, daily_cost_limit_action, monthly_cost_limit_action, config, created_by)
  VALUES (pr.workspace_id, left('Revisor de proyectos · ' || pr.name, 80), 'project_reviewer', true, false, 'notify', 'notify',
          jsonb_build_object('program_id', pr.id), CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  UPDATE public.products
     SET portal_settings = jsonb_set(COALESCE(portal_settings, '{}'::jsonb), '{projects}',
                                     COALESCE(portal_settings -> 'projects', '{}'::jsonb) || jsonb_build_object('reviewer_agent_id', v_id)),
         portal_settings_rev = portal_settings_rev + 1
   WHERE id = pr.id;
  PERFORM app_servicio.audit(pr.workspace_id, 'product', pr.id, 'projects.reviewer_created', jsonb_build_object('agent_id', v_id));
  RETURN v_id;
END;
$$;

-- ─── 10. Secciones y claves de la extensión ─────────────────────────────────
-- Las secciones `fame` y `projects` existen siempre en la base (CHECK de portal_access); se OFRECEN con la extensión.
CREATE OR REPLACE FUNCTION app_servicio.portal_section_rule_problems(p_rule jsonb, p_ext boolean)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  sec text := p_rule ->> 'section';
  v text[];
BEGIN
  IF p_ext AND sec IN ('fame', 'projects') THEN
    -- Mismas reglas que las demás: se valida como si fuera una sección ofrecida y se saca el «no disponible».
    v := app_servicio.portal_section_rule_problems(jsonb_set(p_rule, '{section}', '"community"'));
    RETURN (SELECT COALESCE(array_agg(replace(x, 'community:', sec || ':')), ARRAY[]::text[]) FROM unnest(v) x);
  END IF;
  RETURN app_servicio.portal_section_rule_problems(p_rule);
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_variant_portal_settings(p jsonb, p_variant_id uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  s jsonb;
  v_seen text[] := ARRAY[]::text[];
  v_ext boolean := COALESCE((SELECT app_servicio_proyectos.enabled(pr.workspace_id) FROM public.product_variants pv
                              JOIN public.products pr ON pr.id = pv.product_id WHERE pv.id = p_variant_id), false);
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['v','enabled','ask_terms','sections']);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'enabled' AND jsonb_typeof(p -> 'enabled') <> 'boolean' THEN v := v || '«Acceso al portal» tiene que ser sí o no'::text; END IF;
  IF p ? 'ask_terms' AND jsonb_typeof(p -> 'ask_terms') <> 'boolean' THEN v := v || '«Esta variante los pide» tiene que ser sí o no'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'array' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR s IN SELECT x FROM jsonb_array_elements(p -> 'sections') x LOOP
        IF jsonb_typeof(s) <> 'object' THEN v := v || 'hay una sección que no es válida'::text; CONTINUE; END IF;
        IF jsonb_typeof(s -> 'section') = 'string' THEN
          IF (s ->> 'section') = ANY (v_seen) THEN v := v || format('la sección %s está repetida', s ->> 'section'); END IF;
          v_seen := v_seen || (s ->> 'section');
        END IF;
        v := v || app_servicio.portal_section_rule_problems(s, v_ext);
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$$;

-- La forma de `fame` (F80) y de `projects` (F118, F119) del programa. Gemela de fameSettingsProblems y
-- projectsSettingsProblems (lib/projects/settings.ts, casos en lib/projects/settings.cases.json).
CREATE OR REPLACE FUNCTION app_servicio_proyectos.fame_settings_problems(f jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  prev numeric := 0;
  m jsonb;
BEGIN
  IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RETURN ARRAY['la Sala de la fama no es válida']; END IF;
  v := v || app_servicio.unknown_keys(f, ARRAY['counts','verified_only','include_before_program','milestones','first_project_milestone']);
  IF f ? 'counts' AND NOT COALESCE(f ->> 'counts' = ANY (ARRAY['paid','sold']), false) THEN v := v || 'elegí qué cuenta: lo cobrado o lo vendido'::text; END IF;
  IF (f ? 'verified_only' AND jsonb_typeof(f -> 'verified_only') <> 'boolean')
     OR (f ? 'include_before_program' AND jsonb_typeof(f -> 'include_before_program') <> 'boolean')
     OR (f ? 'first_project_milestone' AND jsonb_typeof(f -> 'first_project_milestone') <> 'boolean') THEN
    v := v || 'las opciones de la Sala de la fama tienen que ser sí o no'::text;
  END IF;
  IF f ? 'milestones' THEN
    IF jsonb_typeof(f -> 'milestones') <> 'array' OR jsonb_array_length(f -> 'milestones') > 10 THEN
      v := v || 'los hitos tienen que ser una lista de hasta 10 montos'::text;
    ELSE
      FOR m IN SELECT x FROM jsonb_array_elements(f -> 'milestones') x LOOP
        IF NOT app_servicio.j_int(m) OR app_servicio.j_num(m) <= prev THEN v := v || 'los hitos van de menor a mayor, en montos positivos'::text; EXIT; END IF;
        prev := app_servicio.j_num(m);
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio_proyectos.projects_settings_problems(p jsonb)
RETURNS text[] LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  st jsonb; d jsonb; b jsonb; t jsonb;
  seen text[] := ARRAY[]::text[];
  sizes text[] := ARRAY[]::text[];
BEGIN
  IF jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RETURN ARRAY['Mis proyectos no es válido']; END IF;
  v := v || app_servicio.unknown_keys(p, ARRAY['reviewer_agent_id','steps','budget_ranges']);
  IF p ? 'reviewer_agent_id' AND jsonb_typeof(p -> 'reviewer_agent_id') <> 'null' AND NOT app_servicio.j_uuid(p -> 'reviewer_agent_id') THEN
    v := v || 'el revisor no es válido'::text;
  END IF;
  IF p ? 'steps' THEN
    IF jsonb_typeof(p -> 'steps') <> 'array' OR jsonb_array_length(p -> 'steps') > 20 THEN v := v || 'los pasos tienen que ser una lista de hasta 20'::text;
    ELSE
      FOR st IN SELECT x FROM jsonb_array_elements(p -> 'steps') x LOOP
        IF jsonb_typeof(st) <> 'object' OR jsonb_typeof(st -> 'key') IS DISTINCT FROM 'string' OR (st ->> 'key') !~ '^[a-z0-9_]{1,40}$'
           OR jsonb_typeof(st -> 'name') IS DISTINCT FROM 'string' OR char_length(btrim(st ->> 'name')) NOT BETWEEN 1 AND 80 THEN
          v := v || 'hay un paso sin nombre o con una clave inválida'::text; CONTINUE;
        END IF;
        v := v || app_servicio.unknown_keys(st, ARRAY['key','name','description','depends_on','prompt','analysis','tasks','lesson_item_id','fields']);
        IF (st ->> 'key') = ANY (seen) THEN v := v || format('el paso %s está repetido', st ->> 'name'); END IF;
        IF st ? 'depends_on' THEN
          IF jsonb_typeof(st -> 'depends_on') <> 'array' THEN v := v || format('%s: los documentos que usa no son válidos', st ->> 'name');
          ELSE
            FOR d IN SELECT x FROM jsonb_array_elements(st -> 'depends_on') x LOOP
              IF jsonb_typeof(d) <> 'string' OR NOT ((d #>> '{}') = ANY (seen)) THEN
                v := v || format('%s: solo puede usar documentos de pasos anteriores', st ->> 'name'); EXIT;
              END IF;
            END LOOP;
          END IF;
        END IF;
        FOREACH t IN ARRAY ARRAY[st -> 'prompt', st -> 'analysis'] LOOP
          IF t IS NOT NULL AND jsonb_typeof(t) <> 'null' AND NOT (jsonb_typeof(t) = 'object' AND jsonb_typeof(t -> 'text') = 'string'
               AND char_length(t ->> 'text') <= 50000 AND app_servicio.j_int(t -> 'version') AND app_servicio.j_num(t -> 'version') >= 1) THEN
            v := v || format('%s: las instrucciones no son válidas', st ->> 'name');
          END IF;
        END LOOP;
        IF st ? 'tasks' AND NOT (jsonb_typeof(st -> 'tasks') = 'array' AND jsonb_array_length(st -> 'tasks') <= 20
             AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(st -> 'tasks') x WHERE jsonb_typeof(x) <> 'string' OR char_length(x #>> '{}') NOT BETWEEN 1 AND 200)) THEN
          v := v || format('%s: las tareas no son válidas', st ->> 'name');
        END IF;
        IF st ? 'lesson_item_id' AND jsonb_typeof(st -> 'lesson_item_id') <> 'null' AND NOT app_servicio.j_uuid(st -> 'lesson_item_id') THEN
          v := v || format('%s: la clase no es válida', st ->> 'name');
        END IF;
        seen := seen || (st ->> 'key');
      END LOOP;
    END IF;
  END IF;
  IF p ? 'budget_ranges' THEN
    IF jsonb_typeof(p -> 'budget_ranges') <> 'array' THEN v := v || 'los rangos de presupuesto no son válidos'::text;
    ELSE
      FOR b IN SELECT x FROM jsonb_array_elements(p -> 'budget_ranges') x LOOP
        IF jsonb_typeof(b) <> 'object' OR NOT COALESCE(b ->> 'size' = ANY (ARRAY['small','medium','large']), false)
           OR NOT app_servicio.j_int(b -> 'min_cents') OR NOT app_servicio.j_int(b -> 'max_cents') OR app_servicio.j_num(b -> 'min_cents') < 0 THEN
          v := v || 'cada rango lleva tamaño, mínimo y máximo'::text; CONTINUE;
        END IF;
        IF app_servicio.j_num(b -> 'min_cents') > app_servicio.j_num(b -> 'max_cents') THEN v := v || format('el rango %s tiene el mínimo mayor que el máximo', b ->> 'size'); END IF;
        IF (b ->> 'size') = ANY (sizes) THEN v := v || format('el rango %s está repetido', b ->> 'size'); END IF;
        sizes := sizes || (b ->> 'size');
      END LOOP;
    END IF;
  END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.validate_program_portal_settings(p jsonb, p_product_id uuid DEFAULT NULL)
RETURNS text[] LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v text[] := ARRAY[]::text[];
  k text; t jsonb; c jsonb; sp jsonb; a jsonb;
  v_keys text[] := ARRAY[]::text[];
  v_ext boolean := COALESCE((SELECT app_servicio_proyectos.enabled(pr.workspace_id) FROM public.products pr WHERE pr.id = p_product_id), false);
  v_allowed text[] := ARRAY['v','sections','terms','community','affiliates','assistant','notifications','points'];
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN RETURN ARRAY['la configuración tiene que ser un objeto']; END IF;
  IF v_ext THEN v_allowed := v_allowed || ARRAY['fame','projects']; END IF;
  v := v || app_servicio.unknown_keys(p, v_allowed);
  IF p ? 'v' AND p -> 'v' <> '1'::jsonb THEN v := v || 'versión desconocida'::text; END IF;
  IF p ? 'sections' THEN
    IF jsonb_typeof(p -> 'sections') <> 'object' THEN v := v || 'las secciones no son válidas'::text;
    ELSE
      FOR k IN SELECT key FROM jsonb_object_keys(p -> 'sections') WITH ORDINALITY AS t(key, ord) ORDER BY ord LOOP
        IF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates','fame','projects']), false) THEN v := v || ('sección desconocida: ' || k);
        ELSIF NOT COALESCE(k = ANY (ARRAY['program','calendar','challenge','certificate','assistant','community','affiliates']), false) AND NOT v_ext THEN v := v || 'Todavía no está disponible'::text;
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
  IF p ? 'points' THEN v := v || app_servicio.points_settings_problems(p -> 'points'); END IF;
  -- Corrida C: la Sala de la fama y Mis proyectos (solo con la extensión; si no, ya cayeron como clave desconocida).
  IF v_ext AND p ? 'fame' THEN v := v || app_servicio_proyectos.fame_settings_problems(p -> 'fame'); END IF;
  IF v_ext AND p ? 'projects' THEN v := v || app_servicio_proyectos.projects_settings_problems(p -> 'projects'); END IF;
  RETURN v;
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.portal_section_enabled(p_product_id uuid, p_section text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE((SELECT COALESCE((pr.portal_settings #>> ARRAY['sections', p_section])::boolean, true)
                     AND (p_section NOT IN ('fame', 'projects') OR app_servicio_proyectos.enabled(pr.workspace_id))
                     FROM public.products pr WHERE pr.id = p_product_id), false)
     AND p_section IN ('program', 'calendar', 'challenge', 'certificate', 'assistant', 'community', 'affiliates', 'fame', 'projects');
$$;

-- ─── 11. Unir contactos ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio_proyectos.merge_contacts_hook(p_main uuid, p_duplicate uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  a integer;
  b integer;
BEGIN
  UPDATE app_servicio_proyectos.student_projects SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS a = ROW_COUNT;
  UPDATE app_servicio_proyectos.student_revenue_entries SET contact_id = p_main WHERE contact_id = p_duplicate;
  GET DIAGNOSTICS b = ROW_COUNT;
  RETURN jsonb_build_object('student_projects', a, 'student_revenue_entries', b);
END;
$$;

-- ─── Permisos de ejecución ──────────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio_proyectos.enabled(uuid), app_servicio_proyectos.project_problems(jsonb),
  app_servicio_proyectos.fame_plan(jsonb, jsonb, jsonb, text, date), app_servicio_proyectos.fame_ranking(uuid, text),
  app_servicio_proyectos.projects_ensure_reviewer(uuid), app_servicio_proyectos.fame_settings_problems(jsonb),
  app_servicio_proyectos.projects_settings_problems(jsonb), app_servicio_proyectos.merge_contacts_hook(uuid, uuid),
  app_servicio.portal_section_rule_problems(jsonb, boolean)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio_proyectos.enabled(uuid), app_servicio_proyectos.project_problems(jsonb),
  app_servicio_proyectos.fame_plan(jsonb, jsonb, jsonb, text, date), app_servicio_proyectos.fame_ranking(uuid, text),
  app_servicio_proyectos.projects_ensure_reviewer(uuid), app_servicio_proyectos.fame_settings_problems(jsonb),
  app_servicio_proyectos.projects_settings_problems(jsonb), app_servicio_proyectos.merge_contacts_hook(uuid, uuid),
  app_servicio.portal_section_rule_problems(jsonb, boolean)
TO service_role;
