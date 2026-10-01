import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "../testing/memory-db";
import { listarAudiosTool, enviarAudioTool, AUDIO_SEND_MEMO_KEY, type AudioSendMemo } from "./audio";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import type { AgentToolContext } from "./types";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * listar_audios y enviar_audio (F22).
 *
 * Lo que importa: solo se ofrecen los audios habilitados para el agente Y con
 * transcripcion lista (nunca uno a medio transcribir ni uno que el toggle
 * "Asistente" tiene apagado); enviar_audio no manda nada ella misma, deja el
 * audio en turn.memo para que el runner lo mande despues del texto; en modo
 * borrador no toca la base, deja una sugerencia con el archivo adentro.
 */

const WS = "ws-1";

function fakeRun(): AiRunHandle {
  return {
    runId: "run-1",
    setModel: vi.fn(),
    addStepUsage: vi.fn(),
    setFinalUsage: vi.fn(),
    addEmbeddingUsage: vi.fn(),
    addAudioUsage: vi.fn(),
    step: vi.fn(async () => null),
    setRouting: vi.fn(),
    setIntent: vi.fn(),
    close: vi.fn(async () => ({ status: "responded" }) as never),
  };
}

function audioRow(over: Record<string, unknown> = {}) {
  return {
    id: "a-1",
    workspace_id: WS,
    name: "Precio",
    description: "Cuando preguntan el precio",
    shortcut: "/precio",
    storage_path: `${WS}/library/a-1.m4a`,
    mime_type: "audio/mp4",
    duration_seconds: 8,
    transcript: "Cuesta tanto por mes",
    transcript_status: "ready",
    agent_enabled: true,
    is_active: true,
    deleted_at: null,
    ...over,
  };
}

function ctxFor(db: ReturnType<typeof memoryDb>, over: Partial<AgentToolContext> = {}): AgentToolContext {
  return {
    supabase: db.client,
    agent: toAgentConfig(agentRow({ allowed_tools: ["listar_audios", "enviar_audio"], tools_config: {} })),
    workspaceId: WS,
    conversationId: "cv-1",
    contactId: "c-1",
    channelId: "ch-1",
    run: fakeRun(),
    nonce: "nonce-1",
    turn: { memo: new Map() },
    mode: "send",
    ...over,
  };
}

describe("listar_audios", () => {
  it("lista solo los habilitados para el agente y con transcripcion lista", async () => {
    const db = memoryDb({
      audio_assets: [
        audioRow(),
        audioRow({ id: "a-2", name: "Sin habilitar", agent_enabled: false }),
        audioRow({ id: "a-3", name: "Sin transcribir", transcript_status: "pending", transcript: null }),
        audioRow({ id: "a-4", name: "Dado de baja", deleted_at: new Date().toISOString() }),
      ],
    });
    const result = await listarAudiosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.forModel);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "a-1", nombre: "Precio", transcripcion: "Cuesta tanto por mes" });
  });

  it("sin audios disponibles, lo dice en vez de una lista vacia muda", async () => {
    const db = memoryDb({ audio_assets: [] });
    const result = await listarAudiosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    expect(result.ok).toBe(true);
    expect(result.forModel).toMatch(/no hay audios/i);
  });
});

describe("enviar_audio: modo envio", () => {
  it("un audio valido queda anotado en turn.memo, no se manda desde aca", async () => {
    const db = memoryDb({ audio_assets: [audioRow()] });
    const ctx = ctxFor(db);
    const result = await enviarAudioTool.execute({ input: { audio_id: "a-1" }, config: {}, ctx });

    expect(result.ok).toBe(true);
    expect(result.suggestion).toBeUndefined();
    const memo = ctx.turn!.memo.get(AUDIO_SEND_MEMO_KEY) as AudioSendMemo;
    expect(memo).toMatchObject({ audioAssetId: "a-1", name: "Precio", storagePath: `${WS}/library/a-1.m4a`, transcript: "Cuesta tanto por mes" });
  });

  it("un id inexistente vuelve como resultado, nunca como excepcion", async () => {
    const db = memoryDb({ audio_assets: [audioRow()] });
    const ctx = ctxFor(db);
    const result = await enviarAudioTool.execute({ input: { audio_id: "no-existe" }, config: {}, ctx });
    expect(result.ok).toBe(false);
    expect(result.forModel).toMatch(/no existe|no esta disponible/i);
  });

  it("un audio no habilitado para el agente se rechaza igual que uno inexistente", async () => {
    const db = memoryDb({ audio_assets: [audioRow({ agent_enabled: false })] });
    const ctx = ctxFor(db);
    const result = await enviarAudioTool.execute({ input: { audio_id: "a-1" }, config: {}, ctx });
    expect(result.ok).toBe(false);
  });

  it("un segundo intento en el mismo turno no pisa el primero: solo uno por respuesta", async () => {
    const db = memoryDb({ audio_assets: [audioRow(), audioRow({ id: "a-2", name: "Horario" })] });
    const ctx = ctxFor(db);
    await enviarAudioTool.execute({ input: { audio_id: "a-1" }, config: {}, ctx });
    const second = await enviarAudioTool.execute({ input: { audio_id: "a-2" }, config: {}, ctx });

    expect(second.ok).toBe(false);
    expect(second.forModel).toContain("Precio");
    const memo = ctx.turn!.memo.get(AUDIO_SEND_MEMO_KEY) as AudioSendMemo;
    expect(memo.audioAssetId).toBe("a-1");
  });
});

describe("enviar_audio: modo borrador (F22)", () => {
  it("no toca turn.memo: devuelve una sugerencia con el archivo adentro", async () => {
    const db = memoryDb({ audio_assets: [audioRow()] });
    const ctx = ctxFor(db, { mode: "draft" });
    const result = await enviarAudioTool.execute({ input: { audio_id: "a-1" }, config: {}, ctx });

    expect(result.ok).toBe(true);
    expect(ctx.turn!.memo.has(AUDIO_SEND_MEMO_KEY)).toBe(false);
    expect(result.suggestion).toEqual({
      type: "send_audio",
      audioAssetId: "a-1",
      name: "Precio",
      storagePath: `${WS}/library/a-1.m4a`,
      mimeType: "audio/mp4",
      durationSeconds: 8,
    });
  });

  it("declara defersInDraftAsync: el runner la ejecuta igual en borrador (no deferInDraft sincronico)", () => {
    expect(enviarAudioTool.defersInDraftAsync).toBe(true);
    expect(enviarAudioTool.deferInDraft).toBeUndefined();
  });
});
