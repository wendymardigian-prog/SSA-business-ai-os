-- ============================================================================
-- 00076 — Valores nuevos en agent_runs y normalizador para agrupar (F4)
-- ============================================================================
-- Fase 3, Bloque 1.
--
--   1. agent_runs.status suma `already_answered`: el turno se retira porque ya
--      hubo una respuesta (Bloque 2, verificacion antes de responder).
--   2. agent_runs.source suma `message_classification` y
--      `message_classification_eval`: las corridas del clasificador de patrones
--      y su evaluacion contra el set de control (Bloques 4 y 5). No llevan
--      agent_id, asi que el CHECK agent_only_for_agent_sources no cambia.
--   3. public.normalize_for_grouping(text): normaliza para AGRUPAR mensajes
--      (colapsa letras repetidas: "siii" y "si" caen juntas). Es distinta de
--      normalize_message_text (00027), que se sigue usando para detectar frases
--      de "no contactar" y NO se toca: cambiarla movería esa deteccion.
--
-- Idempotente. Aditiva: recrea CHECKs para sumar valores (patron del repo) y
-- crea una funcion nueva. No borra datos.
-- ============================================================================

-- 1 y 2. CHECKs de agent_runs --------------------------------------------
ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error', 'drafted',
                    'already_answered'));

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_source_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_source_values
  CHECK (source IN ('agent', 'flow_ai_node', 'sequence_ai_step', 'kb_indexing',
                    'conversation_summary', 'message_classification',
                    'message_classification_eval'));

-- 3. Normalizador para agrupar -------------------------------------------
-- minusculas → saca acentos con translate (no unaccent) → elimina todo lo que
-- no sea letra, numero o espacio → colapsa 2+ caracteres iguales seguidos en
-- uno → colapsa espacios y recorta → trunca a 300.
CREATE OR REPLACE FUNCTION public.normalize_for_grouping(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT left(
    btrim(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            translate(lower(coalesce(p_raw, '')),
              'áàäâãéèëêíìïîóòöôõúùüûñç',
              'aaaaaeeeeiiiiooooouuuunc'),
            '[^a-z0-9 ]', '', 'g'),
          '(.)\1+', '\1', 'g'),
        '\s+', ' ', 'g')
    ),
    300
  );
$$;

REVOKE ALL ON FUNCTION public.normalize_for_grouping(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.normalize_for_grouping(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.normalize_for_grouping(text) IS
  'Normaliza para AGRUPAR mensajes por lo que significan (colapsa letras repetidas: siii=si). Distinta de normalize_message_text (00027), que detecta frases de no contactar. Espejo exacto de lib/text/normalize.ts (F4).';
