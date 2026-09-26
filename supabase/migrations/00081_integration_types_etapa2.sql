-- 00081 · Tipos de integracion de la etapa 2
--
-- `integration_configs` es la tabla generica de "toda configuracion y secreto de
-- un servicio externo, por workspace". La etapa 2 suma cuatro clases de
-- integracion: las redes que se conectan directo (LinkedIn, Threads), los
-- servicios que publican por nosotros (Postproxy), Google (YouTube) y Meta
-- (anuncios e insights de Instagram).
--
-- Es aditiva: solo amplia el CHECK. Ninguna fila existente cambia, y las tres
-- clases de la etapa 1 (`channel`, `ai_provider`, `email_provider`) siguen
-- valiendo. Correrla dos veces no falla.
--
-- La lista de valores tiene que coincidir con `IntegrationType` en
-- lib/types/database.ts.

DO $$
BEGIN
  -- Se reemplaza el CHECK entero en vez de sumar otro: dos CHECK sobre la misma
  -- columna se cumplen los dos a la vez, asi que el viejo seguiria rechazando
  -- los valores nuevos.
  ALTER TABLE public.integration_configs
    DROP CONSTRAINT IF EXISTS integration_configs_type_check;

  ALTER TABLE public.integration_configs
    ADD CONSTRAINT integration_configs_type_check
    CHECK (type IN (
      -- Etapa 1
      'channel',           -- Zernio (Instagram) y Evolution (WhatsApp)
      'ai_provider',       -- OpenAI, Anthropic, Google IA, Voyage
      'email_provider',    -- Resend (saliente) y Resend entrante (bloque 8)
      -- Etapa 2
      'social_network',    -- la red se conecta directo: LinkedIn, Threads
      'publishing_service',-- publica por nosotros: Postproxy
      'google',            -- cliente OAuth propio de Google (YouTube)
      'meta'               -- token de system user: anuncios e insights de Instagram
    ));
END;
$$;

COMMENT ON CONSTRAINT integration_configs_type_check ON public.integration_configs IS
  'Clases de integracion. Sumar una implica tocar IntegrationType en lib/types/database.ts y el catalogo en lib/integrations/providers.ts.';
