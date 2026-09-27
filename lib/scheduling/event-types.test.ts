import { describe, it, expect } from "vitest";
import { slugify, isValidSlug, nextCopySlug } from "./slug";
import { suggestSlug, deleteEventNeedsConfirmation, slugChangeNeedsConfirmation } from "./event-validation";

describe("slugify (F17, portado de Cal.diy)", () => {
  it('slugify("Llamada de Descubrimiento ñ") da "llamada-de-descubrimiento-n"', () => {
    expect(slugify("Llamada de Descubrimiento ñ")).toBe("llamada-de-descubrimiento-n");
  });

  it("minúsculas, espacios y símbolos a guión, números intactos", () => {
    expect(slugify("HELLO")).toBe("hello");
    expect(slugify("hello there")).toBe("hello-there");
    expect(slugify("hello_there")).toBe("hello-there");
    expect(slugify("hello$there")).toBe("hello-there");
    expect(slugify("#hellothere")).toBe("hellothere");
    expect(slugify("321hello there123")).toBe("321hello-there123");
  });

  it("sin guiones al principio ni al final, y sin guiones repetidos", () => {
    expect(slugify("hello-there-")).toBe("hello-there");
    expect(slugify("_hello-there_")).toBe("hello-there");
    expect(slugify("Hello -  World 123_ !@#  Test    456   789")).toBe("hello-world-123-test-456-789");
  });

  it("quita acentos y emojis", () => {
    expect(slugify("Sesión de éxito")).toBe("sesion-de-exito");
    expect(slugify("Hello 📚🕯️ There")).toBe("hello-there");
    expect(slugify("📚🕯️")).toBe("");
  });

  it("mientras se escribe conserva el guión final", () => {
    expect(slugify("test-", true)).toBe("test-");
    expect(slugify("test-")).toBe("test");
  });

  it("isValidSlug y suggestSlug", () => {
    expect(isValidSlug("llamada-de-triaje")).toBe(true);
    expect(isValidSlug("Llamada")).toBe(false);
    expect(isValidSlug("a--b")).toBe(false);
    expect(isValidSlug("")).toBe(false);
    expect(suggestSlug("Llamada de Descubrimiento")).toBe("llamada-de-descubrimiento");
    expect(suggestSlug("x".repeat(80))).toHaveLength(60);
  });
});

describe("duplicar y borrar (F17)", () => {
  it("el duplicado usa -copia, o -copia-2, -copia-3…", () => {
    expect(nextCopySlug("triaje", [])).toBe("triaje-copia");
    expect(nextCopySlug("triaje", ["triaje-copia"])).toBe("triaje-copia-2");
    expect(nextCopySlug("triaje", ["triaje-copia", "triaje-copia-2"])).toBe("triaje-copia-3");
  });

  it("borrar con agendas futuras exige confirm: true", () => {
    expect(deleteEventNeedsConfirmation(0)).toEqual({ ok: true, needsConfirmation: false, message: null });
    const r = deleteEventNeedsConfirmation(3);
    expect(r.ok).toBe(false);
    expect(r.needsConfirmation).toBe(true);
    expect(r.message).toMatch(/3 agendas futuras/);
    expect(deleteEventNeedsConfirmation(3, true).ok).toBe(true);
  });

  it("cambiar el slug con agendas futuras pide confirmación (F18)", () => {
    expect(slugChangeNeedsConfirmation({ currentSlug: "a", nextSlug: "a", futureBookings: 5 }).ok).toBe(true);
    expect(slugChangeNeedsConfirmation({ currentSlug: "a", nextSlug: "b", futureBookings: 0 }).ok).toBe(true);
    const r = slugChangeNeedsConfirmation({ currentSlug: "a", nextSlug: "b", futureBookings: 1 });
    expect(r).toMatchObject({ ok: false, needsConfirmation: true });
    expect(r.message).toMatch(/1 agenda futura /);
    expect(slugChangeNeedsConfirmation({ currentSlug: "a", nextSlug: "b", futureBookings: 1, confirm: true }).ok).toBe(true);
  });
});
