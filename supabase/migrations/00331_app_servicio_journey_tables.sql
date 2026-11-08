-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00331_app_servicio_journey_tables  (Servicios v12, Corrida A1 · S02 · bloque SV1)
-- ============================================================================
-- 1. `app_servicio.service_phases` y `app_servicio.service_items` (§8.2): la copia del camino de la
--    variante en cada servicio. Se escriben solo con las funciones svc_* (sin politicas de escritura);
--    se leen con `can_see_service`.
-- 2. `form_submissions.service_id` y `contract_signatures.service_id` (existen desde la 00150 y la 00157)
--    quedan SIN clave foranea, a proposito (decision del 8/11/2026): el link firmado de un formulario puede
--    traer un `service_id` de un servicio que no existe, y con la clave la base rechazaba el guardado y la
--    respuesta se perdia (lo atrapo verify-forms). El modulo valida en sus triggers (00335): un servicio que
--    no existe, o que no es de ese negocio y ese contacto, no se usa para nada.
-- 3. Columnas nuevas: `form_submissions.service_item_id` (el paso que completa una respuesta, F17), tambien
--    sin clave foranea (la pone solo el trigger del modulo, despues de comprobar el paso), y
--    `contact_notes.service_id` (comentario interno de un servicio, F28; la escribe solo el modulo).
--
-- Aditiva + modifica estructura existente (dos FK y dos columnas en tablas de BAIOS en uso).
-- Va ANTES de desplegar el codigo.
--
-- Cómo volver atrás:
--   ALTER TABLE public.contact_notes DROP COLUMN IF EXISTS service_id;
--   ALTER TABLE public.form_submissions DROP COLUMN IF EXISTS service_item_id;
--   DROP INDEX IF EXISTS public.idx_form_submissions_service, public.idx_contract_signatures_service;
--   DROP TABLE IF EXISTS app_servicio.service_items;
--   DROP TABLE IF EXISTS app_servicio.service_phases;
-- Riesgo: bajo (dos columnas nullable nuevas e indices parciales; ninguna restriccion nueva sobre tablas en uso).
-- ============================================================================

-- ─── 1. Fases ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.service_phases (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id      uuid NOT NULL REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  template_key    text NOT NULL,
  name            text NOT NULL,
  position        integer NOT NULL,
  status          text NOT NULL DEFAULT 'pending',
  duration_days   integer NULL,
  yellow_day      integer NULL,
  red_day         integer NULL,
  advance         text NOT NULL DEFAULT 'auto',
  challenge       jsonb NULL,
  awaiting_start  boolean NOT NULL DEFAULT false,
  late_light      jsonb NULL,
  started_at      timestamptz NULL,
  completed_at    timestamptz NULL,
  completed_via   text NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_phases_status_check CHECK (status IN ('pending', 'in_progress', 'completed')),
  CONSTRAINT service_phases_advance_check CHECK (advance IN ('auto', 'auto_all', 'manual')),
  CONSTRAINT service_phases_via_check CHECK (completed_via IS NULL OR completed_via IN ('auto', 'manual', 'manual_move')),
  CONSTRAINT service_phases_days_check CHECK (
    (duration_days IS NULL OR duration_days > 0)
    AND (yellow_day IS NULL OR yellow_day >= 0)
    AND (red_day IS NULL OR red_day >= 0)
    AND (yellow_day IS NULL OR red_day IS NULL OR yellow_day < red_day)
  ),
  CONSTRAINT service_phases_key_unique UNIQUE (service_id, template_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_phases_in_progress
  ON app_servicio.service_phases (service_id) WHERE status = 'in_progress';
CREATE INDEX IF NOT EXISTS idx_service_phases_ws ON app_servicio.service_phases (workspace_id);
CREATE INDEX IF NOT EXISTS idx_service_phases_service ON app_servicio.service_phases (service_id, position);

DROP TRIGGER IF EXISTS set_updated_at ON app_servicio.service_phases;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.service_phases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 2. Pasos ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_servicio.service_items (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id           uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  service_id             uuid NOT NULL REFERENCES app_servicio.services(id) ON DELETE CASCADE,
  phase_id               uuid NOT NULL REFERENCES app_servicio.service_phases(id) ON DELETE CASCADE,
  template_key           text NOT NULL,
  kind                   text NOT NULL,
  name                   text NOT NULL,
  description            text NULL,
  required               boolean NOT NULL DEFAULT true,
  assignee               text NOT NULL DEFAULT 'student',
  assignee_user_id       uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  visible_to_client      boolean NOT NULL DEFAULT true,
  portal_button          boolean NOT NULL DEFAULT false,
  ref                    jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_rule               jsonb NULL,
  due_on                 date NULL,
  due_at                 timestamptz NULL,
  recurrence             jsonb NULL,
  late                   jsonb NULL,
  reminders              jsonb NULL,
  is_recurring_template  boolean NOT NULL DEFAULT false,
  parent_item_id         uuid NULL REFERENCES app_servicio.service_items(id) ON DELETE CASCADE,
  occurrence_index       integer NULL,
  status                 text NOT NULL DEFAULT 'pending',
  completed_at           timestamptz NULL,
  completed_by_kind      text NULL,
  completed_by           uuid NULL,
  completed_source       text NULL,
  needs_attention        boolean NOT NULL DEFAULT false,
  yellow_after_days      integer NULL,
  red_after_days         integer NULL,
  task_id                uuid NULL REFERENCES public.tasks(id) ON DELETE SET NULL,
  position               integer NOT NULL,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT service_items_kind_check CHECK (kind IN (
    'form', 'survey', 'contract', 'booking', 'quiz', 'activity', 'program_item', 'team_task', 'student_task',
    'certificate', 'open_section', 'open_module', 'checkbox')),
  CONSTRAINT service_items_assignee_check CHECK (assignee IN ('student', 'owner', 'user')),
  CONSTRAINT service_items_status_check CHECK (status IN ('pending', 'completed')),
  CONSTRAINT service_items_by_kind_check CHECK (completed_by_kind IS NULL OR completed_by_kind IN ('user', 'system', 'client')),
  CONSTRAINT service_items_light_check CHECK (
    (yellow_after_days IS NULL OR yellow_after_days >= 0)
    AND (red_after_days IS NULL OR red_after_days >= 0)
    AND (yellow_after_days IS NULL OR red_after_days IS NULL OR red_after_days >= yellow_after_days)
  ),
  CONSTRAINT service_items_occurrence_check CHECK ((parent_item_id IS NULL) = (occurrence_index IS NULL)),
  CONSTRAINT service_items_ref_check CHECK (jsonb_typeof(ref) = 'object')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_items_key
  ON app_servicio.service_items (service_id, template_key) WHERE parent_item_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_service_items_occurrence
  ON app_servicio.service_items (parent_item_id, occurrence_index) WHERE parent_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_items_status_due ON app_servicio.service_items (status, due_on);
CREATE INDEX IF NOT EXISTS idx_service_items_service ON app_servicio.service_items (service_id, position);
CREATE INDEX IF NOT EXISTS idx_service_items_phase ON app_servicio.service_items (phase_id);
CREATE INDEX IF NOT EXISTS idx_service_items_ws ON app_servicio.service_items (workspace_id);
CREATE INDEX IF NOT EXISTS idx_service_items_task ON app_servicio.service_items (task_id) WHERE task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_items_form ON app_servicio.service_items ((ref ->> 'form_id')) WHERE ref ? 'form_id';

DROP TRIGGER IF EXISTS set_updated_at ON app_servicio.service_items;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON app_servicio.service_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ─── 3. RLS: solo lectura, con quien ve el servicio ─────────────────────────
ALTER TABLE app_servicio.service_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_servicio.service_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON app_servicio.service_phases FROM public, anon, authenticated;
REVOKE ALL ON app_servicio.service_items FROM public, anon, authenticated;
GRANT SELECT ON app_servicio.service_phases TO authenticated;
GRANT SELECT ON app_servicio.service_items TO authenticated;
GRANT ALL ON app_servicio.service_phases TO service_role;
GRANT ALL ON app_servicio.service_items TO service_role;

DROP POLICY IF EXISTS service_phases_select ON app_servicio.service_phases;
CREATE POLICY service_phases_select ON app_servicio.service_phases
  FOR SELECT TO authenticated USING (app_servicio.can_see_service(service_id));
DROP POLICY IF EXISTS service_items_select ON app_servicio.service_items;
CREATE POLICY service_items_select ON app_servicio.service_items
  FOR SELECT TO authenticated USING (app_servicio.can_see_service(service_id));

-- ─── 4. Columnas e indices en tablas de BAIOS (sin claves foraneas: ver la cabecera) ───
ALTER TABLE public.form_submissions
  ADD COLUMN IF NOT EXISTS service_item_id uuid NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_service_item ON public.form_submissions (service_item_id) WHERE service_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_form_submissions_service ON public.form_submissions (service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_signatures_service ON public.contract_signatures (service_id) WHERE service_id IS NOT NULL;

ALTER TABLE public.contact_notes
  ADD COLUMN IF NOT EXISTS service_id uuid NULL REFERENCES app_servicio.services(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_contact_notes_service ON public.contact_notes (service_id) WHERE service_id IS NOT NULL;

COMMENT ON COLUMN public.form_submissions.service_item_id IS
  'El paso del camino que completa esta respuesta (Servicios F17). Sin clave foranea: lo pone solo el trigger del modulo, despues de comprobar que el paso es del mismo negocio, servicio y contacto (00331/00335).';
COMMENT ON COLUMN public.contact_notes.service_id IS
  'Comentario interno de un servicio (Servicios F28). NULL = del cliente (00331).';
