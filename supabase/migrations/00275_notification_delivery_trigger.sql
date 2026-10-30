-- ============================================================
-- 00275_notification_delivery_trigger.sql
--
-- SE APLICA DESPUES DEL DEPLOY: el codigo que ejecuta los jobs
-- `notification_deliver` (lib/jobs/handlers/notification-deliver.ts) tiene que
-- estar desplegado antes. Si no, la cola marcaria esos jobs como fallidos por
-- tipo desconocido y ningun aviso saldria por email ni WhatsApp.
--
-- Conecta `private.enqueue_notification_delivery()` (00274) con
-- `public.notifications`: cada aviso nuevo, venga del codigo o del SQL (los
-- `draft_window` de la 00072), encola su entrega. El job decide a quien y por
-- donde segun las preferencias de cada persona. La funcion esta envuelta en
-- EXCEPTION: un aviso NUNCA deja de guardarse por esto.
--
-- Los avisos que ya existian antes de esta migracion no se mandan (no hay
-- barrido hacia atras a proposito).
--
-- Despues de aplicarla:
--   node scripts/verify-account.mjs --despues-de-00275
--
-- Como volver atras:
--   DROP TRIGGER IF EXISTS notifications_enqueue_delivery ON public.notifications;
--   UPDATE public.scheduled_jobs SET status = 'failed', last_error = 'cancelado' WHERE type = 'notification_deliver' AND status = 'pending';
-- Riesgo: bajo. Solo encola.
-- ============================================================

SET search_path = '';

DROP TRIGGER IF EXISTS notifications_enqueue_delivery ON public.notifications;
CREATE TRIGGER notifications_enqueue_delivery
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION private.enqueue_notification_delivery();
