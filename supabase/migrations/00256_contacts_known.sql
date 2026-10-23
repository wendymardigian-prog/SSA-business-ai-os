-- ============================================================
-- 00256_contacts_known
-- ============================================================
-- "Conocido" (octubre 2026): una marca propia del contacto, no una etiqueta.
--
-- Un conocido es alguien personal que escribe por la misma cuenta por la que
-- entran los leads. Hasta aca se resolvia con una etiqueta con efecto (00073,
-- `es-conocido`): apagaba el agente, pero no se veia en la lista de chats, no
-- frenaba las secuencias y no decia de quien era el chat. Ahora:
--
--   contacts.is_known / known_marked_by / known_marked_at
--       La marca, quien la puso y cuando.
--   conversations.agent_disabled_by_known
--       La marca de "esto lo apago el conocido", igual que
--       `agent_disabled_by_tag_id` de la 00073: permite prender de nuevo SOLO
--       lo que apago la marca, nunca un apagado a mano. Se limpia sola si una
--       persona cambia el estado del agente en esa conversacion.
--   workspaces.known_contacts_settings
--       A quien van los chats de un conocido, POR CUENTA:
--       { "by_channel": { "<channel_id>": "<user_id>" }, "default_user_id": "<user_id>" }.
--       Sin nada configurado (o si esa persona ya no esta en el equipo), al
--       Owner. DEFAULT literal: un DEFAULT nunca llama a una funcion de
--       `private` (lo aprendimos en la 00248).
--
-- Al MARCAR (trigger en contacts, venga de donde venga):
--   - todas sus conversaciones pasan a la persona de la cuenta de cada una,
--     aunque ya tuvieran responsable (el anterior queda en audit_log);
--   - el agente queda forzado apagado en las que no lo estaban.
-- Al QUITAR: se prende de nuevo (vuelve a heredar) lo que apago la marca; si el
-- contacto conserva una etiqueta con efecto, la marca pasa a esa y nada se
-- prende. El responsable NO se revierte (no hay forma segura de saber a quien
-- volver).
-- Conversaciones NUEVAS de un conocido nacen con el agente apagado (trigger), y
-- `assign_new_conversation` mira la marca ANTES que las reglas por cuenta.
-- FUSION: si el duplicado era conocido, el principal pasa a serlo (trigger al
-- borrar el duplicado con `metadata.merged_into`, sin reescribir
-- `merge_contacts`); las conversaciones que se mudan al principal heredan el
-- agente apagado.
--
-- Las secuencias se pausan desde la app (`setKnown`), igual que "no
-- contactar", y el procesador saltea a los conocidos.
--
-- Esta migracion REDEFINE `assign_new_conversation` (00255). La definicion de
-- la 00255 sigue completa en ese archivo; volver atras es reaplicar su bloque 3.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   (reaplicar el bloque 3 de la 00255: assign_new_conversation)
--   DROP TRIGGER IF EXISTS contacts_known_on_merge ON public.contacts;
--   DROP TRIGGER IF EXISTS contacts_known_effects ON public.contacts;
--   DROP TRIGGER IF EXISTS conversations_a2_inherit_known ON public.conversations;
--   DROP TRIGGER IF EXISTS conversations_b2_keep_known_marker ON public.conversations;
--   DROP FUNCTION IF EXISTS public.contacts_known_on_merge();
--   DROP FUNCTION IF EXISTS public.contacts_known_effects();
--   DROP FUNCTION IF EXISTS public.conversations_inherit_known();
--   DROP FUNCTION IF EXISTS public.conversations_keep_known_marker();
--   DROP FUNCTION IF EXISTS private.known_assignee(uuid, uuid);
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS known_contacts_settings;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS agent_disabled_by_known;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS known_marked_at,
--     DROP COLUMN IF EXISTS known_marked_by, DROP COLUMN IF EXISTS is_known;
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_known boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS known_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS known_marked_at timestamptz;

COMMENT ON COLUMN public.contacts.is_known IS
  'Conocido (00256): alguien personal. Apaga el agente, pausa secuencias y sus chats van a la persona de cada cuenta (workspaces.known_contacts_settings).';

CREATE INDEX IF NOT EXISTS idx_contacts_known ON public.contacts (workspace_id) WHERE is_known;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_disabled_by_known boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.agent_disabled_by_known IS
  'El agente lo apago la marca de conocido (00256). Se limpia sola si una persona cambia el estado del agente.';

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS known_contacts_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspaces.known_contacts_settings IS
  'A quien van los chats de un conocido (00256): {"by_channel": {"<channel_id>": "<user_id>"}, "default_user_id": "<user_id>"}. Sin nada, al Owner.';

-- ------------------------------------------------------------
-- 2. A quien va un chat de un conocido
-- ------------------------------------------------------------
-- Gemela de `knownAssignee` (lib/inbox/known.ts). Orden: la persona de esa
-- cuenta, la por defecto, el Owner. Solo gente que sigue en el equipo.

CREATE OR REPLACE FUNCTION private.known_assignee(p_workspace_id uuid, p_channel_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_settings jsonb;
  v_pick     uuid;
  v_text     text;
BEGIN
  SELECT known_contacts_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
  v_settings := coalesce(v_settings, '{}'::jsonb);

  FOREACH v_text IN ARRAY ARRAY[
    v_settings -> 'by_channel' ->> p_channel_id::text,
    v_settings ->> 'default_user_id'
  ] LOOP
    CONTINUE WHEN v_text IS NULL OR v_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
    SELECT wm.user_id INTO v_pick
    FROM public.workspace_members wm
    WHERE wm.workspace_id = p_workspace_id AND wm.user_id = v_text::uuid;
    IF v_pick IS NOT NULL THEN
      RETURN v_pick;
    END IF;
  END LOOP;

  SELECT wm.user_id INTO v_pick
  FROM public.workspace_members wm
  WHERE wm.workspace_id = p_workspace_id AND wm.role = 'owner'
  ORDER BY wm.created_at
  LIMIT 1;
  RETURN v_pick;
END;
$$;

REVOKE ALL ON FUNCTION private.known_assignee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.known_assignee(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 3. Marcar y quitar (trigger en contacts)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contacts_known_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_assigned jsonb := '[]'::jsonb;
  v_forced   jsonb := '[]'::jsonb;
  v_restored jsonb := '[]'::jsonb;
  v_moved    jsonb := '[]'::jsonb;
  v_tag      uuid;
BEGIN
  IF NEW.is_known IS NOT DISTINCT FROM OLD.is_known THEN
    RETURN NULL;
  END IF;

  IF NEW.is_known THEN
    -- Responsable: la persona de la cuenta de cada conversacion.
    WITH target AS (
      SELECT c.id, c.assigned_to AS previous, private.known_assignee(c.workspace_id, c.channel_id) AS next
      FROM public.conversations c
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL
    ), upd AS (
      UPDATE public.conversations c
      SET assigned_to = target.next
      FROM target
      WHERE c.id = target.id AND target.next IS NOT NULL AND c.assigned_to IS DISTINCT FROM target.next
      RETURNING c.id, target.previous, target.next
    )
    SELECT coalesce(jsonb_agg(jsonb_build_object('id', upd.id, 'old', upd.previous, 'new', upd.next)), '[]'::jsonb)
      INTO v_assigned FROM upd;

    -- Agente: solo las que no estaban apagadas (un apagado a mano no se reclama).
    WITH upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_known = true
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL AND c.agent_enabled IS DISTINCT FROM false
      RETURNING c.id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_forced FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'known',
      jsonb_build_object('is_known', jsonb_build_object('old', false, 'new', true)),
      jsonb_build_object('conversations_assigned', v_assigned, 'conversations_forced_off', v_forced),
      auth.uid()
    );
    RETURN NULL;
  END IF;

  -- Quitar: si conserva una etiqueta que apaga el agente, la marca pasa a esa.
  SELECT ct.tag_id INTO v_tag
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = NEW.id AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_tag IS NOT NULL THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_known = false, agent_disabled_by_tag_id = v_tag
      WHERE contact_id = NEW.id AND agent_disabled_by_known
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    WITH upd AS (
      UPDATE public.conversations
      SET agent_enabled = NULL, agent_disabled_by_known = false
      WHERE contact_id = NEW.id AND agent_disabled_by_known AND agent_enabled = false
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    NEW.workspace_id, 'contact', NEW.id, 'known',
    jsonb_build_object('is_known', jsonb_build_object('old', true, 'new', false)),
    jsonb_build_object('conversations_restored', v_restored, 'still_disabled_by_tag_id', v_tag, 'conversations_still_disabled', v_moved, 'assignment_kept', true),
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contacts_known_effects ON public.contacts;
CREATE TRIGGER contacts_known_effects
  AFTER UPDATE OF is_known ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_known_effects();

-- ------------------------------------------------------------
-- 4. Fusion: el principal hereda la marca del duplicado
-- ------------------------------------------------------------
-- `merge_contacts` (00247) borra el duplicado con `metadata.merged_into` antes
-- de mudar nada. Al ver eso, si el duplicado era conocido y el principal no,
-- el principal pasa a serlo (y el trigger de arriba hace el resto).

CREATE OR REPLACE FUNCTION public.contacts_known_on_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_main uuid;
BEGIN
  IF NOT OLD.is_known OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
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
  UPDATE public.contacts
  SET is_known = true,
      known_marked_by = coalesce(known_marked_by, OLD.known_marked_by),
      known_marked_at = coalesce(known_marked_at, OLD.known_marked_at, now())
  WHERE id = v_main AND workspace_id = NEW.workspace_id AND NOT is_known;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contacts_known_on_merge ON public.contacts;
CREATE TRIGGER contacts_known_on_merge
  AFTER UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_known_on_merge();

-- ------------------------------------------------------------
-- 5. Conversaciones nuevas o mudadas de un conocido
-- ------------------------------------------------------------
-- Corre despues de `conversations_a_inherit_tag_effects` (orden alfabetico):
-- si una etiqueta ya la apago, no la toca.

CREATE OR REPLACE FUNCTION public.conversations_inherit_known()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_known boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.is_known INTO v_known FROM public.contacts ct WHERE ct.id = NEW.contact_id;

  IF coalesce(v_known, false) THEN
    IF NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_known := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_known THEN
    -- Se mudo a un contacto que no es conocido: lo que apago la marca se libera.
    NEW.agent_enabled := NULL;
    NEW.agent_disabled_by_known := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_a2_inherit_known ON public.conversations;
CREATE TRIGGER conversations_a2_inherit_known
  BEFORE INSERT OR UPDATE OF contact_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_known();

-- Una persona cambio el estado del agente: la marca del conocido deja de valer
-- (mismo criterio que `conversations_keep_tag_marker`, 00073).
CREATE OR REPLACE FUNCTION public.conversations_keep_known_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_known IS NOT DISTINCT FROM OLD.agent_disabled_by_known THEN
    NEW.agent_disabled_by_known := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_b2_keep_known_marker ON public.conversations;
CREATE TRIGGER conversations_b2_keep_known_marker
  BEFORE UPDATE OF agent_enabled ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_known_marker();

REVOKE ALL ON FUNCTION public.contacts_known_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_known_on_merge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_inherit_known() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_keep_known_marker() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. assign_new_conversation: primero el conocido, despues las reglas
-- ------------------------------------------------------------
-- Igual a la 00255 salvo el bloque marcado "00256".

CREATE OR REPLACE FUNCTION public.assign_new_conversation(p_conversation_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  conv             public.conversations%ROWTYPE;
  r                public.conversation_assignment_rules%ROWTYPE;
  v_active         uuid[];
  v_pick           uuid;
  v_setter_old     uuid;
  v_setter_changed boolean := false;
BEGIN
  SELECT * INTO conv FROM public.conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF conv.assigned_to IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'already_assigned', 'assigned_to', conv.assigned_to);
  END IF;

  -- 00256: el chat de un conocido va a la persona de esa cuenta, sin reglas y
  -- sin tocar el setter.
  IF EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = conv.contact_id AND ct.is_known) THEN
    v_pick := private.known_assignee(conv.workspace_id, conv.channel_id);
    IF v_pick IS NULL THEN
      RETURN jsonb_build_object('status', 'no_rule');
    END IF;
    UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;
    RETURN jsonb_build_object('status', 'assigned', 'assigned_to', v_pick, 'rule_id', NULL, 'rule_name', NULL,
      'source', 'known', 'contact_id', conv.contact_id, 'setter_changed', false, 'setter_old', NULL);
  END IF;

  SELECT coalesce(array_agg(wm.user_id), '{}'::uuid[]) INTO v_active
  FROM public.workspace_members wm
  WHERE wm.workspace_id = conv.workspace_id;

  FOR r IN
    SELECT *
    FROM public.conversation_assignment_rules car
    WHERE car.workspace_id = conv.workspace_id
      AND car.enabled
      AND car.archived_at IS NULL
      AND (cardinality(car.channel_ids) = 0 OR conv.channel_id = ANY (car.channel_ids))
    ORDER BY car.position, car.created_at, car.id
    FOR UPDATE
  LOOP
    v_pick := public.conversation_rule_pick(r.mode, r.member_ids, v_active, r.last_assigned_member_id);
    CONTINUE WHEN v_pick IS NULL;

    UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;

    IF r.mode = 'round_robin' THEN
      UPDATE public.conversation_assignment_rules SET last_assigned_member_id = v_pick WHERE id = r.id;
    END IF;

    IF r.setter_mode <> 'none' AND conv.contact_id IS NOT NULL THEN
      SELECT ct.setter_id INTO v_setter_old
      FROM public.contacts ct
      WHERE ct.id = conv.contact_id AND ct.deleted_at IS NULL
      FOR UPDATE;
      IF FOUND
         AND v_setter_old IS DISTINCT FROM v_pick
         AND (r.setter_mode = 'overwrite' OR v_setter_old IS NULL) THEN
        UPDATE public.contacts SET setter_id = v_pick WHERE id = conv.contact_id;
        v_setter_changed := true;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'status', 'assigned',
      'assigned_to', v_pick,
      'rule_id', r.id,
      'rule_name', r.name,
      'source', 'rule',
      'contact_id', conv.contact_id,
      'setter_changed', v_setter_changed,
      'setter_old', v_setter_old
    );
  END LOOP;

  RETURN jsonb_build_object('status', 'no_rule');
END;
$$;

REVOKE ALL ON FUNCTION public.assign_new_conversation(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_new_conversation(uuid) TO service_role;
