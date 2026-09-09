-- ============================================================
-- MIGRACION 00039 — EVENTOS DE CRM QUE DISPARAN FLOWS (F3, F4)
-- ============================================================
-- Los triggers "nuevo contacto" y "evento de CRM" reaccionan a cosas que pasan
-- en el CRM, no en el chat. La pregunta es donde detectarlas.
--
-- Se detectan en la base, con triggers de Postgres, y no en el codigo de las
-- Server Actions. El motivo es concreto: un contacto se crea por tres caminos
-- distintos (mensaje entrante, import de CSV, alta manual) y los tags se
-- agregan desde la ficha, desde un flow y desde el import. Emitir el evento en
-- cada lugar significa acordarse en cada lugar, hoy y en cada camino nuevo que
-- se sume. En la base se captura una vez y no se escapa ninguno.
--
-- Los eventos NO disparan el flow desde la base: se encolan en una tabla y los
-- drena un cron. El motor de flows corre en Node —manda mensajes, llama a la
-- IA, habla con APIs— y nada de eso se puede hacer desde una funcion de
-- Postgres. Ademas, si el disparo fuera sincronico, un flow lento o caido
-- frenaria el guardado del contacto.
--
-- SOBRE EL SCOPE DE LEADS: el disparo lo hace el sistema, sin usuario. Se
-- respeta el scope porque el evento solo puede nacer de un cambio que la RLS ya
-- permitio: un Member no puede tocar un lead que no ve, asi que no puede
-- generar un evento sobre el. La barrera esta antes, en la escritura.
-- ============================================================

-- ------------------------------------------------------------
-- 1. La cola de eventos
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.automation_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- contact_created | tag_added | tag_removed | field_changed |
  -- assignment_changed | do_not_contact
  event_type   text NOT NULL,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  -- Con que valor. Un tag trae su nombre, un campo su slug y su valor nuevo.
  -- Es lo que permite filtrar "cuando se agrega el tag interesado".
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text
);

COMMENT ON TABLE public.automation_events IS
  'Cola de cambios del CRM que pueden disparar un flow. La llenan triggers de Postgres y la drena /api/cron/automation-events.';

-- El cron busca siempre lo mismo: lo no procesado, mas viejo primero.
CREATE INDEX IF NOT EXISTS idx_automation_events_pending
  ON public.automation_events(created_at)
  WHERE processed_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_automation_events_contact
  ON public.automation_events(contact_id, created_at DESC);

ALTER TABLE public.automation_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "automation_events_select" ON public.automation_events;
CREATE POLICY "automation_events_select" ON public.automation_events
  FOR SELECT USING (public.is_workspace_admin(workspace_id));
-- Escriben los triggers de la base (SECURITY DEFINER) y el cron (service role).

-- ------------------------------------------------------------
-- 2. Emisor comun
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.emit_automation_event(
  p_workspace_id uuid,
  p_event_type text,
  p_contact_id uuid,
  p_payload jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.automation_events (workspace_id, event_type, contact_id, payload)
  VALUES (p_workspace_id, p_event_type, p_contact_id, p_payload);
END;
$$;

REVOKE ALL ON FUNCTION public.emit_automation_event(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 3. Contacto creado (F3)
-- ------------------------------------------------------------
-- Cubre los tres origenes de una sola vez. Se ignoran los anonimos: un contacto
-- sin datos todavia no es un lead, y ya se ocultan de la lista (migracion
-- 00032). Cuando se completa deja de ser anonimo y ahi si emite.
CREATE OR REPLACE FUNCTION public.contacts_emit_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(NEW.is_anonymous, false) THEN
    RETURN NEW;
  END IF;

  PERFORM public.emit_automation_event(
    NEW.workspace_id,
    'contact_created',
    NEW.id,
    jsonb_build_object('source', COALESCE(NEW.attribution->>'source', 'unknown'))
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_created ON public.contacts;
CREATE TRIGGER contacts_automation_created
  AFTER INSERT ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_created();

-- Un contacto que nacio anonimo (por ejemplo, de un mensaje sin perfil) y
-- despues se completa cuenta como contacto nuevo recien en ese momento.
CREATE OR REPLACE FUNCTION public.contacts_emit_deanonymized()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF COALESCE(OLD.is_anonymous, false) AND NOT COALESCE(NEW.is_anonymous, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id,
      'contact_created',
      NEW.id,
      jsonb_build_object('source', COALESCE(NEW.attribution->>'source', 'unknown'), 'deanonymized', true)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_deanonymized ON public.contacts;
CREATE TRIGGER contacts_automation_deanonymized
  AFTER UPDATE OF is_anonymous ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_deanonymized();

-- ------------------------------------------------------------
-- 4. Cambios en el contacto (F4)
-- ------------------------------------------------------------
-- Asignacion de setter o vendedor, y marca de no contactar. Cada campo emite
-- su propio evento: un flow que espera "se asigno vendedor" no tiene por que
-- despertarse porque cambio el setter.
CREATE OR REPLACE FUNCTION public.contacts_emit_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.setter_id IS DISTINCT FROM OLD.setter_id AND NEW.setter_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'setter', 'user_id', NEW.setter_id)
    );
  END IF;

  IF NEW.vendedor_id IS DISTINCT FROM OLD.vendedor_id AND NEW.vendedor_id IS NOT NULL THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'assignment_changed', NEW.id,
      jsonb_build_object('role', 'vendedor', 'user_id', NEW.vendedor_id)
    );
  END IF;

  -- Solo al activarse: desmarcar no es un evento que valga la pena automatizar.
  IF COALESCE(NEW.do_not_contact, false) AND NOT COALESCE(OLD.do_not_contact, false) THEN
    PERFORM public.emit_automation_event(
      NEW.workspace_id, 'do_not_contact', NEW.id,
      jsonb_build_object('reason', NEW.do_not_contact_reason)
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contacts_automation_changes ON public.contacts;
CREATE TRIGGER contacts_automation_changes
  AFTER UPDATE OF setter_id, vendedor_id, do_not_contact ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_emit_changes();

-- ------------------------------------------------------------
-- 5. Tags (F4)
-- ------------------------------------------------------------
-- El payload lleva el NOMBRE del tag, no solo el id: el trigger se configura
-- escribiendo "interesado" en el editor, y comparar contra un uuid obligaria a
-- resolverlo en cada evaluacion.
CREATE OR REPLACE FUNCTION public.contact_tags_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_tag_name text;
  v_tag_id   uuid;
BEGIN
  v_tag_id := COALESCE(NEW.tag_id, OLD.tag_id);

  SELECT * INTO v_contact FROM public.contacts
   WHERE id = COALESCE(NEW.contact_id, OLD.contact_id);
  IF NOT FOUND THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT name INTO v_tag_name FROM public.tags WHERE id = v_tag_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id,
    CASE WHEN TG_OP = 'INSERT' THEN 'tag_added' ELSE 'tag_removed' END,
    v_contact.id,
    jsonb_build_object('tag_id', v_tag_id, 'tag_name', v_tag_name)
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS contact_tags_automation ON public.contact_tags;
CREATE TRIGGER contact_tags_automation
  AFTER INSERT OR DELETE ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_emit();

-- ------------------------------------------------------------
-- 6. Campos personalizados (F4)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contact_custom_fields_emit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_slug    text;
BEGIN
  -- Un update que deja el mismo valor no es un cambio.
  IF TG_OP = 'UPDATE' AND NEW.value IS NOT DISTINCT FROM OLD.value THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = NEW.contact_id;
  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT slug INTO v_slug FROM public.custom_field_definitions WHERE id = NEW.field_id;

  PERFORM public.emit_automation_event(
    v_contact.workspace_id, 'field_changed', v_contact.id,
    jsonb_build_object(
      'field_id', NEW.field_id,
      'field_slug', v_slug,
      'value', NEW.value,
      'previous_value', CASE WHEN TG_OP = 'UPDATE' THEN OLD.value ELSE NULL END
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contact_custom_fields_automation ON public.contact_custom_fields;
CREATE TRIGGER contact_custom_fields_automation
  AFTER INSERT OR UPDATE ON public.contact_custom_fields
  FOR EACH ROW EXECUTE FUNCTION public.contact_custom_fields_emit();

-- ------------------------------------------------------------
-- 7. Limpieza y agenda
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_automation_events(p_retention_days integer DEFAULT 7)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer;
BEGIN
  DELETE FROM public.automation_events
  WHERE processed_at IS NOT NULL
    AND processed_at < now() - make_interval(days => p_retention_days);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_automation_events(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_automation_events(integer) TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-automation-events') THEN
    PERFORM cron.unschedule('ssa-cron-automation-events');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ssa-cron-purge-automation-events') THEN
    PERFORM cron.unschedule('ssa-cron-purge-automation-events');
  END IF;
END;
$$;

-- Cada minuto: un contacto nuevo que tiene que recibir un mensaje de
-- bienvenida no puede esperar un cuarto de hora.
SELECT cron.schedule(
  'ssa-cron-automation-events',
  '* * * * *',
  $$SELECT private.call_app_cron('automation-events')$$
);

SELECT cron.schedule(
  'ssa-cron-purge-automation-events',
  '40 4 * * *',
  $$SELECT public.purge_automation_events(7)$$
);
