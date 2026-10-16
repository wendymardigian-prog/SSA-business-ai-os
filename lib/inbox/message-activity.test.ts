import { describe, expect, it } from "vitest";
import { RUN_STATUS_LABELS } from "@/lib/agent/run-labels";
import {
  anchorMessageId,
  buildActivity,
  runEntries,
  summarize,
  type ActivityDraft,
  type ActivityMessage,
  type ActivityRun,
} from "@/lib/inbox/message-activity";

const T = (min: number) => new Date(Date.UTC(2026, 9, 16, 12, min, 0)).toISOString();

const inbound = (id: string, min: number): ActivityMessage => ({ id, direction: "inbound", created_at: T(min), agent_run_id: null });
const outbound = (id: string, min: number, runId: string | null = null): ActivityMessage => ({ id, direction: "outbound", created_at: T(min), agent_run_id: runId });

const run = (over: Partial<ActivityRun> = {}): ActivityRun => ({
  id: "r1",
  source: "agent",
  trigger: "inbound_message",
  status: "responded",
  status_detail: null,
  created_at: T(2),
  inbound_at: T(0),
  completed_at: T(2),
  ...over,
});

const draft = (over: Partial<ActivityDraft> = {}): ActivityDraft => ({
  id: "d1",
  run_id: "r1",
  status: "pending",
  created_at: T(2),
  decided_at: null,
  discard_reason: null,
  has_body: true,
  no_reply_reason: null,
  ...over,
});

describe("anclaje de una corrida a un mensaje", () => {
  const messages = [inbound("a", 0), inbound("b", 1), outbound("o", 3)];

  it("con inbound_at, al mensaje con esa hora", () => {
    expect(anchorMessageId(run({ inbound_at: T(1) }), messages)).toBe("b");
  });

  it("con inbound_at que no coincide exacto, al ultimo entrante anterior", () => {
    expect(anchorMessageId(run({ inbound_at: T(0.5 + 0) }), messages)).toBe("a");
  });

  it("sin inbound_at, al ultimo entrante anterior a la corrida si fue reciente", () => {
    expect(anchorMessageId(run({ inbound_at: null, created_at: T(2) }), messages)).toBe("b");
  });

  it("sin inbound_at y con el mensaje muy viejo, a ninguno", () => {
    expect(anchorMessageId(run({ inbound_at: null, created_at: T(120) }), messages)).toBeNull();
  });

  it("sin mensajes entrantes, a ninguno", () => {
    expect(anchorMessageId(run(), [outbound("o", 1)])).toBeNull();
  });
});

describe("cada estado de corrida tiene su texto", () => {
  it("todos los status conocidos producen una entrada", () => {
    for (const status of Object.keys(RUN_STATUS_LABELS)) {
      const entries = runEntries(run({ status }), status === "drafted" ? draft() : undefined);
      expect(entries.length, status).toBeGreaterThan(0);
      expect(entries[0].title, status).not.toBe("");
    }
  });

  it("respondio = ejecutado, verde", () => {
    const [e] = runEntries(run({ status: "responded" }), undefined);
    expect(e).toMatchObject({ kind: "reply", outcome: "executed", tone: "success" });
  });

  it("salto: no hizo nada y dice por que", () => {
    const [e] = runEntries(run({ status: "skipped", status_detail: "agent_off" }), undefined);
    expect(e).toMatchObject({ kind: "skipped", outcome: "skipped" });
    expect(e.detail).toMatch(/apagado/i);
  });

  it("automatizacion intervino", () => {
    const [e] = runEntries(run({ status: "skipped_automation", status_detail: "flow_session" }), undefined);
    expect(e.kind).toBe("automation");
  });

  it("derivo a una persona", () => {
    const [e] = runEntries(run({ status: "escalated", status_detail: "tool:derivar_a_humano" }), undefined);
    expect(e).toMatchObject({ kind: "escalated", tone: "warning" });
  });

  it("fallo", () => {
    const [e] = runEntries(run({ status: "error", status_detail: "provider_unavailable" }), undefined);
    expect(e).toMatchObject({ kind: "failed", outcome: "failed", tone: "error" });
  });
});

describe("una sugerencia NO es una respuesta enviada", () => {
  it("pendiente: sugerida, ambar, y aclara que no salio nada", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft());
    expect(e).toMatchObject({ kind: "suggestion", outcome: "suggested", tone: "warning" });
    expect(e.detail).toMatch(/no salió nada/i);
  });

  it("enviada tras aprobarla: ejecutada", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ status: "sent", decided_at: T(5) }));
    expect(e).toMatchObject({ outcome: "executed", tone: "success" });
  });

  it("descartada a mano: gris, con el motivo", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ status: "discarded", discard_reason: "muy larga", decided_at: T(4) }));
    expect(e).toMatchObject({ outcome: "skipped", tone: "neutral", title: "Sugerencia descartada" });
    expect(e.detail).toMatch(/muy larga/);
  });

  it("descartada sola porque alguien respondio", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ status: "discarded", discard_reason: "auto:manual_reply" }));
    expect(e.detail).toMatch(/respondió a mano/i);
  });

  it("fallo al enviarse: fallida", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ status: "failed" }));
    expect(e).toMatchObject({ outcome: "failed", tone: "error" });
  });

  it("sin texto: sugiere que responda una persona", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ has_body: false, no_reply_reason: "guardrail:blocked_topic" }));
    expect(e.title).toMatch(/una persona/);
  });

  it("reemplazada por otra", () => {
    const [e] = runEntries(run({ status: "drafted" }), draft({ status: "regenerated" }));
    expect(e.title).toMatch(/reemplazada/);
  });

  it("pedida a mano lo dice", () => {
    const [e] = runEntries(run({ status: "drafted", trigger: "manual" }), draft());
    expect(e.detail).toMatch(/pidió una persona/i);
  });
});

describe("buildActivity", () => {
  const messages = [inbound("a", 0), outbound("o1", 2, "r1")];

  it("une la corrida al mensaje del contacto y a la respuesta del agente", () => {
    const map = buildActivity({ messages, runs: [run()], drafts: [], actions: [] });
    expect(map.get("a")?.entries).toHaveLength(1);
    expect(map.get("o1")?.entries).toHaveLength(1);
    expect(map.get("a")?.summary).toMatchObject({ tone: "success", label: "Agente: respondió" });
  });

  it("ignora corridas que no son del agente de chat (resumen, clasificador, cierre)", () => {
    const map = buildActivity({
      messages,
      runs: [run({ source: "conversation_summary" }), run({ id: "r2", trigger: "cron_close" })],
      drafts: [],
      actions: [],
    });
    expect(map.size).toBe(0);
  });

  it("suma las acciones que ejecuto en esa corrida", () => {
    const map = buildActivity({
      messages,
      runs: [run()],
      drafts: [],
      actions: [{ id: "x1", action: "tag", performed_at: T(2), run_id: "r1" }, { id: "x2", action: "tag", performed_at: T(2), run_id: "otra" }],
    });
    const entries = map.get("a")!.entries;
    expect(entries.map((e) => e.title)).toContain("Etiquetó");
    expect(entries.filter((e) => e.kind === "action")).toHaveLength(1);
  });

  it("un mensaje sin corrida no tiene historia (no se inventa nada)", () => {
    const map = buildActivity({ messages: [inbound("a", 0), inbound("b", 1)], runs: [run({ inbound_at: T(1), created_at: T(2) })], drafts: [], actions: [] });
    expect(map.has("a")).toBe(false);
    expect(map.has("b")).toBe(true);
  });

  it("varias corridas sobre el mismo mensaje quedan ordenadas por hora", () => {
    const map = buildActivity({
      messages: [inbound("a", 0)],
      runs: [run({ id: "r1", status: "drafted", completed_at: T(3) }), run({ id: "r2", trigger: "manual", status: "drafted", created_at: T(9), completed_at: T(9) })],
      drafts: [draft({ id: "d1", run_id: "r1", status: "discarded", decided_at: T(5), created_at: T(3) }), draft({ id: "d2", run_id: "r2", created_at: T(9) })],
      actions: [],
    });
    const entries = map.get("a")!.entries;
    expect(entries.map((e) => e.runId)).toEqual(["r1", "r2"]);
    // Lo que sigue pendiente pesa mas en el punto que lo descartado antes.
    expect(map.get("a")!.summary.outcome).toBe("suggested");
  });
});

describe("summarize", () => {
  it("un error gana sobre lo demas", () => {
    const s = summarize([
      ...runEntries(run({ id: "r1" }), undefined),
      ...runEntries(run({ id: "r2", status: "error" }), undefined),
    ]);
    expect(s.tone).toBe("error");
    expect(s.label).toBe("Agente: falló");
  });
});
