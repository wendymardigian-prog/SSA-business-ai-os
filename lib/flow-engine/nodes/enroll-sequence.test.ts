import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import type { FlowExecutionContext } from "../types";

vi.mock("@/lib/sequences/collisions", () => ({ detectSequenceCollision: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/notifications/create", () => ({
  createNotification: vi.fn().mockResolvedValue(true),
}));

import { detectSequenceCollision } from "@/lib/sequences/collisions";
import { logAudit } from "@/lib/audit";
import { createNotification } from "@/lib/notifications/create";
import { enrollSequenceNode } from "./enroll-sequence";

const WS = "11111111-1111-1111-1111-111111111111";

const context = {
  workspaceId: WS,
  contactId: "con-1",
  channelId: "chn-1",
  flowId: "flow-1",
  conversationId: "conv-1",
} as unknown as FlowExecutionContext;

interface World {
  sequence: Record<string, unknown> | null;
  contact: Record<string, unknown> | null;
  insertError: { code?: string; message?: string } | null;
}

function fakeClient(world: Partial<World> = {}) {
  const w: World = {
    sequence:
      world.sequence !== undefined
        ? world.sequence
        : { id: "seq-1", name: "Bienvenida", status: "active", steps: [{ type: "message", content: "hola" }] },
    contact: world.contact !== undefined ? world.contact : { do_not_contact: false },
    insertError: world.insertError ?? null,
  };

  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  const filters: Record<string, unknown> = {};

  function table(name: string) {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: () => chain,
      eq: (col: string, value: unknown) => {
        filters[`${name}.${col}`] = value;
        return chain;
      },
      maybeSingle: async () => ({
        data: name === "sequences" ? w.sequence : w.contact,
        error: null,
      }),
      single: async () => ({
        data: w.insertError ? null : { id: "enr-nueva" },
        error: w.insertError,
      }),
    });

    return {
      select: () => chain,
      insert: (row: Record<string, unknown>) => {
        inserted.push({ table: name, row });
        return {
          select: () => ({ single: chain.single }),
          then: (resolve: (r: unknown) => unknown) => resolve({ error: null }),
        };
      },
    };
  }

  return {
    client: { from: (name: string) => table(name) } as unknown as SupabaseClient<Database>,
    inserted,
    filters,
  };
}

function run(client: SupabaseClient<Database>, sequenceId = "seq-1") {
  return enrollSequenceNode.execute({
    supabase: client,
    node: { id: "n-1" } as never,
    data: { sequenceId },
    context,
    sessionId: "sess-1",
    runtime: { executeFlow: vi.fn() },
  });
}

const NO_COLLISION = { hasCollision: false, colliding: [], snapshot: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(detectSequenceCollision).mockResolvedValue(NO_COLLISION);
});
afterEach(() => vi.restoreAllMocks());

describe("nodo Enroll in Sequence (F15)", () => {
  it("inscribe y deja la constancia en el audit log", async () => {
    const { client, inserted } = fakeClient();

    await run(client);

    expect(inserted[0].table).toBe("sequence_enrollments");
    expect(inserted[0].row).toMatchObject({
      sequence_id: "seq-1",
      contact_id: "con-1",
      channel_id: "chn-1",
      collision_detected_at: null,
    });
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "enroll", entityType: "sequence_enrollment" })
    );
  });

  it("filtra la secuencia por workspace: no inscribe con un id de otro negocio", async () => {
    const { client, filters } = fakeClient();
    await run(client);
    expect(filters["sequences.workspace_id"]).toBe(WS);
  });

  it("con colision inscribe IGUAL, pero la deja marcada para que un admin decida", async () => {
    const snapshot = [{ enrollment_id: "e-2", sequence_id: "seq-2", sequence_name: "Otra" }];
    vi.mocked(detectSequenceCollision).mockResolvedValue({
      hasCollision: true,
      colliding: [
        {
          id: "e-2",
          sequenceId: "seq-2",
          sequenceName: "Otra",
          status: "active",
          pausedReason: null,
          enrolledAt: "2026-09-01T10:00:00Z",
        },
      ],
      snapshot,
    });
    const { client, inserted } = fakeClient();

    await run(client);

    // Una automatizacion no puede frenarse a preguntarle a una persona.
    const enrollment = inserted.find((i) => i.table === "sequence_enrollments")!;
    expect(enrollment.row.collision_detected_at).toBeTruthy();
    expect(enrollment.row.collision_with).toEqual(snapshot);

    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "collision_detected" })
    );
    // El aviso al centro de notificaciones (F18). Hasta el Bloque 3 esto
    // escribia en analytics_events como sustituto; ahora va a la tabla real.
    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sequence_collision",
        entityType: "sequence_enrollment",
        // Sin recipientId: una colision es informacion de administracion y la
        // RLS no se la muestra a un Member.
        metadata: expect.objectContaining({ with: snapshot }),
      })
    );
    // Y el aviso nombra la otra secuencia, para que se entienda sin abrirlo.
    expect(String(vi.mocked(createNotification).mock.calls.at(-1)?.[0].body)).toContain("Otra");
  });

  it("no inscribe a un contacto marcado como no contactar", async () => {
    const { client, inserted } = fakeClient({ contact: { do_not_contact: true } });
    await run(client);
    expect(inserted).toHaveLength(0);
  });

  it("no inscribe si la secuencia no esta activa", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, inserted } = fakeClient({
      sequence: { id: "seq-1", name: "X", status: "paused", steps: [{ type: "message" }] },
    });
    await run(client);
    expect(inserted).toHaveLength(0);
  });

  it("no inscribe en una secuencia sin pasos", async () => {
    const { client, inserted } = fakeClient({
      sequence: { id: "seq-1", name: "X", status: "active", steps: [] },
    });
    await run(client);
    expect(inserted).toHaveLength(0);
  });

  it("que ya estuviera inscripto no es un error que valga la pena gritar", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient({ insertError: { code: "23505" } });

    await run(client);

    expect(spy).not.toHaveBeenCalled();
    expect(logAudit).not.toHaveBeenCalled();
  });

  it("sin secuencia configurada no hace nada y el flow sigue", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client, inserted } = fakeClient();
    await expect(run(client, "")).resolves.toBeUndefined();
    expect(inserted).toHaveLength(0);
  });
});
