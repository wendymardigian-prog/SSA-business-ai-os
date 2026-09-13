-- ============================================================================
-- 00065 — Resultado "skipped" para los runs del agente
-- ============================================================================
-- Fase 3, Bloque 2a. Toda abstencion del agente deja un run con su motivo,
-- y los cinco resultados del documento no cubrian uno muy comun: el agente no
-- actuo porque estaba apagado (global, por canal o en la conversacion), pausado
-- por un flow, o porque una persona tomo la conversacion mientras generaba.
--
-- Ninguno encaja: no es "se abstuvo por automatizacion" (no hubo automatizacion)
-- ni "bloqueado por guardarrail" (no bloqueo un limite). Meterlo en uno de esos
-- haria mentir el filtro de runs. El motivo puntual va en status_detail.
--
-- Idempotente: reemplaza el CHECK por nombre.
-- ============================================================================

ALTER TABLE public.agent_runs DROP CONSTRAINT IF EXISTS agent_runs_status_values;
ALTER TABLE public.agent_runs ADD CONSTRAINT agent_runs_status_values
  CHECK (status IN ('running', 'responded', 'escalated', 'skipped_automation',
                    'skipped', 'blocked_guardrail', 'completed', 'error'));

COMMENT ON COLUMN public.agent_runs.status IS
  'running | responded | escalated | skipped_automation | skipped | blocked_guardrail | completed | error. skipped = el agente no actuo por una palanca (apagado, canal, conversacion, pausa, una persona tomo la conversacion); el motivo va en status_detail.';
