-- ============================================================================
-- 00235 — Comisiones: el trigger de `payments` (Extra I, CM1, F53)
-- ============================================================================
-- SE APLICA DESPUES DEL MERGE (el codigo que ejecuta los jobs `commissions_payment` tiene que estar desplegado antes:
-- si no, la cola marcaria ese tipo como fallido y las comisiones no se generarian).
--
-- Conecta `private.enqueue_commissions_for_payment()` (00231) con `public.payments`: cuando un pago entra a `paid` se
-- encola la generacion de sus comisiones, y cuando sale se encola la reversion. La funcion esta envuelta en EXCEPTION: un
-- cobro NUNCA falla por esto.
--
-- Pagos que ya estaban cobrados antes de esta migracion NO generan comisiones (no hay barrido hacia atras a proposito:
-- las reglas se arman despues y recalcular el pasado es una decision del negocio, F65).
--
-- Despues de aplicarla:
--   node scripts/verify-commissions.mjs --despues-de-00235
--   node scripts/verify-sales.mjs
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS payments_enqueue_commissions ON public.payments;
--   UPDATE public.scheduled_jobs SET status = 'cancelled' WHERE type = 'commissions_payment' AND status = 'pending';
-- Riesgo: bajo. Solo encola.
-- ============================================================================

SET search_path = '';

DROP TRIGGER IF EXISTS payments_enqueue_commissions ON public.payments;
CREATE TRIGGER payments_enqueue_commissions
  AFTER INSERT OR UPDATE OF status ON public.payments
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_commissions_for_payment();
