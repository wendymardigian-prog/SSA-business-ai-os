/**
 * A12 · los errores de Zernio.
 *
 * El defecto: el SDK lanza `ZernioApiError` con `.statusCode`, y el
 * publicador leia `.status` de un objeto que nunca llegaba. Todo terminaba
 * como permanente, asi que un 429 o un 503 no se reintentaba nunca.
 */

import { describe, it, expect } from "vitest";
import { PublishError } from "@/lib/jobs/errors";
import {
  classifyZernioError,
  existingPostIdFrom,
  isTemporaryZernioStatus,
  zernioStatus,
} from "./zernio-errors";

/** Como es el error que tira el SDK. */
const apiError = (statusCode: number, message = "Zernio dijo que no", details?: object) =>
  Object.assign(new Error(message), { statusCode, details });

describe("de donde sale el codigo HTTP", () => {
  it("de statusCode, que es como lo llama el SDK", () => {
    expect(zernioStatus(apiError(429))).toBe(429);
  });

  it("tambien de status o de response.status, por si cambia", () => {
    expect(zernioStatus({ status: 500 })).toBe(500);
    expect(zernioStatus({ response: { status: 503 } })).toBe(503);
  });

  it("sin nada, no inventa", () => {
    expect(zernioStatus(new Error("se corto la red"))).toBeUndefined();
  });
});

describe("que se reintenta", () => {
  it("429 y 5xx si: es el proveedor, no la publicacion", () => {
    expect(isTemporaryZernioStatus(429)).toBe(true);
    expect(isTemporaryZernioStatus(500)).toBe(true);
    expect(isTemporaryZernioStatus(503)).toBe(true);
  });

  it("un rechazo del contenido no: reintentarlo lo rechaza igual", () => {
    expect(isTemporaryZernioStatus(400)).toBe(false);
    expect(isTemporaryZernioStatus(422)).toBe(false);
    expect(isTemporaryZernioStatus(404)).toBe(false);
  });

  it("sin codigo se reintenta: fue la red", () => {
    expect(isTemporaryZernioStatus(undefined)).toBe(true);
  });
});

describe("classifyZernioError", () => {
  it("un 429 queda temporal y conserva el codigo", () => {
    const error = classifyZernioError(apiError(429, "Demasiados pedidos"), "no anduvo");

    expect(error).toBeInstanceOf(PublishError);
    expect(error.kind).toBe("temporary");
    expect(error.message).toBe("Demasiados pedidos");
  });

  it("un 422 queda permanente", () => {
    expect(classifyZernioError(apiError(422), "no anduvo").kind).toBe("permanent");
  });

  it("sin mensaje usa el de respaldo", () => {
    expect(classifyZernioError(apiError(500, ""), "Zernio no pudo").message).toBe("Zernio no pudo");
  });

  it("no envuelve dos veces un PublishError", () => {
    const original = new PublishError("ya clasificado", "permanent");
    expect(classifyZernioError(original, "x")).toBe(original);
  });
});

describe("el dedupe de contenido de Zernio", () => {
  it("un 409 trae el id del post que ya existe", () => {
    expect(existingPostIdFrom(apiError(409, "duplicado", { existingPostId: "zp-1" }))).toBe("zp-1");
  });

  it("cualquier otro error, no", () => {
    expect(existingPostIdFrom(apiError(422, "x", { existingPostId: "zp-1" }))).toBeNull();
  });
});
