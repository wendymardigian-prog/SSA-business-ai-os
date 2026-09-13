import type { Database } from "@/lib/types/database";

type AgentRow = Database["public"]["Tables"]["agents"]["Row"];

/** Una fila de agents completa con los defaults de la migracion 00058. */
export function agentRow(over: Partial<AgentRow> = {}): AgentRow {
  return {
    id: "agent-1",
    workspace_id: "ws-1",
    name: "Agente de prueba",
    type: "chat",
    is_enabled: true,
    system_prompt: "Sos el asistente de prueba.",
    active_prompt_version: 1,
    provider: "anthropic",
    model: "claude-sonnet-5",
    fallback_provider: null,
    fallback_model: null,
    temperature: 0.7,
    max_output_tokens: 500,
    model_timeout_seconds: 120,
    bundle_window_seconds: 60,
    response_delay_seconds: 20,
    max_wait_seconds: 300,
    max_replies_per_conversation: 12,
    output_format: {},
    allowed_tools: [],
    tools_config: {},
    guardrails: {},
    knowledge_enabled: false,
    knowledge_tags: [],
    knowledge_fallback: "general",
    daily_cost_limit_usd: 5,
    daily_cost_limit_action: "notify",
    monthly_cost_limit_usd: 100,
    monthly_cost_limit_action: "disable",
    enabled_channel_ids: ["ch-1"],
    config: {},
    created_by: null,
    created_at: "2026-09-01T00:00:00.000Z",
    updated_at: "2026-09-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}
