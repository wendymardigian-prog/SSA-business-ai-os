-- ============================================================================
-- 00232 — Comisiones (Extra I, CM3, F67): quien lee el historial de las comisiones y de sus reglas
-- ============================================================================
-- `audit_log_select` NO se reescribe. Siguiendo la convencion de los demas modulos (00147, 00168, 00197, 00213, 00227),
-- Comisiones suma su propia politica de SELECT ADICIONAL y permisiva (Postgres las combina con OR):
--   - entradas de `commission`: las ve quien ve ESA comision (`can_see_commission`): Owner/Admin, un rol con
--     `commissions.view` de alcance `all`, o la persona a la que se le debe;
--   - entradas de `commission_rule`: las ve quien puede ver las reglas (Owner/Admin, `commissions.manage`, o
--     `commissions.view` de alcance `all`).
-- Lo que ya se veia de los demas `entity_type` no cambia: `scripts/verify-audit-visibility.mjs` lo compara.
--
-- Como volver atras:
--   DROP POLICY IF EXISTS audit_log_select_commissions ON public.audit_log;
-- ============================================================================

DROP POLICY IF EXISTS audit_log_select_commissions ON public.audit_log;
CREATE POLICY audit_log_select_commissions ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    (
      entity_type = 'commission'
      AND EXISTS (SELECT 1 FROM public.commissions c WHERE c.id = audit_log.entity_id AND (select public.can_see_commission(c)))
    )
    OR (
      entity_type = 'commission_rule'
      AND (
        (select public.is_workspace_admin(workspace_id))
        OR (select public.has_permission(workspace_id, 'commissions.manage'))
        OR ((select public.has_permission(workspace_id, 'commissions.view')) AND (select public.permission_scope(workspace_id, 'commissions')) = 'all')
      )
    )
  );
