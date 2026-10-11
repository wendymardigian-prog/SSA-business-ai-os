-- ============================================================================
-- 00151 — Formularios: indice parcial para las metricas
-- ============================================================================
-- Vistas, inicios y rechazados de un formulario no tienen tabla propia: se
-- escriben en `analytics_events` (event_type form_view / form_start /
-- form_rejected, contact_id null, metadata {form_id, version_id}). Este indice
-- parcial es lo que usa `form_metrics_daily` (00152) para leerlos.
--
-- Es PARCIAL (`event_type LIKE 'form\_%'`): ninguna de las filas de hoy lo
-- cubre (todas son `contact_created`) y los inserts del motor de flows no lo
-- mantienen. No cambia ni lee ninguna fila existente.
--
-- Aditiva e idempotente.
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.idx_analytics_forms;
-- (los eventos form_* ya escritos quedan en analytics_events y no molestan a nadie)
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_analytics_forms
  ON public.analytics_events (workspace_id, (metadata ->> 'form_id'), event_type, created_at)
  WHERE event_type LIKE 'form\_%';
