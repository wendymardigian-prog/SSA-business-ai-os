import { describe, it, expect } from "vitest";
import { corsHeaders, decideOrigin, originOf, selfOrigins, withCors, CORS_MAX_AGE_SECONDS } from "./cors";

const SETTINGS = { allowedOrigins: [{ origin: "https://tusitio.com", dev: false }, { origin: "http://localhost:4321", dev: true }] };
const SELF = ["https://app.ejemplo.com"];

describe("decideOrigin", () => {
  it("sin Origin (curl, servidor) pasa sin CORS", () => {
    expect(decideOrigin(null, SELF, SETTINGS)).toBe("none");
    expect(decideOrigin("", SELF, SETTINGS)).toBe("none");
  });
  it("la propia app pasa sin CORS", () => {
    expect(decideOrigin("https://app.ejemplo.com", SELF, SETTINGS)).toBe("same");
  });
  it("un origen de la lista pasa con CORS", () => {
    expect(decideOrigin("https://tusitio.com", SELF, SETTINGS)).toBe("allowed");
    expect(decideOrigin("http://localhost:4321", SELF, SETTINGS)).toBe("allowed");
  });
  it("cualquier otro no pasa, también Origin: null", () => {
    expect(decideOrigin("https://otrositio.com", SELF, SETTINGS)).toBe("denied");
    expect(decideOrigin("http://localhost:9999", SELF, SETTINGS)).toBe("denied");
    expect(decideOrigin("null", SELF, SETTINGS)).toBe("denied");
  });
});

describe("corsHeaders", () => {
  it("el origen exacto (nunca *), sin credenciales, con Vary", () => {
    const h = corsHeaders("allowed", "https://tusitio.com", ["POST"]);
    expect(h).toEqual({
      "Access-Control-Allow-Origin": "https://tusitio.com",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": String(CORS_MAX_AGE_SECONDS),
      Vary: "Origin",
    });
    expect(JSON.stringify(h)).not.toContain("*");
    expect(h).not.toHaveProperty("Access-Control-Allow-Credentials");
  });
  it("sin headers para todo lo que no es un origen permitido", () => {
    for (const d of ["none", "same", "denied"] as const) expect(corsHeaders(d, "https://tusitio.com", ["POST"])).toEqual({});
  });
  it("withCors agrega Vary: Origin siempre", () => {
    expect(withCors({})).toEqual({ Vary: "Origin" });
  });
});

describe("selfOrigins", () => {
  it("la URL de la app y el host del pedido (dominio propio apuntado a la app)", () => {
    const headers = new Headers({ "x-forwarded-host": "agenda.cliente.com", "x-forwarded-proto": "https" });
    expect(selfOrigins("https://app.ejemplo.com", headers).sort()).toEqual(["https://agenda.cliente.com", "https://app.ejemplo.com"]);
  });
  it("en local, http", () => {
    expect(selfOrigins("http://localhost:3000", new Headers({ host: "localhost:3000" }))).toEqual(["http://localhost:3000"]);
  });
  it("originOf ignora lo que no es http(s)", () => {
    expect(originOf("javascript:alert(1)")).toBeNull();
    expect(originOf("https://a.com/x?y")).toBe("https://a.com");
  });
});
