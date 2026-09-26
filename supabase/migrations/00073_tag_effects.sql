-- ============================================================================
-- 00073 — Etiquetas con efecto sobre el agente (Bloque 2d-A)
-- ============================================================================
-- Fase 3, Bloque 2d-A.
--
-- Wendy tiene contactos personales en el mismo Instagram por el que entran los
-- leads. El peor error posible del sistema es que el agente le ofrezca la
-- academia a un amigo. Una etiqueta que solo queda guardada no alcanza: el
-- agente igual redactaria la respuesta de venta. Tiene que tener efecto.
--
-- Una sola implementacion generica, no dos casos especiales: `es-conocido` y
-- `no-es-lead` piden lo mismo (apagar el agente en las conversaciones del
-- contacto, las de hoy y las que se abran despues) y solo difieren en si ademas
-- asignan a alguien. Dos columnas en `tags` y triggers en la base. Viven en la
-- base y no en una Server Action porque son seis los caminos que ponen
-- etiquetas (ficha, panel de la bandeja, importacion CSV, nodo de flow,
-- herramienta del agente, accion masiva) y no comparten una funcion de TS.
--
--   1. tags.disables_agent / tags.assigns_to. Solo Owner/Admin crea, edita o
--      borra una etiqueta con efecto (policies de tags por comando). Un Member
--      sigue creando y usando etiquetas comunes, y PUEDE aplicarle una con
--      efecto a un lead suyo (contact_tags no cambia).
--
--   2. conversations.agent_disabled_by_tag_id: la marca de "esto lo apago una
--      etiqueta". Sin FK a proposito: el tag puede borrarse. Es lo que permite
--      revertir SOLO lo que apago la etiqueta y nunca un apagado a mano (Human
--      Takeover, respuesta manual, el toggle).
--
--   3. Al poner la etiqueta (AFTER INSERT en contact_tags): las conversaciones
--      del contacto que no estaban apagadas pasan a forzado apagado con la
--      marca; si la etiqueta asigna, setter y vendedor pasan a esa persona.
--      Una fila de audit_log con las dos consecuencias y el estado previo de
--      cada conversacion.
--
--   4. Al sacarla (AFTER DELETE): las conversaciones con la marca de ESA
--      etiqueta vuelven a heredar (NULL). La asignacion NO se revierte (la
--      persona sigue siendo la responsable; decision de Wendy). Si el contacto
--      conserva otra etiqueta con efecto, la marca pasa a esa y nada se prende.
--
--   5. Conversaciones nuevas del contacto (BEFORE INSERT en conversations) y
--      conversaciones que se mueven a el en una fusion (BEFORE UPDATE OF
--      contact_id) nacen apagadas con la marca.
--
--   6. La marca se limpia sola cuando una persona cambia el estado del agente
--      en la conversacion (BEFORE UPDATE OF agent_enabled). Asi prender a mano
--      gana sobre la etiqueta. Y contestar a mano una conversacion que YA
--      estaba apagada por la etiqueta no la toca: el estado no cambia, no es
--      una decision nueva, y sacar la etiqueta despues la vuelve a heredar.
--      Vale para cualquier escritor, presente o futuro: no depende de que cada
--      archivo de TypeScript se acuerde de limpiarla.
--
--   7. Borrar la etiqueta de la tabla tags (BEFORE DELETE) revierte mientras la
--      fila existe: en la cascada a contact_tags el trigger por fila ya no la
--      encontraria. Prender o apagar "Apaga el agente" en una etiqueta en uso
--      (AFTER UPDATE OF disables_agent) aplica o revierte en sus contactos.
--
-- Los triggers corren como el dueño de las tablas (SECURITY DEFINER): la RLS de
-- audit_log no aplica adentro, igual que en apply_opt_out_check (00027).
-- performed_by = auth.uid(): quien puso la etiqueta, o NULL si fue el sistema.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Columnas
-- ------------------------------------------------------------

ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS disables_agent boolean NOT NULL DEFAULT false;
ALTER TABLE public.tags ADD COLUMN IF NOT EXISTS assigns_to uuid NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tags_assigns_to_fkey') THEN
    ALTER TABLE public.tags
      ADD CONSTRAINT tags_assigns_to_fkey FOREIGN KEY (assigns_to) REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON COLUMN public.tags.disables_agent IS
  'Etiqueta con efecto (00073): el agente queda forzado apagado en las conversaciones del contacto.';
COMMENT ON COLUMN public.tags.assigns_to IS
  'Etiqueta con efecto (00073): al ponerla, setter y vendedor del contacto pasan a esta persona.';

CREATE INDEX IF NOT EXISTS idx_tags_with_effect ON public.tags (workspace_id) WHERE disables_agent;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_disabled_by_tag_id uuid NULL;

COMMENT ON COLUMN public.conversations.agent_disabled_by_tag_id IS
  'La etiqueta que apago el agente aca (00073). Se limpia sola si una persona cambia el estado del agente.';

CREATE INDEX IF NOT EXISTS idx_conversations_disabled_by_tag
  ON public.conversations (agent_disabled_by_tag_id) WHERE agent_disabled_by_tag_id IS NOT NULL;

-- ------------------------------------------------------------
-- 2. Policies de tags, por comando
-- ------------------------------------------------------------
-- La 00002 tenia una sola FOR ALL para cualquier miembro. No se usa privilegio
-- de columna: todos los usuarios son el mismo rol `authenticated`, asi que
-- revocar la columna se la sacaria tambien a Wendy.

DROP POLICY IF EXISTS "Users can manage tags in their workspaces" ON public.tags;
DROP POLICY IF EXISTS "tags_insert" ON public.tags;
DROP POLICY IF EXISTS "tags_update" ON public.tags;
DROP POLICY IF EXISTS "tags_delete" ON public.tags;

CREATE POLICY "tags_insert" ON public.tags
  FOR INSERT
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

CREATE POLICY "tags_update" ON public.tags
  FOR UPDATE
  USING (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  )
  WITH CHECK (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

CREATE POLICY "tags_delete" ON public.tags
  FOR DELETE
  USING (
    public.is_workspace_member(workspace_id)
    AND (public.is_workspace_admin(workspace_id) OR (disables_agent = false AND assigns_to IS NULL))
  );

-- ------------------------------------------------------------
-- 3. Aplicar el efecto de una etiqueta a un contacto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.tag_effect_apply(p_contact_id uuid, p_tag_id uuid, p_origin text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tag      public.tags%ROWTYPE;
  v_contact  public.contacts%ROWTYPE;
  v_forced   jsonb := '[]'::jsonb;
  v_assigned boolean := false;
BEGIN
  SELECT * INTO v_tag FROM public.tags WHERE id = p_tag_id;
  IF NOT FOUND OR (NOT v_tag.disables_agent AND v_tag.assigns_to IS NULL) THEN
    RETURN;
  END IF;

  SELECT * INTO v_contact FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_tag.disables_agent THEN
    -- Solo las que no estaban apagadas: una apagada a mano (Human Takeover,
    -- respuesta manual) no se "reclama", asi sacar la etiqueta no la prende.
    WITH prev AS (
      SELECT c.id, c.agent_enabled
      FROM public.conversations c
      WHERE c.contact_id = p_contact_id
        AND c.deleted_at IS NULL
        AND c.agent_enabled IS DISTINCT FROM false
    ), upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_tag_id = p_tag_id
      FROM prev
      WHERE c.id = prev.id
      RETURNING c.id, prev.agent_enabled AS previous
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', upd.id, 'previous', upd.previous)), '[]'::jsonb)
      INTO v_forced
      FROM upd;
  END IF;

  -- Asignar solo a un miembro vigente, y solo si algo cambia: no se emiten
  -- eventos assignment_changed de mas (contacts_automation_changes, 00039).
  IF v_tag.assigns_to IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM public.workspace_members m
       WHERE m.workspace_id = v_tag.workspace_id AND m.user_id = v_tag.assigns_to
     )
     AND (v_contact.setter_id IS DISTINCT FROM v_tag.assigns_to
          OR v_contact.vendedor_id IS DISTINCT FROM v_tag.assigns_to) THEN
    UPDATE public.contacts
    SET setter_id = v_tag.assigns_to, vendedor_id = v_tag.assigns_to
    WHERE id = p_contact_id;
    v_assigned := true;
  END IF;

  IF jsonb_array_length(v_forced) = 0 AND NOT v_assigned THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_contact.workspace_id, 'contact', p_contact_id, 'tag_effect',
    CASE WHEN v_assigned THEN jsonb_build_object(
      'setter_id', jsonb_build_object('old', v_contact.setter_id, 'new', v_tag.assigns_to),
      'vendedor_id', jsonb_build_object('old', v_contact.vendedor_id, 'new', v_tag.assigns_to)
    ) END,
    jsonb_build_object(
      'applied', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', v_tag.name,
      'conversations_forced_off', v_forced,
      'assigned_to', CASE WHEN v_assigned THEN v_tag.assigns_to END,
      'previous_setter_id', v_contact.setter_id,
      'previous_vendedor_id', v_contact.vendedor_id
    ),
    auth.uid()
  );
END;
$$;

-- ------------------------------------------------------------
-- 4. Liberar lo que apago una etiqueta
-- ------------------------------------------------------------
-- p_always_audit: al sacar la etiqueta a mano queda el registro aunque no haya
-- nada que prender (todas se habian prendido a mano). En los barridos (borrar
-- la etiqueta, apagar su efecto) solo se anota el contacto donde algo cambio.

CREATE OR REPLACE FUNCTION private.tag_effect_release(
  p_contact_id   uuid,
  p_tag_id       uuid,
  p_origin       text,
  p_tag_name     text,
  p_always_audit boolean
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_workspace uuid;
  v_other     uuid;
  v_restored  jsonb := '[]'::jsonb;
  v_moved     jsonb := '[]'::jsonb;
BEGIN
  SELECT workspace_id INTO v_workspace FROM public.contacts WHERE id = p_contact_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Otra etiqueta con efecto que el contacto conserva: la marca pasa a esa y
  -- nada se prende.
  SELECT ct.tag_id INTO v_other
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = p_contact_id
    AND ct.tag_id <> p_tag_id
    AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_other IS NOT NULL THEN
    -- Solo la marca: agent_enabled no esta en el SET, asi que la marca no se limpia.
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_tag_id = v_other
      WHERE contact_id = p_contact_id AND agent_disabled_by_tag_id = p_tag_id
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    WITH upd AS (
      UPDATE public.conversations
      SET agent_enabled = NULL, agent_disabled_by_tag_id = NULL
      WHERE contact_id = p_contact_id
        AND agent_disabled_by_tag_id = p_tag_id
        AND agent_enabled = false
      RETURNING id
    )
    SELECT COALESCE(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
  END IF;

  IF NOT p_always_audit AND jsonb_array_length(v_restored) = 0 AND jsonb_array_length(v_moved) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    v_workspace, 'contact', p_contact_id, 'tag_effect', NULL,
    jsonb_build_object(
      'removed', true,
      'origin', p_origin,
      'tag_id', p_tag_id,
      'tag_name', p_tag_name,
      'conversations_restored', v_restored,
      'still_disabled_by_tag_id', v_other,
      'conversations_still_disabled', v_moved,
      'assignment_kept', true
    ),
    auth.uid()
  );
END;
$$;

REVOKE ALL ON FUNCTION private.tag_effect_apply(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION private.tag_effect_release(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 5. Trigger en contact_tags: poner, sacar, mover (fusion)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contact_tags_apply_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_name     text;
  v_disables boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'tag_added');
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' THEN
    -- En la cascada de un DELETE en tags la fila ya no esta: ese caso lo
    -- resolvio tags_effect_changed antes de borrar.
    SELECT name, disables_agent INTO v_name, v_disables FROM public.tags WHERE id = OLD.tag_id;
    IF FOUND AND v_disables THEN
      PERFORM private.tag_effect_release(OLD.contact_id, OLD.tag_id, 'tag_removed', v_name, true);
    END IF;
    RETURN NULL;
  END IF;

  -- UPDATE OF contact_id: la fusion de contactos mueve las etiquetas del
  -- duplicado al principal (lib/actions/contacts.ts, linkContacts).
  IF NEW.contact_id IS DISTINCT FROM OLD.contact_id THEN
    PERFORM private.tag_effect_apply(NEW.contact_id, NEW.tag_id, 'contact_merge');
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contact_tags_effects ON public.contact_tags;
CREATE TRIGGER contact_tags_effects
  AFTER INSERT OR DELETE OR UPDATE OF contact_id ON public.contact_tags
  FOR EACH ROW EXECUTE FUNCTION public.contact_tags_apply_effects();

-- ------------------------------------------------------------
-- 6. Trigger en tags: borrar la etiqueta, prender o apagar su efecto
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tags_effect_changed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  r record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    -- BEFORE DELETE: la fila todavia existe, se libera antes de la cascada.
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = OLD.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, OLD.id, 'tag_deleted', OLD.name, false);
    END LOOP;
    RETURN OLD;
  END IF;

  -- AFTER UPDATE OF disables_agent.
  IF NEW.disables_agent AND NOT OLD.disables_agent THEN
    FOR r IN SELECT contact_id FROM public.contact_tags WHERE tag_id = NEW.id LOOP
      PERFORM private.tag_effect_apply(r.contact_id, NEW.id, 'effect_enabled');
    END LOOP;
  ELSIF OLD.disables_agent AND NOT NEW.disables_agent THEN
    FOR r IN
      SELECT DISTINCT contact_id FROM public.conversations WHERE agent_disabled_by_tag_id = NEW.id
    LOOP
      PERFORM private.tag_effect_release(r.contact_id, NEW.id, 'effect_disabled', NEW.name, false);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tags_effect_on_delete ON public.tags;
CREATE TRIGGER tags_effect_on_delete
  BEFORE DELETE ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

DROP TRIGGER IF EXISTS tags_effect_on_update ON public.tags;
CREATE TRIGGER tags_effect_on_update
  AFTER UPDATE OF disables_agent ON public.tags
  FOR EACH ROW EXECUTE FUNCTION public.tags_effect_changed();

-- ------------------------------------------------------------
-- 7. Triggers en conversations
-- ------------------------------------------------------------

-- Conversaciones nuevas y movidas (fusion) heredan el efecto del contacto.
CREATE OR REPLACE FUNCTION public.conversations_inherit_tag_effects()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tag_id   uuid;
  v_tag_name text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.tag_id, t.name INTO v_tag_id, v_tag_name
  FROM public.contact_tags ct
  JOIN public.tags t ON t.id = ct.tag_id
  WHERE ct.contact_id = NEW.contact_id AND t.disables_agent
  ORDER BY ct.created_at
  LIMIT 1;

  IF v_tag_id IS NOT NULL THEN
    IF TG_OP = 'INSERT' OR NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_tag_id := v_tag_id;
      INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
      VALUES (
        NEW.workspace_id, 'contact', NEW.contact_id, 'tag_effect', NULL,
        jsonb_build_object(
          'applied', true,
          'origin', CASE WHEN TG_OP = 'INSERT' THEN 'new_conversation' ELSE 'contact_merge' END,
          'tag_id', v_tag_id,
          'tag_name', v_tag_name,
          'conversations_forced_off', jsonb_build_array(jsonb_build_object('id', NEW.id, 'previous', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.agent_enabled END))
        ),
        auth.uid()
      );
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_tag_id IS NOT NULL THEN
    -- Se movio a un contacto sin etiqueta con efecto: lo que apago la
    -- etiqueta del contacto anterior se libera.
    NEW.agent_enabled := NULL;
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_a_inherit_tag_effects ON public.conversations;
CREATE TRIGGER conversations_a_inherit_tag_effects
  BEFORE INSERT OR UPDATE OF contact_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_tag_effects();

-- Una persona cambio el estado del agente en la conversacion: la marca de la
-- etiqueta deja de valer. Solo si el estado cambia de verdad y quien escribe no
-- es el mecanismo de la etiqueta (que escribe la marca junto con el estado).
CREATE OR REPLACE FUNCTION public.conversations_keep_tag_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_tag_id IS NOT DISTINCT FROM OLD.agent_disabled_by_tag_id THEN
    NEW.agent_disabled_by_tag_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_b_keep_tag_marker ON public.conversations;
CREATE TRIGGER conversations_b_keep_tag_marker
  BEFORE UPDATE OF agent_enabled ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_tag_marker();

-- Las trigger functions no quedan invocables por usuarios (00048).
REVOKE ALL ON FUNCTION public.contact_tags_apply_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.tags_effect_changed() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_inherit_tag_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_keep_tag_marker() FROM PUBLIC, anon, authenticated;
