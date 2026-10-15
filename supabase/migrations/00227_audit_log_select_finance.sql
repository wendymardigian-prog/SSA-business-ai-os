-- ============================================================================
-- 00227 — Gastos (G1, GF14): quien lee el historial de Finanzas
-- ============================================================================
-- `audit_log_select` NO se reescribe. Siguiendo la convencion de los demas modulos (00147 Llamadas, 00168 Ventas,
-- 00197 Tareas, 00213 Actividad), Finanzas suma su propia politica de SELECT ADICIONAL y permisiva; Postgres las
-- combina con OR. La de Finanzas deja ver las entradas de gastos, plantillas y proveedores a quien tiene
-- `expenses.view` (en la practica, un rol personalizado de contabilidad). Las categorias y la configuracion se
-- auditan sobre `workspace`, que ya lo ven los Admin.
--
-- Lo que ya se veia de los demas `entity_type` no cambia: `scripts/verify-audit-visibility.mjs` (y
-- `verify-expenses.mjs`) lo comprueban contra el resultado de antes.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE.
--
-- Como volver atras:
--   DROP POLICY IF EXISTS audit_log_select_finance ON public.audit_log;
-- ============================================================================

DROP POLICY IF EXISTS audit_log_select_finance ON public.audit_log;
CREATE POLICY audit_log_select_finance ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    entity_type IN ('expense', 'recurring_expense', 'vendor')
    AND (select public.has_permission(workspace_id, 'expenses.view'))
  );
