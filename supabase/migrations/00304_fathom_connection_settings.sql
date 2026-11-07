-- 00304_fathom_connection_settings (6/11/2026)
--
-- Que importa cada conexion de Fathom: cada persona elige automatico, con reglas o manual, y un
-- area por defecto para lo que graba. Sin configurar, todo sigue como hasta ahora (automatico y
-- sin area), asi una conexion que ya existe no cambia.
--
--   `oauth_connections.fathom_settings`: { mode, rules, default_area_id, auto_since }. La lee
--   `lib/fathom/settings.ts`, que entiende lo que falte. Escribe solo el servidor.
--
-- Aditiva: va ANTES de desplegar el codigo, que lee la columna en cada consulta a Fathom.
--
-- Para volver atras:
--   ALTER TABLE public.oauth_connections DROP COLUMN IF EXISTS fathom_settings;

ALTER TABLE public.oauth_connections
  ADD COLUMN IF NOT EXISTS fathom_settings jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.oauth_connections.fathom_settings IS
  'Que importa esta conexion de Fathom: modo, reglas, area por defecto y desde cuando corre sola. Vacio = automatico y sin area.';
