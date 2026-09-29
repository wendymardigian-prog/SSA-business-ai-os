import { describe, expect, it } from "vitest";
import { draftsQueueHref, emptyQueueHint, otherPeopleDrafts } from "./destination";

describe("draftsQueueHref", () => {
  it("abre en la vista por defecto cuando la persona tiene borradores propios", () => {
    expect(draftsQueueHref({ mine: 3, unassigned: 0, total: 9 })).toBe("/dashboard/drafts");
  });

  it("abre en 'todos' cuando no tiene propios pero hay otros (el caso del Owner)", () => {
    expect(draftsQueueHref({ mine: 0, unassigned: 1, total: 1 })).toBe("/dashboard/drafts?quien=todos");
  });

  it("no agrega filtro para un Member: no conoce el total", () => {
    expect(draftsQueueHref({ mine: 0, unassigned: null, total: null })).toBe("/dashboard/drafts");
  });

  it("no agrega filtro cuando no hay ninguno en el workspace", () => {
    expect(draftsQueueHref({ mine: 0, unassigned: 0, total: 0 })).toBe("/dashboard/drafts");
  });

  it("sin datos todavia, la ruta pelada", () => {
    expect(draftsQueueHref(undefined)).toBe("/dashboard/drafts");
  });
});

describe("otherPeopleDrafts", () => {
  it("resta los propios del total", () => {
    expect(otherPeopleDrafts({ mine: 2, unassigned: 0, total: 5 })).toBe(3);
  });

  it("nunca es negativo si el total llega atrasado", () => {
    expect(otherPeopleDrafts({ mine: 4, unassigned: 0, total: 2 })).toBe(0);
  });

  it("es 0 cuando no se conoce el total", () => {
    expect(otherPeopleDrafts({ mine: 0, unassigned: null, total: null })).toBe(0);
  });
});

describe("emptyQueueHint", () => {
  it("sin otros, explica que va a aparecer solo", () => {
    const hint = emptyQueueHint({ mine: 0, unassigned: null, total: null });
    expect(hint.action).toBeNull();
    expect(hint.text).toContain("aparece acá sola");
  });

  it("con otros, dice cuantos y ofrece verlos", () => {
    const hint = emptyQueueHint({ mine: 0, unassigned: 2, total: 4 });
    expect(hint.text).toContain("Hay 4 de otras personas");
    expect(hint.action).toEqual({ label: "Ver todos (4)", quien: "todos" });
  });

  it("con uno solo, habla en singular", () => {
    const hint = emptyQueueHint({ mine: 0, unassigned: 1, total: 1 });
    expect(hint.text).toContain("Hay 1 de otra persona");
    expect(hint.action?.label).toBe("Ver todos (1)");
  });
});
