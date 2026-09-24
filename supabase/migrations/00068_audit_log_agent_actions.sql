-- ============================================================================
-- 00068 — La vista de Acciones del agente sobre audit_log (F28) y su reversion
-- ============================================================================
-- Fase 3, Bloque 2b. Sin tabla nueva: el audit_log ya es el registro canonico
-- de los efectos de negocio (antes/despues en `changes`, el agente como actor
-- en `performed_by_agent_id`). Lo que faltaba:
--
-- 1. Saber si una accion fue revertida: `reverted_at` y `reverted_by_audit_id`
--    (la entrada `revert` que la deshizo, con quien y cuando). Las marca el
--    service role desde la Server Action, despues de aplicar el inverso con el
--    cliente del usuario: audit_log sigue sin policy de UPDATE, y asi un
--    usuario no puede "desmarcar" una reversion ni marcar una que no hizo.
--
-- 2. Que un Member VEA las acciones del agente sobre sus leads. La policy de
--    la 00023 le deja ver solo sus propias filas (performed_by = auth.uid()), y
--    las del agente tienen performed_by NULL: la pestana Acciones le quedaba
--    vacia. Se suma una rama: filas con performed_by_agent_id sobre un contacto
--    o una conversacion que el Member puede ver. El EXISTS pasa por la RLS de
--    contacts / conversations y arrastra el scope de leads gratis (mismo truco
--    que agent_runs en la 00060 y messages en la 00054).
--
-- 3. Indices para los filtros de la pestana: tipo de accion (el principal),
--    reversion, y canal / contacto / conversacion via metadata (GIN parcial
--    sobre las filas del agente, que son las unicas que se consultan asi).
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.audit_log
  ADD COLUMN IF NOT EXISTS reverted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reverted_by_audit_id uuid REFERENCES public.audit_log(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.audit_log.reverted_at IS
  'Cuando una persona revirtio esta accion del agente desde la pestana Acciones. La reversion es a su vez una entrada (action = revert).';
COMMENT ON COLUMN public.audit_log.reverted_by_audit_id IS
  'La entrada revert que deshizo esta accion (quien y cuando).';

DROP POLICY IF EXISTS "audit_log_select" ON public.audit_log;
CREATE POLICY "audit_log_select" ON public.audit_log
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (public.is_workspace_member(workspace_id) AND performed_by = auth.uid())
    OR (
      public.is_workspace_member(workspace_id)
      AND performed_by_agent_id IS NOT NULL
      AND (
        (entity_type = 'contact' AND EXISTS (SELECT 1 FROM public.contacts c WHERE c.id = audit_log.entity_id))
        OR (entity_type = 'conversation' AND EXISTS (SELECT 1 FROM public.conversations cv WHERE cv.id = audit_log.entity_id))
      )
    )
  );

-- Sin UPDATE ni DELETE para authenticated, como siempre. Las marcas de
-- reversion las escribe el service role.
DROP POLICY IF EXISTS "audit_log_update" ON public.audit_log;
DROP POLICY IF EXISTS "audit_log_delete" ON public.audit_log;
REVOKE UPDATE, DELETE ON TABLE public.audit_log FROM authenticated;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_action
  ON public.audit_log(workspace_id, action, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_reverted
  ON public.audit_log(workspace_id, reverted_at, performed_at DESC)
  WHERE performed_by_agent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_log_agent_metadata
  ON public.audit_log USING gin(metadata jsonb_path_ops)
  WHERE performed_by_agent_id IS NOT NULL;
