import { describe, it, expect } from "vitest";
import { describeSendError, RATE_LIMIT_REACHED } from "./instagram-errors";

/**
 * Lo que se prueba no es que el texto sea exactamente este, sino que un rechazo
 * de la API llegue a la conversacion como una explicacion y no como un volcado
 * tecnico. Por eso cada caso ademas chequea que el mensaje no se parezca a un
 * error crudo.
 */
function pareceErrorCrudo(texto: string): boolean {
  return /\{|\}|error_subcode|OAuthException|\bcode\b|#\d/.test(texto);
}

describe("ventana de 24 horas", () => {
  it("la reconoce por subcodigo", () => {
    const r = describeSendError({ code: 10, error_subcode: 2534022, message: "..." });
    expect(r.kind).toBe("outside_window");
    expect(r.retryable).toBe(false);
  });

  it("la reconoce por texto cuando no viene el codigo", () => {
    const r = describeSendError(
      new Error("This message is sent outside of allowed window")
    );
    expect(r.kind).toBe("outside_window");
  });

  it("explica la regla, no el error", () => {
    const r = describeSendError({ error_subcode: 2534022 });
    expect(r.message).toContain("24 horas");
    expect(pareceErrorCrudo(r.message)).toBe(false);
    expect(r.hint).toBeTruthy();
  });
});

describe("otros rechazos", () => {
  it("reconoce el limite de la API", () => {
    expect(describeSendError({ code: 613 }).kind).toBe("rate_limited");
    expect(describeSendError({ code: 4 }).kind).toBe("rate_limited");
    expect(describeSendError(new Error("rate limit exceeded")).kind).toBe("rate_limited");
  });

  it("reconoce un contacto que no recibe mensajes", () => {
    expect(describeSendError({ code: 551 }).kind).toBe("user_unavailable");
  });

  it("reconoce el token vencido y no propone reintentar", () => {
    const r = describeSendError({ code: 190, message: "Error validating access token" });
    expect(r.kind).toBe("token_expired");
    expect(r.retryable).toBe(false);
    expect(r.hint).toContain("conectar");
  });

  it("saca el error de Meta de adentro del texto de un Error", () => {
    const r = describeSendError(
      new Error('Request failed: {"error":{"code":551,"message":"User not available"}}')
    );
    expect(r.kind).toBe("user_unavailable");
  });

  it("saca el error de una respuesta anidada del SDK", () => {
    const r = describeSendError({ response: { error: { code: 190 } } });
    expect(r.kind).toBe("token_expired");
  });
});

describe("lo que no se reconoce", () => {
  it("no filtra el texto crudo de la API", () => {
    const r = describeSendError(
      new Error("ETIMEDOUT connect 10.0.0.1:443 upstream_id=abc123")
    );
    expect(r.kind).toBe("unknown");
    expect(r.message).not.toContain("ETIMEDOUT");
    expect(r.message).not.toContain("10.0.0.1");
    expect(pareceErrorCrudo(r.message)).toBe(false);
  });

  it("sugiere reintentar, porque puede ser pasajero", () => {
    expect(describeSendError(new Error("boom")).retryable).toBe(true);
  });

  it("aguanta null y undefined sin romperse", () => {
    expect(describeSendError(null).kind).toBe("unknown");
    expect(describeSendError(undefined).kind).toBe("unknown");
  });
});

describe("tope propio del sistema", () => {
  it("explica que el freno lo puso el sistema y cuando se retoma", () => {
    expect(RATE_LIMIT_REACHED.kind).toBe("rate_limited");
    expect(RATE_LIMIT_REACHED.message).toContain("tope");
    expect(RATE_LIMIT_REACHED.hint).toContain("200");
    expect(RATE_LIMIT_REACHED.retryable).toBe(true);
  });
});
