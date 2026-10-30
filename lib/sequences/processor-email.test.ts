/**
 * Secuencias por email y la suscripcion (E2): el respaldo del procesador.
 *
 * La baja pausa las inscripciones en el momento (set_email_status, 00271). Si una
 * llego activa igual (una baja que entro por otro camino), el procesador la frena
 * antes de mandar: un paso de marketing a quien se dio de baja, rebota o marco spam
 * pausa la inscripcion con su motivo y NO llama al envio. Un paso transaccional a una
 * direccion que rebota se saltea. Si la base no contesta, se reintenta sin gastar
 * intento. Las secuencias por WhatsApp o Instagram no miran nada de esto.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/flow-engine/send", () => ({
  sendChannelMessage: vi.fn(),
  recordSend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/generate-reply", () => ({ generateAiReply: vi.fn() }));
vi.mock("@/lib/response-assets/deliver", () => ({ deliverAsset: vi.fn() }));

import { createServiceClient } from "@/lib/supabase/server";
import { sendChannelMessage } from "@/lib/flow-engine/send";
import { processSequenceSteps } from "./processor";

const WS = "11111111-1111-1111-1111-111111111111";

function enrollment() {
  return {
    id: "enr-1", sequence_id: "seq-1", contact_id: "con-1", channel_id: "chn-1", current_step_index: 0, status: "active",
    enrolled_at: "2026-10-01T10:00:00Z", next_step_at: "2026-10-01T11:00:00Z", completed_at: null, paused_reason: null,
    paused_at: null, attempt_count: 0, last_error: null, last_error_at: null, locked_at: null, collision_detected_at: null,
    collision_with: null, collision_reviewed_at: null, collision_reviewed_by: null, collision_resolution: null,
  };
}

function world(opts: { provider?: string; status?: string | null; stepCategory?: "marketing" | "transactional" }) {
  const updates: Array<Record<string, unknown>> = [];
  const rpcCalls: string[] = [];
  const step: Record<string, unknown> = { type: "message", content: "hola" };
  if (opts.stepCategory) step.emailCategory = opts.stepCategory;

  function table(name: string) {
    const single = async () => {
      if (name === "sequences") return { data: { id: "seq-1", workspace_id: WS, status: "active", steps: [step] }, error: null };
      if (name === "channels") return { data: { provider: opts.provider ?? "resend" }, error: null };
      if (name === "conversations") return { data: { id: "conv-1", late_conversation_id: null }, error: null };
      if (name === "contacts") return { data: { email: "ana@x.test", display_name: "Ana", phone: null, instagram_username: null }, error: null };
      return { data: null, error: null };
    };
    const chain: Record<string, unknown> = {};
    chain.eq = () => chain;
    chain.maybeSingle = single;
    return {
      select: () =>
        name === "contacts"
          ? { in: async () => ({ data: [{ id: "con-1", do_not_contact: false, deleted_at: null }], error: null }), eq: () => chain }
          : chain,
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          if (name === "sequence_enrollments") updates.push(patch);
          return { error: null };
        },
      }),
      insert: async () => ({ error: null }),
    };
  }

  const client = {
    from: (name: string) => table(name),
    rpc: async (fn: string) => {
      rpcCalls.push(fn);
      if (fn === "claim_sequence_enrollments") return { data: [enrollment()], error: null };
      if (fn === "email_address_send_state") {
        return opts.status === null
          ? { data: null, error: { message: "boom", code: "XX000" } }
          : { data: { status: opts.status ?? "subscribed", do_not_contact: false, token: "t", matched: true }, error: null };
      }
      return { data: null, error: null };
    },
  };
  vi.mocked(createServiceClient).mockResolvedValue(client as never);
  return { updates, rpcCalls, last: () => updates.at(-1) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendChannelMessage).mockResolvedValue({ ok: true, platformMessageId: "m1" });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("procesador de secuencias: suscripcion a emails", () => {
  for (const status of ["unsubscribed", "bounced", "complained"] as const) {
    it(`marketing a quien esta '${status}': pausa con 'email_${status}' y no llama al envio`, async () => {
      const w = world({ status });
      await processSequenceSteps();
      expect(sendChannelMessage).not.toHaveBeenCalled();
      expect(w.last()).toMatchObject({ status: "paused", paused_reason: `email_${status}` });
    });
  }

  it("suscripto: manda, con la categoria del paso en el contexto", async () => {
    world({ status: "subscribed" });
    await processSequenceSteps();
    expect(sendChannelMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ emailCategory: "marketing" }), { text: "hola" });
  });

  it("un paso transaccional a quien se dio de baja de marketing: se manda igual", async () => {
    world({ status: "unsubscribed", stepCategory: "transactional" });
    await processSequenceSteps();
    expect(sendChannelMessage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ emailCategory: "transactional" }), { text: "hola" });
  });

  it("un paso transaccional a una direccion que rebota: se saltea con el motivo (no se manda, no se pausa)", async () => {
    const w = world({ status: "bounced", stepCategory: "transactional" });
    await processSequenceSteps();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(w.updates.some((u) => typeof u.last_error === "string" && /rebota/.test(u.last_error as string))).toBe(true);
    expect(w.updates.some((u) => u.status === "paused")).toBe(false);
  });

  it("si la base no contesta, se reintenta sin mandar ni gastar intento", async () => {
    const w = world({ status: null });
    await processSequenceSteps();
    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(w.last()).toMatchObject({ locked_at: null });
    expect(w.last()).not.toHaveProperty("attempt_count");
  });

  it("una secuencia por WhatsApp no mira la suscripcion a emails", async () => {
    const w = world({ provider: "evolution", status: "bounced" });
    await processSequenceSteps();
    expect(sendChannelMessage).toHaveBeenCalled();
    expect(w.rpcCalls).not.toContain("email_address_send_state");
  });

  it("si el envio igual vuelve salteado por la baja (una carrera), la inscripcion se pausa", async () => {
    const w = world({ status: "subscribed" });
    vi.mocked(sendChannelMessage).mockResolvedValueOnce({ ok: false, skipped: "unsubscribed", failure: { kind: "unknown", message: "No se mandó", retryable: false } } as never);
    await processSequenceSteps();
    expect(w.last()).toMatchObject({ status: "paused", paused_reason: "email_unsubscribed" });
  });
});
