import { describe, it, expect, vi, beforeEach } from "vitest";
import { approveDraft, discardDraft, regenerateDraft, splitEdited } from "./actions";
import { memoryDb, type MemoryDb } from "../testing/memory-db";
import { agentRow } from "../testing/fixtures";
import { oneLiveDraftPerConversation } from "../testing/turn-world";
import { lastHumanReplyAt } from "../context";
import type { SendFn } from "../send";

/**
 * Las decisiones sobre un borrador. El test que no puede faltar es el primero:
 * aprobar un borrador NO es una respuesta manual y NO apaga el agente.
 */

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

const NOW = new Date("2026-09-25T15:00:00.000Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();

function world(draft: Record<string, unknown> = {}, extra: { conversation?: Record<string, unknown>; contact?: Record<string, unknown> } = {}) {
  const db = memoryDb(
    {
      agents: [agentRow({ channel_modes: { "ch-1": "draft" } })],
      channels: [{ id: "ch-1", workspace_id: "ws-1", platform: "instagram", messaging_window_hours: null }],
      conversations: [
        {
          id: "cv-1",
          workspace_id: "ws-1",
          channel_id: "ch-1",
          contact_id: "c-1",
          agent_enabled: null,
          agent_paused_until: null,
          is_automation_paused: false,
          status: "open",
          assigned_to: null,
          late_conversation_id: "lc-1",
          last_agent_error_at: hoursAgo(1),
          last_agent_error_run_id: "run-x",
          ...extra.conversation,
        },
      ],
      contacts: [{ id: "c-1", display_name: "Ana", instagram_username: "ana", do_not_contact: false, ...extra.contact }],
      messages: [{ id: "in-1", conversation_id: "cv-1", direction: "inbound", text: "cuanto sale?", created_at: hoursAgo(2) }],
      agent_runs: [{ id: "run-1", conversation_id: "cv-1", source: "agent", status: "drafted", responded_at: null, created_at: hoursAgo(2) }],
      agent_drafts: [
        {
          id: "d-1",
          workspace_id: "ws-1",
          agent_id: "agent-1",
          conversation_id: "cv-1",
          contact_id: "c-1",
          channel_id: "ch-1",
          run_id: "run-1",
          status: "pending",
          body: "Sale 500 dolares. Te paso el link?",
          body_parts: ["Sale 500 dolares. Te paso el link?"],
          suggested_actions: [],
          burst_last_inbound_at: hoursAgo(2),
          ...draft,
        },
      ],
      audit_log: [],
      notifications: [],
      scheduled_jobs: [],
    },
    {
      now: () => NOW,
      unique: {
        agent_drafts: oneLiveDraftPerConversation,
        scheduled_jobs: (a, b) => Boolean(a.dedupe_key) && a.dedupe_key === b.dedupe_key && a.status === "pending" && b.status === "pending",
      },
    },
  );
  const sent: string[] = [];
  const send: SendFn = async (_s, _c, text) => {
    sent.push(text);
    return { ok: true, platformMessageId: `pm-${sent.length}` };
  };
  return { db, sent, send };
}

const approve = (w: { db: MemoryDb; send: SendFn }, over: Partial<Parameters<typeof approveDraft>[0]> = {}) =>
  approveDraft({ user: w.db.client, service: w.db.client, userId: "u-1", draftId: "d-1", send: w.send, now: NOW, ...over });

const draft = (db: MemoryDb) => db.rows("agent_drafts").find((d) => d.id === "d-1")!;

describe("enviar un borrador: LA TRAMPA", () => {
  it("aprobar NO apaga el agente: no es una respuesta manual, y el mensaje es del agente Y de quien aprobo", async () => {
    const w = world();
    const result = await approve(w);

    expect(result).toEqual({ ok: true });
    expect(w.sent).toEqual(["Sale 500 dolares. Te paso el link?"]);

    // El agente sigue como estaba (heredar), sin forzado apagado ni audit de toggle.
    const conv = w.db.rows("conversations")[0];
    expect(conv.agent_enabled).toBeNull();
    expect(w.db.rows("audit_log").some((a) => a.action === "agent_toggled")).toBe(false);

    const out = w.db.rows("messages").find((m) => m.direction === "outbound")!;
    expect(out).toMatchObject({ sent_by_agent_id: "agent-1", sent_by_user_id: "u-1", agent_run_id: "run-1" });
    // Y no cuenta como respuesta humana para los guardarrailes.
    expect(await lastHumanReplyAt(w.db.client, "cv-1")).toBeNull();

    expect(draft(w.db)).toMatchObject({ status: "sent", sent_body: "Sale 500 dolares. Te paso el link?", decided_by: "u-1", sent_message_id: out.id });
    expect(typeof w.db.rows("agent_runs")[0].responded_at).toBe("string");
    // La marca de error del agente se borra: su respuesta salio.
    expect(conv.last_agent_error_at).toBeNull();
  });

  it("editar y enviar guarda sent_body distinto de body", async () => {
    const w = world();
    await approve(w, { body: "Sale 500 dolares, con cuotas. Te paso el link?" });
    expect(draft(w.db)).toMatchObject({ body: "Sale 500 dolares. Te paso el link?", sent_body: "Sale 500 dolares, con cuotas. Te paso el link?" });
    expect(w.sent).toEqual(["Sale 500 dolares, con cuotas. Te paso el link?"]);
  });

  it("bloqueo optimista: si otra persona ya decidio, no se envia nada y el mensaje es claro", async () => {
    const w = world({ status: "discarded" });
    const result = await approve(w);
    expect(result).toMatchObject({ ok: false, code: "already_decided" });
    expect(w.sent).toHaveLength(0);
  });

  it("si el envio falla queda failed con el motivo, y se puede reintentar", async () => {
    const w = world();
    const failing: SendFn = async () => ({ ok: false, failure: { kind: "unknown", message: "Instagram no respondio", retryable: true } });
    expect(await approve(w, { send: failing })).toMatchObject({ ok: false, code: "send_failed" });
    expect(draft(w.db)).toMatchObject({ status: "failed", send_error: "Instagram no respondio" });

    expect(await approve(w)).toEqual({ ok: true });
    expect(draft(w.db).status).toBe("sent");
  });

  it("si Instagram dice que la ventana cerro, la fila pasa a no enviable en el acto", async () => {
    const w = world();
    const closed: SendFn = async () => ({ ok: false, failure: { kind: "outside_window", message: "Paso la ventana", retryable: false } });
    await approve(w, { send: closed });
    expect(draft(w.db)).toMatchObject({ status: "failed", sendable_until: NOW.toISOString() });
  });

  it("con la ventana cerrada no intenta enviar: ofrece responder a mano", async () => {
    const w = world({ burst_last_inbound_at: hoursAgo(25) });
    w.db.rows("messages")[0].created_at = hoursAgo(25);
    expect(await approve(w)).toMatchObject({ ok: false, code: "window_closed" });
    expect(w.sent).toHaveLength(0);
    expect(draft(w.db).status).toBe("pending");
  });

  it("si el lead volvio a escribir, el borrador queda superseded y no sale", async () => {
    const w = world();
    w.db.rows("messages").push({ id: "in-2", conversation_id: "cv-1", direction: "inbound", text: "?", created_at: hoursAgo(1) });
    expect(await approve(w)).toMatchObject({ ok: false, code: "superseded" });
    expect(draft(w.db).status).toBe("superseded");
    expect(w.sent).toHaveLength(0);
  });

  it("si ya hubo una respuesta por otro lado, se descarta para no mandar dos", async () => {
    const w = world();
    w.db.rows("messages").push({ id: "out-1", conversation_id: "cv-1", direction: "outbound", text: "hola", created_at: hoursAgo(1) });
    expect(await approve(w)).toMatchObject({ ok: false, code: "answered_elsewhere" });
    expect(draft(w.db)).toMatchObject({ status: "discarded", discard_reason: "auto:answered_elsewhere" });
  });

  it("un contacto 'no contactar' pide confirmacion antes de enviar", async () => {
    const w = world({}, { contact: { do_not_contact: true } });
    expect(await approve(w)).toMatchObject({ ok: false, code: "needs_confirmation" });
    expect(await approve(w, { confirmedDoNotContact: true })).toEqual({ ok: true });
  });

  it("un borrador sin texto no se envia: se responde a mano", async () => {
    const w = world({ body: null, body_parts: null, no_reply_reason: "escalate" });
    expect(await approve(w)).toMatchObject({ ok: false, code: "no_body" });
  });

  it("las sugerencias se aplican al aprobar, con el agente como actor y la persona en metadata", async () => {
    const w = world({
      suggested_actions: [
        { type: "pause", minutes: 60, reason: "lo pidio", maxMinutes: 1440, autoResume: true },
        { type: "escalate", reason: "Pide una persona", summary: "Quiere hablar", reopen: true },
      ],
    });
    await approve(w);
    const conv = w.db.rows("conversations")[0];
    expect(conv.agent_enabled).toBe(false);
    expect(conv.agent_paused_until).toBe(new Date(NOW.getTime() + 60 * 60_000).toISOString());
    const takeover = w.db.rows("audit_log").find((a) => a.action === "human_takeover")!;
    expect(takeover).toMatchObject({ performed_by_agent_id: "agent-1" });
    expect(takeover.metadata).toMatchObject({ origin: "draft_approval", approved_by: "u-1", draft_id: "d-1" });
    expect(w.db.rows("audit_log").find((a) => a.action === "agent_paused")?.metadata).toMatchObject({ origin: "draft_approval", approved_by: "u-1" });
  });
});

describe("descartar", () => {
  it("saca el borrador de la cola con el motivo; es una decision, no una ventana perdida", async () => {
    const w = world();
    expect(await discardDraft({ user: w.db.client, userId: "u-1", draftId: "d-1", reason: "no aplica", now: NOW })).toEqual({ ok: true });
    expect(draft(w.db)).toMatchObject({ status: "discarded", discard_reason: "no aplica", decided_by: "u-1" });
    expect(draft(w.db).window_missed_at ?? null).toBeNull();
  });

  it("dos veces: la segunda avisa que ya se decidio", async () => {
    const w = world();
    await discardDraft({ user: w.db.client, userId: "u-1", draftId: "d-1", now: NOW });
    expect(await discardDraft({ user: w.db.client, userId: "u-2", draftId: "d-1", now: NOW })).toMatchObject({ code: "already_decided" });
  });
});

describe("regenerar", () => {
  const regen = (w: ReturnType<typeof world>, instruction?: string) =>
    regenerateDraft({ user: w.db.client, service: w.db.client, userId: "u-1", draftId: "d-1", instruction, now: NOW });

  it("toma el borrador y encola el turno con la clave del burst y la instruccion", async () => {
    const w = world();
    const result = await regen(w, "mas corto");
    expect(result.ok).toBe(true);
    expect(draft(w.db)).toMatchObject({ status: "regenerated", regenerate_instruction: "mas corto", decided_by: "u-1" });
    expect(w.db.rows("scheduled_jobs")[0]).toMatchObject({
      type: "agent_burst",
      dedupe_key: "agent_burst:cv-1",
      payload: { regenerate_of: "d-1", regenerate_instruction: "mas corto", conversationId: "cv-1", agentId: "agent-1" },
    });
  });

  it("si ya hay un turno agendado (el lead volvio a escribir), no encola otro", async () => {
    const w = world();
    w.db.rows("scheduled_jobs").push({ id: "j-1", type: "agent_burst", dedupe_key: "agent_burst:cv-1", status: "pending" });
    expect(await regen(w, "mas corto")).toMatchObject({ ok: false, code: "turn_pending" });
    expect(draft(w.db).status).toBe("pending");
  });

  it("si otra persona ya decidio, no encola nada", async () => {
    const w = world({ status: "sent" });
    expect(await regen(w)).toMatchObject({ code: "already_decided" });
    expect(w.db.rows("scheduled_jobs")).toHaveLength(0);
  });
});

describe("partir un texto editado", () => {
  it("no toca el contenido y lo parte en el largo del canal", () => {
    expect(splitEdited("hola 😀", 600)).toEqual(["hola 😀"]);
    expect(splitEdited("a".repeat(700), 600)?.length).toBe(2);
  });
  it("si no entra en diez mensajes, lo dice en vez de cortarlo", () => {
    expect(splitEdited("a ".repeat(4000), 100)).toBeNull();
  });
});
