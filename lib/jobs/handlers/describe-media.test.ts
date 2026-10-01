/**
 * Describir una imagen para que el agente sepa que le mandaron (F8).
 *
 * El modelo esta simulado: nunca se llama a un proveedor de verdad. Lo que se
 * prueba es el claim, que una imagen CON caption igual se describa, y que sin
 * ningun modelo de vision el mensaje quede no interpretable (para que el agente
 * escale en vez de responder a ciegas).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { generateText } = vi.hoisted(() => ({ generateText: vi.fn() }));
vi.mock("ai", () => ({ generateText }));

const { getWorkspaceModel } = vi.hoisted(() => ({ getWorkspaceModel: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getWorkspaceModel }));

import { memoryDb } from "@/lib/agent/testing/memory-db";
import { emptyAttachment } from "@/lib/messages/attachments";
import { getJobHandler, resetJobHandlers } from "@/lib/jobs/registry";
import {
  DESCRIBE_MEDIA_JOB,
  describeDedupeKey,
  describeMessageMedia,
  registerDescribeMediaHandler,
} from "./describe-media";

const WS = "ws-1";
const MSG = "m-1";

function messageRow(over: Record<string, unknown> = {}) {
  return {
    id: MSG,
    conversation_id: "cv-1",
    workspace_id: WS,
    text: null,
    media_description: null,
    interpretability: "unknown",
    attachments: {
      v: 2,
      items: [
        emptyAttachment("image", { status: "ready", storagePath: `${WS}/cv-1/${MSG}-0.jpg`, mime: "image/jpeg" }),
      ],
    },
    ...over,
  };
}

function db(rows = [messageRow()], options: { downloadError?: boolean } = {}) {
  const memory = memoryDb({ messages: rows, agent_runs: [], model_pricing: [] });
  (memory.client as unknown as { storage: unknown }).storage = {
    from: () => ({
      download: async () =>
        options.downloadError
          ? { data: null, error: { message: "not found" } }
          : { data: new Blob([new Uint8Array([0xff, 0xd8, 0xff])]), error: null },
    }),
  };
  return memory;
}

const context = (memory: ReturnType<typeof memoryDb>) => ({
  supabase: memory.client,
  job: { id: "j-1", type: DESCRIBE_MEDIA_JOB, payload: { messageId: MSG }, attempts: 0 },
});

const row = (memory: ReturnType<typeof memoryDb>) => memory.rows("messages")[0];

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  getWorkspaceModel.mockImplementation(async (_ws: string, opts: { preferredProvider?: string }) =>
    opts.preferredProvider === "openai"
      ? { ok: true, model: {}, provider: "openai", modelId: "gpt-5" }
      : { ok: false, problem: "provider_unavailable" },
  );
  generateText.mockResolvedValue({
    text: "Captura de una conversación de WhatsApp. El texto dice: “te confirmo el turno del martes”.",
    totalUsage: { inputTokens: 900, outputTokens: 40 },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("describeMessageMedia: el camino feliz (F8)", () => {
  it("describe la imagen y la guarda, marcando el mensaje como interpretable", async () => {
    const memory = db();

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("done");
    expect(row(memory)).toMatchObject({ interpretability: "described" });
    expect(row(memory).media_description).toContain("te confirmo el turno");
  });

  it("el prompt pide el texto que aparece en la imagen: la mayoria son capturas", async () => {
    const memory = db();

    await describeMessageMedia(context(memory), MSG);

    const [{ messages }] = generateText.mock.calls[0];
    const prompt = messages[0].content.find((c: { type: string }) => c.type === "text").text;
    expect(prompt).toContain("texto");
    expect(prompt).toContain("español");
    // Y la imagen va con su mime, no con uno inventado.
    expect(messages[0].content.find((c: { type: string }) => c.type === "image")).toMatchObject({
      mediaType: "image/jpeg",
    });
  });

  it("una imagen CON caption se describe igual: dicen cosas distintas", async () => {
    const memory = db([messageRow({ text: "mirá esto" })]);

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("done");
    expect(generateText).toHaveBeenCalled();
    expect(row(memory).media_description).toBeTruthy();
    // Pero el texto propio sigue mandando para la interpretabilidad.
    expect(row(memory).interpretability).toBe("text");
  });

  it("la descripcion se recorta a 300 caracteres: es contexto, no un informe", async () => {
    const memory = db();
    generateText.mockResolvedValue({ text: "a".repeat(500), totalUsage: {} });

    await describeMessageMedia(context(memory), MSG);

    expect((row(memory).media_description as string).length).toBe(300);
  });

  it("registra el run con su propia fuente", async () => {
    const memory = db();

    await describeMessageMedia(context(memory), MSG);

    expect(memory.rows("agent_runs")[0]).toMatchObject({
      source: "media_description",
      provider: "openai",
      thread_id: MSG,
    });
  });

  it("un sticker NO se describe (FA7): no gasta una llamada de vision, y queda label_only, no unreadable", async () => {
    const memory = db([
      messageRow({
        attachments: {
          v: 2,
          items: [emptyAttachment("sticker", { status: "ready", storagePath: "p.webp", mime: "image/webp" })],
        },
      }),
    ]);

    await expect(describeMessageMedia(context(memory), MSG)).resolves.toMatchObject({ kind: "skipped" });
    expect(generateText).not.toHaveBeenCalled();
    expect(row(memory).interpretability).toBe("label_only");
  });
});

describe("describeMessageMedia: el claim (F8)", () => {
  it("si otra corrida ya la tomo, no se llama al modelo", async () => {
    const memory = db([messageRow({ media_description: "" })]);

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("skipped");
    expect(generateText).not.toHaveBeenCalled();
  });

  it("una que ya tiene descripcion tampoco se vuelve a describir", async () => {
    const memory = db([messageRow({ media_description: "ya estaba descripta" })]);

    await expect(describeMessageMedia(context(memory), MSG)).resolves.toMatchObject({ kind: "skipped" });
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("describeMessageMedia: lo que sale mal (F8)", () => {
  it("SIN ningun modelo de vision el mensaje queda no interpretable: el agente va a escalar", async () => {
    const memory = db();
    getWorkspaceModel.mockResolvedValue({ ok: false, problem: "no_provider" });

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("failed");
    expect(row(memory)).toMatchObject({ media_description: null, interpretability: "unreadable" });
    expect(generateText).not.toHaveBeenCalled();
  });

  it("si el modelo falla se reintenta, y el claim queda liberado", async () => {
    const memory = db();
    generateText.mockRejectedValue(new Error("529 overloaded"));

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("retry");
    // Liberado: si quedara en "" el reintento se saltearia solo.
    expect(row(memory).media_description).toBeNull();
    expect(memory.rows("agent_runs")[0]).toMatchObject({ status: "error" });
  });

  it("si no se puede bajar la imagen se reintenta", async () => {
    const memory = db([messageRow()], { downloadError: true });

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("retry");
    expect(row(memory).media_description).toBeNull();
  });

  it("una respuesta vacia del modelo deja el mensaje no interpretable", async () => {
    const memory = db();
    generateText.mockResolvedValue({ text: "   ", totalUsage: {} });

    const result = await describeMessageMedia(context(memory), MSG);

    expect(result.kind).toBe("failed");
    expect(row(memory).interpretability).toBe("unreadable");
  });

  it("un mensaje sin imagen lista no se intenta describir", async () => {
    const memory = db([
      messageRow({ attachments: { v: 2, items: [emptyAttachment("image", { status: "failed" })] } }),
    ]);

    await expect(describeMessageMedia(context(memory), MSG)).resolves.toMatchObject({ kind: "failed" });
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("el handler del job (F8)", () => {
  beforeEach(() => {
    resetJobHandlers();
    registerDescribeMediaHandler();
  });

  it("se registra con registerJobHandler", () => {
    expect(getJobHandler(DESCRIBE_MEDIA_JOB)).toBeTypeOf("function");
  });

  it("un fallo transitorio lanza; uno permanente no", async () => {
    const handler = getJobHandler(DESCRIBE_MEDIA_JOB)!;

    generateText.mockRejectedValue(new Error("529"));
    await expect(handler(context(db()))).rejects.toThrow(/no pude describir/);

    getWorkspaceModel.mockResolvedValue({ ok: false, problem: "no_provider" });
    await expect(handler(context(db()))).resolves.toBeUndefined();
  });

  it("la clave de dedupe es una por mensaje", () => {
    expect(describeDedupeKey("m-1")).toBe("describe:m-1");
  });
});
