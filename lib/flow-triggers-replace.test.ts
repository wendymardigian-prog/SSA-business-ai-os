import { describe, expect, it, vi } from "vitest";
import { lowerFirst, replaceFlowTriggers } from "./flow-triggers-replace";
import type { DesiredTrigger } from "./flow-triggers";

type Fail = { read?: boolean; delete?: boolean; insertNew?: boolean; restore?: boolean };

/** Un cliente con los tres pasos sobre `triggers`; cada uno puede fallar. */
function fakeDb(fail: Fail = {}) {
  const previous = [{ id: "tr-viejo", flow_id: "f1", workspace_id: "w1", type: "form_submitted", is_active: true }];
  const inserts: unknown[][] = [];
  const err = (on?: boolean) => (on ? { message: "falló" } : null);
  const db = {
    from: () => ({
      select: () => ({ eq: async () => ({ data: fail.read ? null : previous, error: err(fail.read) }) }),
      delete: () => ({ eq: async () => ({ error: err(fail.delete) }) }),
      insert: async (rows: unknown[]) => {
        inserts.push(rows);
        const isRestore = inserts.length === 2;
        return { error: err(isRestore ? fail.restore : fail.insertNew) };
      },
    }),
  };
  return { db: db as never, inserts };
}

const desired = [{ flow_id: "f1", type: "form_submitted", config: {}, priority: 0 }] as unknown as DesiredTrigger[];
const input = { flowId: "f1", workspaceId: "w1", desired, isActive: true };

describe("replaceFlowTriggers", () => {
  it("borra e inserta los nuevos", async () => {
    const { db, inserts } = fakeDb();
    await expect(replaceFlowTriggers(db, input)).resolves.toEqual({ ok: true });
    expect(inserts).toHaveLength(1);
    expect(inserts[0][0]).toMatchObject({ workspace_id: "w1", is_active: true, type: "form_submitted" });
  });

  it("si el borrado falla, no inserta nada y devuelve el error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, inserts } = fakeDb({ delete: true });
    const res = await replaceFlowTriggers(db, input);
    expect(res.ok).toBe(false);
    expect(inserts).toHaveLength(0);
  });

  it("si el insert falla despues de borrar, deja los de antes y lo dice", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db, inserts } = fakeDb({ insertNew: true });
    const res = await replaceFlowTriggers(db, input);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("quedó el que tenía antes") });
    expect(inserts[1]).toEqual([expect.objectContaining({ id: "tr-viejo" })]);
  });

  it("si tampoco se pueden dejar los de antes, avisa que quedó sin disparador", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { db } = fakeDb({ insertNew: true, restore: true });
    const res = await replaceFlowTriggers(db, input);
    expect(res).toEqual({ ok: false, error: expect.stringContaining("quedó sin disparador") });
  });

  it("lowerFirst", () => {
    expect(lowerFirst("No pude")).toBe("no pude");
  });
});
