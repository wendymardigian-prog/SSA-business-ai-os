import type { LanguageModel } from "ai";
import { memoryDb, type MemoryDb } from "./memory-db";
import { agentRow } from "./fixtures";
import type { TurnDeps } from "../runner";
import type { ModelRunInput, ModelRunOutput } from "../fallback";
import type { Database } from "@/lib/types/database";

type AgentRow = Database["public"]["Tables"]["agents"]["Row"];

/**
 * Un mundo de prueba para el turno del agente: base en memoria, reloj falso
 * (sleep avanza el reloj en vez de esperar), modelo falso y envio falso.
 */

export const T0 = new Date("2026-09-15T16:00:00.000Z").getTime(); // martes 10:00 CR
export const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString();

export interface World {
  db: MemoryDb;
  clock: { ms: number };
  deps: TurnDeps;
  modelCalls: ModelRunInput[];
  sent: Array<{ text: string; at: string }>;
  setModel(fn: (input: ModelRunInput) => Promise<ModelRunOutput>): void;
  addInbound(text: string, atSeconds: number): void;
  payload: Record<string, unknown>;
}

/** Un borrador vivo choca con otro vivo de la misma conversacion (00070). */
const LIVE = ["pending", "sending", "failed"];
export const oneLiveDraftPerConversation = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  a.conversation_id === b.conversation_id && LIVE.includes(a.status as string) && LIVE.includes(b.status as string);

export function turnWorld(
  opts: {
    agent?: Partial<AgentRow>;
    conversation?: Record<string, unknown>;
    /** Deja el canal ch-1 en modo borrador (agents.channel_modes, 00070). */
    draft?: boolean;
    channel?: Record<string, unknown>;
  } = {},
): World {
  const clock = { ms: T0 };
  const now = () => new Date(clock.ms);
  const db = memoryDb(
    {
      workspaces: [{ id: "ws-1", ai_daily_cost_limit_usd: null, ai_monthly_cost_limit_usd: null }],
      agents: [agentRow({ ...(opts.draft ? { channel_modes: { "ch-1": "draft" } } : {}), ...opts.agent })],
      channels: [{ id: "ch-1", workspace_id: "ws-1", platform: "instagram", messaging_window_hours: null, ...opts.channel }],
      agent_drafts: [],
      scheduled_jobs: [],
      conversations: [
        {
          id: "cv-1",
          workspace_id: "ws-1",
          channel_id: "ch-1",
          contact_id: "c-1",
          agent_enabled: true,
          agent_paused_until: null,
          is_automation_paused: false,
          assigned_to: null,
          status: "open",
          late_conversation_id: "lc-1",
          deleted_at: null,
          last_agent_error_at: null,
          last_agent_error_run_id: null,
          ...opts.conversation,
        },
      ],
      contacts: [{ id: "c-1", display_name: "Ana", instagram_username: "ana", lead_temperature: null, next_followup_date: null, ai_conversation_summary: null }],
      contact_tags: [],
      messages: [],
      flow_sessions: [],
      model_pricing: [],
      agent_runs: [],
      agent_run_steps: [],
      audit_log: [],
      notifications: [],
    },
    {
      now,
      unique: { agent_drafts: oneLiveDraftPerConversation },
      rpc: {
        // push_debounced_job en memoria: con un pending de la misma clave, lo
        // empuja y descarta las claves volatiles; si no, crea uno.
        push_debounced_job: (args, mdb) => {
          const jobs = mdb.rows("scheduled_jobs");
          const existing = jobs.find((j) => j.dedupe_key === args.p_dedupe_key && j.status === "pending");
          const volatile = (args.p_volatile_keys as string[] | undefined) ?? [];
          if (existing) {
            existing.run_at = args.p_run_at;
            const payload = { ...(existing.payload as Record<string, unknown>) };
            for (const k of volatile) delete payload[k];
            existing.payload = payload;
            return [{ job_id: existing.id, job_run_at: existing.run_at, created: false }];
          }
          const job = { id: `job-${jobs.length + 1}`, type: args.p_type, dedupe_key: args.p_dedupe_key, status: "pending", run_at: args.p_run_at, payload: args.p_payload };
          jobs.push(job);
          return [{ job_id: job.id, job_run_at: job.run_at, created: true }];
        },
        // Momento 2 (00077): espeja la lógica del RPC SQL sobre la base en memoria.
        claim_agent_reply: (args, mdb) => {
          const inbound = new Date(args.p_inbound_at as string).getTime();
          const answered = mdb.rows("messages").some(
            (m) =>
              m.conversation_id === args.p_conversation_id &&
              m.direction === "outbound" &&
              new Date(m.created_at as string).getTime() > inbound &&
              m.status !== "failed" &&
              (args.p_run_id == null || m.agent_run_id !== args.p_run_id),
          );
          return answered;
        },
      },
    },
  );

  const modelCalls: ModelRunInput[] = [];
  const sent: World["sent"] = [];
  let model: (input: ModelRunInput) => Promise<ModelRunOutput> = async () => ({
    text: "Hola Ana, te cuento como funciona.",
    totalUsage: { inputTokens: 1000, outputTokens: 50 },
  });

  const deps: TurnDeps = {
    now,
    sleep: async (ms) => {
      clock.ms += Math.max(ms, 1);
    },
    resolveModel: () => async (provider, modelId) => ({
      ok: true,
      model: {} as LanguageModel,
      provider,
      modelId,
    }),
    runModel: async (input) => {
      modelCalls.push(input);
      return model(input);
    },
    send: async (_supabase, _ctx, text) => {
      sent.push({ text, at: now().toISOString() });
      return { ok: true, platformMessageId: `pm-${sent.length}` };
    },
    checkSpend: async () => ({ allowed: true, warnings: [] }),
    // Por defecto el refresco no trae nada (ok, 0 insertados). Los tests que
    // simulan una respuesta de ManyChat sobrescriben world.deps.refresh.
    refresh: async () => ({ ok: true, inserted: 0, error: null }),
  };

  return {
    db,
    clock,
    deps,
    modelCalls,
    sent,
    setModel: (fn) => {
      model = fn;
    },
    addInbound: (text, atSeconds) => {
      db.rows("messages").push({
        id: `in-${db.rows("messages").length + 1}`,
        conversation_id: "cv-1",
        direction: "inbound",
        text,
        created_at: at(atSeconds),
        sent_by_user_id: null,
        sent_by_flow_id: null,
        sent_by_agent_id: null,
        agent_run_id: null,
      });
    },
    payload: {
      workspaceId: "ws-1",
      conversationId: "cv-1",
      channelId: "ch-1",
      contactId: "c-1",
      agentId: "agent-1",
      last_message_at: at(0),
      burst_deadline: null,
    },
  };
}
