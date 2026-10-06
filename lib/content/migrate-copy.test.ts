/**
 * F90: del `copy` de cuatro campos al guion unico.
 *
 * Dos garantias que el plano pide por escrito:
 *
 *  1. DADA una idea con hook y angulo, DESPUES de migrar `content` contiene los
 *     dos textos y no se pierde nada.
 *  2. CUANDO el codigo nuevo guarda una pieza, `copy` NO se modifica.
 *
 * La primera tiene dos mitades que no se pueden separar: el SQL de la 00117 (lo
 * que corre en la base) y `lib/content/legacy.ts` (lo que lee una version
 * vieja del historial). Si se desincronizan, comparar una version vieja contra
 * la pieza ya migrada inventaria cambios que nunca existieron.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import {
  ideaContentFromLegacy,
  joinText,
  recordingNotesFromLegacyCopy,
  scriptFromLegacyCopy,
} from "./legacy";
import { compareVersions, normalizeSnapshot, type LegacyPostSnapshot, type PostSnapshot } from "./versions";

const WS = "ws-1";
const USER = "user-1";

let db: MemoryDb;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Costa_Rica" },
    role: "admin",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/content/copy-queue", () => ({ enqueueCopy: vi.fn(async () => ({ ok: true as const })) }));

const { savePostDraft, duplicatePostAsVariant, approveIdea } = await import("@/lib/actions/content");
const { restoreVersion } = await import("@/lib/actions/content-versions");

const LEGACY_COPY = { hook: "El hook", body: "El desarrollo", cta: "Comenta SISTEMA", recording_notes: "Plano medio" };

describe("el texto de una idea o pieza vieja, sin perder nada (F90)", () => {
  it("una idea con hook y angulo: content tiene los dos", () => {
    const content = ideaContentFromLegacy({ hook: "Si te da verguenza el precio", angle: "Desde la objecion", notes: null });

    expect(content).toContain("Si te da verguenza el precio");
    expect(content).toContain("Desde la objecion");
  });

  it("va en el orden hook, angulo, notas, separados por una linea en blanco", () => {
    expect(ideaContentFromLegacy({ hook: "H", angle: "A", notes: "N" })).toBe("H\n\nA\n\nN");
  });

  it("saltea lo vacio y recorta, en vez de dejar huecos", () => {
    expect(ideaContentFromLegacy({ hook: "  H  ", angle: "   ", notes: "N" })).toBe("H\n\nN");
    expect(ideaContentFromLegacy({ hook: null, angle: "", notes: undefined })).toBeNull();
  });

  it("el guion de una pieza vieja es hook, desarrollo y cierre; las notas van aparte", () => {
    expect(scriptFromLegacyCopy(LEGACY_COPY)).toBe("El hook\n\nEl desarrollo\n\nComenta SISTEMA");
    expect(recordingNotesFromLegacyCopy(LEGACY_COPY)).toBe("Plano medio");
  });

  it("un copy vacio, nulo o raro no rompe", () => {
    expect(scriptFromLegacyCopy({})).toBeNull();
    expect(scriptFromLegacyCopy(null)).toBeNull();
    expect(scriptFromLegacyCopy("no es un objeto")).toBeNull();
    expect(recordingNotesFromLegacyCopy(undefined)).toBeNull();
    expect(joinText([])).toBeNull();
  });
});

describe("la 00117 hace lo mismo que legacy.ts (no se pueden separar)", () => {
  const sql = readFileSync("supabase/migrations/00117_content_single_text.sql", "utf8");

  it("junta hook, angulo y notas en ESE orden", () => {
    const orden = [...sql.matchAll(/nullif\(btrim\((hook|angle|notes)\), ''\)/g)].map((m) => m[1]);
    expect(orden.slice(0, 3)).toEqual(["hook", "angle", "notes"]);
  });

  it("junta hook, desarrollo y cierre del copy en ESE orden, y las notas aparte", () => {
    const orden = [...sql.matchAll(/copy ->> '(hook|body|cta|recording_notes)'/g)].map((m) => m[1]);
    expect(orden.slice(0, 4)).toEqual(["hook", "body", "cta", "recording_notes"]);
    expect(sql).toMatch(/E'\\n\\n'/);
  });

  it("solo escribe donde la columna nueva esta vacia: nunca pisa lo ya escrito", () => {
    expect(sql).toMatch(/WHERE content IS NULL/);
    expect(sql).toMatch(/WHERE script IS NULL\s+AND recording_notes IS NULL/);
  });

  it("no toca las columnas viejas: no hay un solo UPDATE que las escriba", () => {
    expect(sql).not.toMatch(/SET\s+(hook|angle|notes|pillar|copy)\b/i);
    expect(sql).not.toMatch(/DROP COLUMN/i);
  });
});

describe("las versiones viejas se siguen pudiendo leer (F90)", () => {
  const vieja: LegacyPostSnapshot = {
    title: "Una pieza",
    format: "Reel",
    copy: LEGACY_COPY,
    caption: "Un caption",
    networks: [],
    media: [],
  };

  it("se normaliza al guion unico", () => {
    expect(normalizeSnapshot(vieja)).toEqual({
      title: "Una pieza",
      format: "Reel",
      script: "El hook\n\nEl desarrollo\n\nComenta SISTEMA",
      recording_notes: "Plano medio",
      caption: "Un caption",
      networks: [],
      media: [],
    });
  });

  it("una version nueva queda como esta", () => {
    const nueva: PostSnapshot = { ...normalizeSnapshot(vieja), script: "Otro guion" };
    expect(normalizeSnapshot(nueva).script).toBe("Otro guion");
  });

  it("una vieja contra la pieza ya migrada NO inventa cambios", () => {
    // La pieza migrada tiene el script que armo la 00117.
    const migrada: PostSnapshot = {
      title: "Una pieza",
      format: "Reel",
      script: "El hook\n\nEl desarrollo\n\nComenta SISTEMA",
      recording_notes: "Plano medio",
      caption: "Un caption",
      networks: [],
      media: [],
    };

    expect(compareVersions(vieja, migrada)).toEqual([]);
  });

  it("y si el guion cambio, lo dice como 'Guion', no como cuatro campos", () => {
    const editada: PostSnapshot = { ...normalizeSnapshot(vieja), script: "Reescrito" };

    expect(compareVersions(vieja, editada).map((d) => d.field)).toEqual(["script"]);
  });
});

describe("el codigo nuevo no escribe `copy` (F90)", () => {
  beforeEach(() => {
    db = memoryDb(
      {
        content_posts: [
          {
            id: "post-1",
            workspace_id: WS,
            idea_id: "idea-1",
            title: "Una pieza",
            format: "Reel",
            status: "draft",
            copy: { hook: "VIEJO", body: "VIEJO", cta: "VIEJO", recording_notes: "VIEJO" },
            script: "Guion actual",
            recording_notes: "Notas actuales",
            caption: "Caption",
            networks: [],
            media: [],
            current_version: 1,
            updated_at: "2026-10-01T00:00:00Z",
            created_by: USER,
          },
        ],
        content_ideas: [{ id: "idea-1", workspace_id: WS, title: "Una idea", status: "nueva", format: "Reel" }],
        content_post_versions: [
          { id: "v-vieja", workspace_id: WS, post_id: "post-1", version_no: 1, snapshot: {
            title: "Titulo de ayer", format: "Reel", copy: LEGACY_COPY, caption: "Caption de ayer", networks: [], media: [],
          } },
        ],
        social_posts: [],
        workspace_roles: [],
        agents: [],
      },
      { rpc: { approve_content_idea_v2: () => "post-nuevo" } },
    );
  });

  const copyIntacto = () =>
    expect(db.rows("content_posts")[0].copy).toEqual({
      hook: "VIEJO", body: "VIEJO", cta: "VIEJO", recording_notes: "VIEJO",
    });

  it("guardar el borrador escribe script y notas, y deja copy como estaba", async () => {
    const result = await savePostDraft({
      postId: "post-1",
      script: "Guion nuevo",
      recording_notes: "Notas nuevas",
    });

    expect(result.ok).toBe(true);
    expect(db.rows("content_posts")[0]).toMatchObject({ script: "Guion nuevo", recording_notes: "Notas nuevas" });
    copyIntacto();
  });

  it("editar el guion marca el texto como revisado", async () => {
    db.rows("content_posts")[0].ai_unreviewed = true;

    await savePostDraft({ postId: "post-1", script: "Lo reescribi yo" });

    expect(db.rows("content_posts")[0].ai_unreviewed).toBe(false);
  });

  it("restaurar una version VIEJA escribe el guion armado y no toca copy", async () => {
    const result = await restoreVersion({ postId: "post-1", versionId: "v-vieja" });

    expect(result.ok).toBe(true);
    expect(db.rows("content_posts")[0]).toMatchObject({
      title: "Titulo de ayer",
      script: "El hook\n\nEl desarrollo\n\nComenta SISTEMA",
      recording_notes: "Plano medio",
    });
    copyIntacto();
  });

  it("restaurar deja primero una version con lo de AHORA (nada se pierde)", async () => {
    await restoreVersion({ postId: "post-1", versionId: "v-vieja" });

    const guardada = db.rows("content_post_versions").find((v) => v.reason === "restore");
    expect(guardada).toBeTruthy();
    expect((guardada!.snapshot as PostSnapshot).script).toBe("Guion actual");
    // Y la version que se guarda ahora ya es de la forma nueva.
    expect(guardada!.snapshot).not.toHaveProperty("copy");
  });

  it("duplicar como variante copia script y notas, y la nueva NO lleva copy", async () => {
    const result = await duplicatePostAsVariant({ postId: "post-1" });

    expect(result.ok).toBe(true);
    const variante = db.rows("content_posts").find((p) => p.id !== "post-1")!;
    expect(variante).toMatchObject({ script: "Guion actual", recording_notes: "Notas actuales" });
    expect(variante).not.toHaveProperty("copy");
    copyIntacto();
  });

  it("aprobar una idea llama a la v2, que no recibe copy", async () => {
    const result = await approveIdea("idea-1");

    expect(result.ok).toBe(true);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0].name).toBe("approve_content_idea_v2");
    expect(Object.keys(db.rpcCalls[0].args as object).sort()).toEqual(["p_format", "p_idea_id", "p_title"]);
  });
});

describe("el job del copywriter escribe el guion, no copy (F90)", () => {
  it("guarda script y recording_notes y no toca copy", async () => {
    vi.resetModules();
    const output = {
      script: "Hook\n\nDesarrollo\n\nComenta SISTEMA",
      recording_notes: "Plano cerrado",
      caption_base: "Caption base",
      captions: { instagram: "Para Instagram" },
      youtube_title: null,
    };
    vi.doMock("@/lib/agent/copywriter", () => ({
      runCopywriter: async () => ({ ok: true, output, warnings: [], runId: null, costUsd: null }),
    }));
    vi.doMock("@/lib/notifications/content", () => ({
      notifyCopyReady: async () => undefined,
      notifyCopyFailed: async () => undefined,
    }));

    const { registerContentCopyHandler } = await import("@/lib/jobs/handlers/content-copy");
    const { getJobHandler } = await import("@/lib/jobs/registry");
    const { CONTENT_COPY_JOB } = await import("@/lib/content/jobs");
    registerContentCopyHandler();

    db = memoryDb({
      content_posts: [
        {
          id: "post-1",
          workspace_id: WS,
          title: "Una pieza",
          copy: { hook: "VIEJO", body: "VIEJO", cta: "VIEJO", recording_notes: "VIEJO" },
          script: null,
          recording_notes: null,
          caption: null,
          networks: [{ platform: "instagram" }],
          copy_source: "manual",
          copy_status: "generating",
          current_version: 0,
        },
      ],
      content_post_versions: [],
    });

    await getJobHandler(CONTENT_COPY_JOB)!({
      supabase: db.client as never,
      job: { id: "job-1", type: CONTENT_COPY_JOB, attempts: 0, payload: { postId: "post-1", workspaceId: WS, agentId: "agent-1" } },
    });

    const post = db.rows("content_posts")[0];
    expect(post).toMatchObject({
      script: "Hook\n\nDesarrollo\n\nComenta SISTEMA",
      recording_notes: "Plano cerrado",
      caption: "Caption base",
      copy_status: "idle",
      ai_unreviewed: true,
      copy_source: "ai",
    });
    expect(post.copy).toEqual({ hook: "VIEJO", body: "VIEJO", cta: "VIEJO", recording_notes: "VIEJO" });

    // La version firmada por la IA ya es de la forma nueva.
    const version = db.rows("content_post_versions")[0];
    expect(version.author_kind).toBe("ai");
    expect(version.snapshot).toMatchObject({ script: "Hook\n\nDesarrollo\n\nComenta SISTEMA" });
    expect(version.snapshot).not.toHaveProperty("copy");
  });
});
