-- ============================================================
-- 00133_ai_spend_actions.sql
--
-- Topes de gasto de IA del workspace: que hacen al llegar, y un aviso antes.
--
-- Hasta ahora los dos topes del workspace (ai_daily_cost_limit_usd y
-- ai_monthly_cost_limit_usd, 00058) siempre CORTABAN: el diario frena la IA
-- hasta la medianoche local y el mensual apaga el agente. La accion estaba
-- fija en el codigo (lib/ai/spend.ts) y la pantalla de Ajustes decia, mal,
-- que el diario "avisa".
--
-- Ahora cada tope elige:
--   - 'disable' (el comportamiento de siempre): frena / apaga.
--   - 'notify': solo avisa, no frena nada.
-- Y un aviso opcional ANTES de llegar: al pasar ai_spend_alert_pct % de
-- cualquiera de los dos topes se crea una notificacion (una por periodo).
--
-- Aditiva y sin riesgo: los defaults dejan todo exactamente como esta hoy
-- ('disable' en los dos, sin aviso).
-- ============================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_daily_limit_action text NOT NULL DEFAULT 'disable',
  ADD COLUMN IF NOT EXISTS ai_monthly_limit_action text NOT NULL DEFAULT 'disable',
  ADD COLUMN IF NOT EXISTS ai_spend_alert_pct smallint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_daily_limit_action_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_daily_limit_action_check
      CHECK (ai_daily_limit_action IN ('disable', 'notify'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_monthly_limit_action_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_monthly_limit_action_check
      CHECK (ai_monthly_limit_action IN ('disable', 'notify'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_spend_alert_pct_check') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_spend_alert_pct_check
      CHECK (ai_spend_alert_pct IS NULL OR (ai_spend_alert_pct BETWEEN 1 AND 99));
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.ai_daily_limit_action IS
  'Que pasa al llegar al tope diario de IA: disable = frena la IA hasta la medianoche local; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_monthly_limit_action IS
  'Que pasa al llegar al tope mensual de IA: disable = apaga el agente; notify = solo avisa.';
COMMENT ON COLUMN public.workspaces.ai_spend_alert_pct IS
  'Avisar al llegar a este % de cualquiera de los dos topes (1 a 99). NULL = sin aviso previo. Una notificacion por tope y periodo.';
