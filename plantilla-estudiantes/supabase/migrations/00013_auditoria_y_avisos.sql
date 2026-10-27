-- ============================================================================
-- Historial y avisos
--
-- El historial de cambios (audit_log: inmutable, nunca se edita ni se borra) y el
-- centro de avisos de la app (notifications). Un Member ve los avisos de sus leads;
-- Owner y Admin, los de todo el negocio.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Tablas
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  action text NOT NULL,
  changes jsonb,
  metadata jsonb,
  performed_by uuid,
  performed_at timestamp with time zone DEFAULT now() NOT NULL,
  performed_by_agent_id uuid,
  reverted_at timestamp with time zone,
  reverted_by_audit_id uuid,
  actor_type text DEFAULT 'user'::text NOT NULL,
  actor_label text,
  CONSTRAINT audit_log_pkey PRIMARY KEY (id),
  CONSTRAINT audit_log_actor_type_check CHECK ((actor_type = ANY (ARRAY['user'::text, 'agent'::text, 'system'::text, 'webhook'::text]))),
  CONSTRAINT audit_log_performed_by_agent_id_fkey FOREIGN KEY (performed_by_agent_id) REFERENCES public.agents(id) ON DELETE SET NULL,
  CONSTRAINT audit_log_performed_by_fkey FOREIGN KEY (performed_by) REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT audit_log_reverted_by_audit_id_fkey FOREIGN KEY (reverted_by_audit_id) REFERENCES public.audit_log(id) ON DELETE SET NULL,
  CONSTRAINT audit_log_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.audit_log IS 'Historial de cambios significativos. Inmutable y sin soft delete: no se edita ni se borra nunca.';
COMMENT ON COLUMN public.audit_log.performed_by_agent_id IS 'Agente que ejecuto la accion. performed_by (usuario) queda NULL en ese caso. Es la base de la vista de Acciones.';
COMMENT ON COLUMN public.audit_log.reverted_at IS 'Cuando una persona revirtio esta accion del agente desde la pestana Acciones. La reversion es a su vez una entrada (action = revert).';
COMMENT ON COLUMN public.audit_log.reverted_by_audit_id IS 'La entrada revert que deshizo esta accion (quien y cuando).';
COMMENT ON COLUMN public.audit_log.actor_type IS 'Quien hizo la accion: user (una persona), agent (agente de IA), system (proceso interno) o webhook (un proveedor). Para leerlo, usar effectiveActorType().';
COMMENT ON COLUMN public.audit_log.actor_label IS 'Nombre legible del actor cuando no es una persona (ej: "Analisis automatico").';
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM authenticated;

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  workspace_id uuid NOT NULL,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
  recipient_id uuid,
  read_at timestamp with time zone,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT notifications_pkey PRIMARY KEY (id),
  CONSTRAINT notifications_recipient_id_fkey FOREIGN KEY (recipient_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  CONSTRAINT notifications_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
COMMENT ON TABLE public.notifications IS 'Centro de notificaciones in-app. Las escribe solo el service role. Un Member ve las de sus leads; Owner/Admin, las del workspace.';
COMMENT ON COLUMN public.notifications.entity_type IS 'A que apunta el aviso: conversation, channel, sequence_enrollment, contact. Define el deep-link y, para un Member, si puede verlo.';
COMMENT ON COLUMN public.notifications.metadata IS 'Datos del evento. Nunca API keys, contenido de mensajes ni PII de mas.';
COMMENT ON COLUMN public.notifications.recipient_id IS 'Destinatario puntual. NULL = para los Owner/Admin del workspace (no "para cualquiera").';

-- ----------------------------------------------------------------------------
-- Claves foraneas hacia tablas de esta area
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER TABLE public.agent_run_steps ADD CONSTRAINT agent_run_steps_audit_log_id_fkey FOREIGN KEY (audit_log_id) REFERENCES public.audit_log(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Funciones
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.can_see_notification(n public.notifications)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_visible boolean;
BEGIN
  IF NOT public.is_workspace_member(n.workspace_id) THEN
    RETURN false;
  END IF;

  -- Owner y Admin ven todo lo del workspace.
  IF public.is_workspace_admin(n.workspace_id) THEN
    RETURN true;
  END IF;

  -- Dirigida a mi personalmente.
  IF n.recipient_id = auth.uid() THEN
    RETURN true;
  END IF;

  -- De aca para abajo: es un Member y el aviso no es suyo. Solo lo ve si apunta
  -- a un lead que le corresponde. La pregunta se delega en las funciones de
  -- scope que ya existen, para no tener la regla escrita dos veces.
  IF n.entity_id IS NULL THEN
    RETURN false;
  END IF;

  IF n.entity_type = 'conversation' THEN
    SELECT public.can_see_conversation(c) INTO v_visible
    FROM public.conversations c
    WHERE c.id = n.entity_id;
    RETURN COALESCE(v_visible, false);
  END IF;

  IF n.entity_type = 'contact' THEN
    SELECT public.can_see_contact(ct) INTO v_visible
    FROM public.contacts ct
    WHERE ct.id = n.entity_id;
    RETURN COALESCE(v_visible, false);
  END IF;

  -- Todo lo demas (canales caidos, colisiones de secuencias) es informacion de
  -- administracion: un Member no la ve.
  RETURN false;
END;
$function$;
COMMENT ON FUNCTION public.can_see_notification(n public.notifications) IS 'Alcance de leads aplicado a las notificaciones. Owner/Admin ven todo el workspace; un Member ve las suyas y las que apuntan a un lead que le corresponde. Delega en can_see_conversation / can_see_contact.';
REVOKE ALL ON FUNCTION public.can_see_notification(n public.notifications) FROM PUBLIC, anon;

-- ----------------------------------------------------------------------------
-- Indices
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_audit_log_agent ON public.audit_log USING btree (performed_by_agent_id, performed_at DESC) WHERE (performed_by_agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_action ON public.audit_log USING btree (workspace_id, action, performed_at DESC) WHERE (performed_by_agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_metadata ON public.audit_log USING gin (metadata jsonb_path_ops) WHERE (performed_by_agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_reverted ON public.audit_log USING btree (workspace_id, reverted_at, performed_at DESC) WHERE (performed_by_agent_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON public.audit_log USING btree (entity_type, entity_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_performer ON public.audit_log USING btree (workspace_id, performed_by, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace ON public.audit_log USING btree (workspace_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_log_workspace_action ON public.audit_log USING btree (workspace_id, action, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON public.notifications USING btree (read_at) WHERE (read_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications USING btree (recipient_id, created_at DESC) WHERE (recipient_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_notifications_ws_created ON public.notifications USING btree (workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_ws_unread ON public.notifications USING btree (workspace_id, created_at DESC) WHERE (read_at IS NULL);

-- ----------------------------------------------------------------------------
-- Reglas de acceso (RLS)
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  CREATE POLICY audit_log_insert ON public.audit_log FOR INSERT TO public
    WITH CHECK ((public.is_workspace_member(workspace_id) AND (performed_by = auth.uid())));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_log_select ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_admin(workspace_id) OR (public.is_workspace_member(workspace_id) AND (performed_by = auth.uid())) OR (public.is_workspace_member(workspace_id) AND (performed_by_agent_id IS NOT NULL) AND (((entity_type = 'contact'::text) AND (EXISTS ( SELECT 1
   FROM public.contacts c
  WHERE (c.id = audit_log.entity_id)))) OR ((entity_type = 'conversation'::text) AND (EXISTS ( SELECT 1
   FROM public.conversations cv
  WHERE (cv.id = audit_log.entity_id)))))) OR (public.is_workspace_member(workspace_id) AND (entity_type = 'booking'::text) AND (EXISTS ( SELECT 1
   FROM public.bookings b
  WHERE (b.id = audit_log.entity_id))))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_log_select_audit ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND ( SELECT public.has_permission(audit_log.workspace_id, 'audit.view'::text) AS has_permission)));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY audit_log_select_catalog ON public.audit_log FOR SELECT TO authenticated
    USING ((public.is_workspace_member(workspace_id) AND (entity_type = ANY (ARRAY['product'::text, 'product_variant'::text]))));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY notifications_delete ON public.notifications FOR DELETE TO public
    USING (public.is_workspace_admin(workspace_id));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY notifications_select ON public.notifications FOR SELECT TO public
    USING (public.can_see_notification(notifications.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY notifications_update ON public.notifications FOR UPDATE TO public
    USING (public.can_see_notification(notifications.*))
    WITH CHECK (public.can_see_notification(notifications.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ----------------------------------------------------------------------------
-- Tiempo real
-- ----------------------------------------------------------------------------

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
