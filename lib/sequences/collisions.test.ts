import { describe, it, expect, vi, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { detectSequenceCollision, isLiveEnrollment, parseSnapshot } from "./collisions";

const WS = "11111111-1111-1111-1111-111111111111";

/**
 * Cliente falso que registra los filtros aplicados.
 *
 * Interesa tanto QUE devuelve como CON QUE se consulto: si el filtro por
 * workspace o por canal se cayera, la deteccion avisaria de secuencias de otro
 * negocio o de otro canal.
 */
function fakeClient(rows: unknown[], error: { message: string } | null = null) {
  const filters: Record<string, unknown> = {};
  const negated: Record<string, unknown> = {};

  const chain: Record<string, unknown> = {};
  Object.assign(chain, {
    select: () => chain,
    eq: (col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    },
    neq: (col: string, value: unknown) => {
      negated[col] = value;
      return chain;
    },
    in: (col: string, value: unknown) => {
      filters[col] = value;
      return chain;
    },
    then: (resolve: (r: unknown) => unknown) => resolve({ data: rows, error }),
  });

  const client = { from: () => chain } as unknown as SupabaseClient<Database>;
  return { client, filters, negated };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "enr-otra",
    sequence_id: "seq-2",
    status: "active",
    paused_reason: null,
    enrolled_at: "2026-09-01T10:00:00Z",
    sequences: { workspace_id: WS, name: "Bienvenida" },
    ...overrides,
  };
}

afterEach(() => vi.restoreAllMocks());

describe("isLiveEnrollment", () => {
  it("una activa colisiona", () => {
    expect(isLiveEnrollment({ status: "active" })).toBe(true);
  });

  it("una pausada porque el contacto respondio colisiona: va a arrancar de nuevo", () => {
    expect(isLiveEnrollment({ status: "paused", paused_reason: "contact_replied" })).toBe(true);
  });

  it("una pausada por opt-out NO colisiona: esa no se reanuda nunca", () => {
    expect(isLiveEnrollment({ status: "paused", paused_reason: "opt_out" })).toBe(false);
  });

  it("las terminadas no colisionan", () => {
    expect(isLiveEnrollment({ status: "completed" })).toBe(false);
    expect(isLiveEnrollment({ status: "cancelled" })).toBe(false);
  });
});

describe("detectSequenceCollision", () => {
  it("sin otras inscripciones vivas no hay colision", async () => {
    const { client } = fakeClient([]);
    const report = await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
    });
    expect(report).toEqual({ hasCollision: false, colliding: [], snapshot: [] });
  });

  it("filtra por contacto, canal y workspace: no avisa de otro negocio ni de otro canal", async () => {
    const { client, filters } = fakeClient([]);
    await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
    });
    expect(filters.contact_id).toBe("con-1");
    expect(filters.channel_id).toBe("chn-1");
    expect(filters["sequences.workspace_id"]).toBe(WS);
  });

  it("una secuencia no colisiona consigo misma", async () => {
    const { client, negated } = fakeClient([]);
    await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
      excludeSequenceId: "seq-1",
    });
    expect(negated.sequence_id).toBe("seq-1");
  });

  it("el snapshot guarda el nombre, para que el aviso siga siendo legible despues", async () => {
    const { client } = fakeClient([row()]);
    const report = await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
    });

    expect(report.hasCollision).toBe(true);
    expect(report.snapshot).toEqual([
      { enrollment_id: "enr-otra", sequence_id: "seq-2", sequence_name: "Bienvenida" },
    ]);
  });

  it("descarta las que la base trajo pero no cuentan como vivas", async () => {
    const { client } = fakeClient([row({ status: "paused", paused_reason: "opt_out" })]);
    const report = await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
    });
    expect(report.hasCollision).toBe(false);
  });

  it("si la consulta falla no bloquea la inscripcion: es un aviso, no una precondicion", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient([], { message: "boom" });
    const report = await detectSequenceCollision(client, {
      workspaceId: WS,
      contactId: "con-1",
      channelId: "chn-1",
    });
    expect(report.hasCollision).toBe(false);
  });
});

describe("parseSnapshot", () => {
  it("tolera un jsonb con cualquier otra cosa adentro", () => {
    expect(parseSnapshot(null)).toEqual([]);
    expect(parseSnapshot("texto")).toEqual([]);
    expect(parseSnapshot([{ nada: 1 }])).toEqual([]);
  });

  it("conserva las entradas bien formadas", () => {
    const entry = { enrollment_id: "e-1", sequence_id: "s-1", sequence_name: "X" };
    expect(parseSnapshot([entry, { roto: true }])).toEqual([entry]);
  });
});
