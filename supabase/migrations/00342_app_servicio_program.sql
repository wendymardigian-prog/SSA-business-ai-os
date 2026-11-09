-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00342_app_servicio_program  (Servicios v12, Corrida A1 · S10 · bloque PR)
-- ============================================================================
-- 1. `app_servicio.program_items` (§8.2 #4, F45): modulos, submodulos (un nivel) y clases del PRODUCTO. Estructura
--    por trigger (PR001). Lo nuevo nace inactivo. Escribe solo el servidor (`program_*`, con `program.manage` y
--    `program.activate`); lee el equipo con `program.manage`, `services.configure` o `services.view`.
-- 2. `app_servicio_portal.program_progress` (§8.2 #11, F48): el avance POR PERSONA (contacto + clase). Lo escribe el
--    portal (Parte 2) y lo abierto a mano o por el camino (`unlocked_at`). Trigger: una clase completa completa su
--    padre cuando todas sus clases ACTIVAS estan completas (submodulo → modulo), emite `program_lesson_completed` /
--    `program_module_completed`, completa los pasos del camino con ese `ref.program_item_id` y abre las secciones
--    «al completar un modulo». Nunca tumba la escritura del avance (EXCEPTION).
-- 3. Gemela pura `program_unlock_plan(jsonb)` (casos en lib/program/unlock.cases.json) y `program_item_unlocked(contact,
--    item)`, que arma la cadena y el contexto de la persona y la llama.
-- 4. `svc_open_module` (punto vacio de la 00333) abre un modulo o clase a una persona.
-- 5. `knowledge_base.program_item_id` y `knowledge_chunks.start_second` (F49).
-- 6. Bucket privado `program-resources` (sin politicas: sube y lee el servidor).
-- `program_live_recordings` (F51) va con el Calendario (S12): nombra tablas que nacen ahi.
--
-- Aditiva + reemplaza una funcion vacia de la 00333 (`svc_open_module`, era `BEGIN RETURN; END`). Puede ir antes o
-- despues del codigo. Con el modulo apagado no cambia nada (el trigger sale al principio).
--
-- Cómo volver atrás:
--   DROP TABLE IF EXISTS app_servicio_portal.program_progress;
--   DROP TABLE IF EXISTS app_servicio.program_items CASCADE;
--   ALTER TABLE public.knowledge_base DROP COLUMN IF EXISTS program_item_id;
--   ALTER TABLE public.knowledge_chunks DROP COLUMN IF EXISTS start_second;
--   DELETE FROM storage.buckets WHERE id = 'program-resources';   -- (vaciarlo antes)
--   DROP FUNCTION de cada funcion nueva; y svc_open_module vuelve a ser vacia:
--     CREATE OR REPLACE FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text)
--     RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$ BEGIN RETURN; END; $$;
--
-- Riesgo: bajo (columnas nuevas NULL en knowledge_*; el resto es nuevo).
-- ============================================================================

-- ─── 1. El arbol del programa ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.program_items (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_id        uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  parent_id         uuid NULL REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  kind              text NOT NULL,
  lesson_type       text NULL,
  title             text NOT NULL,
  description       text NULL,
  position          integer NOT NULL DEFAULT 0,
  status            text NOT NULL DEFAULT 'inactive',
  video_url         text NULL,
  video_embed_url   text NULL,
  duration_seconds  integer NULL,
  html_content      text NULL,
  document_path     text NULL,
  form_id           uuid NULL REFERENCES public.forms(id) ON DELETE SET NULL,
  resources         jsonb NOT NULL DEFAULT '[]'::jsonb,
  cover_path        text NULL,
  thumbnail_path    text NULL,
  thumbnail_url     text NULL,
  comments_enabled  boolean NOT NULL DEFAULT true,
  unlock_rule       jsonb NOT NULL DEFAULT '{"type":"open"}'::jsonb,
  required          boolean NOT NULL DEFAULT true,
  source_call_id    uuid NULL REFERENCES public.calls(id) ON DELETE SET NULL,
  copied_from_id    uuid NULL,
  created_by        uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_items_kind_check CHECK (kind IN ('module', 'submodule', 'lesson')),
  CONSTRAINT program_items_lesson_type_check CHECK ((kind = 'lesson' AND lesson_type IN ('video', 'html', 'document', 'quiz', 'activity')) OR (kind <> 'lesson' AND lesson_type IS NULL)),
  CONSTRAINT program_items_status_check CHECK (status IN ('inactive', 'active', 'archived')),
  CONSTRAINT program_items_title_check CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  CONSTRAINT program_items_html_size CHECK (html_content IS NULL OR octet_length(html_content) <= 1048576),
  CONSTRAINT program_items_duration_check CHECK (duration_seconds IS NULL OR duration_seconds >= 0),
  CONSTRAINT program_items_resources_check CHECK (jsonb_typeof(resources) = 'array'),
  CONSTRAINT program_items_unlock_check CHECK (jsonb_typeof(unlock_rule) = 'object'),
  CONSTRAINT program_items_not_self CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX IF NOT EXISTS idx_program_items_tree ON app_servicio.program_items (product_id, parent_id, position);
CREATE INDEX IF NOT EXISTS idx_program_items_ws ON app_servicio.program_items (workspace_id);
COMMENT ON TABLE app_servicio.program_items IS
  'Servicios v12 (F45): el contenido del programa de un producto. Lo nuevo nace inactivo; se archiva, no se borra. Escribe solo el servidor (00342).';

-- La estructura (PR001): un submodulo cuelga de un modulo; una clase, de un modulo o un submodulo; todo del mismo
-- producto y negocio. Nunca lanza otra cosa que PR001.
CREATE OR REPLACE FUNCTION app_servicio.program_items_structure()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  p record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.products pr WHERE pr.id = NEW.product_id AND pr.workspace_id = NEW.workspace_id) THEN
    RAISE EXCEPTION 'El producto no es de este negocio' USING ERRCODE = 'PR001';
  END IF;
  IF NEW.kind = 'module' THEN
    IF NEW.parent_id IS NOT NULL THEN RAISE EXCEPTION 'Un módulo no cuelga de nada' USING ERRCODE = 'PR001'; END IF;
  ELSE
    SELECT id, kind, product_id INTO p FROM app_servicio.program_items WHERE id = NEW.parent_id;
    IF p.id IS NULL OR p.product_id <> NEW.product_id THEN RAISE EXCEPTION 'Elegí dónde va (un módulo de este programa)' USING ERRCODE = 'PR001'; END IF;
    IF NEW.kind = 'submodule' AND p.kind <> 'module' THEN RAISE EXCEPTION 'Un submódulo cuelga de un módulo' USING ERRCODE = 'PR001'; END IF;
    IF NEW.kind = 'lesson' AND p.kind NOT IN ('module', 'submodule') THEN RAISE EXCEPTION 'Una clase cuelga de un módulo o un submódulo' USING ERRCODE = 'PR001'; END IF;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.kind <> OLD.kind AND EXISTS (SELECT 1 FROM app_servicio.program_items c WHERE c.parent_id = NEW.id) THEN
    RAISE EXCEPTION 'No se cambia el tipo de algo que tiene contenido adentro' USING ERRCODE = 'PR001';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_program_items_structure ON app_servicio.program_items;
CREATE TRIGGER trg_program_items_structure BEFORE INSERT OR UPDATE ON app_servicio.program_items
  FOR EACH ROW EXECUTE FUNCTION app_servicio.program_items_structure();

ALTER TABLE app_servicio.program_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS program_items_select ON app_servicio.program_items;
CREATE POLICY program_items_select ON app_servicio.program_items FOR SELECT TO authenticated USING (
  public.is_workspace_member(workspace_id)
  AND (public.has_permission(workspace_id, 'program.manage') OR public.has_permission(workspace_id, 'services.configure')
       OR public.has_permission(workspace_id, 'services.view') OR public.has_permission(workspace_id, 'portal.view'))
);
REVOKE ALL ON app_servicio.program_items FROM public, anon, authenticated;
GRANT SELECT ON app_servicio.program_items TO authenticated;
GRANT ALL ON app_servicio.program_items TO service_role;

-- ─── 2. El avance por persona ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio_portal.program_progress (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id             uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  program_item_id        uuid NOT NULL REFERENCES app_servicio.program_items(id) ON DELETE CASCADE,
  viewed_at              timestamptz NULL,
  completed_at           timestamptz NULL,
  unlocked_at            timestamptz NULL,
  unlock_source          text NULL,
  last_position_seconds  integer NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_progress_unlock_check CHECK (unlock_source IS NULL OR unlock_source IN ('journey_item', 'automation', 'team')),
  CONSTRAINT program_progress_position_check CHECK (last_position_seconds IS NULL OR last_position_seconds >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_program_progress ON app_servicio_portal.program_progress (contact_id, program_item_id);
CREATE INDEX IF NOT EXISTS idx_program_progress_item ON app_servicio_portal.program_progress (program_item_id);
COMMENT ON TABLE app_servicio_portal.program_progress IS
  'Servicios v12 (F48): el avance de una persona en el programa. Una fila por contacto y clase (o modulo). Lo escribe el portal (Parte 2) y lo abierto a mano o por el camino.';
ALTER TABLE app_servicio_portal.program_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio_portal.program_progress FROM public, anon, authenticated;
GRANT ALL ON app_servicio_portal.program_progress TO service_role;

-- ─── 3. Conocimiento y bucket ───────────────────────────────────────────────
ALTER TABLE public.knowledge_base ADD COLUMN IF NOT EXISTS program_item_id uuid NULL REFERENCES app_servicio.program_items(id) ON DELETE SET NULL;
ALTER TABLE public.knowledge_chunks ADD COLUMN IF NOT EXISTS start_second integer NULL;
COMMENT ON COLUMN public.knowledge_base.program_item_id IS 'Servicios v12 (F49): la clase del programa de la que salio esta transcripcion. NULL en todo lo demas.';
COMMENT ON COLUMN public.knowledge_chunks.start_second IS 'Servicios v12 (F49): el segundo del video donde empieza este fragmento. NULL si no se sabe.';
CREATE INDEX IF NOT EXISTS idx_knowledge_base_program_item ON public.knowledge_base (program_item_id) WHERE program_item_id IS NOT NULL;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('program-resources', 'program-resources', false, 20971520, NULL)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

-- ─── 4. La gemela del desbloqueo (lib/program/unlock.ts) ────────────────────
CREATE OR REPLACE FUNCTION app_servicio.program_unlock_plan(p jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
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
      WHEN t IN ('fixed_date', 'days_after_start') THEN CASE WHEN v_opens IS NULL THEN 'Se abre cuando empiece tu acceso' ELSE 'Se abre el ' || to_char(v_opens, 'DD/MM/YYYY') END
      WHEN t = 'after_complete' THEN 'Se abre cuando completes lo anterior'
      WHEN t = 'challenge_started' THEN 'Se abre cuando empiece el Reto'
      ELSE COALESCE(NULLIF(r ->> 'locked_text', ''), 'Todavía no está disponible') END;
    RETURN jsonb_build_object('visible', true, 'unlocked', false, 'included', true, 'display', v_display, 'reason', v_reason,
                              'opensOn', CASE WHEN v_own AND v_opens IS NOT NULL THEN to_char(v_opens, 'YYYY-MM-DD') END);
  END LOOP;
  RETURN jsonb_build_object('visible', true, 'unlocked', true, 'included', true, 'display', 'open', 'reason', NULL, 'opensOn', NULL);
END;
$$;

-- Lo que una persona ve de un modulo o clase: arma la cadena (de la raiz al item), lo que su variante incluye (la
-- union de sus servicios vigentes, F101) y su contexto, y llama a la gemela.
CREATE OR REPLACE FUNCTION app_servicio.program_item_unlocked(p_contact_id uuid, p_item_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
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
    'unlockedIds', COALESCE((SELECT jsonb_agg(pp.program_item_id::text) FROM app_servicio_portal.program_progress pp WHERE pp.contact_id = p_contact_id AND pp.unlocked_at IS NOT NULL), '[]'::jsonb));
  RETURN app_servicio.program_unlock_plan(jsonb_build_object('chain', v_chain, 'ctx', v_ctx));
END;
$$;

-- ─── 5. Abrir un modulo o clase a una persona (paso, automatizacion o a mano) ──
CREATE OR REPLACE FUNCTION app_servicio.svc_open_module(p_service_id uuid, p_program_item_id uuid, p_source text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
BEGIN
  SELECT id, workspace_id, contact_id, product_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL OR NOT app_servicio.module_on(s.workspace_id) THEN RETURN; END IF;
  IF NOT EXISTS (SELECT 1 FROM app_servicio.program_items WHERE id = p_program_item_id AND product_id = s.product_id) THEN RETURN; END IF;
  INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, unlocked_at, unlock_source)
  VALUES (s.workspace_id, s.contact_id, p_program_item_id, now(), CASE WHEN p_source IN ('journey_item', 'automation', 'team') THEN p_source ELSE 'team' END)
  ON CONFLICT (contact_id, program_item_id) DO UPDATE SET unlocked_at = COALESCE(app_servicio_portal.program_progress.unlocked_at, EXCLUDED.unlocked_at),
    unlock_source = COALESCE(app_servicio_portal.program_progress.unlock_source, EXCLUDED.unlock_source), updated_at = now();
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.module_opened', jsonb_build_object('program_item_id', p_program_item_id, 'source', p_source));
END;
$$;

-- «Abrir ahora» desde la ficha del servicio (services.access) y «Volver a bloquear» (automatizacion).
CREATE OR REPLACE FUNCTION app_servicio.svc_open_module_now(p_service_id uuid, p_program_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  s := app_servicio.svc_get(p_service_id);
  PERFORM app_servicio.require_service(s, 'services.access');
  PERFORM app_servicio.svc_open_module(s.id, p_program_item_id, 'team');
END;
$$;

CREATE OR REPLACE FUNCTION app_servicio.svc_relock_module(p_service_id uuid, p_program_item_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s record;
BEGIN
  SELECT id, workspace_id, contact_id INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NULL THEN RETURN; END IF;
  UPDATE app_servicio_portal.program_progress SET unlocked_at = NULL, unlock_source = NULL, updated_at = now()
   WHERE contact_id = s.contact_id AND program_item_id = p_program_item_id;
  PERFORM app_servicio.audit(s.workspace_id, 'service', s.id, 'svc.module_relocked', jsonb_build_object('program_item_id', p_program_item_id));
END;
$$;

-- Emitir un evento del servicio por su id (corregida el 8/11): dentro de un gancho la fila se lee como `record` y
-- `emit` pide el tipo exacto; esta ayuda lo lee tipado.
CREATE OR REPLACE FUNCTION app_servicio.emit_service(p_service_id uuid, p_event text, p_extra jsonb DEFAULT '{}'::jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  s app_servicio.services;
BEGIN
  SELECT * INTO s FROM app_servicio.services WHERE id = p_service_id;
  IF s.id IS NOT NULL THEN PERFORM app_servicio.emit(s, p_event, p_extra); END IF;
END;
$$;

-- ─── 6. El avance completa modulos y pasos (F48, F19) ───────────────────────
CREATE OR REPLACE FUNCTION app_servicio.program_progress_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
  par record;
  sv record;
  si record;
  v_total integer;
  v_done integer;
BEGIN
  BEGIN
    IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
    IF NEW.completed_at IS NULL OR (TG_OP = 'UPDATE' AND OLD.completed_at IS NOT NULL) THEN RETURN NULL; END IF;
    PERFORM app_servicio.as_system();
    SELECT id, kind, parent_id, product_id, status INTO it FROM app_servicio.program_items WHERE id = NEW.program_item_id;
    IF it.id IS NULL THEN RETURN NULL; END IF;
    -- Avisos y pasos del camino de los servicios de la persona en este producto.
    FOR sv IN SELECT id FROM app_servicio.services WHERE contact_id = NEW.contact_id AND product_id = it.product_id AND status IN ('active', 'paused') LOOP
      PERFORM app_servicio.emit_service(sv.id, CASE WHEN it.kind = 'lesson' THEN 'program_lesson_completed' ELSE 'program_module_completed' END,
                                        jsonb_build_object('program_item_id', it.id));
      FOR si IN SELECT id FROM app_servicio.service_items
                 WHERE service_id = sv.id AND status = 'pending' AND kind = 'program_item' AND ref ->> 'program_item_id' = it.id::text LOOP
        PERFORM app_servicio.svc_complete_item(si.id);
      END LOOP;
      IF it.kind = 'module' THEN PERFORM app_servicio.svc_apply_access_event(sv.id, 'module_completed', it.id::text); END IF;
    END LOOP;
    -- El padre queda completo cuando todas sus clases y submodulos ACTIVOS y obligatorios lo estan.
    IF it.parent_id IS NOT NULL THEN
      SELECT id, kind INTO par FROM app_servicio.program_items WHERE id = it.parent_id;
      SELECT count(*) FILTER (WHERE c.required), count(*) FILTER (WHERE c.required AND pp.completed_at IS NOT NULL)
        INTO v_total, v_done
        FROM app_servicio.program_items c
        LEFT JOIN app_servicio_portal.program_progress pp ON pp.program_item_id = c.id AND pp.contact_id = NEW.contact_id
       WHERE c.parent_id = par.id AND c.status = 'active';
      IF v_total > 0 AND v_done = v_total THEN
        INSERT INTO app_servicio_portal.program_progress (workspace_id, contact_id, program_item_id, completed_at)
        VALUES (NEW.workspace_id, NEW.contact_id, par.id, now())
        ON CONFLICT (contact_id, program_item_id) DO UPDATE SET completed_at = COALESCE(app_servicio_portal.program_progress.completed_at, now()), updated_at = now();
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'program_progress_hook: %', SQLERRM;
    BEGIN
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, actor_type, actor_label)
      VALUES (NEW.workspace_id, 'contact', NEW.contact_id, 'svc.hook_failed', jsonb_build_object('hook', 'program_progress', 'error', left(SQLSTATE || ' ' || SQLERRM, 300)), 'system', 'servicios');
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'program_progress_hook (audit): %', SQLERRM;
    END;
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_program_progress ON app_servicio_portal.program_progress;
CREATE TRIGGER trg_program_progress AFTER INSERT OR UPDATE OF completed_at ON app_servicio_portal.program_progress
  FOR EACH ROW EXECUTE FUNCTION app_servicio.program_progress_hook();

-- ─── 7. Escribir el arbol (program.manage / program.activate) ───────────────
CREATE OR REPLACE FUNCTION app_servicio.program_require(p_workspace_id uuid, p_key text)
RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF app_servicio.is_system() THEN RETURN; END IF;
  IF NOT public.has_permission(p_workspace_id, p_key) THEN RAISE EXCEPTION 'No tenés permiso para hacer esto' USING ERRCODE = 'SV004'; END IF;
END;
$$;

-- Crea un modulo, submodulo o clase al final de su lugar. Nace inactivo.
CREATE OR REPLACE FUNCTION app_servicio.program_create_item(p_product_id uuid, p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  v_id uuid;
  v_parent uuid := NULLIF(p ->> 'parent_id', '')::uuid;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(v_ws, 'program.manage');
  INSERT INTO app_servicio.program_items (workspace_id, product_id, parent_id, kind, lesson_type, title, description, position, created_by)
  VALUES (v_ws, p_product_id, v_parent, p ->> 'kind', NULLIF(p ->> 'lesson_type', ''), btrim(COALESCE(p ->> 'title', '')), NULLIF(p ->> 'description', ''),
          COALESCE((SELECT max(position) + 1 FROM app_servicio.program_items WHERE product_id = p_product_id AND parent_id IS NOT DISTINCT FROM v_parent), 0),
          CASE WHEN app_servicio.is_system() THEN NULL ELSE auth.uid() END)
  RETURNING id INTO v_id;
  PERFORM app_servicio.audit(v_ws, 'product', p_product_id, 'program.item_created', jsonb_build_object('item_id', v_id, 'kind', p ->> 'kind'));
  RETURN v_id;
END;
$$;

-- Cambia los datos de un item (no su estado ni su lugar). Solo las claves que vienen.
CREATE OR REPLACE FUNCTION app_servicio.program_update_item(p_item_id uuid, p jsonb)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
BEGIN
  SELECT id, workspace_id, product_id INTO it FROM app_servicio.program_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(it.workspace_id, 'program.manage');
  IF p ? 'form_id' AND NULLIF(p ->> 'form_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.forms f WHERE f.id = (p ->> 'form_id')::uuid AND f.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Ese formulario no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  IF p ? 'source_call_id' AND NULLIF(p ->> 'source_call_id', '') IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.calls c WHERE c.id = (p ->> 'source_call_id')::uuid AND c.workspace_id = it.workspace_id) THEN
    RAISE EXCEPTION 'Esa grabación no es de este negocio' USING ERRCODE = 'PR002';
  END IF;
  UPDATE app_servicio.program_items SET
    title = CASE WHEN p ? 'title' THEN btrim(p ->> 'title') ELSE title END,
    description = CASE WHEN p ? 'description' THEN NULLIF(p ->> 'description', '') ELSE description END,
    lesson_type = CASE WHEN p ? 'lesson_type' AND kind = 'lesson' THEN p ->> 'lesson_type' ELSE lesson_type END,
    video_url = CASE WHEN p ? 'video_url' THEN NULLIF(p ->> 'video_url', '') ELSE video_url END,
    video_embed_url = CASE WHEN p ? 'video_embed_url' THEN NULLIF(p ->> 'video_embed_url', '') ELSE video_embed_url END,
    duration_seconds = CASE WHEN p ? 'duration_seconds' THEN NULLIF(p ->> 'duration_seconds', '')::integer ELSE duration_seconds END,
    html_content = CASE WHEN p ? 'html_content' THEN NULLIF(p ->> 'html_content', '') ELSE html_content END,
    document_path = CASE WHEN p ? 'document_path' THEN NULLIF(p ->> 'document_path', '') ELSE document_path END,
    form_id = CASE WHEN p ? 'form_id' THEN NULLIF(p ->> 'form_id', '')::uuid ELSE form_id END,
    resources = CASE WHEN p ? 'resources' THEN p -> 'resources' ELSE resources END,
    cover_path = CASE WHEN p ? 'cover_path' THEN NULLIF(p ->> 'cover_path', '') ELSE cover_path END,
    thumbnail_path = CASE WHEN p ? 'thumbnail_path' THEN NULLIF(p ->> 'thumbnail_path', '') ELSE thumbnail_path END,
    thumbnail_url = CASE WHEN p ? 'thumbnail_url' THEN NULLIF(p ->> 'thumbnail_url', '') ELSE thumbnail_url END,
    comments_enabled = CASE WHEN p ? 'comments_enabled' THEN (p ->> 'comments_enabled')::boolean ELSE comments_enabled END,
    unlock_rule = CASE WHEN p ? 'unlock_rule' THEN p -> 'unlock_rule' ELSE unlock_rule END,
    required = CASE WHEN p ? 'required' THEN (p ->> 'required')::boolean ELSE required END,
    source_call_id = CASE WHEN p ? 'source_call_id' THEN NULLIF(p ->> 'source_call_id', '')::uuid ELSE source_call_id END
  WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_updated',
    jsonb_build_object('item_id', it.id, 'keys', (SELECT jsonb_agg(k) FROM jsonb_object_keys(p) k)));
END;
$$;

-- Activo / Inactivo / Archivado (program.activate). Con p_children, prende tambien sus hijos inactivos.
CREATE OR REPLACE FUNCTION app_servicio.program_set_status(p_item_id uuid, p_status text, p_children boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it record;
  n integer := 0;
BEGIN
  SELECT id, workspace_id, product_id, status INTO it FROM app_servicio.program_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL THEN RAISE EXCEPTION 'No existe' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(it.workspace_id, 'program.activate');
  IF p_status NOT IN ('inactive', 'active', 'archived') THEN RAISE EXCEPTION 'Estado no válido' USING ERRCODE = 'PR002'; END IF;
  UPDATE app_servicio.program_items SET status = p_status WHERE id = it.id;
  IF p_children AND p_status = 'active' THEN
    WITH RECURSIVE sub AS (
      SELECT id FROM app_servicio.program_items WHERE parent_id = it.id
      UNION ALL SELECT c.id FROM app_servicio.program_items c JOIN sub ON c.parent_id = sub.id)
    UPDATE app_servicio.program_items SET status = 'active' WHERE id IN (SELECT id FROM sub) AND status = 'inactive';
    GET DIAGNOSTICS n = ROW_COUNT;
  END IF;
  PERFORM app_servicio.audit(it.workspace_id, 'product', it.product_id, 'program.item_status',
    jsonb_build_object('item_id', it.id, 'status', jsonb_build_object('old', it.status, 'new', p_status), 'children', n));
  RETURN n;
END;
$$;

-- Reordena un nivel: recibe los ids en el orden nuevo (todos del mismo padre) y deja posiciones 0..n-1.
CREATE OR REPLACE FUNCTION app_servicio.program_reorder(p_product_id uuid, p_parent_id uuid, p_ids uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_ws uuid;
  i integer;
BEGIN
  SELECT workspace_id INTO v_ws FROM public.products WHERE id = p_product_id;
  IF v_ws IS NULL THEN RAISE EXCEPTION 'No existe el producto' USING ERRCODE = 'PR002'; END IF;
  PERFORM app_servicio.program_require(v_ws, 'program.manage');
  IF (SELECT count(*) FROM app_servicio.program_items WHERE product_id = p_product_id AND parent_id IS NOT DISTINCT FROM p_parent_id AND id = ANY (p_ids))
     <> cardinality(p_ids) THEN
    RAISE EXCEPTION 'Eso no es de este lugar del programa' USING ERRCODE = 'PR001';
  END IF;
  FOR i IN 1 .. cardinality(p_ids) LOOP
    UPDATE app_servicio.program_items SET position = i - 1 WHERE id = p_ids[i];
  END LOOP;
END;
$$;

-- ─── 8. Permisos de ejecucion ───────────────────────────────────────────────
REVOKE ALL ON FUNCTION
  app_servicio.program_items_structure(), app_servicio.program_unlock_plan(jsonb), app_servicio.program_item_unlocked(uuid, uuid),
  app_servicio.svc_open_module(uuid, uuid, text), app_servicio.svc_open_module_now(uuid, uuid), app_servicio.svc_relock_module(uuid, uuid),
  app_servicio.program_progress_hook(), app_servicio.program_require(uuid, text), app_servicio.program_create_item(uuid, jsonb),
  app_servicio.program_update_item(uuid, jsonb), app_servicio.program_set_status(uuid, text, boolean), app_servicio.program_reorder(uuid, uuid, uuid[]),
  app_servicio.emit_service(uuid, text, jsonb)
FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION
  app_servicio.program_unlock_plan(jsonb), app_servicio.program_item_unlocked(uuid, uuid), app_servicio.svc_open_module(uuid, uuid, text),
  app_servicio.svc_open_module_now(uuid, uuid), app_servicio.svc_relock_module(uuid, uuid), app_servicio.program_require(uuid, text),
  app_servicio.program_create_item(uuid, jsonb), app_servicio.program_update_item(uuid, jsonb), app_servicio.program_set_status(uuid, text, boolean),
  app_servicio.program_reorder(uuid, uuid, uuid[]), app_servicio.emit_service(uuid, text, jsonb)
TO service_role;
GRANT EXECUTE ON FUNCTION
  app_servicio.svc_open_module_now(uuid, uuid), app_servicio.program_create_item(uuid, jsonb), app_servicio.program_update_item(uuid, jsonb),
  app_servicio.program_set_status(uuid, text, boolean), app_servicio.program_reorder(uuid, uuid, uuid[])
TO authenticated;
