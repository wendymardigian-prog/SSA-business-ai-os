import { describe, expect, it, vi } from "vitest";
import { HONEYPOT_FIELD, LIMITS, checkRateLimit, clientIp, hashIp, newBookingUid, originFrom, pickUtm, rateLimitKey, safeReferrer, windowStart } from "./antispam";

describe("antispam (F29)", () => {
  it("la IP nunca queda en texto: la clave lleva un hash", () => {
    const key = rateLimitKey("create", "190.1.2.3");
    expect(key.startsWith("scheduling:create:")).toBe(true);
    expect(key).not.toContain("190.1.2.3");
    expect(hashIp("190.1.2.3")).toHaveLength(32);
    expect(hashIp("190.1.2.3")).toBe(hashIp("190.1.2.3"));
    expect(hashIp("190.1.2.4")).not.toBe(hashIp("190.1.2.3"));
  });

  it("la ventana se corta por hora (crear) y por minuto (horarios)", () => {
    const now = new Date("2026-10-06T18:34:56.000Z");
    expect(windowStart("create", now)).toBe("2026-10-06T18:00:00.000Z");
    expect(windowStart("slots", now)).toBe("2026-10-06T18:34:00.000Z");
    expect(LIMITS.create.max).toBe(10);
    expect(LIMITS.slots.max).toBe(60);
  });

  it("la 11 creacion en una hora se rechaza", async () => {
    let count = 0;
    const service = { rpc: vi.fn(async () => ({ data: ++count, error: null })) } as never;
    for (let i = 1; i <= 10; i++) {
      expect((await checkRateLimit(service, "create", "1.2.3.4")).allowed).toBe(true);
    }
    const eleventh = await checkRateLimit(service, "create", "1.2.3.4");
    expect(eleventh).toMatchObject({ allowed: false, count: 11, max: 10 });
  });

  it("si la base falla, no se bloquea a nadie", async () => {
    const service = { rpc: vi.fn(async () => ({ data: null, error: { message: "boom" } })) } as never;
    expect((await checkRateLimit(service, "create", "1.2.3.4")).allowed).toBe(true);
  });

  it("el campo trampa se llama website", () => {
    expect(HONEYPOT_FIELD).toBe("website");
  });

  it("la IP sale del proxy", () => {
    expect(clientIp(new Headers({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
    expect(clientIp(new Headers({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(clientIp(new Headers())).toBe("0.0.0.0");
  });
});

describe("atribucion (F29)", () => {
  it("toma los UTM y los click ids, y nada mas", () => {
    const params = new URLSearchParams("utm_source=ig&utm_medium=bio&fbclid=abc&email=a@b.com&otra=x");
    expect(pickUtm(params)).toEqual({ utm_source: "ig", utm_medium: "bio", fbclid: "abc" });
  });
  it("el origen es embed solo si lo dice", () => {
    expect(originFrom(new URLSearchParams("embed=1"))).toBe("embed");
    expect(originFrom(new URLSearchParams(""))).toBe("public_page");
    expect(originFrom({ embed: "true" })).toBe("embed");
  });
  it("el referrer se valida como http(s)", () => {
    expect(safeReferrer("https://mi-sitio.com/a")).toBe("https://mi-sitio.com/a");
    expect(safeReferrer("javascript:alert(1)")).toBeNull();
    expect(safeReferrer("")).toBeNull();
    expect(safeReferrer(null)).toBeNull();
  });
});

describe("uid de la agenda", () => {
  it("son 22 caracteres URL-safe y no se repiten", () => {
    const a = newBookingUid();
    const b = newBookingUid();
    expect(a).toHaveLength(22);
    expect(a).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(a).not.toBe(b);
  });
});
