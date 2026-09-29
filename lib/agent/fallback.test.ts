import { describe, it, expect, vi } from "vitest";
import { APICallError } from "ai";
import type { LanguageModel } from "ai";
import { describeAttempts, generateWithFallback, type Candidate, type ModelRunner } from "./fallback";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * El reintento con modelo de respaldo.
 *
 * El caso que motivo estas pruebas: principal y respaldo del MISMO proveedor
 * con la key revocada. Se intentaban los dos, fallaban identico, y el run
 * decia "primary: AI_APICallError; fallback: AI_APICallError". Dos errores
 * iguales que no distinguen una key vencida de un proveedor caido.
 */

const FAKE_MODEL = { modelId: "fake" } as unknown as LanguageModel;

function fakeRun() {
  const steps: Array<{ name?: string | null; error?: string | null }> = [];
  const handle = {
    runId: "run-1",
    setModel: vi.fn(),
    addStepUsage: vi.fn(),
    setFinalUsage: vi.fn(),
    addEmbeddingUsage: vi.fn(),
  addAudioUsage: vi.fn(),
    setRouting: vi.fn(),
    setIntent: vi.fn(),
    step: vi.fn(async (input: { name?: string | null; error?: string | null }) => {
      steps.push({ name: input.name, error: input.error });
      return null;
    }),
    close: vi.fn(),
  } as unknown as AiRunHandle;
  return { run: handle, steps };
}

function authError(status = 401) {
  return new APICallError({
    message: "API key is invalid.",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: status,
    responseBody: JSON.stringify({ error: { type: "authentication_error" } }),
  });
}

function overloadedError() {
  return new APICallError({
    message: "Overloaded",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: 529,
    responseBody: JSON.stringify({ error: { type: "overloaded_error" } }),
  });
}

/** Un `now` que avanza solo, para no depender del reloj real. */
function clock(start = 0) {
  let t = start;
  return () => (t += 1);
}

async function run(args: {
  candidates: Candidate[];
  runModel: ModelRunner;
  resolveOk?: boolean;
}) {
  const { run: handle, steps } = fakeRun();
  const now = clock();
  const outcome = await generateWithFallback({
    candidates: args.candidates,
    resolve: async () =>
      args.resolveOk === false
        ? { ok: false, problem: "provider_unavailable" }
        : { ok: true, model: FAKE_MODEL },
    runModel: args.runModel,
    buildInput: () => ({
      system: "s",
      messages: [],
      tools: {},
      temperature: undefined,
      maxOutputTokens: undefined,
      onStep: async () => {},
    }),
    timeoutMs: 30_000,
    deadline: 10_000_000,
    now,
    run: handle,
  });
  return { outcome, steps };
}

const ANTHROPIC_PRIMARY: Candidate = { provider: "anthropic", model: "claude-sonnet-5", role: "primary" };
const ANTHROPIC_FALLBACK: Candidate = { provider: "anthropic", model: "claude-haiku-4-5", role: "fallback" };
const OPENAI_FALLBACK: Candidate = { provider: "openai", model: "gpt-5", role: "fallback" };

describe("generateWithFallback — key rechazada", () => {
  it("NO reintenta el mismo proveedor: la key es del proveedor, no del modelo", async () => {
    const runModel = vi.fn(async () => {
      throw authError();
    });

    const { outcome, steps } = await run({
      candidates: [ANTHROPIC_PRIMARY, ANTHROPIC_FALLBACK],
      runModel,
    });

    // Una sola llamada de verdad, no dos.
    expect(runModel).toHaveBeenCalledTimes(1);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.attempts[0].problem).toBe("api_401:authentication_error");
    expect(outcome.attempts[1].problem).toBe("skipped_same_provider_auth");
    // El salteo queda anotado: si no, pareceria que el respaldo no existe.
    expect(steps[1].error).toContain("skipped_same_provider_auth");
  });

  it("devuelve el proveedor que rechazo la key, para poder avisar", async () => {
    const { outcome } = await run({
      candidates: [ANTHROPIC_PRIMARY, ANTHROPIC_FALLBACK],
      runModel: async () => {
        throw authError(403);
      },
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.authFailures).toEqual([
      { provider: "anthropic", model: "claude-sonnet-5", status: 403 },
    ]);
  });

  it("un respaldo de OTRO proveedor SI se intenta: para eso esta", async () => {
    const runModel = vi.fn(async () => {
      if (runModel.mock.calls.length === 1) throw authError();
      return { text: "respondio el respaldo", totalUsage: undefined };
    });

    const { outcome } = await run({ candidates: [ANTHROPIC_PRIMARY, OPENAI_FALLBACK], runModel });

    expect(runModel).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ ok: true, provider: "openai", model: "gpt-5", role: "fallback" });
  });
});

describe("generateWithFallback — otros fallos", () => {
  it("un 529 SI reintenta el mismo proveedor: puede ser pasajero", async () => {
    const runModel = vi.fn(async () => {
      if (runModel.mock.calls.length === 1) throw overloadedError();
      return { text: "ok", totalUsage: undefined };
    });

    const { outcome } = await run({ candidates: [ANTHROPIC_PRIMARY, ANTHROPIC_FALLBACK], runModel });

    expect(runModel).toHaveBeenCalledTimes(2);
    expect(outcome).toMatchObject({ ok: true, role: "fallback" });
  });

  it("un timeout se reporta como model_timeout", async () => {
    const { outcome } = await run({
      candidates: [ANTHROPIC_PRIMARY],
      runModel: async () => {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        throw err;
      },
    });

    expect(outcome).toMatchObject({ ok: false, reason: "model_timeout" });
  });

  it("un proveedor no conectado no cuenta como key rechazada", async () => {
    const { outcome } = await run({
      candidates: [ANTHROPIC_PRIMARY, ANTHROPIC_FALLBACK],
      runModel: async () => ({ text: "", totalUsage: undefined }),
      resolveOk: false,
    });

    expect(outcome.ok).toBe(false);
    if (outcome.ok) return;
    expect(outcome.authFailures).toEqual([]);
    // Los dos se intentan resolver: el problema es la conexion, no la key.
    expect(outcome.attempts).toHaveLength(2);
  });

  it("el primero que responde gana y no se toca el respaldo", async () => {
    const runModel = vi.fn(async () => ({ text: "listo", totalUsage: undefined }));

    const { outcome } = await run({ candidates: [ANTHROPIC_PRIMARY, OPENAI_FALLBACK], runModel });

    expect(runModel).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ ok: true, role: "primary" });
  });
});

describe("describeAttempts", () => {
  it("dice contra QUE se intento, no solo el rol", () => {
    const text = describeAttempts([
      { role: "primary", provider: "anthropic", model: "claude-sonnet-5", problem: "api_401:authentication_error" },
      { role: "fallback", provider: "anthropic", model: "claude-haiku-4-5", problem: "skipped_same_provider_auth" },
    ]);

    expect(text).toBe(
      "primary anthropic/claude-sonnet-5: api_401:authentication_error; " +
        "fallback anthropic/claude-haiku-4-5: skipped_same_provider_auth",
    );
  });
});
