-- ============================================================================
-- 00067 — Cierre de conversaciones, memoria acumulativa y clasificacion (F33, F34)
-- ============================================================================
-- Fase 3, Bloque 2b.
--
-- 1. agents: cuando se cierra sola una conversacion que atiende el agente
--    (horas de inactividad, default 12), y si al cierre genera el resumen
--    acumulativo del contacto y aplica la clasificacion (tags, temperatura,
--    seguimiento). Se agregan al GRANT de columnas de la 00060.
--
-- 2. conversations.closed_at: cuando se cerro (a mano o por el barrido).
--    conversations.summarized_at: hasta que instante estan resumidos sus
--    mensajes. Un cierre sin mensajes nuevos desde ahi no llama al modelo.
--
-- 3. Indice parcial para el barrido de inactividad: conversaciones abiertas
--    por canal y fecha del ultimo mensaje.
--
-- El barrido solo cierra conversaciones donde el agente esta activo Y ya
-- participo (tiene al menos un run): el backlog de conversaciones viejas queda
-- abierto y no dispara cientos de resumenes el dia que se prenda el maestro.
--
-- Idempotente.
-- ============================================================================

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS close_after_inactive_hours integer NOT NULL DEFAULT 12,
  ADD COLUMN IF NOT EXISTS summary_on_close boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS classify_on_close boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.agents.close_after_inactive_hours IS
  'Horas sin mensajes tras las que el barrido cierra una conversacion que el agente atiende y en la que ya participo. Al cerrar, resumen y clasificacion segun las otras dos columnas.';
COMMENT ON COLUMN public.agents.summary_on_close IS
  'Si al cerrar una conversacion el agente genera el resumen acumulativo del contacto (contacts.ai_conversation_summary). Deja un run con source conversation_summary.';
COMMENT ON COLUMN public.agents.classify_on_close IS
  'Si al cerrar aplica tags, temperatura y proximo seguimiento, con las mismas reglas que sus herramientas.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_close_after_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_close_after_range
      CHECK (close_after_inactive_hours BETWEEN 1 AND 720);
  END IF;
END $$;

GRANT SELECT (close_after_inactive_hours, summary_on_close, classify_on_close) ON public.agents TO authenticated;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS summarized_at timestamptz;

COMMENT ON COLUMN public.conversations.closed_at IS
  'Cuando se cerro por ultima vez (a mano o por inactividad). Se conserva al reabrir.';
COMMENT ON COLUMN public.conversations.summarized_at IS
  'Hasta que instante estan incorporados sus mensajes al resumen del contacto. Un cierre sin mensajes posteriores no genera otro resumen.';

CREATE INDEX IF NOT EXISTS idx_conversations_open_by_last_message
  ON public.conversations(channel_id, last_message_at)
  WHERE status = 'open' AND deleted_at IS NULL;
