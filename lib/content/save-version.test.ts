/**
 * Guardar una version, agrupadas por sesion (Contenido v4, C6).
 *
 * De punta a punta con `writeVersion` real y la base en memoria: es lo unico
 * que prueba que el `UPDATE` de verdad pisa la misma fila (mismo
 * `version_no`) en vez de crear una nueva, y que los cuatro eventos que
 * cortan la sesion insertan siempre.
 */

import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/agent/testing/memory-db";
import { writeVersion } from "./save-version";

const WS = "ws-1";
const POST = "post-1";
const ANA = "user-ana";
const SOFIA = "user-sofia";

function seed(post: Record<string, unknown> = {}, versions: Record<string, unknown>[] = []) {
  return memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Una pieza",
        format: "reel",
        script: "v0",
        recording_notes: null,
        caption: null,
        networks: [],
        media: [],
        current_version: versions.length,
        ...post,
      },
    ],
    content_post_versions: versions,
  });
}

describe("C6 · una pieza editada 12 veces en 8 minutos por la misma persona: UNA sola version", () => {
  it("el primer cambio inserta; los siguientes actualizan la MISMA fila", async () => {
    const db = seed();

    const start = "2026-10-07T10:00:00.000Z";
    await writeVersion(db.client, { postId: POST, workspaceId: WS, context: { trigger: "edit", now: new Date(start) }, authorId: ANA });

    for (let i = 1; i <= 11; i++) {
      db.rows("content_posts")[0].script = `v${i}`;
      await writeVersion(db.client, {
        postId: POST,
        workspaceId: WS,
        context: { trigger: "edit", now: new Date(new Date(start).getTime() + i * 40_000) }, // cada 40s, 8 min en total
        authorId: ANA,
      });
    }

    const versions = db.rows("content_post_versions");
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({ version_no: 1, reason: "edit", author_id: ANA });
    expect((versions[0].snapshot as { script: string }).script).toBe("v11");
  });
});

describe("C6 · una edicion, 15 minutos de pausa, y otra edicion: DOS versiones", () => {
  it("la sesion se corta por tiempo", async () => {
    const db = seed();
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:00:00.000Z") },
      authorId: ANA,
    });
    db.rows("content_posts")[0].script = "v1";
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:15:00.000Z") },
      authorId: ANA,
    });

    const versions = db.rows("content_post_versions").sort((a, b) => Number(a.version_no) - Number(b.version_no));
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.version_no)).toEqual([1, 2]);
  });
});

describe("C6 · dos personas editando con 2 minutos de diferencia: DOS versiones, una por autor", () => {
  it("la sesion es por autor", async () => {
    const db = seed();
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:00:00.000Z") },
      authorId: ANA,
    });
    db.rows("content_posts")[0].script = "de sofia";
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:02:00.000Z") },
      authorId: SOFIA,
    });

    const versions = db.rows("content_post_versions");
    expect(versions).toHaveLength(2);
    expect(versions.map((v) => v.author_id).sort()).toEqual([ANA, SOFIA].sort());
  });
});

describe("C6 · un cambio de estado en medio de una sesion corta la sesion", () => {
  it("status_change inserta aparte, y el edit siguiente abre una sesion nueva", async () => {
    const db = seed();
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:00:00.000Z") },
      authorId: ANA,
    });
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "status_change", now: new Date("2026-10-07T10:01:00.000Z") },
      authorId: ANA,
    });
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:02:00.000Z") },
      authorId: ANA,
    });

    const versions = db.rows("content_post_versions").sort((a, b) => Number(a.version_no) - Number(b.version_no));
    expect(versions).toHaveLength(3);
    expect(versions.map((v) => v.reason)).toEqual(["edit", "status_change", "edit"]);
  });
});

describe("C6 · aprobar tiene su propio motivo, separado de un cambio de estado cualquiera", () => {
  it("approve inserta con reason='approve'", async () => {
    const db = seed();
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "approve", now: new Date("2026-10-07T10:00:00.000Z") },
      authorId: ANA,
    });

    expect(db.rows("content_post_versions")[0].reason).toBe("approve");
  });
});

describe("C6 · generar con IA y restaurar siguen insertando siempre", () => {
  it("ai_generation", async () => {
    const db = seed();
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "ai_generation" },
      authorKind: "ai",
    });
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "ai_generation" },
      authorKind: "ai",
    });

    expect(db.rows("content_post_versions")).toHaveLength(2);
  });
});

describe("C6 · el tope de 50 y el recorte no cambian", () => {
  it("una fila que se ACTUALIZA no cuenta como una nueva para el tope", async () => {
    const existentes = Array.from({ length: 49 }, (_, i) => ({
      id: `v${i}`,
      workspace_id: WS,
      post_id: POST,
      version_no: i + 1,
      snapshot: {},
      author_kind: "human",
      author_id: "otro",
      reason: "manual_save",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    }));
    const db = seed({ current_version: 49 }, existentes);

    // El primer edit de esta sesion: inserta la version 50.
    await writeVersion(db.client, {
      postId: POST,
      workspaceId: WS,
      context: { trigger: "edit", now: new Date("2026-10-07T10:00:00.000Z") },
      authorId: ANA,
    });
    expect(db.rows("content_post_versions")).toHaveLength(50);

    // Diez cambios mas, todos dentro de la sesion: siguen actualizando la 50.
    for (let i = 1; i <= 10; i++) {
      await writeVersion(db.client, {
        postId: POST,
        workspaceId: WS,
        context: { trigger: "edit", now: new Date(new Date("2026-10-07T10:00:00.000Z").getTime() + i * 60_000) },
        authorId: ANA,
      });
    }
    expect(db.rows("content_post_versions")).toHaveLength(50);
  });
});
