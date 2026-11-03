import { describe, it, expect } from "vitest";
import { validateOrigin, parseWebsiteSettings, serializeWebsiteSettings, validateOriginsInput, isOriginAllowed, MAX_ALLOWED_ORIGINS } from "./website";

describe("validateOrigin: solo el origen exacto", () => {
  it.each([
    ["https://tusitio.com", "https://tusitio.com"],
    ["https://TuSitio.com/", "https://tusitio.com"],
    ["  https://www.tusitio.com  ", "https://www.tusitio.com"],
    ["https://tusitio.com:443", "https://tusitio.com"],
    ["https://app.tusitio.com:8443", "https://app.tusitio.com:8443"],
    ["https://mi-web-production.up.railway.app", "https://mi-web-production.up.railway.app"],
  ])("acepta %s como %s", (raw, expected) => {
    expect(validateOrigin(raw, false)).toEqual({ ok: true, origin: expected });
  });

  it.each([
    "",
    "tusitio.com",
    "http://tusitio.com",
    "https://tusitio.com/pagina",
    "https://tusitio.com?x=1",
    "https://tusitio.com#a",
    "https://user:pass@tusitio.com",
    "ftp://tusitio.com",
    "https://intranet",
    "https://tu sitio.com",
    "*",
  ])("rechaza %j", (raw) => {
    expect(validateOrigin(raw, false).ok).toBe(false);
  });

  it("localhost solo como de desarrollo, y de desarrollo solo localhost", () => {
    expect(validateOrigin("http://localhost:4321", false).ok).toBe(false);
    expect(validateOrigin("http://localhost:4321", true)).toEqual({ ok: true, origin: "http://localhost:4321" });
    expect(validateOrigin("http://127.0.0.1:3000", true)).toEqual({ ok: true, origin: "http://127.0.0.1:3000" });
    expect(validateOrigin("https://tusitio.com", true).ok).toBe(false);
  });
});

describe("parse / serialize", () => {
  it("descarta lo que no tiene forma, los repetidos y lo que pasa del tope", () => {
    const raw = {
      allowed_origins: [
        { origin: "https://a.com", dev: false },
        { origin: "https://A.com/" },
        { origin: "http://localhost:4321", dev: true },
        { origin: "http://localhost:4321" },
        { origin: 42 },
        "https://b.com",
        null,
      ],
    };
    expect(parseWebsiteSettings(raw).allowedOrigins).toEqual([
      { origin: "https://a.com", dev: false },
      { origin: "http://localhost:4321", dev: true },
    ]);
    expect(parseWebsiteSettings(null).allowedOrigins).toEqual([]);
    expect(parseWebsiteSettings([]).allowedOrigins).toEqual([]);
    const many = { allowed_origins: Array.from({ length: 30 }, (_, i) => ({ origin: `https://s${i}.com` })) };
    expect(parseWebsiteSettings(many).allowedOrigins).toHaveLength(MAX_ALLOWED_ORIGINS);
  });

  it("ida y vuelta", () => {
    const settings = { allowedOrigins: [{ origin: "https://a.com", dev: false }] };
    expect(parseWebsiteSettings(serializeWebsiteSettings(settings))).toEqual(settings);
  });
});

describe("validateOriginsInput: lo que manda la pantalla", () => {
  it("marca el error de cada fila y los repetidos", () => {
    const out = validateOriginsInput([{ origin: "https://a.com" }, { origin: "http://b.com" }, { origin: "https://a.com/" }]);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(Object.keys(out.errors)).toEqual(["1", "2"]);
  });

  it("una lista vacía es válida (quita todos los orígenes)", () => {
    expect(validateOriginsInput([])).toEqual({ ok: true, settings: { allowedOrigins: [] } });
  });

  it("más del tope no pasa", () => {
    expect(validateOriginsInput(Array.from({ length: 21 }, (_, i) => ({ origin: `https://s${i}.com` }))).ok).toBe(false);
  });
});

describe("isOriginAllowed", () => {
  const settings = { allowedOrigins: [{ origin: "https://tusitio.com", dev: false }] };
  it("compara exacto (sin subdominios ni comodines)", () => {
    expect(isOriginAllowed("https://tusitio.com", settings)).toBe(true);
    expect(isOriginAllowed("HTTPS://TUSITIO.COM", settings)).toBe(true);
    expect(isOriginAllowed("https://www.tusitio.com", settings)).toBe(false);
    expect(isOriginAllowed("https://tusitio.com.evil.com", settings)).toBe(false);
    expect(isOriginAllowed("http://tusitio.com", settings)).toBe(false);
    expect(isOriginAllowed(null, settings)).toBe(false);
  });
});
