-- 00295_fathom_history_import (6/11/2026)
--
-- Importar el historial de Fathom y dejar de usar la marca "es closer".
--
--   1. `oauth_connections.history_import`: el avance de la importacion (corrida,
--      pagina por la que va, cuantas trajo, motivo si quedo incompleta). Sin claves
--      ni datos de personas. Lo escribe solo el servidor.
--   2. `calls.imported_from_history`: la llamada entro por una importacion del
--      historial. Es historia: no dispara automatizaciones y no se analiza sola.
--   3. Comentarios: `is_closer` queda sin usar (se borra en otra migracion, DESPUES
--      de desplegar el codigo que ya no la lee) y `closer_emails` pasa a ser "los
--      otros correos con los que esta persona graba en Fathom".
--
-- Aditiva: va ANTES de desplegar el codigo (Mi Fathom y la clasificacion leen estas
-- columnas). No hay politicas nuevas: `oauth_connections` y `calls` ya tienen la suya.
--
-- Para volver atras:
--   ALTER TABLE public.calls DROP COLUMN IF EXISTS imported_from_history;
--   ALTER TABLE public.oauth_connections DROP COLUMN IF EXISTS history_import;

ALTER TABLE public.oauth_connections ADD COLUMN IF NOT EXISTS history_import jsonb;

COMMENT ON COLUMN public.oauth_connections.history_import IS
  'El avance de la importacion del historial (lib/fathom/history-state.ts). null = nunca se importo.';

ALTER TABLE public.calls ADD COLUMN IF NOT EXISTS imported_from_history boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.calls.imported_from_history IS
  'Entro por una importacion del historial: no dispara automatizaciones y no se analiza sola.';

COMMENT ON COLUMN public.workspace_members.is_closer IS
  'Sin usar desde la 00295: entra lo que graba quien conecto su Fathom y tiene calls.view.';

COMMENT ON COLUMN public.workspace_members.closer_emails IS
  'Los otros correos con los que esta persona graba en Fathom. Los carga ella en Mi Fathom.';
