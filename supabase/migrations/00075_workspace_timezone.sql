-- ============================================================================
-- 00075 — Zona horaria del workspace (Fase 3, Bloque 1, F3)
-- ============================================================================
-- Los dashboards del Bloque 3 cortan los dias en la zona del negocio ("Hoy",
-- "Esta semana"). Hasta ahora la zona vivia como constante en el codigo
-- (BUSINESS_TIMEZONE = America/Costa_Rica). Se guarda en el workspace para que
-- las funciones de metricas la usen. Los lectores viejos (guardarrailes,
-- costos, topes) siguen con la constante por ahora; unificarlos queda anotado.
--
-- Idempotente y aditiva: una columna con default.
-- ============================================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'America/Costa_Rica';

COMMENT ON COLUMN public.workspaces.timezone IS
  'Zona horaria IANA del negocio. Los dashboards cortan dias y semanas con esta zona (F3). Default America/Costa_Rica.';

-- authenticated ya puede leer todas las columnas de workspaces por su policy;
-- no hace falta GRANT de columna (a diferencia de agents, que revoca costos).
