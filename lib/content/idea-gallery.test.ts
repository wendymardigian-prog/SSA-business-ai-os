import { describe, expect, it } from "vitest";
import { canEditIdea, galleryPosition, nextAfterRemoval, stepAfter } from "./idea-gallery";

const IDS = ["a", "b", "c"];

describe("la galeria de ideas: donde estoy (F95)", () => {
  it("dice 'N de M' y los vecinos", () => {
    expect(galleryPosition(IDS, "b")).toEqual({ index: 1, total: 3, label: "2 de 3", prevId: "a", nextId: "c" });
  });

  it("la primera no tiene anterior y la ultima no tiene siguiente", () => {
    expect(galleryPosition(IDS, "a")).toMatchObject({ label: "1 de 3", prevId: null, nextId: "b" });
    expect(galleryPosition(IDS, "c")).toMatchObject({ label: "3 de 3", prevId: "b", nextId: null });
  });

  it("una sola idea: 1 de 1, sin flechas", () => {
    expect(galleryPosition(["a"], "a")).toEqual({ index: 0, total: 1, label: "1 de 1", prevId: null, nextId: null });
  });

  it("una idea que no esta en la lista no tiene posicion", () => {
    expect(galleryPosition(IDS, "z")).toBeNull();
    expect(galleryPosition([], "a")).toBeNull();
  });
});

describe("cual se abre despues de sacar una", () => {
  it("la que sigue", () => {
    expect(nextAfterRemoval(IDS, "a")).toBe("b");
    expect(nextAfterRemoval(IDS, "b")).toBe("c");
  });

  it("si era la ultima de la lista pero quedan otras, la anterior: el drawer no se cierra con ideas por revisar", () => {
    expect(nextAfterRemoval(IDS, "c")).toBe("b");
  });

  it("si era la unica, no queda ninguna", () => {
    expect(nextAfterRemoval(["a"], "a")).toBeNull();
  });

  it("una que no estaba no cambia nada: abre la primera", () => {
    expect(nextAfterRemoval(IDS, "z")).toBe("a");
    expect(nextAfterRemoval([], "z")).toBeNull();
  });
});

describe("que pasa despues de cada accion (F95)", () => {
  it("DESCARTAR abre la siguiente, sin cerrar, y deja su aviso", () => {
    expect(stepAfter("discard", IDS, "a", {})).toEqual({
      kind: "idea",
      id: "b",
      toast: { tone: "ok", text: "Idea descartada" },
    });
  });

  it("CRITERIO: al descartar la ultima que queda, el drawer se CIERRA con el aviso", () => {
    const step = stepAfter("discard", ["a"], "a", {});

    expect(step.kind).toBe("close");
    expect(step.toast.text).toContain("última idea");
    expect(step.toast.text).toContain("no quedan");
  });

  it("CRITERIO: APROBAR crea la pieza y abre la idea siguiente en la misma apertura", () => {
    expect(stepAfter("approve", IDS, "a", { postId: "p1" })).toEqual({
      kind: "idea",
      id: "b",
      toast: { tone: "ok", text: "Pieza creada en Borrador" },
    });
  });

  it("aprobar la ultima que queda cierra con el aviso", () => {
    const step = stepAfter("approve", ["a"], "a", { postId: "p1" });

    expect(step.kind).toBe("close");
    expect(step.toast.text).toContain("no quedan");
  });

  it("aprobar la ultima de la lista cuando quedan otras, abre la anterior", () => {
    expect(stepAfter("approve", IDS, "c", { postId: "p1" })).toMatchObject({ kind: "idea", id: "b" });
  });

  it("APROBAR Y PRODUCIR COPY rompe la secuencia: abre la PIEZA generada, aunque queden ideas", () => {
    expect(stepAfter("approve_and_generate", IDS, "a", { postId: "p9", copyQueued: true })).toEqual({
      kind: "piece",
      id: "p9",
      toast: { tone: "ok", text: "Aprobada. El copywriter está escribiendo el guion." },
    });
  });

  it("y lo hace tambien con la ultima idea", () => {
    expect(stepAfter("approve_and_generate", ["a"], "a", { postId: "p9", copyQueued: true })).toMatchObject({
      kind: "piece",
      id: "p9",
    });
  });

  it("si el copy no se pudo pedir, la pieza igual se abre y el aviso lo dice", () => {
    const step = stepAfter("approve_and_generate", IDS, "a", {
      postId: "p9",
      copyQueued: false,
      copyError: "No hay proveedor de IA",
    });

    expect(step).toMatchObject({ kind: "piece", id: "p9" });
    expect(step.toast.tone).toBe("warning");
    expect(step.toast.text).toContain("No hay proveedor de IA");
  });

  it("sin postId (algo salio mal) no abre una pieza que no existe", () => {
    expect(stepAfter("approve_and_generate", IDS, "a", {}).kind).not.toBe("piece");
  });
});

describe("quien puede editar una idea", () => {
  it("quien aprueba edita cualquiera", () => {
    expect(canEditIdea({ approve: true, createdBy: "otra", userId: "yo" })).toBe(true);
  });

  it("un Member edita las suyas", () => {
    expect(canEditIdea({ approve: false, createdBy: "yo", userId: "yo" })).toBe(true);
  });

  it("y no las de otra persona", () => {
    expect(canEditIdea({ approve: false, createdBy: "otra", userId: "yo" })).toBe(false);
    expect(canEditIdea({ approve: false, createdBy: null, userId: "yo" })).toBe(false);
  });
});
