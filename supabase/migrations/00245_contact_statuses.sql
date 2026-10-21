-- ============================================================
-- 00245_contact_statuses
-- ============================================================
-- El pipeline de contactos: cada contacto tiene un estado de SETTER y un
-- estado de VENDEDOR (closer), y muestra siempre su ULTIMO estado (el que se
-- cambio mas recientemente de los dos). Cada cambio queda en el historial.
--
-- Lo que suma:
--
--  1. `workspaces.contact_status_settings` (jsonb): las dos listas editables
--     `{ setter: [...], closer: [...] }`, cada estado `{ key, name, color,
--     archived_at }`. La `key` no cambia nunca (la guardan los contactos y el
--     historial); un estado no se borra, se archiva. El valor por defecto es
--     la MISMA lista que `DEFAULT_CONTACT_STATUSES` (lib/contacts/statuses.ts;
--     `lib/contacts/statuses.test.ts` las compara).
--  2. Columnas en `contacts`: el estado de cada rol con su fecha, si el de
--     setter lo puso el agente de IA, y el ultimo estado (rol, clave, fecha).
--  3. `contact_status_changes`: el historial. Lo lee quien ve el contacto
--     (`can_see_contact`), asi el setter ve tambien los cambios del vendedor
--     (con `audit_log` no pasaria: un Member ve solo sus propias entradas).
--     Escribe solo el servidor.
--  4. `set_contact_status(...)`: la UNICA forma de cambiar un estado. En una
--     transaccion bloquea el contacto, valida el estado contra la lista,
--     escribe, recalcula el ultimo estado, anota el cambio y emite el evento
--     de automatizacion `status_changed`. Solo `service_role`: quien llama ya
--     chequeo el permiso (`contacts.edit`) y que la persona ve el contacto.
--  5. `contacts_status_guard`: rechaza un cambio DIRECTO a esas columnas que
--     no venga de la funcion (marca de transaccion
--     `app.contact_status_internal`, mismo patron que
--     `app.commissions_internal`). Asi ningun estado queda sin historial.
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contacts_status_guard ON public.contacts;
--   DROP FUNCTION IF EXISTS private.contacts_status_guard();
--   DROP FUNCTION IF EXISTS public.set_contact_status(uuid, uuid, text, text, uuid, uuid, text, boolean);
--   DROP TABLE IF EXISTS public.contact_status_changes;
--   ALTER TABLE public.contacts
--     DROP COLUMN IF EXISTS setter_status, DROP COLUMN IF EXISTS setter_status_at,
--     DROP COLUMN IF EXISTS setter_status_by_agent, DROP COLUMN IF EXISTS closer_status,
--     DROP COLUMN IF EXISTS closer_status_at, DROP COLUMN IF EXISTS last_status_role,
--     DROP COLUMN IF EXISTS last_status, DROP COLUMN IF EXISTS last_status_at;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS contact_status_settings;
--   DROP FUNCTION IF EXISTS private.default_contact_status_settings();
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ------------------------------------------------------------
-- 1. Las listas
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.default_contact_status_settings()
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $fn$
  SELECT $defaults${
    "setter": [
      {"key": "nuevo", "name": "Nuevo", "color": "#64748b", "archived_at": null},
      {"key": "contactado", "name": "Contactado", "color": "#2563eb", "archived_at": null},
      {"key": "en_conversacion", "name": "En conversación", "color": "#0891b2", "archived_at": null},
      {"key": "calificado", "name": "Calificado", "color": "#16a34a", "archived_at": null},
      {"key": "agendado", "name": "Agendado", "color": "#7c3aed", "archived_at": null},
      {"key": "no_calificado", "name": "No calificado", "color": "#ca8a04", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ],
    "closer": [
      {"key": "llamada_agendada", "name": "Llamada agendada", "color": "#7c3aed", "archived_at": null},
      {"key": "no_se_presento", "name": "No se presentó", "color": "#ca8a04", "archived_at": null},
      {"key": "en_seguimiento", "name": "En seguimiento", "color": "#0891b2", "archived_at": null},
      {"key": "propuesta_enviada", "name": "Propuesta enviada", "color": "#2563eb", "archived_at": null},
      {"key": "ganado", "name": "Ganado", "color": "#16a34a", "archived_at": null},
      {"key": "perdido", "name": "Perdido", "color": "#e11d48", "archived_at": null}
    ]
  }$defaults$::jsonb;
$fn$;

REVOKE ALL ON FUNCTION private.default_contact_status_settings() FROM PUBLIC, anon, authenticated;

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS contact_status_settings jsonb NOT NULL DEFAULT private.default_contact_status_settings();

-- ------------------------------------------------------------
-- 2. Las columnas del contacto
-- ------------------------------------------------------------
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS setter_status text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS setter_status_at timestamptz;
-- true si el estado de setter ACTUAL lo puso el agente de IA (la herramienta
-- `cambiar_estado_setter` no pisa por defecto uno puesto por una persona).
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS setter_status_by_agent boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS closer_status text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS closer_status_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_status_role text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_status text;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS last_status_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_last_status_role_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_last_status_role_check
      CHECK (last_status_role IS NULL OR last_status_role IN ('setter', 'closer'));
  END IF;
  -- Un estado sin fecha (o una fecha sin estado) no tiene sentido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_status_dates_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_status_dates_check
      CHECK (
        (setter_status IS NULL) = (setter_status_at IS NULL)
        AND (closer_status IS NULL) = (closer_status_at IS NULL)
        AND (last_status IS NULL) = (last_status_role IS NULL)
        AND (last_status IS NULL) = (last_status_at IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_setter_status
  ON public.contacts (workspace_id, setter_status) WHERE deleted_at IS NULL AND setter_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_closer_status
  ON public.contacts (workspace_id, closer_status) WHERE deleted_at IS NULL AND closer_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_last_status
  ON public.contacts (workspace_id, last_status_role, last_status) WHERE deleted_at IS NULL AND last_status IS NOT NULL;

-- ------------------------------------------------------------
-- 3. El historial
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_status_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  role                text NOT NULL CHECK (role IN ('setter', 'closer')),
  old_status          text,
  new_status          text,
  -- Quien lo cambio: una persona, el agente de IA, o ninguno (una automatizacion o el sistema).
  changed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  -- Lo que dijo el agente para justificarlo (nunca un mensaje del lead).
  reason              text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (old_status IS DISTINCT FROM new_status)
);

CREATE INDEX IF NOT EXISTS idx_contact_status_changes_contact
  ON public.contact_status_changes (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_status_changes_workspace
  ON public.contact_status_changes (workspace_id, created_at DESC);

ALTER TABLE public.contact_status_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_status_changes_select ON public.contact_status_changes;
CREATE POLICY contact_status_changes_select ON public.contact_status_changes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_workspace_member(workspace_id))
    AND EXISTS (
      SELECT 1 FROM public.contacts c
       WHERE c.id = contact_status_changes.contact_id
         AND c.workspace_id = contact_status_changes.workspace_id
         AND public.can_see_contact(c)
    )
  );
-- Sin politicas de INSERT/UPDATE/DELETE: escribe solo `set_contact_status`.

REVOKE ALL ON TABLE public.contact_status_changes FROM anon, authenticated;
GRANT SELECT ON TABLE public.contact_status_changes TO authenticated;
GRANT ALL ON TABLE public.contact_status_changes TO service_role;

-- ------------------------------------------------------------
-- 4. El guardia: ningun estado sin pasar por la funcion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contacts_status_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('app.contact_status_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.setter_status IS NOT NULL OR NEW.closer_status IS NOT NULL OR NEW.last_status IS NOT NULL
       OR NEW.setter_status_by_agent THEN
      RAISE EXCEPTION 'El estado de un contacto se cambia con set_contact_status' USING ERRCODE = 'CS001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.setter_status IS DISTINCT FROM OLD.setter_status
     OR NEW.setter_status_at IS DISTINCT FROM OLD.setter_status_at
     OR NEW.setter_status_by_agent IS DISTINCT FROM OLD.setter_status_by_agent
     OR NEW.closer_status IS DISTINCT FROM OLD.closer_status
     OR NEW.closer_status_at IS DISTINCT FROM OLD.closer_status_at
     OR NEW.last_status_role IS DISTINCT FROM OLD.last_status_role
     OR NEW.last_status IS DISTINCT FROM OLD.last_status
     OR NEW.last_status_at IS DISTINCT FROM OLD.last_status_at THEN
    RAISE EXCEPTION 'El estado de un contacto se cambia con set_contact_status' USING ERRCODE = 'CS001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.contacts_status_guard() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_status_guard ON public.contacts;
CREATE TRIGGER contacts_status_guard
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_status_guard();

-- ------------------------------------------------------------
-- 5. La funcion
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { result: 'changed' | 'unchanged' | 'not_found' | 'invalid_status' | 'protected',
--     old_status, new_status, last_status_role, last_status, last_status_at, change_id }
--
-- p_status NULL quita el estado de ese rol.
-- p_respect_human: para el agente. Si el estado de setter actual lo puso una
--   PERSONA, no se pisa ('protected').
CREATE OR REPLACE FUNCTION public.set_contact_status(
  p_workspace_id uuid,
  p_contact_id   uuid,
  p_role         text,
  p_status       text,
  p_actor_user   uuid DEFAULT NULL,
  p_actor_agent  uuid DEFAULT NULL,
  p_reason       text DEFAULT NULL,
  p_respect_human boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact  public.contacts%ROWTYPE;
  v_settings jsonb;
  v_list     jsonb;
  v_old      text;
  v_status   text := nullif(btrim(coalesce(p_status, '')), '');
  v_now      timestamptz := now();
  v_setter   text;
  v_setter_at timestamptz;
  v_closer   text;
  v_closer_at timestamptz;
  v_by_agent boolean;
  v_last_role text;
  v_last     text;
  v_last_at  timestamptz;
  v_change   uuid;
BEGIN
  IF p_role IS NULL OR p_role NOT IN ('setter', 'closer') THEN
    RAISE EXCEPTION 'Rol de estado invalido: %', p_role USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_contact
    FROM public.contacts
   WHERE id = p_contact_id
     AND workspace_id = p_workspace_id
     AND deleted_at IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('result', 'not_found');
  END IF;

  v_old := CASE WHEN p_role = 'setter' THEN v_contact.setter_status ELSE v_contact.closer_status END;

  IF v_old IS NOT DISTINCT FROM v_status THEN
    RETURN jsonb_build_object('result', 'unchanged', 'old_status', v_old, 'new_status', v_status,
      'last_status_role', v_contact.last_status_role, 'last_status', v_contact.last_status,
      'last_status_at', v_contact.last_status_at);
  END IF;

  -- El estado tiene que existir en la lista de ese rol y no estar archivado.
  -- Sin la lista guardada, los estados por defecto (igual que parseStatusSettings).
  IF v_status IS NOT NULL THEN
    SELECT contact_status_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
    IF v_settings IS NULL OR jsonb_typeof(v_settings) <> 'object' OR NOT (v_settings ? p_role) THEN
      v_list := private.default_contact_status_settings() -> p_role;
    ELSE
      v_list := v_settings -> p_role;
    END IF;
    IF jsonb_typeof(v_list) <> 'array' OR NOT EXISTS (
      SELECT 1 FROM jsonb_array_elements(v_list) e
       WHERE e ->> 'key' = v_status
         AND (e -> 'archived_at' IS NULL OR jsonb_typeof(e -> 'archived_at') = 'null')
    ) THEN
      RETURN jsonb_build_object('result', 'invalid_status', 'old_status', v_old, 'new_status', v_status);
    END IF;
  END IF;

  IF p_respect_human AND p_role = 'setter' AND v_old IS NOT NULL AND NOT v_contact.setter_status_by_agent THEN
    RETURN jsonb_build_object('result', 'protected', 'old_status', v_old, 'new_status', v_status);
  END IF;

  v_setter := v_contact.setter_status;
  v_setter_at := v_contact.setter_status_at;
  v_closer := v_contact.closer_status;
  v_closer_at := v_contact.closer_status_at;
  v_by_agent := v_contact.setter_status_by_agent;

  IF p_role = 'setter' THEN
    v_setter := v_status;
    v_setter_at := CASE WHEN v_status IS NULL THEN NULL ELSE v_now END;
    v_by_agent := v_status IS NOT NULL AND p_actor_agent IS NOT NULL;
  ELSE
    v_closer := v_status;
    v_closer_at := CASE WHEN v_status IS NULL THEN NULL ELSE v_now END;
  END IF;

  -- El ultimo: el de fecha mas reciente; con la misma fecha, el del vendedor
  -- (gemela de `deriveLastStatus`, lib/contacts/statuses.ts).
  IF v_closer IS NOT NULL AND (v_setter IS NULL OR v_closer_at >= v_setter_at) THEN
    v_last_role := 'closer'; v_last := v_closer; v_last_at := v_closer_at;
  ELSIF v_setter IS NOT NULL THEN
    v_last_role := 'setter'; v_last := v_setter; v_last_at := v_setter_at;
  ELSE
    v_last_role := NULL; v_last := NULL; v_last_at := NULL;
  END IF;

  PERFORM set_config('app.contact_status_internal', 'on', true);
  UPDATE public.contacts
     SET setter_status = v_setter,
         setter_status_at = v_setter_at,
         setter_status_by_agent = v_by_agent,
         closer_status = v_closer,
         closer_status_at = v_closer_at,
         last_status_role = v_last_role,
         last_status = v_last,
         last_status_at = v_last_at,
         updated_at = v_now
   WHERE id = p_contact_id;
  PERFORM set_config('app.contact_status_internal', 'off', true);

  INSERT INTO public.contact_status_changes
    (workspace_id, contact_id, role, old_status, new_status, changed_by, changed_by_agent_id, reason, created_at)
  VALUES
    (p_workspace_id, p_contact_id, p_role, v_old, v_status, p_actor_user, p_actor_agent,
     left(nullif(btrim(coalesce(p_reason, '')), ''), 300), v_now)
  RETURNING id INTO v_change;

  -- El evento de automatizacion nunca tumba el cambio.
  BEGIN
    PERFORM public.emit_automation_event(
      p_workspace_id, 'status_changed', p_contact_id,
      jsonb_build_object('role', p_role, 'status', v_status, 'previous_status', v_old, 'change_id', v_change)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_contact_status: no pude emitir el evento: %', SQLERRM;
  END;

  RETURN jsonb_build_object('result', 'changed', 'old_status', v_old, 'new_status', v_status,
    'last_status_role', v_last_role, 'last_status', v_last, 'last_status_at', v_last_at,
    'change_id', v_change);
END;
$$;

REVOKE ALL ON FUNCTION public.set_contact_status(uuid, uuid, text, text, uuid, uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_contact_status(uuid, uuid, text, text, uuid, uuid, text, boolean) TO service_role;
