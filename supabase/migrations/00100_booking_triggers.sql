-- ============================================================================
-- 00100 — Triggers de agenda (Etapa 4, Bloque 7a, F43 a F46)
-- ============================================================================
-- 1. `triggers_type_check` suma los nueve tipos de agenda. Postgres no deja
--    extender un CHECK: se tira y se rehace con la lista completa, como hizo
--    la 00087 con `email_received`.
--
-- 2. `flow_sessions.channel_id` pasa a admitir null.
--    Hasta hoy era NOT NULL y el cron de `automation_events` mandaba el canal
--    vacio cuando el contacto no tenia conversacion: el insert de la sesion
--    fallaba en silencio y el flow no corria. Un lead que agenda desde la
--    pagina publica no tiene conversacion, asi que sin esto NINGUN flujo de
--    agenda arrancaria. El motor tolera la sesion sin canal: los nodos que
--    mandan por un canal se saltean con motivo y `send_email` no lo necesita.
--
-- 3. Un indice para buscar los disparos por clave de idempotencia.
--
-- Idempotente y aditiva. No toca datos.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. Los nueve tipos de agenda
-- ------------------------------------------------------------

ALTER TABLE public.triggers DROP CONSTRAINT IF EXISTS triggers_type_check;

ALTER TABLE public.triggers ADD CONSTRAINT triggers_type_check CHECK (
  type IN (
    -- Etapa 1
    'keyword',
    'postback',
    'quick_reply',
    'welcome',
    'default',
    'comment_keyword',
    'new_contact',
    'crm_event',
    'inactivity',
    -- Etapa 2
    'email_received',
    -- Etapa 4: agenda. Los seis primeros nacen de un evento; los tres
    -- ultimos los agenda un job relativo a la hora de la reunion.
    'booking_created',
    'booking_rescheduled',
    'booking_cancelled',
    'booking_updated',
    'booking_ended',
    'booking_status_changed',
    'booking_before_start',
    'booking_after_end',
    'booking_after_created'
  )
);

COMMENT ON CONSTRAINT triggers_type_check ON public.triggers IS
  'La lista viene del registro de TypeScript (lib/flow-engine/registry). Hay un test que compara las dos.';

-- ------------------------------------------------------------
-- 2. Una sesion de flow puede no tener canal
-- ------------------------------------------------------------

ALTER TABLE public.flow_sessions ALTER COLUMN channel_id DROP NOT NULL;

COMMENT ON COLUMN public.flow_sessions.channel_id IS
  'Null cuando el flow no arranco por un canal (agenda, evento de CRM sin conversacion). Los nodos que envian por canal se saltean con motivo.';

-- El indice parcial de sesiones activas seguia sirviendo, pero con canal null
-- dos sesiones del mismo contacto no chocaban entre si de todos modos: no era
-- un unico, es un indice de busqueda. Se rehace incluyendo las de canal null.
DROP INDEX IF EXISTS public.idx_flow_sessions_contact_active;
CREATE INDEX IF NOT EXISTS idx_flow_sessions_contact_active
  ON public.flow_sessions (contact_id, channel_id)
  WHERE status = 'active';

-- ------------------------------------------------------------
-- 3. Buscar disparos por clave
-- ------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_trigger_fires_dedupe
  ON public.trigger_fires (workspace_id, dedupe_key);
