-- ============================================================
-- 00269_event_types_internal
-- ============================================================
-- Agendar a mano SIN elegir un evento (octubre 2026): "Reunión con Ana", el
-- invitado, la fecha y la hora, como en Google Calendar.
--
-- Una reunion necesita un evento (bookings.event_type_id es NOT NULL y lo leen
-- la sincronizacion con Google, los avisos, los flujos, reagendar y los
-- informes: hacerlo opcional era tocar ~90 lugares y `create_booking`, que
-- esta protegida). En cambio, cada persona tiene UN evento interno:
--
--   event_types.is_internal
--       true = el evento interno de su duena (owner_user_id). Nunca se publica
--       (nace y queda 'inactive'), no aparece en ninguna lista ni en el agente,
--       y no se edita. La reunion guarda su propio titulo (bookings.title), asi
--       que en la lista se ve "Reunión con Ana" y no el nombre del evento.
--
-- Lo crea la app la primera vez que hace falta (lib/scheduling/booking/manual.ts),
-- con el cliente de servicio; el indice unico parcial evita dos por persona
-- aunque dos pedidos lleguen a la vez.
--
-- Aditiva: se aplica ANTES de desplegar el codigo que la usa.
--
-- Como volver atras:
--   DROP INDEX IF EXISTS public.uq_event_types_internal_owner;
--   ALTER TABLE public.event_types DROP COLUMN IF EXISTS is_internal;
--   (los eventos internos que ya tengan reuniones quedan como eventos inactivos
--    comunes: no se pierde ninguna reunion)
--
-- Idempotente: IF NOT EXISTS.
-- ============================================================

ALTER TABLE public.event_types ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.event_types.is_internal IS
  'El evento interno de su duena (00269): sostiene las reuniones agendadas a mano sin elegir un evento. Nunca se publica ni aparece en las listas.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_event_types_internal_owner
  ON public.event_types (workspace_id, owner_user_id)
  WHERE is_internal AND deleted_at IS NULL;
