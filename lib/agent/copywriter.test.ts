/**
 * El agente copywriter, de punta a punta (E4, E5, E8, E11).
 *
 * Proveedor de IA SIEMPRE simulado: ninguna llamada real, ni un centavo
 * gastado. Lo que se prueba es lo que decide el agente —que contexto junta,
 * que topes respeta, que deja anotado— y no lo que escribe el modelo.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const { getWorkspaceModel } = vi.hoisted(() => ({ getWorkspaceModel: vi.fn() }));
vi.mock("@/lib/ai/provider", () => ({ getWorkspaceModel }));

const { runCopywriter } = await import("./copywriter");

const WS_A = "ws-a";
const WS_B = "ws-b";
const AGENT_A = "agente-a";
const AGENT_B = "agente-b";
const POST_A = "post-a";
const POST_B = "post-b";

const SALIDA = {
  script: "Un hook\n\nEl desarrollo\n\nComenta SISTEMA",
  recording_notes: "Vertical",
  caption_base: "Un caption",
  captions: { instagram: "Para Instagram" },
};

/** El proveedor simulado: devuelve la salida y anota que prompt recibio. */
function fakeGenerate(object: unknown = SALIDA) {
  return vi.fn(async (params: { prompt: string }) => ({
    object,
    usage: { inputTokens: 100, outputTokens: 200 },
    _prompt: params.prompt,
  })) as never;
}

const haceDias = (d: number) => new Date(Date.now() - d * 24 * 60 * 60_000).toISOString();

function seed(over: { agentConfig?: unknown; agentPrompt?: string; gastado?: number } = {}): MemoryDb {
  return memoryDb(
    {
      agents: [
        {
          id: AGENT_A,
          workspace_id: WS_A,
          name: "Copywriter de contenido",
          type: "copywriter",
          is_enabled: true,
          system_prompt: over.agentPrompt ?? "Escribi como Ana: directa y sin vueltas.",
          active_prompt_version: 1,
          provider: null,
          model: null,
          temperature: null,
          max_output_tokens: null,
          config: over.agentConfig ?? {},
          knowledge_tags: ["oferta"],
          daily_cost_limit_usd: 5,
          daily_cost_limit_action: "notify",
          monthly_cost_limit_usd: 100,
          monthly_cost_limit_action: "disable",
          deleted_at: null,
        },
        {
          id: AGENT_B,
          workspace_id: WS_B,
          name: "Copywriter de contenido",
          type: "copywriter",
          is_enabled: true,
          system_prompt: "Escribi formal, en tercera persona.",
          active_prompt_version: 1,
          provider: null,
          model: null,
          temperature: null,
          max_output_tokens: null,
          config: {},
          knowledge_tags: [],
          daily_cost_limit_usd: null,
          daily_cost_limit_action: "notify",
          monthly_cost_limit_usd: null,
          monthly_cost_limit_action: "disable",
          deleted_at: null,
        },
      ],
      workspaces: [
        {
          id: WS_A,
          content_copy_settings: { voice: "La voz vieja" },
          ai_daily_cost_limit_usd: null,
          ai_monthly_cost_limit_usd: null,
          timezone: "America/Costa_Rica",
        },
        {
          id: WS_B,
          content_copy_settings: null,
          ai_daily_cost_limit_usd: null,
          ai_monthly_cost_limit_usd: null,
          timezone: "America/Costa_Rica",
        },
      ],
      content_posts: [
        {
          id: POST_A,
          workspace_id: WS_A,
          title: "Detras de escena",
          format: "reel",
          script: null,
          caption: null,
          networks: [{ platform: "instagram" }],
          idea_id: "idea-1",
        },
        {
          id: POST_B,
          workspace_id: WS_B,
          title: "Otro negocio",
          format: "reel",
          script: null,
          caption: null,
          networks: [{ platform: "instagram" }],
          idea_id: null,
        },
      ],
      content_ideas: [
        { id: "idea-1", title: "Por que perdes leads", content: "Mi tasa paso de 40 a 90\n\nAntes y despues", reference: null },
      ],
      social_posts: [
        { workspace_id: WS_A, platform: "instagram", status: "published", caption: "El que mejor anduvo", engagement_d7: 90, published_at: haceDias(10), content_posts: { format: "reel" } },
        { workspace_id: WS_A, platform: "instagram", status: "published", caption: "El viejo", engagement_d7: 99, published_at: haceDias(200), content_posts: { format: "reel" } },
      ],
      social_accounts: [{ workspace_id: WS_A, platform: "instagram", channel_id: "chan-1" }],
      triggers: [
        {
          id: "trg-1",
          workspace_id: WS_A,
          flow_id: "flow-1",
          type: "comment_keyword",
          is_active: true,
          channel_id: "chan-1",
          config: { keywords: [{ value: "SISTEMA" }], postIds: [] },
          // La base lo trae por join; aca se siembra como lo devuelve.
          flows: { name: "Guia por DM" },
        },
      ],
      flows: [{ id: "flow-1", name: "Guia por DM" }],
      knowledge_base: [
        { workspace_id: WS_A, title: "Oferta", content_md: "Implementacion en 10 dias", tags: ["oferta"], internal_only: false, status: "ready" },
      ],
      content_pillars: [],
      content_offers: [],
      agent_runs: [],
      agent_run_steps: [],
    },
    { rpc: { sum_ai_spend: () => over.gastado ?? 0 } },
  );
}

beforeEach(() => {
  getWorkspaceModel.mockResolvedValue({ ok: true, model: {}, provider: "anthropic", modelId: "claude-sonnet-5" });
});

describe("E4 · el contexto que junta antes de escribir", () => {
  it("le da la idea, el mejor post reciente, la palabra clave real y lo que sabe", async () => {
    const db = seed();
    const generate = fakeGenerate();

    const result = await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    expect(result.ok).toBe(true);
    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;

    expect(prompt).toContain("Mi tasa paso de 40 a 90");
    expect(prompt).toContain("El que mejor anduvo");
    // De hace 200 dias no: el negocio de entonces era otro.
    expect(prompt).not.toContain("El viejo");
    expect(prompt).toContain("SISTEMA -> Guia por DM");
    expect(prompt).toContain("Implementacion en 10 dias");
    expect(prompt).toContain("Escribi como Ana");
  });

  it("F94: le da la clasificacion de la pieza (pilar, oferta, etapa) con sus NOMBRES, no los ids", async () => {
    const db = seed();
    db.rows("content_pillars").push({ id: "p1", workspace_id: WS_A, name: "Sistemas", archived_at: null });
    db.rows("content_offers").push({ id: "o1", workspace_id: WS_A, name: "Implementacion en 10 dias", archived_at: null });
    Object.assign(db.rows("content_posts")[0], { pillar_id: "p1", offer_id: "o1", funnel_stage: "bofu", reference: "https://ref.test/x" });
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).toContain("Pilar: Sistemas");
    expect(prompt).toContain("Oferta: Implementacion en 10 dias");
    expect(prompt).toContain("Etapa del embudo: Decisión");
    expect(prompt).toContain("Referencia: https://ref.test/x");
    expect(prompt).not.toContain("p1");
  });

  it("F94: un pilar archivado se sigue nombrando: la pieza lo tiene", async () => {
    const db = seed();
    db.rows("content_pillars").push({ id: "p1", workspace_id: WS_A, name: "Viejo", archived_at: "2026-10-01T00:00:00Z" });
    Object.assign(db.rows("content_posts")[0], { pillar_id: "p1" });
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).toContain("Pilar: Viejo");
  });

  it("F94: un pilar de OTRO workspace no se lee", async () => {
    const db = seed();
    db.rows("content_pillars").push({ id: "p-ajeno", workspace_id: WS_B, name: "Secreto del otro negocio", archived_at: null });
    Object.assign(db.rows("content_posts")[0], { pillar_id: "p-ajeno" });
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).not.toContain("Secreto del otro negocio");
  });

  it("F94: pasa el formato de cada red elegido en la pieza", async () => {
    const db = seed();
    db.rows("content_posts")[0].networks = [
      { platform: "instagram", format: "carousel" },
      { platform: "tiktok" },
    ];
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).toContain("instagram: Carrusel");
    // Una red sin formato elegido no inventa uno (la linea de limites dice
    // "tiktok: hasta ...", que es otra cosa).
    expect(prompt).not.toMatch(/tiktok: (Video|Carrusel|Reel)/);
  });

  it("F94: el guion que ya habia se manda para mejorarlo", async () => {
    const db = seed();
    db.rows("content_posts")[0].script = "Mi guion escrito a mano";
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).toContain("Mi guion escrito a mano");
    expect(prompt).toContain("sin perder lo que ya funciona");
  });

  it("cada lectura queda como un paso del run: se puede ver que vio", async () => {
    const db = seed();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate: fakeGenerate() });

    const nombres = db.rows("agent_run_steps").map((s) => s.name);
    expect(nombres).toContain("leer_idea");
    expect(nombres).toContain("mejores_posts");
    expect(nombres).toContain("palabras_clave");
    expect(nombres).toContain("conocimiento");
    expect(nombres).toContain("escribir");
  });

  it("las indicaciones de la persona llegan al modelo", async () => {
    const db = seed();
    const generate = fakeGenerate();

    await runCopywriter(
      db.client,
      { agentId: AGENT_A, postId: POST_A, instructions: "mas corto, mas directo" },
      { generate },
    );

    const prompt = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls[0][0].prompt;
    expect(prompt).toContain("mas corto, mas directo");
  });
});

describe("E11 · cada workspace corre con SU configuracion", () => {
  it("dos negocios, dos voces distintas", async () => {
    const db = seed();
    const generate = fakeGenerate();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });
    await runCopywriter(db.client, { agentId: AGENT_B, postId: POST_B }, { generate });

    const calls = (generate as unknown as { mock: { calls: Array<[{ prompt: string }]> } }).mock.calls;
    expect(calls[0][0].prompt).toContain("Escribi como Ana");
    expect(calls[1][0].prompt).toContain("Escribi formal");
    expect(calls[1][0].prompt).not.toContain("Escribi como Ana");
    // Y el de B no ve nada del negocio de A.
    expect(calls[1][0].prompt).not.toContain("Implementacion en 10 dias");
  });

  it("un agente de otro workspace no puede escribir esta pieza", async () => {
    const db = seed();

    const result = await runCopywriter(
      db.client,
      { agentId: AGENT_B, postId: POST_A },
      { generate: fakeGenerate() },
    );

    expect(result).toMatchObject({ ok: false, reason: "no_post" });
  });
});

describe("E3 · los limites de la marca", () => {
  it("avisa cuando el copy usa una frase prohibida, sin tirarlo", async () => {
    const db = seed({
      agentConfig: { guardrails: { bannedPhrases: ["revolucionario"] } },
    });
    const generate = fakeGenerate({ ...SALIDA, caption_base: "Esto es revolucionario" });

    const result = await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    expect(result.ok).toBe(true);
    expect(result.ok && result.warnings.join(" ")).toContain("revolucionario");
    // El copy sirve igual: se arregla la frase en dos segundos.
    expect(result.ok && result.output.caption_base).toBe("Esto es revolucionario");
  });
});

describe("E8 · topes y trazabilidad", () => {
  it("no llama al modelo si se alcanzo el tope del agente", async () => {
    // El mismo mundo, pero el negocio ya gasto mas que su tope diario.
    const db = seed({ gastado: 999 });
    const generate = fakeGenerate();

    const result = await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate });

    expect(result).toMatchObject({ ok: false, reason: "spend_limit" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("el run queda firmado por el agente, con su origen", async () => {
    const db = seed();

    await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate: fakeGenerate() });

    const run = db.rows("agent_runs")[0];
    expect(run).toMatchObject({ agent_id: AGENT_A, source: "content_copy", workspace_id: WS_A });
  });

  it("sin proveedor de IA lo dice en vez de fallar raro", async () => {
    getWorkspaceModel.mockResolvedValue({ ok: false });
    const db = seed();

    const result = await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate: fakeGenerate() });

    expect(result).toMatchObject({ ok: false, reason: "no_provider" });
  });

  it("si el modelo devuelve cualquier cosa, el run queda en error", async () => {
    const db = seed();

    const result = await runCopywriter(
      db.client,
      { agentId: AGENT_A, postId: POST_A },
      { generate: fakeGenerate({ cualquier: "cosa" }) },
    );

    expect(result).toMatchObject({ ok: false, reason: "invalid_output" });
    expect(db.rows("agent_runs")[0].status).toBe("error");
  });

  it("un agente que no es copywriter no escribe", async () => {
    const db = seed();
    db.rows("agents")[0].type = "chat";

    expect(
      await runCopywriter(db.client, { agentId: AGENT_A, postId: POST_A }, { generate: fakeGenerate() }),
    ).toMatchObject({ ok: false, reason: "no_agent" });
  });
});
