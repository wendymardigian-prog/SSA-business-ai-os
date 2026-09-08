import { describe, it, expect, afterEach } from "vitest";
import { channelWebhookUrl, isLocalUrl } from "./webhook-url";

const original = process.env.NEXT_PUBLIC_APP_URL;
afterEach(() => {
  process.env.NEXT_PUBLIC_APP_URL = original;
});

describe("channelWebhookUrl", () => {
  it("arma la URL de cada proveedor sobre el dominio de la app", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://mi-app.up.railway.app";
    expect(channelWebhookUrl("zernio")).toBe(
      "https://mi-app.up.railway.app/api/webhooks/late"
    );
    expect(channelWebhookUrl("evolution")).toBe(
      "https://mi-app.up.railway.app/api/webhooks/evolution"
    );
  });

  it("no duplica la barra si la variable termina en /", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://mi-app.up.railway.app/";
    expect(channelWebhookUrl("zernio")).toBe(
      "https://mi-app.up.railway.app/api/webhooks/late"
    );
  });

  it("se niega a registrar una direccion local", () => {
    // El webhook de Zernio quedo apuntando a localhost durante semanas y ningun
    // DM entro nunca, sin que nada avisara. Mejor fallar al registrar.
    for (const local of [
      "http://localhost:3000",
      "http://127.0.0.1:3000",
      "http://0.0.0.0:3000",
      "http://app.local",
    ]) {
      process.env.NEXT_PUBLIC_APP_URL = local;
      expect(() => channelWebhookUrl("zernio")).toThrow(/dominio publico/);
    }
  });
});

describe("isLocalUrl", () => {
  it("reconoce las direcciones caseras", () => {
    expect(isLocalUrl("http://localhost:3000")).toBe(true);
    expect(isLocalUrl("http://127.0.0.1")).toBe(true);
    expect(isLocalUrl("http://algo.localhost:3000")).toBe(true);
  });

  it("deja pasar un dominio publico", () => {
    expect(isLocalUrl("https://mi-app.up.railway.app")).toBe(false);
    expect(isLocalUrl("https://app.midominio.com")).toBe(false);
  });

  it("algo que no es una URL cuenta como local: no se registra", () => {
    expect(isLocalUrl("no-es-una-url")).toBe(true);
    expect(isLocalUrl("")).toBe(true);
  });
});
