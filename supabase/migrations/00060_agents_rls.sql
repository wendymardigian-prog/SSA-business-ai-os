-- ============================================================================
-- 00060 — RLS y privilegios de columna de las tablas del agente
-- ============================================================================
-- Fase 3, Bloque 2a. Todas las tablas nuevas con RLS y policies explicitas.
--
-- | Tabla                 | SELECT                                  | INSERT        | UPDATE        | DELETE  |
-- |-----------------------|-----------------------------------------|---------------|---------------|---------|
-- | agents                | Miembros (sin columnas de topes)        | Owner, Admin  | Owner, Admin  | nadie (soft delete) |
-- | agent_prompt_versions | Owner, Admin                            | Owner, Admin  | nadie         | nadie   |
-- | agent_runs            | Owner/Admin; Member los de su scope     | service role  | service role  | nadie   |
-- | agent_run_steps       | igual que su run                        | service role  | nadie         | cascada |
-- | model_pricing         | Owner, Admin                            | Owner         | Owner         | Owner   |
--
-- ---------------------------------------------------------------------------
-- LOS COSTOS: privilegio de columna, no una vista
-- ---------------------------------------------------------------------------
-- La RLS es de fila: no esconde columnas. Para que un Member no pueda leer el
-- costo de un run que si puede ver, se usa el privilegio de columna.
--
-- Ojo con un detalle de Postgres que hace inutil la version ingenua: un
-- `REVOKE SELECT (col) ON t FROM authenticated` NO tiene ningun efecto si el rol
-- tiene SELECT a nivel tabla, y Supabase se lo otorga por defecto a toda tabla
-- nueva de public. Por eso se revoca el SELECT de la tabla entera y se vuelve a
-- otorgar solo sobre la lista de columnas publicas.
--
-- Consecuencias, las dos deseadas:
--   - `select('*')` sobre agent_runs con el cliente de un usuario falla con
--     permission denied, sea Member u Owner. Las consultas del cliente listan
--     columnas explicitas (AGENT_RUN_PUBLIC_COLUMNS en lib/agent/runs.ts).
--   - Los costos se leen solo desde el servidor con service role, detras de un
--     requireWorkspaceAdmin() explicito.
--
-- CUANDO SE AGREGUE UNA COLUMNA a agent_runs o agents, hay que decidir si va al
-- GRANT de abajo. Si no se agrega, el cliente de usuario no la puede leer.
--
-- Scope de leads: la policy de agent_runs para un Member usa un EXISTS sobre
-- conversations, que pasa por la RLS de conversations y arrastra el scope gratis.
-- Mismo truco que la 00054 en messages. Un run sin conversacion (indexacion,
-- nodo de flow sin conversacion) solo lo ven Owner/Admin.
--
-- Idempotente.
-- ============================================================================

-- ------------------------------------------------------------
-- 1. agents
-- ------------------------------------------------------------

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agents_select" ON public.agents;
CREATE POLICY "agents_select" ON public.agents
  FOR SELECT USING (public.is_workspace_member(workspace_id) AND deleted_at IS NULL);

DROP POLICY IF EXISTS "agents_insert" ON public.agents;
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT WITH CHECK (public.is_workspace_admin(workspace_id));

-- El soft delete es un UPDATE que setea deleted_at: por eso el filtro de
-- deleted_at va solo en el SELECT (mismo criterio que la 00024).
DROP POLICY IF EXISTS "agents_update" ON public.agents;
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE USING (public.is_workspace_admin(workspace_id))
  WITH CHECK (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "agents_delete" ON public.agents;

REVOKE ALL ON TABLE public.agents FROM anon;
REVOKE SELECT ON TABLE public.agents FROM authenticated;
GRANT SELECT (
  id, workspace_id, name, type, is_enabled,
  system_prompt, active_prompt_version,
  provider, model, fallback_provider, fallback_model,
  temperature, max_output_tokens, model_timeout_seconds,
  bundle_window_seconds, response_delay_seconds, max_wait_seconds,
  max_replies_per_conversation,
  output_format, allowed_tools, tools_config, guardrails,
  knowledge_enabled, knowledge_tags, knowledge_fallback,
  enabled_channel_ids, config,
  created_by, created_at, updated_at, deleted_at
) ON public.agents TO authenticated;
-- Sin GRANT de lectura: daily_cost_limit_usd, daily_cost_limit_action,
-- monthly_cost_limit_usd, monthly_cost_limit_action.

-- ------------------------------------------------------------
-- 2. agent_prompt_versions
-- ------------------------------------------------------------

ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_prompt_versions_select" ON public.agent_prompt_versions;
CREATE POLICY "agent_prompt_versions_select" ON public.agent_prompt_versions
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

-- Quien guarda queda escrito como quien guardo, y la version tiene que ser de
-- un agente del mismo workspace.
DROP POLICY IF EXISTS "agent_prompt_versions_insert" ON public.agent_prompt_versions;
CREATE POLICY "agent_prompt_versions_insert" ON public.agent_prompt_versions
  FOR INSERT WITH CHECK (
    public.is_workspace_admin(workspace_id)
    AND created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.agents a
      WHERE a.id = agent_prompt_versions.agent_id
        AND a.workspace_id = agent_prompt_versions.workspace_id
    )
  );

-- Inmutable: sin policies de UPDATE ni DELETE, y sin el privilegio.
DROP POLICY IF EXISTS "agent_prompt_versions_update" ON public.agent_prompt_versions;
DROP POLICY IF EXISTS "agent_prompt_versions_delete" ON public.agent_prompt_versions;
REVOKE ALL ON TABLE public.agent_prompt_versions FROM anon;
REVOKE UPDATE, DELETE ON TABLE public.agent_prompt_versions FROM authenticated;

-- ------------------------------------------------------------
-- 3. agent_runs
-- ------------------------------------------------------------

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_runs_select" ON public.agent_runs;
CREATE POLICY "agent_runs_select" ON public.agent_runs
  FOR SELECT USING (
    public.is_workspace_admin(workspace_id)
    OR (
      public.is_workspace_member(workspace_id)
      AND conversation_id IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.conversations conv
        WHERE conv.id = agent_runs.conversation_id
      )
    )
  );

-- Sin INSERT/UPDATE/DELETE: solo el service role escribe runs.
DROP POLICY IF EXISTS "agent_runs_insert" ON public.agent_runs;
DROP POLICY IF EXISTS "agent_runs_update" ON public.agent_runs;
DROP POLICY IF EXISTS "agent_runs_delete" ON public.agent_runs;

REVOKE ALL ON TABLE public.agent_runs FROM anon, authenticated;
GRANT SELECT (
  id, workspace_id, source, agent_id, prompt_version,
  conversation_id, thread_id, contact_id, channel_id,
  trigger, status, status_detail, provider, model,
  latency_ms, step_count, error, created_at, completed_at
) ON public.agent_runs TO authenticated;
-- Sin GRANT de lectura: input_tokens, output_tokens, cached_tokens,
-- embedding_tokens, cost_usd, pricing_id.

-- ------------------------------------------------------------
-- 4. agent_run_steps
-- ------------------------------------------------------------

ALTER TABLE public.agent_run_steps ENABLE ROW LEVEL SECURITY;

-- El EXISTS pasa por la RLS de agent_runs: un paso se ve si se ve su run.
DROP POLICY IF EXISTS "agent_run_steps_select" ON public.agent_run_steps;
CREATE POLICY "agent_run_steps_select" ON public.agent_run_steps
  FOR SELECT USING (
    public.is_workspace_member(workspace_id)
    AND EXISTS (
      SELECT 1 FROM public.agent_runs r WHERE r.id = agent_run_steps.run_id
    )
  );

DROP POLICY IF EXISTS "agent_run_steps_insert" ON public.agent_run_steps;
DROP POLICY IF EXISTS "agent_run_steps_update" ON public.agent_run_steps;
DROP POLICY IF EXISTS "agent_run_steps_delete" ON public.agent_run_steps;

REVOKE ALL ON TABLE public.agent_run_steps FROM anon;
REVOKE INSERT, UPDATE, DELETE ON TABLE public.agent_run_steps FROM authenticated;

-- ------------------------------------------------------------
-- 5. model_pricing
-- ------------------------------------------------------------

ALTER TABLE public.model_pricing ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "model_pricing_select" ON public.model_pricing;
CREATE POLICY "model_pricing_select" ON public.model_pricing
  FOR SELECT USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "model_pricing_insert" ON public.model_pricing;
CREATE POLICY "model_pricing_insert" ON public.model_pricing
  FOR INSERT WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "model_pricing_update" ON public.model_pricing;
CREATE POLICY "model_pricing_update" ON public.model_pricing
  FOR UPDATE USING (public.is_workspace_owner(workspace_id))
  WITH CHECK (public.is_workspace_owner(workspace_id));

DROP POLICY IF EXISTS "model_pricing_delete" ON public.model_pricing;
CREATE POLICY "model_pricing_delete" ON public.model_pricing
  FOR DELETE USING (public.is_workspace_owner(workspace_id));

REVOKE ALL ON TABLE public.model_pricing FROM anon;
