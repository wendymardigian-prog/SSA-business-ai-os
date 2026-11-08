-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00335_app_servicio_completion_triggers  (Servicios v12, Corrida A1 · S06 · bloque SV2)
-- ============================================================================
-- Los pasos del camino se completan solos (F17, F18, F20) y se avisa cuando alguien deja el equipo (F96):
-- 1. form_submissions:
--    - BEFORE INSERT (`trg_app_servicio_submission_item`): el servidor pone el paso del link firmado en
--      `meta.service_item_id` (submit_form_response guarda el meta SIN filtrar, 00204: rama A de F17).
--      Se copia a `service_item_id` solo si el paso es del mismo servicio y del mismo contacto; si no,
--      se descarta (y la respuesta se guarda igual).
--    - AFTER INSERT (`trg_app_servicio_submission`): formulario o encuesta. Con paso firmado completa ESE
--      paso; sin el, el paso pendiente con ese form_id del servicio mas antiguo del contacto (y anota
--      `svc.item_ambiguous` si habia varios). Las actividades y evaluaciones las suma la 00340 (S11).
-- 2. contract_signatures AFTER INSERT (`trg_app_servicio_signature`): igual, con el formulario de contrato.
-- 3. bookings AFTER INSERT OR UPDATE OF status (`trg_app_servicio_booking`): un paso de agenda por
--    `event_type_id` (NUNCA por el nombre). `booked` al agendar; `attended` cuando la reunion pasa a un
--    resultado (`status_group = 'outcome'`: no existe el estado "asistio"). `utm.svc_item` se respeta
--    solo si el contacto es el del servicio. create_booking no se toca.
-- 4. tasks AFTER UPDATE OF status (`trg_app_servicio_task`): completar la tarea `cx` de un paso completa
--    el paso; reabrirla lo destilda (si la fase sigue abierta).
-- 5. workspace_members AFTER DELETE (`trg_app_servicio_member_removed`): quien deja el equipo con
--    servicios a cargo: marca y aviso a Owner y Admin "X tiene N servicios: reasignalos".
--
-- NINGUNO hace fallar lo que lo dispara: EXCEPTION WHEN OTHERS → RAISE WARNING + svc.hook_failed + aviso.
-- Con el modulo apagado en el negocio, salen sin hacer nada.
--
-- Modifica logica existente (triggers nuevos en tablas en uso). Riesgo ALTO. Va ANTES del codigo.
--
-- Cómo volver atrás:
--   DROP TRIGGER IF EXISTS trg_app_servicio_submission_item ON public.form_submissions;
--   DROP TRIGGER IF EXISTS trg_app_servicio_submission ON public.form_submissions;
--   DROP TRIGGER IF EXISTS trg_app_servicio_signature ON public.contract_signatures;
--   DROP TRIGGER IF EXISTS trg_app_servicio_booking ON public.bookings;
--   DROP TRIGGER IF EXISTS trg_app_servicio_task ON public.tasks;
--   DROP TRIGGER IF EXISTS trg_app_servicio_member_removed ON public.workspace_members;
--   DROP FUNCTION IF EXISTS app_servicio.submission_item_hook(), app_servicio.submission_hook(), app_servicio.signature_hook(),
--     app_servicio.booking_hook(), app_servicio.task_hook(), app_servicio.member_removed_hook(),
--     app_servicio.svc_complete_by_form(uuid, uuid, uuid, uuid, text, text), app_servicio.svc_unmark_item(uuid);
-- ============================================================================

-- Destilda sin pedir permiso (lo usa la tarea reabierta). Nunca en una fase cerrada.
CREATE OR REPLACE FUNCTION app_servicio.svc_unmark_item(p_item_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  ph app_servicio.service_phases;
BEGIN
  SELECT * INTO it FROM app_servicio.service_items WHERE id = p_item_id FOR UPDATE;
  IF it.id IS NULL OR it.status <> 'completed' THEN RETURN false; END IF;
  SELECT * INTO ph FROM app_servicio.service_phases WHERE id = it.phase_id;
  IF ph.status = 'completed' THEN RETURN false; END IF;
  UPDATE app_servicio.service_items SET status = 'pending', completed_at = NULL, completed_by_kind = NULL, completed_by = NULL, completed_source = NULL
   WHERE id = it.id;
  PERFORM app_servicio.audit(it.workspace_id, 'service_item', it.id, 'svc.item_uncompleted', jsonb_build_object('service_id', it.service_id, 'source', 'task'), 'system');
  PERFORM app_servicio.svc_compute_light(it.service_id);
  RETURN true;
END;
$$;

-- Completa el paso que pide ese formulario para ese contacto (F17). Devuelve el paso completado o NULL.
-- p_kinds: los tipos de paso que acepta (form/survey, contract); p_signed_item: el paso del link firmado.
CREATE OR REPLACE FUNCTION app_servicio.svc_complete_by_form(p_workspace_id uuid, p_contact_id uuid, p_form_id uuid, p_signed_item uuid, p_kinds text, p_source text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  it app_servicio.service_items;
  v_count integer;
  v_kinds text[] := string_to_array(p_kinds, ',');
BEGIN
  IF p_signed_item IS NOT NULL THEN
    SELECT i.* INTO it FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
     WHERE i.id = p_signed_item AND s.contact_id = p_contact_id AND i.status = 'pending' AND i.kind = ANY (v_kinds)
       AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted';
    IF it.id IS NOT NULL THEN
      PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
      RETURN it.id;
    END IF;
    RETURN NULL;
  END IF;
  -- Sin paso firmado: los pasos pendientes con ese formulario en servicios activos del contacto, primero
  -- los de la fase en curso; si hay varios servicios, el mas antiguo.
  SELECT count(DISTINCT i.service_id) INTO v_count
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
     AND ph.status <> 'completed';
  IF v_count = 0 THEN RETURN NULL; END IF;
  SELECT i.* INTO it
    FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
   WHERE s.workspace_id = p_workspace_id AND s.contact_id = p_contact_id AND s.status = 'active' AND i.status = 'pending' AND NOT i.is_recurring_template
     AND i.kind = ANY (v_kinds) AND i.ref ->> 'form_id' = p_form_id::text AND COALESCE(i.ref ->> 'complete_on', 'submitted') = 'submitted'
     AND ph.status <> 'completed'
   ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position, i.occurrence_index NULLS FIRST
   LIMIT 1;
  IF v_count > 1 THEN
    PERFORM app_servicio.audit(p_workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
      jsonb_build_object('service_id', it.service_id, 'form_id', p_form_id, 'services', v_count), 'system');
  END IF;
  PERFORM app_servicio.svc_mark_item(it.id, p_source, 'client', NULL);
  RETURN it.id;
END;
$$;

-- ─── 1. form_submissions ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.submission_item_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item uuid;
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NEW; END IF;
  BEGIN
    IF NEW.meta ? 'service_item_id' AND (NEW.meta ->> 'service_item_id') ~* '^[0-9a-f-]{36}$' THEN
      SELECT i.id INTO v_item FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
       WHERE i.id = (NEW.meta ->> 'service_item_id')::uuid AND s.workspace_id = NEW.workspace_id
         AND s.contact_id IS NOT DISTINCT FROM NEW.contact_id AND (NEW.service_id IS NULL OR s.id = NEW.service_id);
      NEW.service_item_id := v_item;  -- NULL si no es del mismo servicio y contacto: se descarta
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'app_servicio.submission_item_hook: %', SQLERRM;
  END;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_submission_item ON public.form_submissions;
CREATE TRIGGER trg_app_servicio_submission_item
  BEFORE INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.submission_item_hook();

CREATE OR REPLACE FUNCTION app_servicio.submission_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_type text;
  v_done uuid;
  v_owner uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.status = 'received' AND NEW.contact_id IS NOT NULL THEN
      SELECT f.type INTO v_type FROM public.forms f WHERE f.id = NEW.form_id;
      IF v_type IN ('custom', 'survey') THEN
        v_done := app_servicio.svc_complete_by_form(NEW.workspace_id, NEW.contact_id, NEW.form_id, NEW.service_item_id,
                    CASE v_type WHEN 'survey' THEN 'survey' ELSE 'form' END, 'form_submission');
        -- Un link firmado que no se pudo ubicar: no completa nada y avisa al responsable (F17).
        IF v_done IS NULL AND (NEW.meta ? 'service_item_id' OR NEW.service_id IS NOT NULL) THEN
          SELECT s.owner_user_id INTO v_owner FROM app_servicio.services s WHERE s.id = NEW.service_id;
          PERFORM app_servicio.notify(NEW.workspace_id, v_owner, 'svc_item_unmatched', 'Llegó una respuesta que no se pudo ubicar',
            'No completó ningún paso del camino. Revisala.', 'form_submission', NEW.id);
          PERFORM app_servicio.audit(NEW.workspace_id, 'form_submission', NEW.id, 'svc.item_unmatched', jsonb_build_object('form_id', NEW.form_id), 'system');
        END IF;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'form_submission', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_submission ON public.form_submissions;
CREATE TRIGGER trg_app_servicio_submission
  AFTER INSERT ON public.form_submissions
  FOR EACH ROW EXECUTE FUNCTION app_servicio.submission_hook();

-- ─── 2. contract_signatures ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.signature_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_contact uuid;
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT fs.contact_id, fs.service_item_id INTO v_contact, v_item FROM public.form_submissions fs WHERE fs.id = NEW.submission_id;
    v_contact := COALESCE(NEW.contact_id, v_contact);
    IF v_contact IS NOT NULL THEN
      PERFORM app_servicio.svc_complete_by_form(NEW.workspace_id, v_contact, NEW.form_id, v_item, 'contract', 'contract_signature');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'contract_signature', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_signature ON public.contract_signatures;
CREATE TRIGGER trg_app_servicio_signature
  AFTER INSERT ON public.contract_signatures
  FOR EACH ROW EXECUTE FUNCTION app_servicio.signature_hook();

-- ─── 3. bookings (F18) ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.booking_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_when text;
  it app_servicio.service_items;
  v_count integer;
  v_signed uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    IF NEW.contact_id IS NULL OR NEW.status LIKE 'cancelled%' THEN
      PERFORM set_config('app_servicio.system', v_prev_system, true);
      RETURN NULL;
    END IF;
    -- booked: al agendar. attended: al pasar a un resultado (status_group = outcome).
    v_when := CASE WHEN TG_OP = 'INSERT' THEN 'booked'
                   WHEN NEW.status_group = 'outcome' AND OLD.status_group IS DISTINCT FROM 'outcome' THEN 'attended' END;
    IF v_when IS NOT NULL THEN
      -- El paso que viene en el link de la agenda, solo si es del mismo contacto.
      IF (NEW.utm ->> 'svc_item') ~* '^[0-9a-f-]{36}$' THEN
        SELECT i.id INTO v_signed FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id
         WHERE i.id = (NEW.utm ->> 'svc_item')::uuid AND s.contact_id = NEW.contact_id AND s.workspace_id = NEW.workspace_id;
      END IF;
      SELECT count(DISTINCT i.service_id) INTO v_count
        FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
       WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
         AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
         AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed);
      IF v_count > 0 THEN
        SELECT i.* INTO it
          FROM app_servicio.service_items i JOIN app_servicio.services s ON s.id = i.service_id JOIN app_servicio.service_phases ph ON ph.id = i.phase_id
         WHERE s.workspace_id = NEW.workspace_id AND s.contact_id = NEW.contact_id AND s.status = 'active' AND i.status = 'pending'
           AND i.kind = 'booking' AND i.ref ->> 'event_type_id' = NEW.event_type_id::text AND COALESCE(i.ref ->> 'complete_on', 'booked') = v_when
           AND ph.status <> 'completed' AND (v_signed IS NULL OR i.id = v_signed)
         ORDER BY s.created_at, (ph.status = 'in_progress') DESC, ph.position, i.position LIMIT 1;
        IF v_count > 1 THEN
          PERFORM app_servicio.audit(NEW.workspace_id, 'service_item', it.id, 'svc.item_ambiguous',
            jsonb_build_object('service_id', it.service_id, 'event_type_id', NEW.event_type_id, 'services', v_count), 'system');
        END IF;
        PERFORM app_servicio.svc_mark_item(it.id, 'booking_' || v_when, 'client', NULL);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'booking', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_booking ON public.bookings;
CREATE TRIGGER trg_app_servicio_booking
  AFTER INSERT OR UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION app_servicio.booking_hook();

-- ─── 4. tasks (F20) ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION app_servicio.task_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_item uuid;
  v_prev_system text := COALESCE(current_setting('app_servicio.system', true), '');
BEGIN
  IF NEW.source <> 'cx' OR NEW.source_ref IS NULL OR NEW.source_ref NOT LIKE 'svc\_item:%' THEN RETURN NULL; END IF;
  IF NOT app_servicio.module_on(NEW.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    PERFORM app_servicio.as_system();
    SELECT i.id INTO v_item FROM app_servicio.service_items i
     WHERE i.id = substr(NEW.source_ref, 10)::uuid AND i.workspace_id = NEW.workspace_id AND i.task_id = NEW.id;
    IF v_item IS NOT NULL THEN
      IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
        PERFORM app_servicio.svc_mark_item(v_item, 'task', 'user', NULL);
      ELSIF OLD.status = 'completed' AND NEW.status <> 'completed' THEN
        PERFORM app_servicio.svc_unmark_item(v_item);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(NEW.workspace_id, 'task', SQLSTATE || ' ' || SQLERRM, NEW.id);
  END;
  PERFORM set_config('app_servicio.system', v_prev_system, true);
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_task ON public.tasks;
CREATE TRIGGER trg_app_servicio_task
  AFTER UPDATE OF status ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app_servicio.task_hook();

-- ─── 5. workspace_members: alguien deja el equipo (F96) ─────────────────────
CREATE OR REPLACE FUNCTION app_servicio.member_removed_hook()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_n integer;
  v_name text;
BEGIN
  IF NOT app_servicio.module_on(OLD.workspace_id) THEN RETURN NULL; END IF;
  BEGIN
    UPDATE app_servicio.services SET flags = flags || '{"owner_departed": true}'::jsonb
     WHERE workspace_id = OLD.workspace_id AND owner_user_id = OLD.user_id AND status IN ('active', 'paused', 'pending_confirmation');
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n > 0 THEN
      SELECT COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), 'Una persona') INTO v_name FROM auth.users u WHERE u.id = OLD.user_id;
      PERFORM app_servicio.notify_admins(OLD.workspace_id, 'svc_owner_departed',
        format('%s tiene %s servicios: reasignalos', COALESCE(v_name, 'Una persona'), v_n),
        'Dejó el equipo y quedaron a su nombre. Reasignalos desde Clientes.', 'workspace', OLD.workspace_id,
        jsonb_build_object('user_id', OLD.user_id, 'services', v_n));
      PERFORM app_servicio.audit(OLD.workspace_id, 'workspace', OLD.workspace_id, 'svc.owner_departed', jsonb_build_object('user_id', OLD.user_id, 'services', v_n), 'system');
    END IF;
  EXCEPTION WHEN OTHERS THEN
    PERFORM app_servicio.hook_failed(OLD.workspace_id, 'workspace_member', SQLSTATE || ' ' || SQLERRM, OLD.workspace_id);
  END;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS trg_app_servicio_member_removed ON public.workspace_members;
CREATE TRIGGER trg_app_servicio_member_removed
  AFTER DELETE ON public.workspace_members
  FOR EACH ROW EXECUTE FUNCTION app_servicio.member_removed_hook();

REVOKE ALL ON FUNCTION app_servicio.svc_unmark_item(uuid), app_servicio.svc_complete_by_form(uuid, uuid, uuid, uuid, text, text),
  app_servicio.submission_item_hook(), app_servicio.submission_hook(), app_servicio.signature_hook(), app_servicio.booking_hook(),
  app_servicio.task_hook(), app_servicio.member_removed_hook() FROM public, anon;
GRANT EXECUTE ON FUNCTION app_servicio.svc_unmark_item(uuid), app_servicio.svc_complete_by_form(uuid, uuid, uuid, uuid, text, text) TO service_role;
