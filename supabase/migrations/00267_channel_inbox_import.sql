-- ============================================================
-- 00267_channel_inbox_import
--
-- El avance de la importacion de conversaciones de cada canal de Zernio.
--
-- Hasta ahora la importacion al conectar una cuenta de Instagram se cortaba en
-- 200 conversaciones y corria una sola vez, dentro de la peticion. Pasa a ser un
-- trabajo de la cola que recorre TODO lo que Zernio tenga, por partes, y se
-- repite a las 24 horas y a los 7 dias (Zernio trae el historial viejo en
-- segundo plano y no avisa cuando termina). Ver docs/instagram-importacion/PLAN.md
-- y lib/inbox-import/state.ts.
--
-- `inbox_import` guarda donde va (fase, cursor, cuantas miro y cuantas eran
-- nuevas), el identificador de la corrida (`run_id`: una vuelta de una corrida
-- vieja se reconoce y no sigue) y el motivo si quedo incompleta. NULL = nunca
-- se importo. La escribe el servidor (la cola y "Sincronizar canales"); no
-- lleva secretos, asi que la pantalla de Canales la lee con la sesion como el
-- resto de la fila.
--
-- Volver atras:
--   ALTER TABLE public.channels DROP COLUMN IF EXISTS inbox_import;
-- Riesgo: bajo (aditiva). Se aplica ANTES de desplegar el codigo, que la lee.
-- ============================================================

SET search_path = '';

ALTER TABLE public.channels
  ADD COLUMN IF NOT EXISTS inbox_import jsonb;

COMMENT ON COLUMN public.channels.inbox_import IS
  'Avance de la importacion de conversaciones desde Zernio (00267): run_id, status, pass, phase, cursor, step, scanned, imported. NULL = nunca se importo.';
