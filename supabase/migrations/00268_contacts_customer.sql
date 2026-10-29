-- ============================================================
-- 00268_contacts_customer
-- ============================================================
-- "Cliente" (octubre 2026): una segunda marca propia del contacto, hermana de
-- "Conocido" (00256) y con los MISMOS efectos:
--
--   contacts.is_customer / customer_marked_by / customer_marked_at / customer_source
--       La marca, quien la puso, cuando y de donde vino: 'manual' (una persona)
--       o 'sale' (se cobro un pago de una venta; customer_marked_by queda NULL).
--   conversations.agent_disabled_by_customer
--       "Esto lo apago la marca de cliente", igual que agent_disabled_by_known.
--   workspaces.customer_contacts_settings
--       A quien van los chats de un cliente, POR CUENTA, con la misma forma que
--       known_contacts_settings. DIFERENCIA con Conocido: sin nada configurado,
--       el responsable NO cambia (no se manda todo al Owner). Un cliente marcado
--       solo al cobrar ya suele tener setter y vendedor, y moverle los chats al
--       Owner sin que nadie lo pidiera seria una sorpresa.
--
-- Al MARCAR (trigger en contacts, venga de donde venga):
--   - sus conversaciones pasan a la persona configurada para su cuenta (si hay);
--   - el agente queda forzado apagado en las que no lo estaban.
-- Al QUITAR: se prende lo que apago la marca, salvo que otra causa siga vigente
-- (la marca de conocido o una etiqueta con efecto): la marca pasa a esa.
--
-- Al COBRAR: un pago que pasa a `paid` con monto positivo (no un reembolso)
-- marca al contacto de la venta como cliente si no lo era. Nunca tumba el pago
-- (EXCEPTION WHEN OTHERS). En la plantilla de estudiantes (sin Ventas) esa
-- funcion y su trigger se podan.
--
-- Las secuencias: se pausan desde la app (`setCustomer`) y el procesador saltea
-- a los clientes (asi tambien quedan frenadas cuando la marca vino de un cobro).
--
-- Esta migracion REDEFINE, copiando y sumando solo lo marcado "00268":
--   - private.tag_effect_release (00073): al sacar una etiqueta, si el contacto
--     sigue siendo conocido o cliente, el agente NO se prende (antes un conocido
--     con etiqueta quedaba con el agente prendido al sacarle la etiqueta).
--   - public.contacts_known_effects (00256): al quitar "conocido", si sigue
--     siendo cliente, la marca pasa a la de cliente.
--   - public.assign_new_conversation (00256): despues del conocido, el cliente.
-- Las definiciones anteriores siguen completas en esos archivos; volver atras
-- es reaplicar esos bloques.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   (reaplicar tag_effect_release de la 00073 y contacts_known_effects y
--    assign_new_conversation de la 00256)
--   DROP TRIGGER IF EXISTS payments_mark_customer ON public.payments;
--   DROP FUNCTION IF EXISTS private.payments_mark_customer();
--   DROP TRIGGER IF EXISTS contacts_customer_on_merge ON public.contacts;
--   DROP TRIGGER IF EXISTS contacts_customer_effects ON public.contacts;
--   DROP TRIGGER IF EXISTS conversations_a3_inherit_customer ON public.conversations;
--   DROP TRIGGER IF EXISTS conversations_b3_keep_customer_marker ON public.conversations;
--   DROP FUNCTION IF EXISTS public.contacts_customer_on_merge();
--   DROP FUNCTION IF EXISTS public.contacts_customer_effects();
--   DROP FUNCTION IF EXISTS public.conversations_inherit_customer();
--   DROP FUNCTION IF EXISTS public.conversations_keep_customer_marker();
--   DROP FUNCTION IF EXISTS private.customer_assignee(uuid, uuid);
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS customer_contacts_settings;
--   ALTER TABLE public.conversations DROP COLUMN IF EXISTS agent_disabled_by_customer;
--   ALTER TABLE public.contacts DROP COLUMN IF EXISTS customer_source,
--     DROP COLUMN IF EXISTS customer_marked_at, DROP COLUMN IF EXISTS customer_marked_by,
--     DROP COLUMN IF EXISTS is_customer;
--
-- Idempotente: IF NOT EXISTS, CREATE OR REPLACE, DROP TRIGGER IF EXISTS.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Columnas
-- ------------------------------------------------------------

ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS is_customer boolean NOT NULL DEFAULT false;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS customer_marked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS customer_marked_at timestamptz;
ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS customer_source text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contacts_customer_source_check') THEN
    ALTER TABLE public.contacts ADD CONSTRAINT contacts_customer_source_check
      CHECK (customer_source IS NULL OR customer_source IN ('manual', 'sale'));
  END IF;
END $$;

COMMENT ON COLUMN public.contacts.is_customer IS
  'Cliente (00268): ya compro. Mismos efectos que is_known: apaga el agente, pausa secuencias y sus chats van a la persona configurada por cuenta (workspaces.customer_contacts_settings).';
COMMENT ON COLUMN public.contacts.customer_source IS
  'De donde vino la marca de cliente: manual (una persona) o sale (se cobro un pago; customer_marked_by queda NULL).';

CREATE INDEX IF NOT EXISTS idx_contacts_customer ON public.contacts (workspace_id) WHERE is_customer;

ALTER TABLE public.conversations ADD COLUMN IF NOT EXISTS agent_disabled_by_customer boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.conversations.agent_disabled_by_customer IS
  'El agente lo apago la marca de cliente (00268). Se limpia sola si una persona cambia el estado del agente.';

ALTER TABLE public.workspaces ADD COLUMN IF NOT EXISTS customer_contacts_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.workspaces.customer_contacts_settings IS
  'A quien van los chats de un cliente (00268): {"by_channel": {"<channel_id>": "<user_id>"}, "default_user_id": "<user_id>"}. Sin nada, el responsable no cambia.';

-- ------------------------------------------------------------
-- 2. A quien va un chat de un cliente
-- ------------------------------------------------------------
-- Gemela de `customerAssignee` (lib/inbox/marks.ts). Orden: la persona de esa
-- cuenta, la por defecto. Sin Owner de respaldo (ver la cabecera).

CREATE OR REPLACE FUNCTION private.customer_assignee(p_workspace_id uuid, p_channel_id uuid)
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
  SELECT customer_contacts_settings INTO v_settings FROM public.workspaces WHERE id = p_workspace_id;
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

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.customer_assignee(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION private.customer_assignee(uuid, uuid) TO service_role;

-- ------------------------------------------------------------
-- 3. Marcar y quitar (trigger en contacts)
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contacts_customer_effects()
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
  IF NEW.is_customer IS NOT DISTINCT FROM OLD.is_customer THEN
    RETURN NULL;
  END IF;

  IF NEW.is_customer THEN
    WITH target AS (
      SELECT c.id, c.assigned_to AS previous, private.customer_assignee(c.workspace_id, c.channel_id) AS next
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

    WITH upd AS (
      UPDATE public.conversations c
      SET agent_enabled = false, agent_disabled_by_customer = true
      WHERE c.contact_id = NEW.id AND c.deleted_at IS NULL AND c.agent_enabled IS DISTINCT FROM false
      RETURNING c.id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_forced FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'customer',
      jsonb_build_object('is_customer', jsonb_build_object('old', false, 'new', true)),
      jsonb_build_object('source', NEW.customer_source, 'conversations_assigned', v_assigned, 'conversations_forced_off', v_forced),
      auth.uid()
    );
    RETURN NULL;
  END IF;

  -- Quitar. Si sigue siendo conocido, la marca pasa a la de conocido.
  IF NEW.is_known THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_customer = false, agent_disabled_by_known = true
      WHERE contact_id = NEW.id AND agent_disabled_by_customer
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
  ELSE
    SELECT ct.tag_id INTO v_tag
    FROM public.contact_tags ct
    JOIN public.tags t ON t.id = ct.tag_id
    WHERE ct.contact_id = NEW.id AND t.disables_agent
    ORDER BY ct.created_at
    LIMIT 1;

    IF v_tag IS NOT NULL THEN
      WITH upd AS (
        UPDATE public.conversations
        SET agent_disabled_by_customer = false, agent_disabled_by_tag_id = v_tag
        WHERE contact_id = NEW.id AND agent_disabled_by_customer
        RETURNING id
      )
      SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;
    ELSE
      WITH upd AS (
        UPDATE public.conversations
        SET agent_enabled = NULL, agent_disabled_by_customer = false
        WHERE contact_id = NEW.id AND agent_disabled_by_customer AND agent_enabled = false
        RETURNING id
      )
      SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_restored FROM upd;
    END IF;
  END IF;

  INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
  VALUES (
    NEW.workspace_id, 'contact', NEW.id, 'customer',
    jsonb_build_object('is_customer', jsonb_build_object('old', true, 'new', false)),
    jsonb_build_object('conversations_restored', v_restored, 'still_known', NEW.is_known, 'still_disabled_by_tag_id', v_tag,
      'conversations_still_disabled', v_moved, 'assignment_kept', true),
    auth.uid()
  );
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contacts_customer_effects ON public.contacts;
CREATE TRIGGER contacts_customer_effects
  AFTER UPDATE OF is_customer ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_customer_effects();

-- ------------------------------------------------------------
-- 4. Fusion: el principal hereda la marca del duplicado
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.contacts_customer_on_merge()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_main uuid;
BEGIN
  IF NOT OLD.is_customer OR OLD.deleted_at IS NOT NULL OR NEW.deleted_at IS NULL THEN
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
  SET is_customer = true,
      customer_marked_by = coalesce(customer_marked_by, OLD.customer_marked_by),
      customer_marked_at = coalesce(customer_marked_at, OLD.customer_marked_at, now()),
      customer_source = coalesce(customer_source, OLD.customer_source, 'manual')
  WHERE id = v_main AND workspace_id = NEW.workspace_id AND NOT is_customer;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS contacts_customer_on_merge ON public.contacts;
CREATE TRIGGER contacts_customer_on_merge
  AFTER UPDATE OF deleted_at ON public.contacts
  FOR EACH ROW EXECUTE FUNCTION public.contacts_customer_on_merge();

-- ------------------------------------------------------------
-- 5. Conversaciones nuevas o mudadas de un cliente
-- ------------------------------------------------------------
-- Corre despues de `conversations_a2_inherit_known` (orden alfabetico): si una
-- etiqueta o la marca de conocido ya la apagaron, no la toca.

CREATE OR REPLACE FUNCTION public.conversations_inherit_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_customer boolean;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.contact_id IS NOT DISTINCT FROM OLD.contact_id THEN
    RETURN NEW;
  END IF;

  SELECT ct.is_customer INTO v_customer FROM public.contacts ct WHERE ct.id = NEW.contact_id;

  IF coalesce(v_customer, false) THEN
    IF NEW.agent_enabled IS DISTINCT FROM false THEN
      NEW.agent_enabled := false;
      NEW.agent_disabled_by_customer := true;
    END IF;
  ELSIF TG_OP = 'UPDATE' AND NEW.agent_disabled_by_customer THEN
    NEW.agent_disabled_by_customer := false;
    IF NOT NEW.agent_disabled_by_known AND NEW.agent_disabled_by_tag_id IS NULL THEN
      NEW.agent_enabled := NULL;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_a3_inherit_customer ON public.conversations;
CREATE TRIGGER conversations_a3_inherit_customer
  BEFORE INSERT OR UPDATE OF contact_id ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_inherit_customer();

CREATE OR REPLACE FUNCTION public.conversations_keep_customer_marker()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NEW.agent_enabled IS DISTINCT FROM OLD.agent_enabled
     AND NEW.agent_disabled_by_customer IS NOT DISTINCT FROM OLD.agent_disabled_by_customer THEN
    NEW.agent_disabled_by_customer := false;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS conversations_b3_keep_customer_marker ON public.conversations;
CREATE TRIGGER conversations_b3_keep_customer_marker
  BEFORE UPDATE OF agent_enabled ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.conversations_keep_customer_marker();

REVOKE ALL ON FUNCTION public.contacts_customer_effects() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.contacts_customer_on_merge() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_inherit_customer() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conversations_keep_customer_marker() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 6. Al cobrar: el contacto de la venta pasa a ser cliente
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.payments_mark_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM 'paid' OR coalesce(NEW.amount, 0) <= 0 THEN
    RETURN NULL;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM 'paid' THEN
    RETURN NULL;
  END IF;

  BEGIN
    UPDATE public.contacts ct
    SET is_customer = true,
        customer_marked_by = NULL,
        customer_marked_at = now(),
        customer_source = 'sale'
    FROM public.sales s
    WHERE s.id = NEW.sale_id
      AND ct.id = s.contact_id
      AND ct.workspace_id = NEW.workspace_id
      AND ct.deleted_at IS NULL
      AND NOT ct.is_customer;
  EXCEPTION WHEN OTHERS THEN
    -- Marcar al cliente nunca puede costar el pago.
    RAISE WARNING 'payments_mark_customer: no pude marcar al cliente del pago %: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION private.payments_mark_customer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS payments_mark_customer ON public.payments;
CREATE TRIGGER payments_mark_customer
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.payments_mark_customer();

-- ------------------------------------------------------------
-- 7. tag_effect_release: no prender el agente de un conocido o un cliente
-- ------------------------------------------------------------
-- Igual a la 00073 salvo el bloque marcado "00268".

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
  v_known     boolean;
  v_customer  boolean;
  v_restored  jsonb := '[]'::jsonb;
  v_moved     jsonb := '[]'::jsonb;
BEGIN
  SELECT workspace_id, is_known, is_customer INTO v_workspace, v_known, v_customer
  FROM public.contacts WHERE id = p_contact_id;
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
  -- 00268: si sigue siendo conocido o cliente, la marca pasa a esa y nada se prende.
  ELSIF coalesce(v_known, false) OR coalesce(v_customer, false) THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_tag_id = NULL,
          agent_disabled_by_known = coalesce(v_known, false),
          agent_disabled_by_customer = NOT coalesce(v_known, false)
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
REVOKE ALL ON FUNCTION private.tag_effect_release(uuid, uuid, text, text, boolean) FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 8. contacts_known_effects: al quitar "conocido", si sigue siendo cliente
-- ------------------------------------------------------------
-- Igual a la 00256 salvo el bloque marcado "00268".

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

  -- 00268: si sigue siendo cliente, la marca pasa a la de cliente y nada se prende.
  IF NEW.is_customer THEN
    WITH upd AS (
      UPDATE public.conversations
      SET agent_disabled_by_known = false, agent_disabled_by_customer = true
      WHERE contact_id = NEW.id AND agent_disabled_by_known
      RETURNING id
    )
    SELECT coalesce(jsonb_agg(upd.id), '[]'::jsonb) INTO v_moved FROM upd;

    INSERT INTO public.audit_log (workspace_id, entity_type, entity_id, action, changes, metadata, performed_by)
    VALUES (
      NEW.workspace_id, 'contact', NEW.id, 'known',
      jsonb_build_object('is_known', jsonb_build_object('old', true, 'new', false)),
      jsonb_build_object('still_customer', true, 'conversations_still_disabled', v_moved, 'assignment_kept', true),
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

REVOKE ALL ON FUNCTION public.contacts_known_effects() FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------
-- 9. assign_new_conversation: conocido, cliente y despues las reglas
-- ------------------------------------------------------------
-- Igual a la 00256 salvo el bloque marcado "00268".

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

  -- 00268: el de un cliente, a la persona configurada para esa cuenta. Sin
  -- nadie configurado, siguen las reglas de siempre.
  IF EXISTS (SELECT 1 FROM public.contacts ct WHERE ct.id = conv.contact_id AND ct.is_customer) THEN
    v_pick := private.customer_assignee(conv.workspace_id, conv.channel_id);
    IF v_pick IS NOT NULL THEN
      UPDATE public.conversations SET assigned_to = v_pick WHERE id = conv.id;
      RETURN jsonb_build_object('status', 'assigned', 'assigned_to', v_pick, 'rule_id', NULL, 'rule_name', NULL,
        'source', 'customer', 'contact_id', conv.contact_id, 'setter_changed', false, 'setter_old', NULL);
    END IF;
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
