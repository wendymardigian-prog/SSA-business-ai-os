-- ============================================================================
-- 00066 — El agente por conversacion pasa a tres estados, y la rafaga tiene
--         antiguedad maxima
-- ============================================================================
-- Fase 3, Bloque 2b.
--
-- 1. conversations.agent_enabled: de boolean NOT NULL DEFAULT false a
--    NULLABLE sin default.
--
--      NULL  = heredar del canal (el maestro de agents.enabled_channel_ids manda)
--      true  = forzado prendido en esta conversacion
--      false = forzado apagado (lo pone Human Takeover, una respuesta manual, o
--              una persona desde la bandeja)
--
--    Antes el default false obligaba a prender el agente conversacion por
--    conversacion, y un lead nuevo nunca lo tenia. Iba contra el objetivo del
--    sistema. Ahora el maestro del canal manda por defecto y la conversacion es
--    la excepcion explicita.
--
--    MIGRACION DE LAS FILAS EXISTENTES, UNA SOLA VEZ: todas las conversaciones
--    que hoy estan en false lo estan porque era el default, ninguna fue apagada
--    a proposito (verificado el 24/9/2026: 583 filas, todas false, 0 runs). Se
--    pasan todas a NULL. El bloque comprueba antes que la columna todavia sea
--    NOT NULL: si la migracion se vuelve a correr, la columna ya es nullable y
--    no toca nada, asi que un false puesto a proposito despues de hoy nunca se
--    pisa.
--
--    El dia que se prenda el maestro de Instagram, las 583 conversaciones
--    (y toda conversacion nueva) pasan a estar atendidas por el agente ante el
--    proximo mensaje entrante. No es retroactivo: nadie recibe nada por prender
--    el maestro.
--
-- 2. agents.burst_max_age_hours (default 6). La rafaga que responde un turno
--    son "los entrantes posteriores a la ultima salida". Con 137 conversaciones
--    sin una sola respuesta, eso seria el historial entero: si un lead escribe
--    hoy, el agente contestaria tambien la pregunta de hace tres semanas. Con
--    esto la rafaga descarta lo anterior a N horas. El contexto de la
--    conversacion sigue entrando por el historial de ~20 mensajes: esto decide
--    QUE se responde, no que se lee.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. conversations.agent_enabled: tres estados
-- ------------------------------------------------------------

DO $$
DECLARE
  v_was_not_null boolean;
BEGIN
  SELECT (is_nullable = 'NO') INTO v_was_not_null
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'conversations'
     AND column_name = 'agent_enabled';

  IF v_was_not_null THEN
    ALTER TABLE public.conversations ALTER COLUMN agent_enabled DROP DEFAULT;
    ALTER TABLE public.conversations ALTER COLUMN agent_enabled DROP NOT NULL;
    -- Solo en la primera corrida: todo false era el default, no una decision.
    UPDATE public.conversations SET agent_enabled = NULL WHERE agent_enabled = false;
  END IF;
END $$;

COMMENT ON COLUMN public.conversations.agent_enabled IS
  'Agente de IA en esta conversacion, tres estados. NULL = hereda del canal (el maestro de agents.enabled_channel_ids decide). true = forzado prendido. false = forzado apagado: lo pone Human Takeover, una respuesta manual del operador o una persona desde la bandeja. Ortogonal a is_automation_paused (flows) y a agent_paused_until (pausa de un flow).';

-- El indice parcial de la 00058 (WHERE agent_enabled) sigue valiendo: NULL no
-- entra, solo las forzadas prendidas.

-- ------------------------------------------------------------
-- 2. agents.burst_max_age_hours
-- ------------------------------------------------------------

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS burst_max_age_hours integer NOT NULL DEFAULT 6;

COMMENT ON COLUMN public.agents.burst_max_age_hours IS
  'La rafaga que responde un turno ignora los entrantes mas viejos que esto (horas, contadas desde el instante del turno). Siguen en el contexto del prompt; solo no se responden.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'agents_burst_max_age_range') THEN
    ALTER TABLE public.agents ADD CONSTRAINT agents_burst_max_age_range
      CHECK (burst_max_age_hours BETWEEN 1 AND 720);
  END IF;
END $$;

-- La 00060 revoco el SELECT de la tabla y lo otorgo por columnas: toda columna
-- nueva que la pantalla tenga que leer con el cliente del usuario va aca.
GRANT SELECT (burst_max_age_hours) ON public.agents TO authenticated;
