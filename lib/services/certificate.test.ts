// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { canIssueFor, certificateState, isServiceSubject, longDate, serviceDesignValues, serviceSubjectRef, SERVICE_DESIGN_VARS } from "./certificate";

describe("variables del grupo Servicio", () => {
  it("todas empiezan con service.", () => {
    expect(SERVICE_DESIGN_VARS.every((v) => v.key.startsWith("service."))).toBe(true);
  });
  it("solo devuelve lo que sabe", () => {
    const v = serviceDesignValues(
      { id: "s", status: "completed", starts_on: "2026-10-01", ends_on: null, completed_at: null, product_snapshot: { product_name: "Programa X" } },
      { variantName: "Completa", ownerName: "", completedOn: "2026-12-15" },
    );
    expect(v).toEqual({ "service.product": "Programa X", "service.variant": "Completa", "service.start_on": "1 de octubre de 2026", "service.completed_on": "15 de diciembre de 2026" });
  });
  it("una fecha civil no se corre por la zona", () => {
    expect(longDate("2026-01-01")).toBe("1 de enero de 2026");
    expect(longDate(null)).toBeNull();
    expect(longDate("no")).toBeNull();
  });
});

describe("sujeto y estado", () => {
  it("el sujeto es el servicio", () => {
    const ref = serviceSubjectRef("id-1", "Programa X");
    expect(isServiceSubject(ref)).toBe(true);
    expect(isServiceSubject({ module: "otro", type: "service", id: "x" })).toBe(false);
    expect(isServiceSubject(null)).toBe(false);
  });
  it("un servicio cancelado no emite (CE001)", () => {
    expect(canIssueFor("active")).toBe(true);
    expect(canIssueFor("completed")).toBe(true);
    expect(canIssueFor("cancelled")).toBe(false);
    expect(canIssueFor("refunded")).toBe(false);
  });
  it("uno vigente: el más nuevo no anulado", () => {
    const st = certificateState([
      { id: "a", code: "A", status: "void", created_at: "2026-11-01T00:00:00Z" },
      { id: "b", code: "B", status: "ready", created_at: "2026-11-02T00:00:00Z" },
      { id: "c", code: "C", status: "failed", created_at: "2026-11-03T00:00:00Z" },
    ]);
    expect(st.current?.id).toBe("b");
    expect(st.previous.map((d) => d.id)).toEqual(["c", "a"]);
    expect(certificateState([{ id: "a", code: "A", status: "void", created_at: "x" }]).current).toBeNull();
  });
});
