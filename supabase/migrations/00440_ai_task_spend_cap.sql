-- ============================================================================
-- 00440 — Tope mensual de gasto por tarea de IA (traído de RER: 00411 y 00441)
-- ============================================================================
-- Cada tarea de IA (clasificar mensajes, resumir, transcribir, describir
-- imágenes, analizar anuncios, vincular anuncios y las tres de llamadas) puede
-- tener su propio tope mensual en USD. Al pasar el porcentaje de aviso (el del
-- negocio o, sin valor, el 80 %) avisa una vez por la campana; al llegar, la
-- tarea no llama al modelo hasta el mes siguiente (lib/ai/workspace-budget.ts,
-- `withinWorkspaceBudget` con `task`). Sin tope guardado, nada cambia.
--
-- 1. `workspaces.ai_task_limits` (jsonb, '{}' de serie): por tarea,
--    `{"monthly_cap_usd": numeric}`. Se escribe solo con `set_ai_task_cap`.
-- 2. `set_ai_task_cap(workspace, tarea, tope)`: cambia SOLO la clave de esa
--    tarea, con la fila bloqueada (dos personas guardando a la vez no se
--    pisan). Devuelve lo que había antes, para la auditoría. Solo service_role:
--    la Server Action comprueba `ai_limits.manage` antes.
-- 3. `sum_ai_task_spend(workspace, desde, source, detail_like)`: el gasto de
--    una tarea desde un instante. En SQL por lo mismo que la 00064: PostgREST
--    corta en 1.000 filas y un tope que subestima el gasto no protege. Filtra
--    por `source` y, solo para la clasificación al cierre, por `status_detail`.
--    Usa el índice (workspace_id, created_at) de la 00059. Solo service_role.
--
-- Aditiva e idempotente. Va ANTES de desplegar el código: el chequeo de gasto
-- de cada tarea lee la columna nueva y, si no existe, no llama al modelo.
--
-- Para volver atrás:
--   DROP FUNCTION IF EXISTS public.sum_ai_task_spend(uuid, timestamptz, text, text);
--   DROP FUNCTION IF EXISTS public.set_ai_task_cap(uuid, text, numeric);
--   ALTER TABLE public.workspaces DROP COLUMN IF EXISTS ai_task_limits;
-- ============================================================================

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS ai_task_limits jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'workspaces_ai_task_limits_object') THEN
    ALTER TABLE public.workspaces ADD CONSTRAINT workspaces_ai_task_limits_object
      CHECK (jsonb_typeof(ai_task_limits) = 'object');
  END IF;
END $$;

COMMENT ON COLUMN public.workspaces.ai_task_limits IS
  'Por tarea de IA, {"monthly_cap_usd": numeric}: avisa al 80 % (o el porcentaje del negocio) y frena al llegar. Se escribe con set_ai_task_cap.';

CREATE OR REPLACE FUNCTION public.set_ai_task_cap(
  p_workspace_id    uuid,
  p_task            text,
  p_monthly_cap_usd numeric
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old jsonb;
BEGIN
  IF p_task IS NULL OR p_task !~ '^[a-z_]{3,40}$' THEN
    RAISE EXCEPTION 'tarea no válida' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_monthly_cap_usd IS NOT NULL AND (p_monthly_cap_usd < 0 OR p_monthly_cap_usd > 100000) THEN
    RAISE EXCEPTION 'el tope va de 0 a 100000' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT ai_task_limits -> p_task INTO v_old
    FROM public.workspaces WHERE id = p_workspace_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'workspace inexistente' USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE public.workspaces
     SET ai_task_limits = CASE
           WHEN p_monthly_cap_usd IS NULL THEN COALESCE(ai_task_limits, '{}'::jsonb) - p_task
           ELSE jsonb_set(COALESCE(ai_task_limits, '{}'::jsonb), ARRAY[p_task], jsonb_build_object('monthly_cap_usd', p_monthly_cap_usd), true)
         END
   WHERE id = p_workspace_id;

  RETURN v_old;
END;
$$;

REVOKE ALL ON FUNCTION public.set_ai_task_cap(uuid, text, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_ai_task_cap(uuid, text, numeric) TO service_role;

CREATE OR REPLACE FUNCTION public.sum_ai_task_spend(
  p_workspace_id uuid,
  p_since        timestamptz,
  p_source       text,
  p_detail_like  text DEFAULT NULL
)
RETURNS numeric
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(SUM(r.cost_usd), 0)
  FROM public.agent_runs r
  WHERE r.workspace_id = p_workspace_id
    AND r.created_at >= p_since
    AND r.source = p_source
    AND (p_detail_like IS NULL OR r.status_detail LIKE p_detail_like);
$$;

COMMENT ON FUNCTION public.sum_ai_task_spend(uuid, timestamptz, text, text) IS
  'Gasto de IA en USD de una tarea (agent_runs.source, y status_detail para la clasificación al cierre) desde un instante. Lo usa el freno por tarea. Solo service_role.';

REVOKE ALL ON FUNCTION public.sum_ai_task_spend(uuid, timestamptz, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sum_ai_task_spend(uuid, timestamptz, text, text) TO service_role;
