/**
 * El nodo «Calificar lead»: lee el nivel actual, evalúa las reglas con el mismo
 * evaluador que «Condiciones» y pide UN cambio a `set_contact_qualification`
 * (por el núcleo, que acá se espía). Nunca lanza.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FieldValue } from "../condition-eval";
import type { QualifyLeadStepData } from "../qualify-lead";

const apply = vi.fn();
vi.mock("@/lib/contacts/qualification-core", () => ({ applyContactQualification: (...args: unknown[]) => apply(...args) }));

let answers: Record<string, FieldValue> = {};
vi.mock("./branch", () => ({
  resolveBranchFields: async () => (field: string) => answers[field],
}));

const { qualifyLeadNode } = await import("./qualify-lead");

function fakeSupabase(level: number | null, opts: { error?: boolean; missing?: boolean } = {}) {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () =>
      opts.error ? { data: null, error: { message: "boom" } } : { data: opts.missing ? null : { qualification_level: level }, error: null },
  };
  return { from: () => chain } as never;
}

async function run(data: Partial<QualifyLeadStepData>, level: number | null, opts: { error?: boolean; missing?: boolean } = {}) {
  const notes: Array<{ status: string; reason?: unknown }> = [];
  await qualifyLeadNode.execute({
    supabase: fakeSupabase(level, opts),
    node: { id: "n1", type: "action", data: data as never, position: { x: 0, y: 0 } },
    data: { actionType: "qualify_lead", ...data } as QualifyLeadStepData,
    context: {
      workspaceId: "ws-1",
      contactId: "c-1",
      flowId: "f-1",
      variables: {},
      noteStep: (n: { status: string; reason?: unknown }) => notes.push(n),
    } as never,
    sessionId: "s-1",
  } as never);
  return notes;
}

beforeEach(() => {
  apply.mockReset();
  apply.mockResolvedValue({ kind: "changed", oldLevel: null, newLevel: 3, changeId: "ch-1" });
  answers = {};
});

describe("«Calificar lead»", () => {
  it("sumar 1: pide `add` con el origen automatización y el flujo", async () => {
    const notes = await run({ mode: "add", points: 1 }, 2);
    expect(apply).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ workspaceId: "ws-1", contactId: "c-1", mode: "add", value: 1, source: "automation", flowId: "f-1" }),
    );
    expect(notes).toEqual([]);
  });

  it("según reglas: suma las que se cumplen y deja su nombre como motivo", async () => {
    answers = { "answer.presupuesto": 8000, "answer.rol": "Dueño" };
    await run(
      {
        mode: "rules",
        base: "current",
        rules: [
          { id: "a", label: "Presupuesto", points: 2, logic: "and", conditions: [{ field: "answer.presupuesto", operator: "gt", value: "5000", valueType: "number" }] },
          { id: "b", label: "Decide", points: 1, logic: "and", conditions: [{ field: "answer.rol", operator: "is", value: "Dueño", valueType: "single_select" }] },
          { id: "c", label: "Sin urgencia", points: -1, logic: "and", conditions: [{ field: "answer.urgencia", operator: "is", value: "No", valueType: "single_select" }] },
        ],
      },
      1,
    );
    expect(apply).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mode: "add", value: 3, reason: "Presupuesto (+2), Decide (+1)" }));
  });

  it("si ninguna regla se cumple, no cambia nada y lo anota", async () => {
    const notes = await run(
      { mode: "rules", base: "current", rules: [{ id: "a", points: 1, logic: "and", conditions: [{ field: "answer.x", operator: "is", value: "si", valueType: "text" }] }] },
      2,
    );
    expect(apply).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "skipped", reason: "No se cumplió ninguna regla." }]);
  });

  it("un paso mal armado se saltea sin tocar la base", async () => {
    const notes = await run({ mode: "set", level: 9 }, 2);
    expect(apply).not.toHaveBeenCalled();
    expect(notes[0]).toMatchObject({ status: "skipped" });
  });

  it("si la base no deja leer el contacto, falla sin lanzar", async () => {
    const notes = await run({ mode: "add", points: 1 }, null, { error: true });
    expect(apply).not.toHaveBeenCalled();
    expect(notes).toEqual([{ status: "failed", reason: "No pude leer el contacto." }]);
  });

  it("un rechazo de la base queda como fallo; el mismo nivel, como salteado", async () => {
    apply.mockResolvedValueOnce({ kind: "error", oldLevel: null, message: "No pude guardar la calificación" });
    expect(await run({ mode: "set", level: 3 }, 2)).toEqual([{ status: "failed", reason: "No pude guardar la calificación" }]);
    apply.mockResolvedValueOnce({ kind: "unchanged", oldLevel: 3, newLevel: 3, changeId: null });
    expect((await run({ mode: "set", level: 3 }, 3))[0]).toMatchObject({ status: "skipped" });
  });

  it("nunca lanza aunque el núcleo explote", async () => {
    apply.mockRejectedValueOnce(new Error("red"));
    expect(await run({ mode: "add", points: 1 }, 1)).toEqual([{ status: "failed", reason: "No pude cambiar la calificación." }]);
  });
});
