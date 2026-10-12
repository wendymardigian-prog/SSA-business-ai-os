-- ============================================================================
-- 00168 — Ventas (B4, F35): quien lee el historial de una venta, un pago o el catalogo
-- ============================================================================
-- `audit_log_select` NO se reescribe (ni la politica de Llamadas, `audit_log_select_calls`).
-- Siguiendo la convencion de Llamadas, cada modulo suma su propia politica de SELECT ADICIONAL y
-- permisiva; Postgres las combina con OR. La de Ventas:
--
--   entity_type = 'sale'       quien ve la venta (`can_see_sale_id`: admin, setter, vendedor, o un rol
--                              con `sales.view` de alcance `all`), incluidas las filas que escribio el
--                              sistema o un agente.
--   entity_type = 'payment'    quien ve la venta del pago.
--   product, product_variant,  cualquier miembro del workspace: el catalogo ya es legible por todos en sus
--   product_version            tablas (00159), asi que su historial tambien.
--
-- Una persona que no es setter ni vendedor NO ve ninguna fila de esa venta ni de sus pagos. Lo que ya
-- se veia de los demas `entity_type` (contact, conversation, booking, call, ...) no cambia:
-- `scripts/verify-audit-visibility.mjs` (--despues-de-00168) lo comprueba contra el resultado de antes.
--
-- Idempotente: DROP POLICY IF EXISTS + CREATE.
--
-- Como volver atras:
--   DROP POLICY IF EXISTS audit_log_select_sales ON public.audit_log;
-- ============================================================================

DROP POLICY IF EXISTS audit_log_select_sales ON public.audit_log;
CREATE POLICY audit_log_select_sales ON public.audit_log
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.is_workspace_member(workspace_id) AND (
         (entity_type = 'sale' AND public.can_see_sale_id(entity_id))
      OR (entity_type = 'payment' AND EXISTS (
            SELECT 1 FROM public.payments p
             WHERE p.id = audit_log.entity_id AND public.can_see_sale_id(p.sale_id)))
      OR entity_type IN ('product', 'product_variant', 'product_version')
    )
  );
