import { describe, it, expect, vi } from "vitest";
import { memoryDb } from "../testing/memory-db";
import { listarRecursosTool, usarRecursoTool, ASSET_SEND_MEMO_KEY, type AssetSendMemo } from "./assets";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import type { AgentToolContext } from "./types";
import type { AiRunHandle } from "@/lib/ai/run";

/**
 * listar_recursos y usar_recurso: la banca de recursos (textos y audios).
 *
 * Lo que importa: un texto se ofrece siempre que este habilitado; un audio
 * ademas necesita transcripcion lista Y un canal que acepte media (un email
 * no puede mandar audio); usar_recurso con un texto lo devuelve interpolado
 * para que el modelo lo use como respuesta, sin tocar turn.memo; con un
 * audio no manda nada ella misma, deja el audio en turn.memo para que el
 * runner lo mande despues del texto; en modo borrador no toca la base, deja
 * una sugerencia con el archivo adentro.
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
    kind: "audio",
    name: "Precio",
    description: "Cuando preguntan el precio",
    shortcut: "/precio",
    tags: [],
    content: null,
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

function textRow(over: Record<string, unknown> = {}) {
  return {
    id: "t-1",
    workspace_id: WS,
    kind: "text",
    name: "Saludo",
    description: null,
    shortcut: "/saludo",
    tags: [],
    content: "Hola {{contact.display_name}}, gracias por escribir a {{workspace.name}}.",
    storage_path: null,
    mime_type: null,
    duration_seconds: null,
    transcript: null,
    transcript_status: "none",
    agent_enabled: true,
    is_active: true,
    deleted_at: null,
    ...over,
  };
}

function channelRow(over: Record<string, unknown> = {}) {
  return { id: "ch-1", provider: "evolution", ...over };
}

function ctxFor(
  db: ReturnType<typeof memoryDb>,
  over: Partial<AgentToolContext> = {},
): AgentToolContext {
  return {
    supabase: db.client,
    agent: toAgentConfig(agentRow({ allowed_tools: ["listar_recursos", "usar_recurso"], tools_config: {} })),
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

describe("listar_recursos", () => {
  it("lista los textos y los audios habilitados con transcripcion lista", async () => {
    const db = memoryDb({
      response_assets: [
        textRow(),
        audioRow(),
        audioRow({ id: "a-2", name: "Sin habilitar", agent_enabled: false }),
        audioRow({ id: "a-3", name: "Sin transcribir", transcript_status: "pending", transcript: null }),
        audioRow({ id: "a-4", name: "Dado de baja", deleted_at: new Date().toISOString() }),
      ],
      channels: [channelRow()],
    });
    const result = await listarRecursosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    expect(result.ok).toBe(true);
    const parsed = JSON.parse(result.forModel);
    expect(parsed).toHaveLength(2);
    expect(parsed.find((p: { id: string }) => p.id === "t-1")).toMatchObject({ tipo: "texto", nombre: "Saludo" });
    expect(parsed.find((p: { id: string }) => p.id === "a-1")).toMatchObject({ tipo: "audio", transcripcion: "Cuesta tanto por mes" });
  });

  it("un texto se ofrece aunque no haya canal que acepte audio", async () => {
    const db = memoryDb({
      response_assets: [textRow(), audioRow()],
      channels: [channelRow({ provider: "resend" })],
    });
    const result = await listarRecursosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    const parsed = JSON.parse(result.forModel);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "t-1", tipo: "texto" });
  });

  it("en un canal de email (resend) no se lista ningun audio", async () => {
    const db = memoryDb({
      response_assets: [audioRow()],
      channels: [channelRow({ provider: "resend" })],
    });
    const result = await listarRecursosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    expect(result.forModel).toMatch(/no hay recursos/i);
  });

  it("sin recursos disponibles, lo dice en vez de una lista vacia muda", async () => {
    const db = memoryDb({ response_assets: [], channels: [channelRow()] });
    const result = await listarRecursosTool.execute({ input: {}, config: {}, ctx: ctxFor(db) });
    expect(result.ok).toBe(true);
    expect(result.forModel).toMatch(/no hay recursos/i);
  });
});

describe("usar_recurso: con un texto", () => {
  it("devuelve el contenido interpolado y no toca turn.memo", async () => {
    const db = memoryDb({
      response_assets: [textRow()],
      contacts: [{ id: "c-1", display_name: "Ana", email: null, phone: null }],
      workspaces: [{ id: WS, name: "Mi Negocio" }],
      channels: [channelRow()],
    });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "t-1" }, config: {}, ctx });

    expect(result.ok).toBe(true);
    expect(result.forModel).toContain("Hola Ana, gracias por escribir a Mi Negocio.");
    expect(ctx.turn!.memo.size).toBe(0);
    expect(result.suggestion).toBeUndefined();
  });

  it("sin dato del contacto, la variable queda vacia (no rompe)", async () => {
    const db = memoryDb({
      response_assets: [textRow()],
      contacts: [{ id: "c-1", display_name: null, email: null, phone: null }],
      workspaces: [{ id: WS, name: "Mi Negocio" }],
      channels: [channelRow()],
    });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "t-1" }, config: {}, ctx });
    expect(result.forModel).toContain("Hola , gracias por escribir a Mi Negocio.");
  });
});

describe("usar_recurso: con un audio, modo envio", () => {
  it("un audio valido queda anotado en turn.memo, no se manda desde aca", async () => {
    const db = memoryDb({ response_assets: [audioRow()], channels: [channelRow()] });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "a-1" }, config: {}, ctx });

    expect(result.ok).toBe(true);
    expect(result.suggestion).toBeUndefined();
    const memo = ctx.turn!.memo.get(ASSET_SEND_MEMO_KEY) as AssetSendMemo;
    expect(memo).toMatchObject({ assetId: "a-1", name: "Precio", storagePath: `${WS}/library/a-1.m4a`, transcript: "Cuesta tanto por mes" });
  });

  it("un id inexistente vuelve como resultado, nunca como excepcion", async () => {
    const db = memoryDb({ response_assets: [audioRow()], channels: [channelRow()] });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "no-existe" }, config: {}, ctx });
    expect(result.ok).toBe(false);
    expect(result.forModel).toMatch(/no existe|no esta disponible/i);
  });

  it("un audio no habilitado para el agente se rechaza igual que uno inexistente", async () => {
    const db = memoryDb({ response_assets: [audioRow({ agent_enabled: false })], channels: [channelRow()] });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "a-1" }, config: {}, ctx });
    expect(result.ok).toBe(false);
  });

  it("un audio en un canal de email se rechaza igual que uno inexistente", async () => {
    const db = memoryDb({ response_assets: [audioRow()], channels: [channelRow({ provider: "resend" })] });
    const ctx = ctxFor(db);
    const result = await usarRecursoTool.execute({ input: { recurso_id: "a-1" }, config: {}, ctx });
    expect(result.ok).toBe(false);
  });

  it("un segundo intento en el mismo turno no pisa el primero: solo uno por respuesta", async () => {
    const db = memoryDb({
      response_assets: [audioRow(), audioRow({ id: "a-2", name: "Horario" })],
      channels: [channelRow()],
    });
    const ctx = ctxFor(db);
    await usarRecursoTool.execute({ input: { recurso_id: "a-1" }, config: {}, ctx });
    const second = await usarRecursoTool.execute({ input: { recurso_id: "a-2" }, config: {}, ctx });

    expect(second.ok).toBe(false);
    expect(second.forModel).toContain("Precio");
    const memo = ctx.turn!.memo.get(ASSET_SEND_MEMO_KEY) as AssetSendMemo;
    expect(memo.assetId).toBe("a-1");
  });
});

describe("usar_recurso: con un audio, modo borrador", () => {
  it("no toca turn.memo: devuelve una sugerencia con el archivo adentro", async () => {
    const db = memoryDb({ response_assets: [audioRow()], channels: [channelRow()] });
    const ctx = ctxFor(db, { mode: "draft" });
    const result = await usarRecursoTool.execute({ input: { recurso_id: "a-1" }, config: {}, ctx });

    expect(result.ok).toBe(true);
    expect(ctx.turn!.memo.has(ASSET_SEND_MEMO_KEY)).toBe(false);
    expect(result.suggestion).toEqual({
      type: "send_asset",
      assetId: "a-1",
      name: "Precio",
      storagePath: `${WS}/library/a-1.m4a`,
      mimeType: "audio/mp4",
      durationSeconds: 8,
    });
  });

  it("declara defersInDraftAsync: el runner la ejecuta igual en borrador (no deferInDraft sincronico)", () => {
    expect(usarRecursoTool.defersInDraftAsync).toBe(true);
    expect(usarRecursoTool.deferInDraft).toBeUndefined();
  });
});
