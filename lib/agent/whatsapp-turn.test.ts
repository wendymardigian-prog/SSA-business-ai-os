import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAgentTurn } from "./runner";
import { turnWorld, at, T0 } from "./testing/turn-world";
import type { ModelRunInput } from "./fallback";

/**
 * El turno de punta a punta con la herramienta generar_link_whatsapp y el
 * guardarrail de salida. Base en memoria, modelo y envio falsos.
 */

type Exec = { execute: (i: unknown, o: unknown) => Promise<unknown> };
const call = (tools: ModelRunInput["tools"], name: string, input: unknown) =>
  (tools[name] as unknown as Exec).execute(input, { toolCallId: `t-${name}`, messages: [] });

const WHATSAPP_AGENT = {
  allowed_tools: ["generar_link_whatsapp"],
  tools_config: { generar_link_whatsapp: { numero: "5491100000000" } },
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("generar_link_whatsapp: envio directo", () => {
  it("el mensaje sale con el link y queda una entrada whatsapp_handoff", async () => {
    const w = turnWorld({ agent: WHATSAPP_AGENT });
    w.addInbound("quiero avanzar con el programa", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async (input) => {
      await call(input.tools, "generar_link_whatsapp", { contexto: "quiere avanzar con el programa", nombre: "Ana" });
      return { text: "Dale, escribime por acá y seguimos: {{LINK_WHATSAPP}}", totalUsage: { inputTokens: 10, outputTokens: 5 } };
    });

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ kind: "run", status: "responded" });

    // El mensaje enviado lleva el link real, no el marcador.
    expect(w.sent).toHaveLength(1);
    expect(w.sent[0].text).toContain("https://wa.me/5491100000000?text=");
    expect(w.sent[0].text).not.toContain("{{LINK_WHATSAPP}}");

    // Un solo paso tool_call de la herramienta.
    const toolSteps = w.db.rows("agent_run_steps").filter((s) => s.name === "generar_link_whatsapp");
    expect(toolSteps).toHaveLength(1);

    // Una entrada whatsapp_handoff con el agente como actor.
    const handoff = w.db.rows("audit_log").filter((a) => a.action === "whatsapp_handoff");
    expect(handoff).toHaveLength(1);
    expect(handoff[0]).toMatchObject({ entity_type: "contact", entity_id: "c-1", performed_by_agent_id: "agent-1" });
  });

  it("dos llamadas en el mismo turno: un solo link, un solo paso", async () => {
    const w = turnWorld({ agent: WHATSAPP_AGENT });
    w.addInbound("dale", 0);
    w.clock.ms = T0 + 75_000;
    const links: string[] = [];
    w.setModel(async (input) => {
      const a = (await call(input.tools, "generar_link_whatsapp", { contexto: "uno" })) as string;
      const b = (await call(input.tools, "generar_link_whatsapp", { contexto: "dos" })) as string;
      links.push(JSON.parse(a).link, JSON.parse(b).link);
      return { text: "acá: {{LINK_WHATSAPP}}", totalUsage: { inputTokens: 5, outputTokens: 2 } };
    });

    await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(links[0]).toBe(links[1]); // mismo link
    expect(w.db.rows("agent_run_steps").filter((s) => s.name === "generar_link_whatsapp")).toHaveLength(1);
  });

  it("marcador sin llamada a la herramienta: el texto sale limpio y queda un guardarrail", async () => {
    const w = turnWorld({ agent: WHATSAPP_AGENT });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "Escribime: {{LINK_WHATSAPP}}", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(w.sent[0].text).not.toContain("{{LINK_WHATSAPP}}");
    expect(w.sent[0].text).not.toContain("wa.me");
    expect(w.db.rows("agent_run_steps").some((s) => s.name === "whatsapp_marker")).toBe(true);
    expect(w.db.rows("audit_log").filter((a) => a.action === "whatsapp_handoff")).toHaveLength(0);
  });

  it("reusa el link de un run anterior de la conversacion", async () => {
    const w = turnWorld({ agent: WHATSAPP_AGENT });
    // Un run anterior con su paso de herramienta ya guardado.
    const prevLink = "https://wa.me/5491100000000?text=Hola%2C%20soy%20Ana.";
    w.db.rows("agent_runs").push({ id: "run-prev", conversation_id: "cv-1", workspace_id: "ws-1", created_at: at(-100) });
    w.db.rows("agent_run_steps").push({
      id: "step-prev", run_id: "run-prev", kind: "tool_call", name: "generar_link_whatsapp",
      error: null, created_at: at(-100), output: { link: prevLink, texto_preescrito: "Hola, soy Ana." },
    });
    w.addInbound("me pasas el link de nuevo?", 0);
    w.clock.ms = T0 + 75_000;
    let returned = "";
    w.setModel(async (input) => {
      returned = (await call(input.tools, "generar_link_whatsapp", { contexto: "de nuevo" })) as string;
      return { text: "acá: {{LINK_WHATSAPP}}", totalUsage: { inputTokens: 5, outputTokens: 2 } };
    });

    await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(JSON.parse(returned).link).toBe(prevLink);
    expect(w.sent[0].text).toContain(prevLink);
    const step = w.db.rows("agent_run_steps").find((s) => s.name === "generar_link_whatsapp" && s.run_id !== "run-prev");
    expect((step?.output as { reenvio?: boolean })?.reenvio).toBe(true);
  });
});

describe("guardarrail de salida", () => {
  it("envio directo: link a otro numero bloquea, el lead no recibe nada, run blocked_guardrail y aviso", async () => {
    const w = turnWorld({
      agent: { ...WHATSAPP_AGENT, guardrails: { linksPermitidos: ["wa.me/5491100000000"] } },
    });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "escribime a wa.me/999888777 ya", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ status: "blocked_guardrail" });
    expect(w.sent).toHaveLength(0);
    expect(w.db.rows("notifications").some((n) => n.type === "agent_output_blocked")).toBe(true);
    const step = w.db.rows("agent_run_steps").find((s) => (s.name as string)?.startsWith("output_"));
    expect(step).toBeTruthy();
  });

  it("una palabra prohibida configurada, en la salida, se bloquea", async () => {
    const w = turnWorld({
      agent: { ...WHATSAPP_AGENT, guardrails: { palabrasProhibidas: { enabled: true, phrases: ["miempresa"] } } },
    });
    w.addInbound("con quien hablo?", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "Soy el asistente de MiEmpresa", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ status: "blocked_guardrail" });
    expect(w.sent).toHaveLength(0);
  });

  it("lista de links vacia: un link cualquiera no bloquea (palabras prohibidas off, no aplica aca)", async () => {
    const w = turnWorld({
      // Sin palabras prohibidas ni links, para aislar: solo confirma que la lista vacia no frena links.
      agent: { ...WHATSAPP_AGENT, guardrails: { palabrasProhibidas: { enabled: false, phrases: [] }, cifras: { enabled: false, permitidas: [] } } },
    });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "mira este ejemplo cualquiera.com", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ status: "responded" });
    expect(w.sent).toHaveLength(1);
  });
});

describe("guardarrail de salida en modo borrador", () => {
  it("no envia: guarda el borrador marcado con el hallazgo", async () => {
    const w = turnWorld({
      draft: true,
      agent: { ...WHATSAPP_AGENT, guardrails: { linksPermitidos: ["wa.me/5491100000000"] } },
    });
    w.addInbound("hola", 0);
    w.clock.ms = T0 + 75_000;
    w.setModel(async () => ({ text: "escribime a wa.me/999888777", totalUsage: { inputTokens: 5, outputTokens: 2 } }));

    const outcome = await runAgentTurn(w.db.client, w.payload, w.deps);
    expect(outcome).toMatchObject({ status: "drafted" });
    expect(w.sent).toHaveLength(0);
    const draft = w.db.rows("agent_drafts")[0];
    const suggested = draft.suggested_actions as Array<{ type: string }>;
    expect(suggested.some((s) => s.type === "guardrail_review")).toBe(true);
  });
});
