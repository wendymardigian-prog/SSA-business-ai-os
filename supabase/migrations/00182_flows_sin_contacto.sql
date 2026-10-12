-- ============================================================================
-- 00182 — Flujos sin contacto ("sobre una persona del equipo", EOD E15)
-- ============================================================================
-- Un reporte de fin de dia no tiene contacto: es de una persona del equipo. En vez de
-- inventar un contacto falso por setter, la cola de eventos y las sesiones de flujo
-- aceptan una persona del equipo EN LUGAR de un contacto. Precedente: la 00100 hizo lo
-- mismo con `flow_sessions.channel_id`.
--
-- automation_events
--   - contact_id pasa a nullable, con un CHECK: solo los eventos de la lista pueden venir
--     sin contacto. Los que existen hoy (contact_created, tag_added, booking_*, form_*,
--     sale_*, payment_*, call_*...) siguen exigiendolo.
--   - member_user_id: la persona del equipo del evento.
-- flow_sessions
--   - contact_id pasa a nullable; member_user_id nuevo; un CHECK exige uno de los dos.
--
-- La lista de eventos sin contacto vive en ESTE CHECK y en `lib/flow-engine/registry/
-- eod-triggers.ts` (subject "member"); `lib/eod/migrations.test.ts` lee este archivo.
--
-- Estado VIEJO (leido de la base viva al escribir esta migracion, 12/10/2026):
--   automation_events.contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
--   flow_sessions.contact_id     uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE
--   (sin member_user_id en ninguna de las dos)
--
-- Como volver atras (antes: que no queden filas sin contacto):
--   DELETE FROM public.automation_events WHERE contact_id IS NULL;
--   DELETE FROM public.flow_sessions WHERE contact_id IS NULL;
--   ALTER TABLE public.automation_events DROP CONSTRAINT IF EXISTS automation_events_contact_or_member;
--   ALTER TABLE public.automation_events DROP COLUMN IF EXISTS member_user_id;
--   ALTER TABLE public.automation_events ALTER COLUMN contact_id SET NOT NULL;
--   ALTER TABLE public.flow_sessions DROP CONSTRAINT IF EXISTS flow_sessions_contact_or_member;
--   ALTER TABLE public.flow_sessions DROP COLUMN IF EXISTS member_user_id;
--   ALTER TABLE public.flow_sessions ALTER COLUMN contact_id SET NOT NULL;
-- Riesgo: bajo (aditiva: ninguna fila existente cambia, y todo evento de hoy sigue
-- exigiendo contacto).
-- ============================================================================

SET search_path = '';

ALTER TABLE public.automation_events ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE public.automation_events
  ADD COLUMN IF NOT EXISTS member_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.automation_events'::regclass AND conname = 'automation_events_contact_or_member'
  ) THEN
    ALTER TABLE public.automation_events ADD CONSTRAINT automation_events_contact_or_member
      CHECK (
        contact_id IS NOT NULL
        OR (event_type = ANY (ARRAY['eod_submitted'::text]) AND member_user_id IS NOT NULL)
      );
  END IF;
END $$;

COMMENT ON COLUMN public.automation_events.member_user_id IS
  'La persona del equipo de un evento sin contacto (eod_submitted). Los demas eventos llevan contacto.';

ALTER TABLE public.flow_sessions ALTER COLUMN contact_id DROP NOT NULL;
ALTER TABLE public.flow_sessions
  ADD COLUMN IF NOT EXISTS member_user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.flow_sessions'::regclass AND conname = 'flow_sessions_contact_or_member'
  ) THEN
    ALTER TABLE public.flow_sessions ADD CONSTRAINT flow_sessions_contact_or_member
      CHECK (contact_id IS NOT NULL OR member_user_id IS NOT NULL);
  END IF;
END $$;

COMMENT ON COLUMN public.flow_sessions.member_user_id IS
  'La persona del equipo de un flujo sin contacto (EOD). Una sesion tiene contacto o persona, nunca ninguno.';
