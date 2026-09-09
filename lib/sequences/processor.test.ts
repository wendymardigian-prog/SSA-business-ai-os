import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@/lib/types/database";

type Enrollment = Database["public"]["Tables"]["sequence_enrollments"]["Row"];

vi.mock("@/lib/supabase/server", () => ({ createServiceClient: vi.fn() }));
vi.mock("@/lib/flow-engine/send", () => ({
  sendChannelMessage: vi.fn(),
  recordSend: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/ai/generate-reply", () => ({ generateAiReply: vi.fn() }));

import { createServiceClient } from "@/lib/supabase/server";
import { sendChannelMessage } from "@/lib/flow-engine/send";
import { generateAiReply } from "@/lib/ai/generate-reply";
import { processSequenceSteps } from "./processor";

const WS = "11111111-1111-1111-1111-111111111111";

function enrollment(overrides: Partial<Enrollment> = {}): Enrollment {
  return {
    id: "enr-1",
    sequence_id: "seq-1",
    contact_id: "con-1",
    channel_id: "chn-1",
    current_step_index: 0,
    status: "active",
    enrolled_at: "2026-09-09T10:00:00Z",
    next_step_at: "2026-09-09T11:00:00Z",
    completed_at: null,
    paused_reason: null,
    paused_at: null,
    attempt_count: 0,
    last_error: null,
    last_error_at: null,
    locked_at: null,
    collision_detected_at: null,
    collision_with: null,
    collision_reviewed_at: null,
    collision_reviewed_by: null,
    collision_resolution: null,
    ...overrides,
  };
}

interface World {
  claimed: Enrollment[];
  sequence: { id: string; workspace_id: string; status: string; steps: unknown } | null;
  contacts: Array<{ id: string; do_not_contact: boolean; deleted_at: string | null }>;
  conversation: { id: string; late_conversation_id: string | null } | null;
}

/**
 * Cliente falso que registra cada update sobre sequence_enrollments.
 *
 * Lo que se afirma en estos tests es siempre "en que estado quedo la
 * inscripcion", asi que alcanza con juntar los patches.
 */
function fakeClient(world: Partial<World> = {}) {
  const w: World = {
    claimed: world.claimed ?? [enrollment()],
    sequence:
      world.sequence !== undefined
        ? world.sequence
        : { id: "seq-1", workspace_id: WS, status: "active", steps: [{ type: "message", content: "hola" }] },
    contacts: world.contacts ?? [{ id: "con-1", do_not_contact: false, deleted_at: null }],
    conversation:
      world.conversation !== undefined
        ? world.conversation
        : { id: "conv-1", late_conversation_id: "late-1" },
  };

  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];

  function table(name: string) {
    const builder: Record<string, unknown> = {};
    let lastId = "";

    const chain = {
      select: () => chain,
      eq: (col: string, value: string) => {
        if (col === "id") lastId = value;
        return chain;
      },
      in: () => chain,
      maybeSingle: async () => {
        if (name === "sequences") return { data: w.sequence, error: null };
        if (name === "conversations") return { data: w.conversation, error: null };
        if (name === "contacts")
          return { data: { display_name: "Ana", email: null, phone: null, instagram_username: null }, error: null };
        return { data: null, error: null };
      },
      then: undefined,
    };

    return {
      ...builder,
      select: (_cols?: string) => {
        if (name === "contacts") {
          return {
            in: async () => ({ data: w.contacts, error: null }),
            eq: () => chain,
          };
        }
        return chain;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          if (name === "sequence_enrollments") updates.push({ id, patch });
          return { error: null };
        },
      }),
      insert: async () => ({ error: null }),
    };
  }

  const client = {
    from: (name: string) => table(name),
    rpc: async (fn: string) => {
      if (fn === "claim_sequence_enrollments") return { data: w.claimed, error: null };
      return { data: null, error: null };
    },
  };

  vi.mocked(createServiceClient).mockResolvedValue(client as never);
  return { updates, lastPatch: () => updates.at(-1)?.patch };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(sendChannelMessage).mockResolvedValue({ ok: true, platformMessageId: "m1" });
});
afterEach(() => vi.restoreAllMocks());

describe("processSequenceSteps", () => {
  it("una secuencia pausada pausa la inscripcion; NO la cancela para siempre", async () => {
    const { lastPatch } = fakeClient({
      sequence: { id: "seq-1", workspace_id: WS, status: "paused", steps: [] },
    });

    const result = await processSequenceSteps();

    expect(result.paused).toBe(1);
    expect(lastPatch()).toMatchObject({ status: "paused", paused_reason: "sequence_paused" });
    expect(lastPatch()).not.toMatchObject({ status: "cancelled" });
  });

  it("un contacto marcado 'no contactar' pausa sin intentar el envio", async () => {
    const { lastPatch } = fakeClient({
      contacts: [{ id: "con-1", do_not_contact: true, deleted_at: null }],
    });

    await processSequenceSteps();

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(lastPatch()).toMatchObject({ status: "paused", paused_reason: "opt_out" });
  });

  it("sin conversacion abierta pausa en vez de reintentar contra una puerta que no existe", async () => {
    const { lastPatch } = fakeClient({ conversation: null });

    await processSequenceSteps();

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(lastPatch()).toMatchObject({ paused_reason: "no_conversation" });
  });

  it("un envio fallido NO avanza el paso: suma un intento y lo reprograma", async () => {
    vi.mocked(sendChannelMessage).mockResolvedValue({
      ok: false,
      failure: { kind: "unknown", message: "se cayo", retryable: true },
    });
    const { updates } = fakeClient();

    const result = await processSequenceSteps();

    expect(result.failed).toBe(1);
    const patch = updates.at(-1)!.patch;
    expect(patch.attempt_count).toBe(1);
    expect(patch.current_step_index).toBeUndefined();
    expect(patch.next_step_at).toBeTruthy();
  });

  it("agotados los intentos saltea el paso y sigue: la secuencia no muere por un paso", async () => {
    vi.mocked(sendChannelMessage).mockResolvedValue({
      ok: false,
      failure: { kind: "unknown", message: "se cayo", retryable: true },
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { updates } = fakeClient({
      claimed: [
        enrollment({
          attempt_count: 2,
          current_step_index: 0,
        }),
      ],
      sequence: {
        id: "seq-1",
        workspace_id: WS,
        status: "active",
        steps: [
          { type: "message", content: "uno" },
          { type: "message", content: "dos" },
        ],
      },
    });

    await processSequenceSteps();

    const patch = updates.at(-1)!.patch;
    expect(patch.current_step_index).toBe(1);
    expect(patch.attempt_count).toBe(0);
  });

  it("el tope horario reprograma SIN gastar intento: no es culpa del paso", async () => {
    vi.mocked(sendChannelMessage).mockResolvedValue({
      ok: false,
      failure: { kind: "rate_limited", message: "tope de la hora", retryable: true },
    });
    const { updates } = fakeClient();

    await processSequenceSteps();

    const patch = updates.at(-1)!.patch;
    expect(patch.attempt_count).toBeUndefined();
    expect(patch.next_step_at).toBeTruthy();
    expect(patch.locked_at).toBeNull();
  });

  it("un envio exitoso avanza, limpia el error y suelta el lock", async () => {
    const { updates } = fakeClient({
      claimed: [enrollment({ attempt_count: 2, last_error: "algo viejo" })],
      sequence: {
        id: "seq-1",
        workspace_id: WS,
        status: "active",
        steps: [
          { type: "message", content: "hola {{contact.first_name}}" },
          { type: "delay", delayMinutes: 60 },
        ],
      },
    });

    await processSequenceSteps();

    // El texto sale interpolado, no con el token crudo.
    const sent = vi.mocked(sendChannelMessage).mock.calls[0][2] as { text: string };
    expect(sent.text).toBe("hola Ana");

    const patch = updates.at(-1)!.patch;
    expect(patch).toMatchObject({
      current_step_index: 1,
      attempt_count: 0,
      last_error: null,
      locked_at: null,
    });
  });

  it("el envio no nace de un flow: el contexto lleva flowId en null", async () => {
    fakeClient();
    await processSequenceSteps();
    const context = vi.mocked(sendChannelMessage).mock.calls[0][1] as { flowId: unknown };
    expect(context.flowId).toBeNull();
  });

  it("dos inscripciones del mismo contacto y canal en la misma tanda: sale un solo mensaje", async () => {
    const { updates } = fakeClient({
      claimed: [
        enrollment({ id: "enr-1", sequence_id: "seq-1" }),
        enrollment({ id: "enr-2", sequence_id: "seq-2" }),
      ],
    });

    const result = await processSequenceSteps();

    expect(sendChannelMessage).toHaveBeenCalledTimes(1);
    expect(result.skipped).toBe(1);
    // La segunda no se pierde: se reprograma para el proximo tick.
    const second = updates.find((u) => u.id === "enr-2")!;
    expect(second.patch.next_step_at).toBeTruthy();
    expect(second.patch.status).toBeUndefined();
  });

  it("un paso de espera no manda nada, solo avanza", async () => {
    const { updates } = fakeClient({
      sequence: {
        id: "seq-1",
        workspace_id: WS,
        status: "active",
        steps: [
          { type: "delay", delayMinutes: 10 },
          { type: "message", content: "hola" },
        ],
      },
    });

    await processSequenceSteps();

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(updates.at(-1)!.patch.current_step_index).toBe(1);
  });

  it("al pasar el ultimo paso la inscripcion queda completada", async () => {
    const { lastPatch } = fakeClient();
    await processSequenceSteps();
    expect(lastPatch()).toMatchObject({ status: "completed", next_step_at: null });
  });

  it("si la key de IA falla, el paso se reintenta y la secuencia sigue viva", async () => {
    vi.mocked(generateAiReply).mockResolvedValue({
      ok: false,
      problem: "no_key",
      message: "Falta la API key",
    });
    const { updates } = fakeClient({
      sequence: {
        id: "seq-1",
        workspace_id: WS,
        status: "active",
        steps: [{ type: "aiMessage", prompt: "escribile" }],
      },
    });

    const result = await processSequenceSteps();

    expect(sendChannelMessage).not.toHaveBeenCalled();
    expect(result.failed).toBe(1);
    const patch = updates.at(-1)!.patch;
    expect(patch.attempt_count).toBe(1);
    // No se cancela ni se completa: sigue viva esperando el reintento.
    expect(patch.status).toBeUndefined();
  });

  it("un paso de IA exitoso manda lo que genero el modelo", async () => {
    vi.mocked(generateAiReply).mockResolvedValue({
      ok: true,
      text: "te escribo por la promo",
      provider: "anthropic",
      modelId: "claude-x",
    });
    fakeClient({
      sequence: {
        id: "seq-1",
        workspace_id: WS,
        status: "active",
        steps: [{ type: "aiMessage", prompt: "recordale la promo a {{contact.first_name}}" }],
      },
    });

    await processSequenceSteps();

    // La consigna se interpola antes de mandarsela al modelo.
    const request = vi.mocked(generateAiReply).mock.calls[0][1] as { userPrompt: string };
    expect(request.userPrompt).toBe("recordale la promo a Ana");

    const sent = vi.mocked(sendChannelMessage).mock.calls[0][2] as { text: string };
    expect(sent.text).toBe("te escribo por la promo");
  });

  it("sin nada vencido no hace ninguna consulta de mas", async () => {
    fakeClient({ claimed: [] });
    const result = await processSequenceSteps();
    expect(result).toEqual({ processed: 0, failed: 0, paused: 0, skipped: 0, total: 0 });
    expect(sendChannelMessage).not.toHaveBeenCalled();
  });
});
