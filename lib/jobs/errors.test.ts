import { describe, it, expect } from "vitest";
import { classifyPublishError, humanizePublishError, PublishError } from "./errors";

describe("que errores se reintentan (F30)", () => {
  it("429 y 5xx son temporales", () => {
    for (const status of [429, 500, 502, 503, 504]) {
      expect(classifyPublishError({ status }).kind, String(status)).toBe("temporary");
    }
  });

  it("401 y 403 son permanentes: el token no se arregla solo", () => {
    expect(classifyPublishError({ status: 401 }).kind).toBe("permanent");
    expect(classifyPublishError({ status: 403 }).kind).toBe("permanent");
  });

  it("un 400 de validacion es permanente: el mismo pedido falla igual", () => {
    expect(classifyPublishError({ status: 400 }).kind).toBe("permanent");
  });

  it("sin respuesta es temporal: no se sabe que fallo definitivamente", () => {
    // Un corte de red de dos segundos no puede costar una publicacion.
    expect(classifyPublishError(new Error("fetch failed")).kind).toBe("temporary");
  });

  it("pero un mensaje que delata el problema se trata como permanente", () => {
    expect(classifyPublishError(new Error("invalid_grant")).kind).toBe("permanent");
    expect(classifyPublishError(new Error("Video duration too long")).kind).toBe("permanent");
  });

  it("un PublishError ya clasificado se respeta", () => {
    const original = new PublishError("algo", "permanent", 418);

    expect(classifyPublishError(original)).toBe(original);
  });

  it("lee el codigo venga como venga", () => {
    expect(classifyPublishError({ statusCode: 429 }).kind).toBe("temporary");
    expect(classifyPublishError({ code: 401 }).kind).toBe("permanent");
  });
});

describe("como se le cuenta a una persona", () => {
  it("un error temporal dice que se reintenta solo", () => {
    const message = humanizePublishError(new PublishError("503", "temporary", 503), "Instagram");

    expect(message).toContain("reintentar");
    expect(message).not.toContain("503");
  });

  it("un token vencido dice donde reconectar", () => {
    const message = humanizePublishError(
      new PublishError("invalid_grant", "permanent", 401),
      "YouTube",
    );

    expect(message).toContain("Integraciones");
  });

  it("un permiso faltante dice que hay que aceptar todos", () => {
    const message = humanizePublishError(new PublishError("no permission", "permanent", 403), "LinkedIn");

    expect(message).toContain("permisos");
  });

  it("un rechazo del proveedor conserva el motivo, que es lo util", () => {
    const message = humanizePublishError(
      new PublishError("El video supera la duracion permitida", "permanent", 400),
      "TikTok",
    );

    expect(message).toContain("supera la duracion");
  });
});
