import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { authorizeCronRequest, checkCronSecret, parseBearerToken } from "./cron-auth";

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CRON_SECRET;
});

describe("parseBearerToken", () => {
  it("saca el token del prefijo Bearer", () => {
    expect(parseBearerToken("Bearer abc123")).toBe("abc123");
  });

  it("acepta el prefijo en minuscula: el scheme es case-insensitive", () => {
    expect(parseBearerToken("bearer abc123")).toBe("abc123");
  });

  it("un header sin prefijo NO es un token", () => {
    // El `.replace("Bearer ", "")` que reemplaza esto devolvia el valor crudo.
    expect(parseBearerToken("abc123")).toBeNull();
  });

  it("'Token Bearer abc' no cuela como Bearer", () => {
    // El replace viejo no anclaba el prefijo, asi que esto pasaba como "abc".
    expect(parseBearerToken("Token Bearer abc")).toBeNull();
  });

  it("un Bearer sin valor es null", () => {
    expect(parseBearerToken("Bearer ")).toBeNull();
    expect(parseBearerToken("Bearer    ")).toBeNull();
  });

  it("sin header, null", () => {
    expect(parseBearerToken(null)).toBeNull();
    expect(parseBearerToken(undefined)).toBeNull();
  });
});

describe("checkCronSecret", () => {
  it("deja pasar el secreto correcto", () => {
    expect(checkCronSecret("s3cr3t", "s3cr3t")).toEqual({ ok: true });
  });

  it("rechaza uno incorrecto del mismo largo", () => {
    // El caso que un startsWith mal escrito dejaria pasar.
    expect(checkCronSecret("s3cr3x", "s3cr3t")).toMatchObject({ ok: false, status: 401 });
  });

  it("rechaza uno de largo distinto sin lanzar", () => {
    // timingSafeEqual explota con buffers de distinto largo.
    expect(() => checkCronSecret("corto", "mucho mas largo")).not.toThrow();
    expect(checkCronSecret("corto", "mucho mas largo")).toMatchObject({ status: 401 });
  });

  it("sin secreto provisto, 401", () => {
    expect(checkCronSecret(null, "s3cr3t")).toMatchObject({ status: 401 });
    expect(checkCronSecret("", "s3cr3t")).toMatchObject({ status: 401 });
  });

  it("si CRON_SECRET no esta configurado devuelve 500, no 401", () => {
    // 401 seria mentir: no es que alguien intento entrar, es que el servidor
    // esta mal desplegado. El operador tiene que poder distinguirlos.
    expect(checkCronSecret("lo-que-sea", undefined)).toMatchObject({ ok: false, status: 500 });
    expect(checkCronSecret("lo-que-sea", "")).toMatchObject({ status: 500 });
    expect(checkCronSecret("lo-que-sea", "   ")).toMatchObject({ status: 500 });
  });

  it("recorta el secreto del entorno: un salto de linea pegado no lo invalida", () => {
    expect(checkCronSecret("s3cr3t", "s3cr3t\n")).toEqual({ ok: true });
  });
});

describe("authorizeCronRequest", () => {
  it("autoriza con el header Authorization", () => {
    process.env.CRON_SECRET = "s3cr3t";
    const request = new NextRequest("https://app.test/api/cron/jobs", {
      headers: { authorization: "Bearer s3cr3t" },
    });
    expect(authorizeCronRequest(request)).toBeNull();
  });

  it("el secreto en la query string NO autoriza, aunque sea el correcto", async () => {
    // Es el cambio de comportamiento de esta pasada. Sin este test, alguien
    // "restaura la compatibilidad" en seis meses y el secreto vuelve a los logs.
    process.env.CRON_SECRET = "s3cr3t";
    const request = new NextRequest("https://app.test/api/cron/jobs?key=s3cr3t");
    const denied = authorizeCronRequest(request);
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(401);
  });

  it("sin CRON_SECRET responde 500 y lo deja en el log del servidor", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const request = new NextRequest("https://app.test/api/cron/jobs", {
      headers: { authorization: "Bearer lo-que-sea" },
    });
    const denied = authorizeCronRequest(request);
    expect(denied!.status).toBe(500);
    expect(spy).toHaveBeenCalled();
  });

  it("el mensaje de error nunca incluye el secreto", async () => {
    process.env.CRON_SECRET = "s3cr3t-muy-secreto";
    const request = new NextRequest("https://app.test/api/cron/jobs", {
      headers: { authorization: "Bearer equivocado" },
    });
    const denied = authorizeCronRequest(request);
    const body = await denied!.json();
    expect(JSON.stringify(body)).not.toContain("s3cr3t-muy-secreto");
  });
});
