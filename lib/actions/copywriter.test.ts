/**
 * F94: "Regenerar" pide confirmacion cuando ya hay un guion escrito.
 *
 * Pisar el guion de alguien sin preguntar es la clase de cosa que hace que una
 * funcion util deje de usarse. Y el permiso, el estado y el tope se revisan
 * ANTES de encolar nada.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";

let db: MemoryDb;
let role = "admin";
let roleId: string | null = null;
const enqueueCopy = vi.fn(async (_db: unknown, _params: unknown) => ({ ok: true as const, agentId: "agent-1" }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: "user-1" },
    workspace: { id: WS },
    role,
    roleId,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/content/copy-queue", () => ({ enqueueCopy }));

const { requestCopy } = await import("./copywriter");

const seed = (post: Record<string, unknown> = {}) => {
  db = memoryDb({
    content_posts: [
      { id: POST, workspace_id: WS, status: "draft", script: null, copy_status: "idle", ...post },
    ],
    workspace_roles: [],
  });
};

beforeEach(() => {
  role = "admin";
  roleId = null;
  enqueueCopy.mockClear();
  seed();
});

describe("regenerar sobre un guion escrito (F94)", () => {
  it("CRITERIO: con un guion escrito a mano, pide confirmacion y NO encola", async () => {
    seed({ script: "Lo escribi yo, con cuidado" });

    const result = await requestCopy({ postId: POST });

    expect(result).toMatchObject({ ok: false, needsConfirmation: true });
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("el mensaje avisa que queda en el historial", async () => {
    seed({ script: "Lo escribi yo" });

    const result = await requestCopy({ postId: POST });

    expect(result.ok === false && result.error).toContain("historial");
  });

  it("confirmado, encola", async () => {
    seed({ script: "Lo escribi yo" });

    const result = await requestCopy({ postId: POST, confirmed: true });

    expect(result).toEqual({ ok: true, data: { queued: true } });
    expect(enqueueCopy).toHaveBeenCalledTimes(1);
  });

  it("sin guion no pregunta nada: no hay nada que pisar", async () => {
    const result = await requestCopy({ postId: POST });

    expect(result.ok).toBe(true);
    expect(enqueueCopy).toHaveBeenCalledTimes(1);
  });

  it("un guion en blanco tampoco cuenta como escrito", async () => {
    seed({ script: "   \n  " });

    expect((await requestCopy({ postId: POST })).ok).toBe(true);
  });

  it("las notas de grabacion solas no piden confirmacion: lo que se pisa es el guion", async () => {
    seed({ recording_notes: "Plano medio" });

    expect((await requestCopy({ postId: POST })).ok).toBe(true);
  });

  it("las indicaciones de la persona viajan a la cola", async () => {
    await requestCopy({ postId: POST, instructions: "mas corto, mas directo" });

    expect(enqueueCopy.mock.calls[0][1]).toMatchObject({ workspaceId: WS, postId: POST, instructions: "mas corto, mas directo" });
  });
});

describe("quien puede pedir copy y cuando", () => {
  it("sin el permiso content.ai no se encola, aunque haya confirmado", async () => {
    role = "member";

    const result = await requestCopy({ postId: POST, confirmed: true });

    expect(result.ok).toBe(false);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("un rol personalizado con content.ai SI puede", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({
      id: "rol-1",
      workspace_id: WS,
      system_role: null,
      permissions: { keys: ["content.view", "content.ai"], scopes: { leads: "all", conversations: "all" } },
    });

    expect((await requestCopy({ postId: POST })).ok).toBe(true);
  });

  it("si el copywriter ya esta escribiendo esa pieza, no se encola otra vez", async () => {
    seed({ copy_status: "generating" });

    const result = await requestCopy({ postId: POST });

    expect(result.ok).toBe(false);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("una pieza ya publicada no se reescribe desde aca", async () => {
    seed({ status: "published" });

    expect((await requestCopy({ postId: POST })).ok).toBe(false);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });

  it("una pieza de otro workspace no existe para quien pide", async () => {
    seed({ workspace_id: "otro-ws" });

    expect((await requestCopy({ postId: POST })).ok).toBe(false);
    expect(enqueueCopy).not.toHaveBeenCalled();
  });
});
