-- ============================================================================
-- 00374 — Google: varios canales de YouTube por negocio y Google Drive
-- ============================================================================
--
-- Tres cambios, todos aditivos:
--
--   1. `oauth_connections` admite el proveedor `google_drive`: una cuenta de
--      Google Drive por negocio, con el mismo cliente OAuth que YouTube y
--      Calendar. Sirve para importar archivos a Recursos.
--
--   2. Un negocio puede tener VARIOS canales de YouTube (`provider = 'google'`,
--      `user_id IS NULL`), uno por cuenta externa (el id del canal). Hasta hoy
--      el indice unico `(workspace_id, provider) WHERE user_id IS NULL` dejaba
--      uno solo, y reconectar con otro canal pisaba el anterior. Los demas
--      proveedores del negocio (LinkedIn, Threads, Drive) siguen con uno.
--
--   3. `response_assets.link_kind` suma `drive` («Google Drive»): un recurso
--      que es el enlace a un archivo de Drive.
--
-- Definiciones de partida, leidas de la base de produccion el 13/11/2026
-- (pg_get_constraintdef), no de un archivo viejo:
--
--   oauth_connections_provider_check:
--     CHECK ((provider = ANY (ARRAY['google'::text, 'linkedin'::text,
--       'threads'::text, 'google_calendar'::text, 'fathom'::text])))
--   uq_oauth_connections_workspace_provider:
--     UNIQUE (workspace_id, provider) WHERE (user_id IS NULL)
--   response_assets_link_kind_check:
--     CHECK (((link_kind IS NULL) OR ((kind = 'link'::text) AND (link_kind =
--       ANY (ARRAY['video','imagen','testimonio','articulo','landing',
--       'formulario','agenda','pago','otro'])))))
--
-- La plantilla de estudiantes no trae Fathom: el CHECK nuevo suma 'fathom'
-- solo si la definicion vigente ya lo tenia.
--
-- Como volver atras (antes: borrar las filas con provider = 'google_drive',
-- las de link_kind = 'drive' y dejar un solo canal de YouTube por negocio):
--   DROP INDEX IF EXISTS public.uq_oauth_connections_workspace_channel;
--   DROP INDEX IF EXISTS public.uq_oauth_connections_workspace_provider;
--   CREATE UNIQUE INDEX uq_oauth_connections_workspace_provider
--     ON public.oauth_connections (workspace_id, provider) WHERE user_id IS NULL;
--   y volver a los dos CHECK de arriba.
-- ============================================================================

-- ── 1. El proveedor google_drive ────────────────────────────────────────────
DO $$
DECLARE
  v_has_fathom boolean;
BEGIN
  SELECT pg_get_constraintdef(oid) LIKE '%fathom%'
    INTO v_has_fathom
    FROM pg_constraint
   WHERE conname = 'oauth_connections_provider_check'
     AND conrelid = 'public.oauth_connections'::regclass;

  ALTER TABLE public.oauth_connections DROP CONSTRAINT IF EXISTS oauth_connections_provider_check;

  IF coalesce(v_has_fathom, false) THEN
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
      CHECK (provider = ANY (ARRAY['google'::text, 'linkedin'::text, 'threads'::text,
                                   'google_calendar'::text, 'fathom'::text, 'google_drive'::text]));
  ELSE
    ALTER TABLE public.oauth_connections ADD CONSTRAINT oauth_connections_provider_check
      CHECK (provider = ANY (ARRAY['google'::text, 'linkedin'::text, 'threads'::text,
                                   'google_calendar'::text, 'google_drive'::text]));
  END IF;
END $$;

-- ── 2. Varios canales de YouTube por negocio ───────────────────────────────
-- Primero el indice nuevo, despues se achica el viejo: en ningun momento queda
-- la tabla sin unicidad para los proveedores de una sola cuenta.
CREATE UNIQUE INDEX IF NOT EXISTS uq_oauth_connections_workspace_channel
  ON public.oauth_connections (workspace_id, provider, external_account_id)
  WHERE user_id IS NULL AND provider = 'google';

DROP INDEX IF EXISTS public.uq_oauth_connections_workspace_provider;
CREATE UNIQUE INDEX uq_oauth_connections_workspace_provider
  ON public.oauth_connections (workspace_id, provider)
  WHERE user_id IS NULL AND provider <> 'google';

COMMENT ON INDEX public.uq_oauth_connections_workspace_channel IS
  'YouTube: un negocio puede conectar varios canales, uno por fila (el id del canal en external_account_id). 00374.';

-- ── 3. Enlace a Google Drive en Recursos ───────────────────────────────────
ALTER TABLE public.response_assets DROP CONSTRAINT IF EXISTS response_assets_link_kind_check;
ALTER TABLE public.response_assets ADD CONSTRAINT response_assets_link_kind_check
  CHECK (link_kind IS NULL OR (
    kind = 'link'
    AND link_kind IN ('video', 'imagen', 'testimonio', 'articulo', 'landing',
                      'formulario', 'agenda', 'pago', 'otro', 'drive')
  ));
