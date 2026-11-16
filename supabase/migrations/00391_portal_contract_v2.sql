-- @plantilla-quitar(servicios)
-- ============================================================================
-- 00391_portal_contract_v2  (Portal de estudiantes, Corrida B2 · P12)
-- ============================================================================
-- `app_servicio.contract_version()` pasa a '2': las funciones `portal_*` de las 00384 a 00390 están aplicadas. El
-- portal declara que espera la 2 (F209); con la 1 muestra «Estamos actualizando el portal».
--
-- Volver atrás: CREATE OR REPLACE FUNCTION app_servicio.contract_version() RETURNS text LANGUAGE sql IMMUTABLE
--   SET search_path TO '' AS $function$ SELECT '1'::text; $function$;
-- ============================================================================
CREATE OR REPLACE FUNCTION app_servicio.contract_version()
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $function$ SELECT '2'::text; $function$;
