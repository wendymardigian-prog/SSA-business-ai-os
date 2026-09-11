-- ============================================================================
-- 00051 — Centro de notificaciones in-app (F18)
-- ============================================================================
-- Avisos operativos dentro del sistema: se derivo una conversacion a una
-- persona, se cayo un canal, un contacto quedo en dos secuencias a la vez.
--
-- Por que una tabla y no seguir usando analytics_events, que es donde vivian
-- hasta ahora: un aviso necesita estado de leido/no leido por persona y un
-- indice pensado para contar los no leidos. analytics_events es una bitacora de
-- metricas; meterle ese estado la convertia en dos cosas a la vez.
--
-- SCOPE — es lo unico delicado de esta migracion:
-- Un Member solo puede ver los avisos de SUS leads. Una notificacion de "se
-- derivo una conversacion" apunta a una conversacion concreta, asi que la
-- pregunta "puede ver este aviso?" se reduce a "puede ver esa conversacion?",
-- que ya sabe contestar can_see_conversation (00018/00028). Por eso el helper
-- delega en las funciones que ya existen en vez de reimplementar el scope: si
-- manana cambia la regla de scope, cambia en un solo lugar.
--
-- recipient_id NULL significa "para los admins del workspace". No significa
-- "para cualquiera".
--
-- Sin soft delete: un aviso leido no es historia que haya que conservar. Se
-- purgan los viejos por cron.
--
-- Idempotente.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- Sin CHECK a proposito: el catalogo de tipos vive en TypeScript
  -- (lib/notifications/types.ts), igual que integration_configs.provider y
  -- audit_log.action. Un tipo nuevo no tiene que ser una migracion.
  type text NOT NULL,
  title text NOT NULL,
  body text,
  -- A que apunta el aviso. entity_type manda el deep-link Y el scope.
  entity_type text,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- NULL = para los Owner/Admin del workspace.
  recipient_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.notifications IS
  'Centro de notificaciones in-app (F18). Las escribe solo el service role. Un Member ve las de sus leads; Owner/Admin, las del workspace.';

COMMENT ON COLUMN public.notifications.recipient_id IS
  'Destinatario puntual. NULL = para los Owner/Admin del workspace (no "para cualquiera").';

COMMENT ON COLUMN public.notifications.entity_type IS
  'A que apunta el aviso: conversation, channel, sequence_enrollment, contact. Define el deep-link y, para un Member, si puede verlo.';

COMMENT ON COLUMN public.notifications.metadata IS
  'Datos del evento. Nunca API keys, contenido de mensajes ni PII de mas.';

-- El contador de la campana: no leidas del workspace, mas nuevas primero.
CREATE INDEX IF NOT EXISTS idx_notifications_ws_unread
  ON public.notifications(workspace_id, created_at DESC)
  WHERE read_at IS NULL;

-- El listado completo del panel.
CREATE INDEX IF NOT EXISTS idx_notifications_ws_created
  ON public.notifications(workspace_id, created_at DESC);

-- Las de un destinatario puntual.
CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications(recipient_id, created_at DESC)
  WHERE recipient_id IS NOT NULL;

-- Lo que mira la purga.
CREATE INDEX IF NOT EXISTS idx_notifications_read_at
  ON public.notifications(read_at)
  WHERE read_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- Scope: puede esta persona ver este aviso?
-- ----------------------------------------------------------------------------
-- Recibe la fila entera como tipo compuesto, igual que can_see_contact: asi la
-- policy se escribe can_see_notification(notifications) y el planner no tiene
-- que resolver nada raro.
CREATE OR REPLACE FUNCTION public.can_see_notification(n public.notifications)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
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
$$;

COMMENT ON FUNCTION public.can_see_notification(public.notifications) IS
  'Scope de leads aplicado a las notificaciones (F18). Owner/Admin ven todo el workspace; un Member ve las suyas y las que apuntan a un lead que le corresponde. Delega en can_see_conversation / can_see_contact.';

REVOKE ALL ON FUNCTION public.can_see_notification(public.notifications) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_see_notification(public.notifications) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- RLS
-- ----------------------------------------------------------------------------
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "notifications_select" ON public.notifications;
CREATE POLICY "notifications_select" ON public.notifications
  FOR SELECT USING (public.can_see_notification(notifications));

-- Marcar leido y nada mas. El USING y el WITH CHECK son el mismo predicado, asi
-- que nadie puede mover un aviso a otro workspace ni "leer" el de otro.
DROP POLICY IF EXISTS "notifications_update" ON public.notifications;
CREATE POLICY "notifications_update" ON public.notifications
  FOR UPDATE USING (public.can_see_notification(notifications))
  WITH CHECK (public.can_see_notification(notifications));

DROP POLICY IF EXISTS "notifications_delete" ON public.notifications;
CREATE POLICY "notifications_delete" ON public.notifications
  FOR DELETE USING (public.is_workspace_admin(workspace_id));

-- Sin policy de INSERT: los avisos los genera el sistema con el service role.
-- Si un usuario pudiera insertar, podria fabricarle un aviso a otro.
DROP POLICY IF EXISTS "notifications_insert" ON public.notifications;

-- ----------------------------------------------------------------------------
-- Realtime — para que la campana se actualice sola
-- ----------------------------------------------------------------------------
-- Con guard: el ALTER pelado falla al re-correr con "table is already member of
-- publication", y esta migracion tiene que poder correrse dos veces.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- ----------------------------------------------------------------------------
-- Purga
-- ----------------------------------------------------------------------------
-- Un aviso leido de hace dos meses no lo mira nadie y la tabla crece sola.
-- Los NO leidos no se tocan nunca: si nadie lo vio, sigue pendiente.
CREATE OR REPLACE FUNCTION public.purge_read_notifications(p_retention_days integer DEFAULT 60)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_deleted integer := 0;
BEGIN
  DELETE FROM public.notifications
  WHERE read_at IS NOT NULL
    AND read_at < now() - make_interval(days => GREATEST(p_retention_days, 1));

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

COMMENT ON FUNCTION public.purge_read_notifications(integer) IS
  'Borra las notificaciones LEIDAS de mas de N dias. Las no leidas no se tocan nunca. La llama el cron diario.';

REVOKE ALL ON FUNCTION public.purge_read_notifications(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_read_notifications(integer) TO service_role;
