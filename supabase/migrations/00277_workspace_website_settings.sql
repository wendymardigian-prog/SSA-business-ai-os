-- ============================================================
-- 00277_workspace_website_settings.sql
--
-- La web de un cliente manda sus formularios desde el navegador, desde OTRO
-- dominio. Para que el navegador deje leer la respuesta (CORS) y para que el
-- servidor sepa que ese dominio es del negocio, cada workspace guarda sus
-- origenes permitidos:
--
--   `workspaces.website_settings` = { "allowed_origins": [
--       { "origin": "https://tusitio.com", "dev": false },
--       { "origin": "http://localhost:4321", "dev": true } ] }
--
-- Cada origen es exacto (esquema + dominio + puerto, sin ruta). `http://` solo
-- se acepta para localhost / 127.0.0.1 y marcado como de desarrollo. La forma la
-- valida el codigo (`lib/http/cors.ts`) antes de escribir; la base solo exige un
-- objeto. No es un secreto: lo ven los miembros, como la marca.
--
-- Escribe el servidor con el cliente de servicio despues de chequear
-- `integrations.manage` (Ajustes → Integraciones → Tu sitio web). La politica de
-- UPDATE de `workspaces` no se toca.
--
-- El DEFAULT es un literal: un DEFAULT se evalua con los permisos de quien
-- inserta y nunca puede llamar a una funcion de `private` (00248).
--
-- No crea tablas: no lleva GRANT propio (la columna tiene el acceso de
-- `workspaces`).
--
-- Aditiva: se aplica ANTES de desplegar el codigo (el envio de formularios la lee).
--
-- Como volver atras:
--   ALTER TABLE public.workspaces DROP CONSTRAINT IF EXISTS workspaces_website_settings_check;
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS website_settings;
--   (Con el codigo nuevo desplegado, sin la columna ningun origen externo queda
--   permitido: los formularios propios siguen andando.)
--
-- Riesgo: bajo. Una columna nueva con valor por defecto, sin backfill.
-- ============================================================

SET search_path = '';

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS website_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_website_settings_check' AND conrelid = 'public.workspaces'::regclass) THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_website_settings_check
      CHECK (jsonb_typeof(website_settings) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.website_settings IS
  'La web del negocio: { allowed_origins: [{ origin, dev }] } = los dominios exactos desde los que un navegador puede mandar formularios y pedir un link de baja (CORS). Lo escribe el servidor (lib/actions/website-settings.ts).';
