import { describe, it, expect, vi, beforeEach } from "vitest";
import type { LanguageModel } from "ai";
import { memoryDb } from "./testing/memory-db";
import { agentRow } from "./testing/fixtures";
import { parseSummaryOutput, summarizeConversationOnClose, SUMMARY_MAX_CHARS, type SummaryDeps } from "./summary";
import type { ModelRunInput, ModelRunOutput } from "./fallback";

/**
 * Memoria acumulativa (F33) y clasificacion al cierre (F34), con el modelo
 * simulado y la base en memoria.
 */

const NOW = new Date("2026-09-24T12:00:00.000Z");
const TAG_INTERESADO = "00000000-0000-4000-8000-00000000000a";
const TAG_VIP = "00000000-0000-4000-8000-00000000000b";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

function world(opts: {
  previous?: string | null;
  status?: string;
  summarizedAt?: string | null;
  messages?: Array<{ direction: "inbound" | "outbound"; text: string; created_at: string }>;
  agent?: Parameters<typeof agentRow>[0];
} = {}) {
  const db = memoryDb(
    {
      agents: [agentRow({ enabled_channel_ids: ["ch-1"], ...opts.agent })],
      conversations: [
        { id: "cv-1", workspace_id: "ws-1", channel_id: "ch-1", contact_id: "c-1", status: opts.status ?? "closed", summarized_at: opts.summarizedAt ?? null, deleted_at: null, agent_enabled: null, agent_paused_until: null },
      ],
      contacts: [{ id: "c-1", workspace_id: "ws-1", display_name: "Ana", ai_conversation_summary: opts.previous ?? null, lead_temperature: null, next_followup_date: null }],
      messages: (opts.messages ?? [
        { direction: "inbound", text: "Hola, me interesa el curso", created_at: "2026-09-24T10:00:00.000Z" },
        { direction: "outbound", text: "Genial, te cuento", created_at: "2026-09-24T10:01:00.000Z" },
      ]).map((m, i) => ({ id: `m-${i}`, conversation_id: "cv-1", ...m })),
      tags: [
        { id: TAG_INTERESADO, workspace_id: "ws-1", name: "Interesado" },
        { id: TAG_VIP, workspace_id: "ws-1", name: "VIP" },
      ],
      contact_tags: [],
      audit_log: [],
      agent_runs: [],
      agent_run_steps: [],
      model_pricing: [],
    },
    { now: () => NOW },
  );
  const calls: ModelRunInput[] = [];
  let answer: (input: ModelRunInput) => Promise<ModelRunOutput> = async () => ({
    text: JSON.stringify({ resumen: "Ana quiere el curso.", clasificacion: { agregar_tags: [], quitar_tags: [], temperatura: null, seguimiento_dias: null } }),
    totalUsage: { inputTokens: 500, outputTokens: 80 },
  });
  const deps: SummaryDeps = {
    now: () => NOW,
    resolveModel: () => async (provider, modelId) => ({ ok: true, model: {} as LanguageModel, provider, modelId }),
    runModel: async (input) => {
      calls.push(input);
      return answer(input);
    },
  };
  return { db, deps, calls, setAnswer: (fn: typeof answer) => (answer = fn) };
}

const args = { conversationId: "cv-1", workspaceId: "ws-1", trigger: "manual" as const };

describe("resumen acumulativo con reconciliacion", () => {
  it("el resumen previo entra al prompt como dato con la instruccion de corregir lo que cambio, y lo nuevo REEMPLAZA lo viejo", async () => {
    const w = world({
      previous: "Ana quiere el plan mensual. Prefiere que le escriban a la tarde.",
      messages: [{ direction: "inbound", text: "Lo pense mejor y quiero el plan anual", created_at: "2026-09-24T10:00:00.000Z" }],
    });
    w.setAnswer(async () => ({
      text: JSON.stringify({ resumen: "Ana quiere el plan anual (cambio de opinion: antes el mensual). Prefiere que le escriban a la tarde.", clasificacion: {} }),
      totalUsage: { inputTokens: 500, outputTokens: 80 },
    }));

    const outcome = await summarizeConversationOnClose(w.db.client, args, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "completed" });
    const prompt = JSON.stringify(w.calls[0]);
    expect(prompt).toContain("plan mensual"); // el previo viaja al modelo
    expect(prompt).toContain("<<<memoria"); // como dato delimitado
    expect(w.calls[0].system).toMatch(/quedate con el NUEVO/);
    const saved = String(w.db.rows("contacts")[0].ai_conversation_summary);
    expect(saved).toContain("plan anual");
    expect(saved).not.toMatch(/^Ana quiere el plan mensual/); // no se acumulo el viejo delante
    // Run con source conversation_summary, atado al agente, y audit reversible
    expect(w.db.rows("agent_runs")[0]).toMatchObject({ source: "conversation_summary", agent_id: "agent-1", trigger: "manual", status: "completed" });
    expect(w.db.rows("audit_log").find((a) => a.action === "summary")).toMatchObject({
      performed_by_agent_id: "agent-1",
      changes: { ai_conversation_summary: { old: "Ana quiere el plan mensual. Prefiere que le escriban a la tarde.", new: saved } },
    });
    expect(w.db.rows("conversations")[0].summarized_at).toBe(NOW.toISOString());
  });

  it("sin mensajes nuevos desde el ultimo resumen no llama al modelo ni abre run", async () => {
    const w = world({ summarizedAt: "2026-09-24T11:00:00.000Z" });
    const outcome = await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(outcome).toEqual({ kind: "skipped", reason: "no_new_messages" });
    expect(w.calls).toHaveLength(0);
    expect(w.db.rows("agent_runs")).toHaveLength(0);
  });

  it("si la conversacion se reabrio antes del job, no hace nada", async () => {
    const w = world({ status: "open" });
    expect(await summarizeConversationOnClose(w.db.client, args, w.deps)).toEqual({ kind: "skipped", reason: "not_closed" });
    expect(w.calls).toHaveLength(0);
  });

  it("con el agente apagado no gasta", async () => {
    const w = world({ agent: { is_enabled: false } });
    expect(await summarizeConversationOnClose(w.db.client, args, w.deps)).toEqual({ kind: "skipped", reason: "no_agent" });
  });

  it("si supera el tope, pide una condensacion y si igual se pasa recorta", async () => {
    const w = world();
    const huge = "x".repeat(SUMMARY_MAX_CHARS + 500);
    let n = 0;
    w.setAnswer(async () => {
      n++;
      return { text: JSON.stringify({ resumen: n === 1 ? huge : "y".repeat(SUMMARY_MAX_CHARS + 10), clasificacion: {} }), totalUsage: { inputTokens: 10, outputTokens: 10 } };
    });
    const outcome = await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(w.calls).toHaveLength(2);
    expect(w.calls[1].messages[0].content).toContain("Condensalo");
    expect(String(w.db.rows("contacts")[0].ai_conversation_summary).length).toBe(SUMMARY_MAX_CHARS);
    expect(outcome).toMatchObject({ detail: expect.stringContaining("summary_condensed") });
    expect(outcome).toMatchObject({ detail: expect.stringContaining("summary_truncated") });
  });

  it("una respuesta que no es JSON deja el run en error y no toca el contacto", async () => {
    const w = world({ previous: "previo" });
    w.setAnswer(async () => ({ text: "No puedo hacer eso.", totalUsage: undefined }));
    const outcome = await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(outcome).toMatchObject({ kind: "run", status: "error", detail: "bad_output" });
    expect(w.db.rows("contacts")[0].ai_conversation_summary).toBe("previo");
  });
});

describe("clasificacion al cierre", () => {
  const classifyingAgent = {
    allowed_tools: ["etiquetar_contacto", "cambiar_temperatura", "programar_seguimiento"],
    tools_config: {
      etiquetar_contacto: { allowedTagIds: [TAG_INTERESADO], canRemove: false },
      cambiar_temperatura: { canLower: false },
      programar_seguimiento: { maxDaysAhead: 30, canOverrideManual: false },
    },
  };

  it("aplica tags SOLO de la lista blanca, la temperatura y el seguimiento, todo auditado y en el run", async () => {
    const w = world({ agent: classifyingAgent });
    w.setAnswer(async () => ({
      text: JSON.stringify({
        resumen: "Ana pidio precio y quiere avanzar.",
        clasificacion: { agregar_tags: ["Interesado", "VIP"], quitar_tags: [], temperatura: "hot", seguimiento_dias: 3 },
      }),
      totalUsage: { inputTokens: 10, outputTokens: 10 },
    }));

    const outcome = await summarizeConversationOnClose(w.db.client, args, w.deps);

    expect(outcome).toMatchObject({ kind: "run", status: "completed", detail: "classified" });
    expect(w.calls[0].system).toContain("Etiquetas permitidas (usa solo estas, tal cual): Interesado");
    expect(w.db.rows("contact_tags").map((t) => t.tag_id)).toEqual([TAG_INTERESADO]); // VIP no
    expect(w.db.rows("contacts")[0]).toMatchObject({ lead_temperature: "hot", next_followup_date: "2026-09-27T12:00:00.000Z" });
    const actions = w.db.rows("audit_log").map((a) => a.action).sort();
    expect(actions).toEqual(["followup", "summary", "tag", "temperature"]);
    for (const a of w.db.rows("audit_log")) expect(a).toMatchObject({ performed_by_agent_id: "agent-1" });
    expect((w.db.rows("audit_log").find((a) => a.action === "tag")?.metadata as Record<string, unknown>).origin).toBe("close_classification");
    const steps = w.db.rows("agent_run_steps").filter((s) => s.kind === "tool_call").map((s) => s.name);
    expect(steps).toEqual(expect.arrayContaining(["resumen", "etiquetar_contacto", "cambiar_temperatura", "programar_seguimiento"]));
  });

  it("respeta los limites de las herramientas: no baja la temperatura ni pasa el maximo de dias", async () => {
    const w = world({ agent: classifyingAgent });
    w.db.rows("contacts")[0].lead_temperature = "hot";
    w.setAnswer(async () => ({
      text: JSON.stringify({ resumen: "r", clasificacion: { agregar_tags: [], quitar_tags: [], temperatura: "cold", seguimiento_dias: 90 } }),
      totalUsage: undefined,
    }));
    await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(w.db.rows("contacts")[0]).toMatchObject({ lead_temperature: "hot", next_followup_date: null });
    expect(w.db.rows("audit_log").map((a) => a.action)).toEqual(["summary"]);
  });

  it("con las herramientas apagadas para el agente, la clasificacion no aplica nada", async () => {
    const w = world({ agent: { allowed_tools: [], tools_config: {} } });
    w.setAnswer(async () => ({
      text: JSON.stringify({ resumen: "r", clasificacion: { agregar_tags: ["Interesado"], quitar_tags: [], temperatura: "hot", seguimiento_dias: 2 } }),
      totalUsage: undefined,
    }));
    await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(w.db.rows("contact_tags")).toHaveLength(0);
    expect(w.db.rows("contacts")[0].lead_temperature).toBeNull();
  });

  it("con clasificar apagado, el prompt lo dice y no se aplica nada aunque el modelo proponga", async () => {
    const w = world({ agent: { ...classifyingAgent, classify_on_close: false } });
    w.setAnswer(async () => ({
      text: JSON.stringify({ resumen: "r", clasificacion: { agregar_tags: ["Interesado"], quitar_tags: [], temperatura: "hot", seguimiento_dias: 2 } }),
      totalUsage: undefined,
    }));
    await summarizeConversationOnClose(w.db.client, args, w.deps);
    expect(w.calls[0].system).toContain("La clasificacion no esta habilitada");
    expect(w.db.rows("contact_tags")).toHaveLength(0);
  });
});

describe("parseSummaryOutput", () => {
  it("tolera fences y texto alrededor; rechaza lo que no es el JSON esperado", () => {
    expect(parseSummaryOutput('```json\n{"resumen":"ok","clasificacion":{}}\n```')?.resumen).toBe("ok");
    expect(parseSummaryOutput('Aca va: {"resumen":"ok"} gracias')?.clasificacion.temperatura).toBeNull();
    expect(parseSummaryOutput("nada")).toBeNull();
    expect(parseSummaryOutput('{"clasificacion":{}}')).toBeNull();
  });
});
