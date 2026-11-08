import { describe, expect, it } from "vitest";
import { differsFromPublished, hasUnpublishedChanges, stableStringify } from "./stale";

describe("«Hay cambios sin publicar» (F48b)", () => {
  it("el orden de las claves no importa", () => {
    expect(stableStringify({ a: 1, b: { c: [1, { y: 2, x: 1 }] } })).toBe(stableStringify({ b: { c: [1, { x: 1, y: 2 }] }, a: 1 }));
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
  });

  it("un documento igual al publicado no avisa; uno distinto sí", () => {
    const doc = { v: 1, pages: [{ id: "p1", elements: [{ id: "a", text: "Hola" }] }] };
    expect(differsFromPublished({ published: true, doc, publishedDoc: JSON.parse(JSON.stringify(doc)) })).toBe(false);
    expect(differsFromPublished({ published: true, doc: { ...doc, pages: [{ id: "p1", elements: [{ id: "a", text: "Chau" }] }] }, publishedDoc: doc })).toBe(true);
  });

  it("sin publicar, o sin una versión de publicar con la que comparar, no avisa", () => {
    expect(differsFromPublished({ published: false, doc: { a: 1 }, publishedDoc: { a: 2 } })).toBe(false);
    expect(differsFromPublished({ published: true, doc: { a: 1 }, publishedDoc: null })).toBe(false);
  });

  const base = { published: true, isGeneration: false, serverDiffers: false, loadedRev: 4, currentRev: 4, dirty: false };

  it("recién publicado y sin tocar: sin aviso", () => {
    expect(hasUnpublishedChanges(base)).toBe(false);
  });

  it("editar (con o sin guardar) lo enciende", () => {
    expect(hasUnpublishedChanges({ ...base, dirty: true })).toBe(true);
    expect(hasUnpublishedChanges({ ...base, currentRev: 5 })).toBe(true);
    expect(hasUnpublishedChanges({ ...base, serverDiffers: true })).toBe(true);
  });

  it("después de «Publicar cambios» la pantalla vuelve a cargar y se apaga sola", () => {
    // Se guardó la rev 5 y se publicó: el servidor ya no ve diferencias y la pantalla carga la rev 5.
    expect(hasUnpublishedChanges({ ...base, loadedRev: 5, currentRev: 5, serverDiffers: false })).toBe(false);
  });

  it("un borrador o una pieza emitida nunca avisan", () => {
    expect(hasUnpublishedChanges({ ...base, published: false, dirty: true })).toBe(false);
    expect(hasUnpublishedChanges({ ...base, isGeneration: true, dirty: true })).toBe(false);
  });
});
