import { describe, expect, it } from "vitest";
import { designerSubjectType, parseAttachments, parseMessageContext, parseMessageResult } from "./schema";

describe("ai_threads / ai_messages: forma por canal", () => {
  it("Diseñador: el alcance es todo o una página", () => {
    expect(parseMessageContext("designer", { scope: {} }).ok).toBe(true);
    expect(parseMessageContext("designer", { scope: { page: 2 } }).ok).toBe(true);
    expect(parseMessageContext("designer", { scope: { page: -1 } }).ok).toBe(false);
    expect(parseMessageContext("designer", { scope: {}, extra: 1 }).ok).toBe(false);
  });

  it("Diseñador: el resultado dice qué cambió", () => {
    expect(parseMessageResult("designer", { changed_pages: [0, 2], summary: "Cambió la página 3" }).ok).toBe(true);
    expect(parseMessageResult("designer", { changed_pages: [0], summary: "x", proposal: { kind: "enable_verification", status: "pending", payload: { doc_type: "certificado" } } }).ok).toBe(true);
    expect(parseMessageResult("designer", { summary: "sin páginas" }).ok).toBe(false);
  });

  it("portal y asistente aceptan un objeto (los completa su módulo)", () => {
    expect(parseMessageContext("portal", { program_item_id: "x" }).ok).toBe(true);
    expect(parseMessageResult("assistant", { a: 1 }).ok).toBe(true);
  });

  it("adjuntos: hasta 10, con ruta, nombre y tipo", () => {
    expect(parseAttachments([{ asset_path: "ws/a.png", name: "a.png", mime: "image/png" }]).ok).toBe(true);
    expect(parseAttachments([{ name: "a.png" }]).ok).toBe(false);
    expect(parseAttachments(Array.from({ length: 11 }, () => ({ asset_path: "p", name: "n", mime: "m" }))).ok).toBe(false);
  });

  it("un hilo del Diseñador es de un diseño o de una plantilla", () => {
    expect(designerSubjectType("design")).toBe("design");
    expect(designerSubjectType("template")).toBe("design_template");
  });
});
