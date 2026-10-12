import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkLimit, formsKeys, isValidSessionId, windowStartFor } from "./rate-limit";
import { FORM_LIMITS } from "@/lib/forms/limits";

const fakeDb = (impl: () => Promise<{ data: unknown; error: { message: string } | null }>) => {
  const rpc = vi.fn(impl);
  return { client: { rpc } as never, rpc };
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.RATE_LIMIT_SALT = "sal-de-prueba";
});

describe("checkLimit", () => {
  it("permite hasta el máximo y corta el siguiente", async () => {
    let n = 0;
    const { client, rpc } = fakeDb(async () => ({ data: ++n, error: null }));
    const spec = { key: "forms:submit:x", max: 2, windowMs: 3_600_000 };
    expect((await checkLimit(client, spec)).allowed).toBe(true);
    expect((await checkLimit(client, spec)).allowed).toBe(true);
    const third = await checkLimit(client, spec);
    expect(third.allowed).toBe(false);
    expect(third.count).toBe(3);
    expect(rpc).toHaveBeenCalledWith("bump_rate_limit", expect.objectContaining({ p_key: "forms:submit:x" }));
  });

  it("un error de base no bloquea", async () => {
    const { client } = fakeDb(async () => ({ data: null, error: { message: "caída" } }));
    expect((await checkLimit(client, { key: "k", max: 1, windowMs: 1000 })).allowed).toBe(true);
  });

  it("una excepción tampoco bloquea", async () => {
    const { client } = fakeDb(async () => {
      throw new Error("red");
    });
    expect((await checkLimit(client, { key: "k", max: 1, windowMs: 1000 })).allowed).toBe(true);
  });
});

describe("el tope de envíos de Formularios (R2)", () => {
  it("los valores dejan pasar a una red compartida: 30 por formulario y 60 en total", () => {
    expect(FORM_LIMITS.submitPerIpPerFormPerHour).toBe(30);
    expect(FORM_LIMITS.submitPerIpPerHour).toBe(60);
  });
});

describe("claves", () => {
  it("la IP nunca viaja en claro", () => {
    expect(formsKeys.submit("203.0.113.9")).not.toContain("203.0.113.9");
    expect(formsKeys.submitForm("form-1", "203.0.113.9")).toMatch(/^forms:submit:form-1:[0-9a-f]{32}$/);
    expect(formsKeys.beacon("203.0.113.9")).toMatch(/^forms:beacon:[0-9a-f]{32}$/);
  });

  it("el sid no se guarda en claro y la misma sesión da la misma clave", () => {
    const sid = "3f0c1c2e-0000-4000-8000-000000000001";
    const key = formsKeys.session("view", "form-1", sid);
    expect(key).not.toContain(sid);
    expect(formsKeys.session("view", "form-1", sid)).toBe(key);
    expect(formsKeys.session("start", "form-1", sid)).not.toBe(key);
    expect(formsKeys.session("view", "form-1", "3f0c1c2e-0000-4000-8000-000000000002")).not.toBe(key);
  });

  it("windowStartFor alinea a la ventana", () => {
    expect(windowStartFor(3_600_000, new Date("2026-10-10T05:30:00Z"))).toBe("2026-10-10T05:00:00.000Z");
  });

  it("isValidSessionId solo acepta UUID", () => {
    expect(isValidSessionId("3f0c1c2e-0000-4000-8000-000000000001")).toBe(true);
    expect(isValidSessionId("algo")).toBe(false);
    expect(isValidSessionId(undefined)).toBe(false);
  });
});
