-- ============================================================================
-- 00074 — Origen de los salientes (Fase 3, Bloque 1, F2)
-- ============================================================================
-- Hasta ahora ningun saliente guardaba de donde salio. Los 1.580 del historial
-- entraron sin autor (ver docs/diagnostico-autoria.md). El dashboard del
-- Bloque 3 necesita separar Agente / Equipo / Automatizaciones / Fuera del
-- sistema, y la verificacion del Bloque 2 necesita distinguir un saliente
-- externo (ManyChat) de uno propio. Ese dato es `messages.origin`.
--
--   1. Columna `origin` con su lista cerrada. null en entrantes; no null en
--      salientes (el CHECK se exige recien despues del backfill).
--   2. Backfill: agent > user > flow por sus sent_by_*, y external si no tiene
--      ninguno (que es el caso de todo el historial).
--   3. Trigger BEFORE INSERT que deriva el origin de cualquier saliente que
--      llegue sin el. Protege la base mientras la version vieja de la app siga
--      desplegada: un saliente que entre por un camino todavia sin actualizar
--      no queda con origin null (romperia el CHECK), se deriva de sus autores.
--   4. Indice (workspace_id, origin, created_at) para el dashboard.
--
-- Idempotente. Solo aditiva: agrega una columna, la puebla y la indexa. No
-- borra ni modifica datos existentes mas alla de completar `origin`.
-- ============================================================================

-- 1. Columna --------------------------------------------------------------
ALTER TABLE public.messages ADD COLUMN IF NOT EXISTS origin text;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_origin_values') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_origin_values
      CHECK (origin IS NULL OR origin IN ('agent', 'user', 'flow', 'sequence', 'broadcast', 'external'));
  END IF;
END $$;

COMMENT ON COLUMN public.messages.origin IS
  'De donde salio el saliente: agent, user, flow, sequence, broadcast o external. null en entrantes. Lo escribe cada camino de envio; el trigger messages_fill_origin lo deriva si falta (F2).';

-- 2. Backfill de lo ya guardado ------------------------------------------
-- Prioridad agent > user > flow: un borrador aprobado lleva las dos autorias
-- (agente y quien aprobo), y ahi manda el agente. sequence/broadcast no tienen
-- columna propia en el historial, asi que un saliente sin ningun autor es
-- external (todo el historial cae aca).
UPDATE public.messages
SET origin = CASE
    WHEN sent_by_agent_id IS NOT NULL THEN 'agent'
    WHEN sent_by_user_id IS NOT NULL THEN 'user'
    WHEN sent_by_flow_id IS NOT NULL THEN 'flow'
    ELSE 'external'
  END
WHERE direction = 'outbound' AND origin IS NULL;

UPDATE public.messages
SET origin = NULL
WHERE direction = 'inbound' AND origin IS NOT NULL;

-- 3. Trigger que deriva el origin en salientes sin el --------------------
CREATE OR REPLACE FUNCTION public.messages_fill_origin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.direction = 'inbound' THEN
    NEW.origin := NULL;
  ELSIF NEW.origin IS NULL THEN
    NEW.origin := CASE
      WHEN NEW.sent_by_agent_id IS NOT NULL THEN 'agent'
      WHEN NEW.sent_by_user_id IS NOT NULL THEN 'user'
      WHEN NEW.sent_by_flow_id IS NOT NULL THEN 'flow'
      ELSE 'external'
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS messages_fill_origin ON public.messages;
CREATE TRIGGER messages_fill_origin
  BEFORE INSERT OR UPDATE OF origin, direction, sent_by_agent_id, sent_by_user_id, sent_by_flow_id
  ON public.messages
  FOR EACH ROW
  EXECUTE FUNCTION public.messages_fill_origin();

-- 4. CHECK duro: todo saliente tiene origin -------------------------------
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'messages_outbound_has_origin') THEN
    ALTER TABLE public.messages ADD CONSTRAINT messages_outbound_has_origin
      CHECK (direction <> 'outbound' OR origin IS NOT NULL);
  END IF;
END $$;

-- 5. Indice para el dashboard ---------------------------------------------
CREATE INDEX IF NOT EXISTS idx_messages_workspace_origin_created
  ON public.messages (workspace_id, origin, created_at);

-- 6. Verificacion: no puede quedar un saliente sin origin -----------------
DO $$
DECLARE v_missing integer;
BEGIN
  SELECT count(*) INTO v_missing
  FROM public.messages
  WHERE direction = 'outbound' AND origin IS NULL;
  IF v_missing > 0 THEN
    RAISE EXCEPTION 'Quedaron % salientes sin origin despues del backfill', v_missing;
  END IF;
END $$;
