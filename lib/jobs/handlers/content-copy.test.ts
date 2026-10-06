/**
 * F94: el job del copywriter cuando el modelo no cumple el esquema.
 *
 * "CUANDO la salida no cumple el esquema nuevo, NO DEBE guardarse nada y el
 * job DEBE fallar con aviso." Lo que valida el esquema es `validateCopyOutput`
 * (ai-copy.test.ts) y lo que lo convierte en `invalid_output` es el agente
 * (agent/copywriter.test.ts); aca esta lo que hace el JOB con ese resultado.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";

let db: MemoryDb;
const notifyCopyFailed = vi.fn(async (_db: unknown, _params: unknown) => undefined);
const notifyCopyReady = vi.fn(async (_db: unknown, _params: unknown) => undefined);
const runCopywriter = vi.fn();

vi.mock("@/lib/agent/copywriter", () => ({ runCopywriter }));
vi.mock("@/lib/notifications/content", () => ({ notifyCopyFailed, notifyCopyReady }));

const { registerContentCopyHandler } = await import("./content-copy");
const { getJobHandler } = await import("@/lib/jobs/registry");
const { CONTENT_COPY_JOB } = await import("@/lib/content/jobs");

const run = () =>
  getJobHandler(CONTENT_COPY_JOB)!({
    supabase: db.client as never,
    job: { id: "job-1", type: CONTENT_COPY_JOB, attempts: 0, payload: { postId: POST, workspaceId: WS, agentId: "agent-1" } },
  });

beforeEach(() => {
  notifyCopyFailed.mockClear();
  notifyCopyReady.mockClear();
  runCopywriter.mockReset();
  registerContentCopyHandler();
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        script: "Mi guion a mano",
        recording_notes: "Mis notas",
        caption: "Mi caption",
        networks: [{ platform: "instagram", caption: null }],
        copy_source: "manual",
        copy_status: "generating",
        ai_unreviewed: false,
        current_version: 0,
      },
    ],
    content_post_versions: [],
  });
});

describe("el job cuando la salida no sirve (F94)", () => {
  beforeEach(() => {
    runCopywriter.mockResolvedValue({
      ok: false,
      reason: "invalid_output",
      error: "El guion no puede estar vacio",
    });
  });

  it("NO guarda nada: ni guion, ni notas, ni caption, ni version", async () => {
    await run();

    expect(db.rows("content_posts")[0]).toMatchObject({
      script: "Mi guion a mano",
      recording_notes: "Mis notas",
      caption: "Mi caption",
      copy_source: "manual",
      ai_unreviewed: false,
    });
    expect(db.rows("content_post_versions")).toHaveLength(0);
  });

  it("la pieza deja de decir 'escribiendo' y queda en failed", async () => {
    await run();

    expect(db.rows("content_posts")[0].copy_status).toBe("failed");
  });

  it("avisa a la persona, con el motivo", async () => {
    await run();

    expect(notifyCopyFailed).toHaveBeenCalledTimes(1);
    expect(notifyCopyFailed.mock.calls[0][1]).toMatchObject({
      workspaceId: WS,
      contentPostId: POST,
      reason: "El guion no puede estar vacio",
    });
    expect(notifyCopyReady).not.toHaveBeenCalled();
  });

  it("no lanza: reintentar solo volveria a gastar", async () => {
    await expect(run()).resolves.toBeUndefined();
  });
});

describe("el job cuando sale bien (F94)", () => {
  const output = {
    script: "Hook\n\nDesarrollo\n\nComenta SISTEMA",
    recording_notes: "Plano cerrado",
    caption_base: "Caption nuevo",
    captions: { instagram: "Para Instagram" },
    youtube_title: null,
  };

  beforeEach(() => {
    runCopywriter.mockResolvedValue({ ok: true, output, warnings: ["un aviso"], runId: null, costUsd: null });
  });

  it("sobre un guion escrito a mano, queda 'mixed' y sin revisar", async () => {
    await run();

    expect(db.rows("content_posts")[0]).toMatchObject({
      script: output.script,
      recording_notes: output.recording_notes,
      caption: "Caption nuevo",
      copy_source: "mixed",
      ai_unreviewed: true,
      copy_status: "idle",
    });
  });

  it("sobre una pieza vacia, queda 'ai'", async () => {
    db.rows("content_posts")[0].script = null;

    await run();

    expect(db.rows("content_posts")[0].copy_source).toBe("ai");
  });

  it("deja una version firmada por la IA y avisa con los advertencias", async () => {
    await run();

    expect(db.rows("content_post_versions")[0]).toMatchObject({ author_kind: "ai", reason: "ai_generation" });
    expect(notifyCopyReady.mock.calls[0][1]).toMatchObject({ warnings: ["un aviso"] });
  });

  it("un titulo de YouTube solo se escribe en la red de YouTube", async () => {
    db.rows("content_posts")[0].networks = [{ platform: "instagram" }, { platform: "youtube" }];
    runCopywriter.mockResolvedValue({ ok: true, output: { ...output, youtube_title: "Un titulo" }, warnings: [], runId: null, costUsd: null });

    await run();

    const networks = db.rows("content_posts")[0].networks as Array<{ platform: string; youtube_title?: string }>;
    expect(networks.find((n) => n.platform === "youtube")?.youtube_title).toBe("Un titulo");
    expect(networks.find((n) => n.platform === "instagram")?.youtube_title).toBeUndefined();
  });
});
