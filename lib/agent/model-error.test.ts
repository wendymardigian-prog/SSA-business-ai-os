import { describe, it, expect } from "vitest";
import { APICallError } from "ai";
import { classifyModelError, isTimeoutError } from "./model-error";

/**
 * Lo que se guarda cuando falla una llamada al modelo.
 *
 * Dos cosas se prueban y las dos costaron caro: que el codigo HTTP sobreviva
 * (antes se perdia y todo se leia "AI_APICallError"), y que el texto del lead
 * NUNCA salga del error del proveedor.
 */

function apiError(opts: { statusCode?: number; responseBody?: string; message?: string }) {
  return new APICallError({
    message: opts.message ?? "fallo",
    url: "https://api.anthropic.com/v1/messages",
    requestBodyValues: {},
    statusCode: opts.statusCode,
    responseBody: opts.responseBody,
  });
}

describe("classifyModelError", () => {
  it("una key rechazada queda marcada como auth, con su codigo y su tipo", () => {
    const failure = classifyModelError(
      apiError({
        statusCode: 401,
        responseBody: JSON.stringify({
          type: "error",
          error: { type: "authentication_error", message: "API key is invalid." },
        }),
      }),
    );

    expect(failure).toMatchObject({
      code: "api_401:authentication_error",
      status: 401,
      providerType: "authentication_error",
      isAuth: true,
      isTimeout: false,
    });
  });

  it("un 403 tambien es auth", () => {
    expect(classifyModelError(apiError({ statusCode: 403 })).isAuth).toBe(true);
  });

  it("un 404 NO es auth: es un modelo que no existe", () => {
    const failure = classifyModelError(
      apiError({ statusCode: 404, responseBody: JSON.stringify({ error: { type: "not_found_error" } }) }),
    );
    expect(failure).toMatchObject({ code: "api_404:not_found_error", isAuth: false });
  });

  it("un 429 y un 529 conservan su codigo", () => {
    expect(classifyModelError(apiError({ statusCode: 429 })).code).toBe("api_429");
    expect(classifyModelError(apiError({ statusCode: 529 })).code).toBe("api_529");
  });

  it("lee el formato de OpenAI (code antes que type)", () => {
    const failure = classifyModelError(
      apiError({
        statusCode: 401,
        responseBody: JSON.stringify({ error: { code: "invalid_api_key", type: "invalid_request_error" } }),
      }),
    );
    expect(failure.providerType).toBe("invalid_api_key");
  });

  it("lee el formato de Google (status)", () => {
    const failure = classifyModelError(
      apiError({ statusCode: 401, responseBody: JSON.stringify({ error: { status: "UNAUTHENTICATED" } }) }),
    );
    expect(failure.providerType).toBe("UNAUTHENTICATED");
  });

  it("NUNCA deja pasar el texto del lead que algunos proveedores repiten", () => {
    const secreto = "hola, mi tarjeta termina en 4242 y mi telefono es 11-5555-0000";
    const failure = classifyModelError(
      apiError({
        statusCode: 400,
        message: `Invalid request: ${secreto}`,
        responseBody: JSON.stringify({
          error: { type: "invalid_request_error", message: `prompt was: ${secreto}` },
        }),
      }),
    );

    const todo = JSON.stringify(failure);
    expect(todo).not.toContain("4242");
    expect(todo).not.toContain("11-5555-0000");
    expect(failure.code).toBe("api_400:invalid_request_error");
  });

  it("un cuerpo que no es JSON no rompe: queda solo el codigo", () => {
    const failure = classifyModelError(apiError({ statusCode: 500, responseBody: "<html>502 Bad Gateway</html>" }));
    expect(failure).toMatchObject({ code: "api_500", status: 500, providerType: null });
  });

  it("un timeout se reconoce y no es auth", () => {
    const err = new Error("The operation was aborted due to timeout");
    err.name = "TimeoutError";
    expect(classifyModelError(err)).toMatchObject({ code: "timeout", isTimeout: true, isAuth: false });
  });

  it("un error cualquiera cae en su nombre de clase", () => {
    const err = new Error("algo raro");
    err.name = "AI_APICallError";
    expect(classifyModelError(err)).toMatchObject({ code: "AI_APICallError", status: null, isAuth: false });
  });

  it("algo que no es un Error no explota", () => {
    expect(classifyModelError("un string suelto")).toMatchObject({ code: "error", isAuth: false });
  });
});

describe("isTimeoutError", () => {
  it("reconoce TimeoutError, AbortError y el mensaje", () => {
    const t = new Error("x");
    t.name = "TimeoutError";
    const a = new Error("x");
    a.name = "AbortError";
    expect(isTimeoutError(t)).toBe(true);
    expect(isTimeoutError(a)).toBe(true);
    expect(isTimeoutError(new Error("request aborted"))).toBe(true);
    expect(isTimeoutError(new Error("401 unauthorized"))).toBe(false);
  });
});
