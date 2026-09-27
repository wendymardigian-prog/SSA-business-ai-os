-- 00094 · El agente copywriter de contenido (grupo E)
--
-- Tres cosas.
--
-- 1. **Un CHECK viejo que rechaza los runs de copy.** La Etapa 2 agrego
--    `agent_runs_source_check` con `content_copy` y `ads_analysis`, pero dejo
--    vivo `agent_runs_source_values` (de la 00076), que no los tiene. Los dos
--    se aplican, asi que **hoy, contra la base real, registrar un run de
--    generacion de copy falla**: la generacion funciona pero el costo no
--    queda anotado en ningun lado, y por lo tanto no cuenta para los topes.
--    Los tests no lo veian porque mockean la base.
--
-- 2. **El agente necesita poder firmar sus runs.**
--    `agent_runs_agent_only_for_agent_sources` solo deja guardar `agent_id`
--    cuando el origen es `agent` o `conversation_summary`. El copywriter
--    tiene que poder decir cual de sus ejecuciones fue: sin eso no hay
--    pestana Runs ni Costos que valga.
--
-- 3. **Que se vea que esta escribiendo.** `content_posts.copy_status` es lo
--    que hace que el tablero y el editor muestren "el copywriter esta
--    escribiendo" y se actualicen solos al terminar.
--
-- Y siembra un agente `copywriter` por workspace, existente y futuro.
--
-- Aditiva. No borra ni modifica datos: el unico DROP es el de un CHECK que
-- contradice a otro mas nuevo.

-- ------------------------------------------------------------
-- 1. Los CHECK de agent_runs
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_values;

DO $$
BEGIN
  ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_agent_only_for_agent_sources;
  ALTER TABLE public.agent_runs
    ADD CONSTRAINT agent_runs_agent_only_for_agent_sources
    CHECK (
      agent_id IS NULL
      OR source IN ('agent', 'conversation_summary', 'content_copy')
    );
END $$;

-- ------------------------------------------------------------
-- 2. Que el copywriter esta escribiendo
-- ------------------------------------------------------------

ALTER TABLE public.content_posts
  ADD COLUMN IF NOT EXISTS copy_status text NOT NULL DEFAULT 'idle';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'content_posts_copy_status_check') THEN
    ALTER TABLE public.content_posts
      ADD CONSTRAINT content_posts_copy_status_check
      CHECK (copy_status IN ('idle', 'generating', 'failed'));
  END IF;
END $$;

COMMENT ON COLUMN public.content_posts.copy_status IS
  'Si el copywriter esta escribiendo esta pieza. Lo lee el kanban y el editor para mostrarlo y refrescarse solos (E6).';

-- ------------------------------------------------------------
-- 3. Un copywriter por workspace
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.seed_copywriter_agent()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Apagado y sin prompt propio: la voz de marca se carga desde la pantalla.
  -- Nace pudiendo correr a mano; producir el copy solo al aprobar una idea es
  -- un interruptor aparte, que arranca apagado.
  INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
  VALUES (
    NEW.id,
    'Copywriter de contenido',
    'copywriter',
    true,
    ''
  )
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS seed_copywriter_on_workspace ON public.workspaces;
CREATE TRIGGER seed_copywriter_on_workspace
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.seed_copywriter_agent();

-- Los que ya existen.
INSERT INTO public.agents (workspace_id, name, type, is_enabled, system_prompt)
SELECT w.id, 'Copywriter de contenido', 'copywriter', true, ''
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.agents a
  WHERE a.workspace_id = w.id AND a.type = 'copywriter' AND a.deleted_at IS NULL
);

-- Un solo copywriter por workspace: dos serian dos voces distintas para la
-- misma marca, y nadie sabria cual escribio que.
CREATE UNIQUE INDEX IF NOT EXISTS uq_agents_copywriter_por_workspace
  ON public.agents (workspace_id)
  WHERE type = 'copywriter' AND deleted_at IS NULL;
