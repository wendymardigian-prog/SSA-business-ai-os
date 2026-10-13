import { describe, expect, it } from "vitest";
import { lastContactId, summarizeResult } from "./result";

describe("summarizeResult", () => {
  it("sin flujos que lo escuchen: procesado, con el motivo", () => {
    expect(summarizeResult({})).toEqual({ status: "processed", summary: "Ningún flujo publicado escucha este webhook", errorMessage: null });
  });

  it("un flujo completado y otro fallado: error y '1 de 2 flujos falló: …'", () => {
    const r = summarizeResult({ a: { status: "completed" }, b: { status: "failed", error: "HTTP 500" } });
    expect(r).toEqual({ status: "error", summary: "1 de 2 flujos falló: HTTP 500", errorMessage: "HTTP 500" });
  });

  it("con un solo flujo, el singular", () => {
    expect(summarizeResult({ a: { status: "failed", error: "x" } }).summary).toBe("1 de 1 flujo falló: x");
  });

  it("un flujo pendiente en un Esperar: procesado con '1 flujo en curso'", () => {
    const r = summarizeResult({ a: { status: "pending" } });
    expect(r.status).toBe("processed");
    expect(r.summary).toBe("1 flujo en curso");
  });

  it("solo condiciones que no se cumplieron", () => {
    expect(summarizeResult({ a: { status: "skipped_condition" } }).summary).toBe("no cumplió la condición");
  });

  it("mezcla de corridos, en curso y salteados", () => {
    const r = summarizeResult({ a: { status: "completed" }, b: { status: "pending" }, c: { status: "skipped_condition" } });
    expect(r.summary).toBe("1 flujo corrió, 1 flujo en curso, 1 no cumplió la condición");
  });
});

describe("lastContactId", () => {
  it("el ultimo contacto que tocó un flujo, o null", () => {
    expect(lastContactId({ a: { status: "completed", contact_id: "c1" }, b: { status: "completed", contact_id: "c2" } })).toBe("c2");
    expect(lastContactId({ a: { status: "completed" } })).toBeNull();
  });
});
