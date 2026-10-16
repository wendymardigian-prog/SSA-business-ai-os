-- ============================================================
-- 00236 — Varias cuentas de la misma red social (Social y Contenido)
-- ============================================================
-- Hasta ahora `social_accounts` admitia UNA cuenta por red en cada workspace
-- (indice unico (workspace_id, platform), 00082). Zernio deja conectar varias
-- (dos Instagram, dos TikTok), asi que la regla pasa a ser: una fila por CUENTA,
-- identificada por (workspace, red, external_id).
--
-- Dos indices parciales y no uno solo, a proposito:
--   - Con `external_id`: una fila por cuenta real (el id que da el proveedor).
--   - Sin `external_id` (una red que todavia no informo el suyo, o antes de
--     conectar): sigue habiendo UNA por red, como hasta hoy.
-- Un `UNIQUE (workspace_id, platform, external_id)` comun no sirve: Postgres
-- trata los NULL como distintos y dejaria crear filas repetidas sin id.
--
-- NO cambia ningun dato ni ninguna fila existente: toda cuenta de hoy es unica
-- por red, asi que cumple los dos indices nuevos. El codigo (syncSocialAccounts)
-- ya no usa `ON CONFLICT (workspace_id, platform)`: busca por (red, external_id).
--
-- Para volver atras (solo si NO hay dos cuentas de la misma red):
--   DROP INDEX IF EXISTS public.uq_social_accounts_ws_platform_ext;
--   DROP INDEX IF EXISTS public.uq_social_accounts_ws_platform_noext;
--   CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform
--     ON public.social_accounts (workspace_id, platform);

DROP INDEX IF EXISTS public.uq_social_accounts_ws_platform;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform_ext
  ON public.social_accounts (workspace_id, platform, external_id)
  WHERE external_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_social_accounts_ws_platform_noext
  ON public.social_accounts (workspace_id, platform)
  WHERE external_id IS NULL;

COMMENT ON TABLE public.social_accounts IS
  'Una fila por cuenta social del workspace (varias por red si la red lo permite, por ejemplo dos Instagram por Zernio): por donde se publica y que se muestra en la pagina Social.';
