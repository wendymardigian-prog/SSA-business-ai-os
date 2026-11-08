-- ============================================================
-- 00329_contact_qualification
-- ============================================================
-- El NIVEL DE CALIFICACION del lead: de 1 a 5 (NULL = «Sin calificar»). Convive
-- con la temperatura (`lead_temperature`), que no se toca.
--
-- Lo que suma:
--
--  1. `workspaces.qualification_settings` (jsonb): el nombre y la descripcion
--     (la rubrica) de cada uno de los 5 niveles, `{ levels: [{ level, name,
--     description }] }`. Los niveles son fijos; lo que se edita es el texto.
--     El DEFAULT es un LITERAL igual a `DEFAULT_QUALIFICATION_SETTINGS`
--     (lib/contacts/qualification.ts; `qualification.test.ts` los compara): un
--     DEFAULT que llama a una funcion de `private` rompe el alta de un workspace
--     (ver 00248).
--  2. Columnas en `contacts`: `qualification_level` (1-5), `qualification_at` y
--     `qualification_by_agent` (true si el nivel ACTUAL lo puso el agente de IA).
--  3. `contact_qualification_changes`: el historial. Lo lee quien ve el contacto
--     (`can_see_contact`); escribe solo el servidor.
--  4. `set_contact_qualification(...)`: la UNICA forma de cambiar el nivel.
--     Fija, suma o resta (recortando entre 1 y 5) o lo quita, anota el cambio y
--     emite `qualification_changed`. La regla de recorte es gemela de
--     `applyQualificationChange` (lib/contacts/qualification.ts), con los casos
--     de `lib/contacts/qualification.cases.json`.
--  5. `contacts_qualification_guard`: rechaza un cambio DIRECTO a esas columnas
--     (QL001). Pasa solo con la marca `app.contact_qualification_internal`.
--  6. `contacts_qualification_on_merge`: al fusionar (`merge_contacts` borra el
--     duplicado con `metadata.merged_into`), mueve el historial al principal y se
--     queda con el nivel MAS ALTO. Mismo patron que 00256 y 00320: no se
--     reescribe `merge_contacts`; la tabla va en `CONTACT_MERGE_EXCLUSIONS`.
--  7. La siembra: los contactos con temperatura y sin nivel arrancan con
--     frio = 2, tibio = 3, caliente = 4 (sin tocar la temperatura ni el
--     `updated_at`, y sin emitir eventos). Corre una sola vez.
--  8. Los agentes que tienen `cambiar_temperatura` suman `calificar_lead` (con
--     la misma configuracion de «puede bajar»).
--
-- Aditiva. Va ANTES de desplegar el codigo (la ficha y la lista leen las columnas).
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS contacts_qualification_on_merge ON public.contacts;
--   DROP FUNCTION IF EXISTS public.contacts_qualification_on_merge();
--   DROP TRIGGER IF EXISTS contacts_qualification_guard ON public.contacts;
--   DROP FUNCTION IF EXISTS private.contacts_qualification_guard();
--   DROP FUNCTION IF EXISTS public.set_contact_qualification(uuid, uuid, text, integer, uuid, uuid, text, uuid, text, boolean, boolean);
--   DROP FUNCTION IF EXISTS private.qualification_next_level(smallint, text, integer);
--   DROP TABLE IF EXISTS public.contact_qualification_changes;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS qualification_level,
--     DROP COLUMN IF EXISTS qualification_at, DROP COLUMN IF EXISTS qualification_by_agent;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS qualification_settings;
--   UPDATE public.agents SET allowed_tools = array_remove(allowed_tools, 'calificar_lead'),
--     tools_config = tools_config - 'calificar_lead';
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE, DROP ... IF EXISTS.
-- ============================================================

CREATE SCHEMA IF NOT EXISTS private;

-- ------------------------------------------------------------
-- 1. Los nombres y la rubrica de cada nivel
-- ------------------------------------------------------------
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS qualification_settings jsonb NOT NULL DEFAULT '{
    "levels": [
      {"level": 1, "name": "No califica", "description": "No encaja con lo que ofrecemos o no tiene un interés real."},
      {"level": 2, "name": "Bajo", "description": "Muestra algo de interés, pero le faltan varias condiciones: necesidad, presupuesto o momento."},
      {"level": 3, "name": "Medio", "description": "Tiene la necesidad y el interés, pero falta confirmar el presupuesto o quién decide."},
      {"level": 4, "name": "Bueno", "description": "Cumple casi todo: necesidad clara, presupuesto y decide; falta dar el siguiente paso."},
      {"level": 5, "name": "Ideal", "description": "Cliente ideal: cumple todo y está listo para avanzar."}
    ]
  }'::jsonb;

-- ------------------------------------------------------------
-- 2. Las columnas del contacto
-- ------------------------------------------------------------
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS qualification_level smallint;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS qualification_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS qualification_by_agent boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_qualification_level_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_qualification_level_check
      CHECK (qualification_level IS NULL OR qualification_level BETWEEN 1 AND 5);
  END IF;
  -- Un nivel sin fecha (o una fecha sin nivel) no tiene sentido.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_qualification_dates_check') THEN
    ALTER TABLE public.contacts
      ADD CONSTRAINT contacts_qualification_dates_check
      CHECK ((qualification_level IS NULL) = (qualification_at IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_contacts_qualification_level
  ON public.contacts (workspace_id, qualification_level) WHERE deleted_at IS NULL AND qualification_level IS NOT NULL;

-- ------------------------------------------------------------
-- 3. El historial
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.contact_qualification_changes (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id          uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  old_level           smallint CHECK (old_level IS NULL OR old_level BETWEEN 1 AND 5),
  new_level           smallint CHECK (new_level IS NULL OR new_level BETWEEN 1 AND 5),
  -- De donde vino: una persona, el agente de IA, una automatizacion, una
  -- importacion, una fusion de contactos o la siembra desde la temperatura.
  source              text NOT NULL CHECK (source IN ('person', 'agent', 'automation', 'import', 'merge', 'seed')),
  changed_by          uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  flow_id             uuid REFERENCES public.flows(id) ON DELETE SET NULL,
  -- El motivo (lo que dijo el agente, la regla que se cumplio). Nunca un mensaje del lead.
  reason              text CHECK (reason IS NULL OR char_length(reason) <= 300),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CHECK (old_level IS DISTINCT FROM new_level)
);

CREATE INDEX IF NOT EXISTS idx_contact_qualification_changes_contact
  ON public.contact_qualification_changes (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_qualification_changes_workspace
  ON public.contact_qualification_changes (workspace_id, created_at DESC);

ALTER TABLE public.contact_qualification_changes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contact_qualification_changes_select ON public.contact_qualification_changes;
CREATE POLICY contact_qualification_changes_select ON public.contact_qualification_changes
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_workspace_member(workspace_id))
    AND EXISTS (
      SELECT 1 FROM public.contacts c
       WHERE c.id = contact_qualification_changes.contact_id
         AND c.workspace_id = contact_qualification_changes.workspace_id
         AND public.can_see_contact(c)
    )
  );
-- Sin politicas de INSERT/UPDATE/DELETE: escribe solo `set_contact_qualification`.

REVOKE ALL ON TABLE public.contact_qualification_changes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.contact_qualification_changes TO authenticated;
GRANT ALL ON TABLE public.contact_qualification_changes TO service_role;

-- ------------------------------------------------------------
-- 4. La regla de recorte (gemela de `applyQualificationChange`)
-- ------------------------------------------------------------
-- 'set'   : p_value entre 1 y 5 (otro valor devuelve -1: invalido).
-- 'add'   : suma p_value (negativo resta) y recorta entre 1 y 5. Desde «Sin
--           calificar» se cuenta desde 0: +1 da 1, +3 da 3, y restar no hace nada.
-- 'clear' : quita el nivel.
-- Devuelve el nivel nuevo (NULL = sin calificar) o -1 si el pedido es invalido.
CREATE OR REPLACE FUNCTION private.qualification_next_level(p_old smallint, p_mode text, p_value integer)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
  v integer;
BEGIN
  IF p_mode = 'clear' THEN
    RETURN NULL;
  ELSIF p_mode = 'set' THEN
    IF p_value IS NULL OR p_value < 1 OR p_value > 5 THEN RETURN -1; END IF;
    RETURN p_value;
  ELSIF p_mode = 'add' THEN
    IF p_value IS NULL THEN RETURN -1; END IF;
    v := coalesce(p_old, 0) + p_value;
    IF p_old IS NULL AND v < 1 THEN RETURN NULL; END IF;
    RETURN greatest(1, least(5, v));
  END IF;
  RETURN -1;
END;
$$;

REVOKE ALL ON FUNCTION private.qualification_next_level(smallint, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.qualification_next_level(smallint, text, integer) TO service_role;

-- ------------------------------------------------------------
-- 5. El guardia: ningun nivel sin pasar por la funcion
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.contacts_qualification_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF coalesce(current_setting('app.contact_qualification_internal', true), '') = 'on' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.qualification_level IS NOT NULL OR NEW.qualification_at IS NOT NULL OR NEW.qualification_by_agent THEN
      RAISE EXCEPTION 'El nivel de calificacion se cambia con set_contact_qualification' USING ERRCODE = 'QL001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.qualification_level IS DISTINCT FROM OLD.qualification_level
     OR NEW.qualification_at IS DISTINCT FROM OLD.qualification_at
     OR NEW.qualification_by_agent IS DISTINCT FROM OLD.qualification_by_agent THEN
    RAISE EXCEPTION 'El nivel de calificacion se cambia con set_contact_qualification' USING ERRCODE = 'QL001';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION private.contacts_qualification_guard() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. La siembra desde la temperatura (una sola vez, antes del guardia)
-- ------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.contact_qualification_changes WHERE source = 'seed') THEN
    PERFORM set_config('app.contact_qualification_internal', 'on', true);
    ALTER TABLE public.contacts DISABLE TRIGGER set_updated_at;

    WITH seeded AS (
      UPDATE public.contacts
         SET qualification_level = CASE lead_temperature WHEN 'cold' THEN 2 WHEN 'warm' THEN 3 WHEN 'hot' THEN 4 END,
             qualification_at = now(),
             qualification_by_agent = false
       WHERE qualification_level IS NULL
         AND lead_temperature IN ('cold', 'warm', 'hot')
         AND deleted_at IS NULL
      RETURNING id, workspace_id, qualification_level
    )
    INSERT INTO public.contact_qualification_changes (workspace_id, contact_id, old_level, new_level, source, reason)
    SELECT workspace_id, id, NULL, qualification_level, 'seed', 'Conversión desde la temperatura'
      FROM seeded;

    ALTER TABLE public.contacts ENABLE TRIGGER set_updated_at;
    PERFORM set_config('app.contact_qualification_internal', 'off', true);
  END IF;
END $$;

DROP TRIGGER IF EXISTS contacts_qualification_guard ON public.contacts;
CREATE TRIGGER contacts_qualification_guard
  BEFORE INSERT OR UPDATE ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION private.contacts_qualification_guard();

-- ------------------------------------------------------------
-- 7. La funcion
-- ------------------------------------------------------------
-- Devuelve jsonb:
--   { result: 'changed' | 'unchanged' | 'not_found' | 'invalid' | 'protected' | 'not_raised',
--     old_level, new_level, change_id }
--
-- p_source: 'person' | 'agent' | 'automation' | 'import' (la fusion y la siembra
--   no pasan por aca).
-- p_respect_human: para el agente. Si el nivel actual lo puso una PERSONA (o una
--   automatizacion, una importacion), no se pisa ('protected').
-- p_only_raise: para el agente sin «puede bajar»: un nivel mas bajo que el actual
--   (o quitarlo) no se aplica ('not_raised'). Se decide aca, bajo el bloqueo.
CREATE OR REPLACE FUNCTION public.set_contact_qualification(
  p_workspace_id  uuid,
  p_contact_id    uuid,
  p_mode          text,
  p_value         integer DEFAULT NULL,
  p_actor_user    uuid DEFAULT NULL,
  p_actor_agent   uuid DEFAULT NULL,
  p_source        text DEFAULT 'person',
  p_flow_id       uuid DEFAULT NULL,
  p_reason        text DEFAULT NULL,
  p_respect_human boolean DEFAULT false,
  p_only_raise    boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_contact public.contacts%ROWTYPE;
  v_old     smallint;
  v_next    integer;
  v_new     smallint;
  v_now     timestamptz := now();
  v_change  uuid;
  v_dir     text;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('set', 'add', 'clear') THEN
    RETURN jsonb_build_object('result', 'invalid');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('person', 'agent', 'automation', 'import') THEN
    RETURN jsonb_build_object('result', 'invalid');
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

  v_old := v_contact.qualification_level;
  v_next := private.qualification_next_level(v_old, p_mode, p_value);
  IF v_next = -1 THEN
    RETURN jsonb_build_object('result', 'invalid', 'old_level', v_old);
  END IF;
  v_new := v_next::smallint;

  IF v_old IS NOT DISTINCT FROM v_new THEN
    RETURN jsonb_build_object('result', 'unchanged', 'old_level', v_old, 'new_level', v_new);
  END IF;

  IF p_respect_human AND v_old IS NOT NULL AND NOT v_contact.qualification_by_agent THEN
    RETURN jsonb_build_object('result', 'protected', 'old_level', v_old, 'new_level', v_new);
  END IF;

  IF p_only_raise AND v_old IS NOT NULL AND (v_new IS NULL OR v_new < v_old) THEN
    RETURN jsonb_build_object('result', 'not_raised', 'old_level', v_old, 'new_level', v_new);
  END IF;

  PERFORM set_config('app.contact_qualification_internal', 'on', true);
  UPDATE public.contacts
     SET qualification_level = v_new,
         qualification_at = CASE WHEN v_new IS NULL THEN NULL ELSE v_now END,
         qualification_by_agent = v_new IS NOT NULL AND p_actor_agent IS NOT NULL,
         updated_at = v_now
   WHERE id = p_contact_id;
  PERFORM set_config('app.contact_qualification_internal', 'off', true);

  INSERT INTO public.contact_qualification_changes
    (workspace_id, contact_id, old_level, new_level, source, changed_by, changed_by_agent_id, flow_id, reason, created_at)
  VALUES
    (p_workspace_id, p_contact_id, v_old, v_new, p_source, p_actor_user, p_actor_agent, p_flow_id,
     left(nullif(btrim(coalesce(p_reason, '')), ''), 300), v_now)
  RETURNING id INTO v_change;

  v_dir := CASE
    WHEN v_new IS NULL THEN 'cleared'
    WHEN v_old IS NULL OR v_new > v_old THEN 'up'
    ELSE 'down'
  END;

  -- El evento de automatizacion nunca tumba el cambio.
  BEGIN
    PERFORM public.emit_automation_event(
      p_workspace_id, 'qualification_changed', p_contact_id,
      jsonb_build_object('level', v_new, 'previous_level', v_old, 'direction', v_dir,
                         'source', p_source, 'change_id', v_change)
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'set_contact_qualification: no pude emitir el evento: %', SQLERRM;
  END;

  RETURN jsonb_build_object('result', 'changed', 'old_level', v_old, 'new_level', v_new, 'change_id', v_change);
END;
$$;

REVOKE ALL ON FUNCTION public.set_contact_qualification(uuid, uuid, text, integer, uuid, uuid, text, uuid, text, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_contact_qualification(uuid, uuid, text, integer, uuid, uuid, text, uuid, text, boolean, boolean) TO service_role;

-- ------------------------------------------------------------
-- 8. La fusion de contactos
-- ------------------------------------------------------------
-- `merge_contacts` (00247) borra el duplicado con `metadata.merged_into` antes de
-- mudar nada. Al ver eso: el historial del duplicado pasa al principal y, si el
-- duplicado tenia un nivel mas alto, el principal se queda con ese (y lo anota).
-- Nunca tumba la fusion.
CREATE OR REPLACE FUNCTION public.contacts_qualification_on_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_main      uuid;
  v_main_lvl  smallint;
BEGIN
  IF OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
    RETURN NULL;
  END IF;
  IF NOT (coalesce(NEW.metadata, '{}'::jsonb) ? 'merged_into') THEN
    RETURN NULL;
  END IF;
  BEGIN
    v_main := (NEW.metadata ->> 'merged_into')::uuid;
  EXCEPTION WHEN others THEN
    RETURN NULL;
  END;

  BEGIN
    UPDATE public.contact_qualification_changes
       SET contact_id = v_main
     WHERE contact_id = OLD.id AND workspace_id = NEW.workspace_id;

    IF OLD.qualification_level IS NOT NULL THEN
      SELECT qualification_level INTO v_main_lvl
        FROM public.contacts
       WHERE id = v_main AND workspace_id = NEW.workspace_id;
      IF FOUND AND (v_main_lvl IS NULL OR OLD.qualification_level > v_main_lvl) THEN
        PERFORM set_config('app.contact_qualification_internal', 'on', true);
        UPDATE public.contacts
           SET qualification_level = OLD.qualification_level,
               qualification_at = coalesce(OLD.qualification_at, now()),
               qualification_by_agent = OLD.qualification_by_agent
         WHERE id = v_main AND workspace_id = NEW.workspace_id;
        PERFORM set_config('app.contact_qualification_internal', 'off', true);
        INSERT INTO public.contact_qualification_changes
          (workspace_id, contact_id, old_level, new_level, source, reason)
        VALUES
          (NEW.workspace_id, v_main, v_main_lvl, OLD.qualification_level, 'merge', 'Fusión de contactos');
      END IF;
    END IF;
  EXCEPTION WHEN others THEN
    PERFORM set_config('app.contact_qualification_internal', 'off', true);
    RAISE WARNING 'contacts_qualification_on_merge: no pude mover la calificacion del contacto %: %', OLD.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.contacts_qualification_on_merge() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS contacts_qualification_on_merge ON public.contacts;
CREATE TRIGGER contacts_qualification_on_merge
  AFTER UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_qualification_on_merge();

-- ------------------------------------------------------------
-- 9. El agente: donde ya calificaba con la temperatura, suma el nivel
-- ------------------------------------------------------------
UPDATE public.agents
   SET allowed_tools = array_append(allowed_tools, 'calificar_lead'),
       tools_config = CASE
         WHEN tools_config ? 'cambiar_temperatura' AND NOT (tools_config ? 'calificar_lead')
           THEN tools_config || jsonb_build_object('calificar_lead',
                  jsonb_build_object('canLower', coalesce((tools_config -> 'cambiar_temperatura' -> 'canLower'), 'false'::jsonb)))
         ELSE tools_config
       END
 WHERE 'cambiar_temperatura' = ANY (allowed_tools)
   AND NOT ('calificar_lead' = ANY (allowed_tools));
