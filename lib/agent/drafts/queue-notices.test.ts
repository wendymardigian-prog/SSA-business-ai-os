import { describe, it, expect } from "vitest";
import { noticeForDraftChange } from "./queue-notices";

describe("noticeForDraftChange (F6)", () => {
  it("descarte por respuesta en otro medio", () => {
    expect(
      noticeForDraftChange({ eventType: "UPDATE", new: { status: "discarded", discard_reason: "auto:answered_elsewhere" } }),
    ).toMatch(/otro medio/);
  });
  it("descarte por respuesta manual", () => {
    expect(
      noticeForDraftChange({ eventType: "UPDATE", new: { status: "discarded", discard_reason: "auto:manual_reply" } }),
    ).toMatch(/a mano/);
  });
  it("un descarte manual del operador no muestra aviso automático", () => {
    expect(
      noticeForDraftChange({ eventType: "UPDATE", new: { status: "discarded", discard_reason: "no me gusta" } }),
    ).toBeNull();
  });
  it("un borrador nuevo (pending) no genera aviso", () => {
    expect(noticeForDraftChange({ eventType: "INSERT", new: { status: "pending", discard_reason: null } })).toBeNull();
  });
  it("payload sin fila", () => {
    expect(noticeForDraftChange({ eventType: "DELETE", new: null })).toBeNull();
  });
});
