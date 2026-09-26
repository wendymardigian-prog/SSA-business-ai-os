/**
 * El token de Meta y la cuenta de Instagram que alcanza (F40).
 */

import { describe, it, expect, vi } from "vitest";
import { resolveIgAccount, validateMetaToken } from "./token";

function fakeFetch(...responses: unknown[]) {
  const queue = [...responses];
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => queue.shift() ?? {},
  })) as unknown as typeof fetch;
}

describe("validar el token (F40)", () => {
  it("uno bueno devuelve quien es", async () => {
    const result = await validateMetaToken("t", fakeFetch({ id: "123", name: "Mi negocio" }));

    expect(result).toEqual({ ok: true, id: "123", name: "Mi negocio" });
  });

  it("uno invalido no se guarda: dice que generar otro", async () => {
    // Guardar uno invalido dejaria la card en verde y los dashboards vacios.
    const result = await validateMetaToken("t", fakeFetch({ error: { code: 190, message: "bad" } }));

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("Business Manager");
  });
});

describe("deducir la cuenta de Instagram (F40)", () => {
  const paginas = {
    data: [
      { id: "p1", name: "Sin IG" },
      { id: "p2", name: "Con IG", instagram_business_account: { id: "ig-1", username: "mia" } },
      { id: "p3", name: "Otra", instagram_business_account: { id: "ig-2", username: "otra" } },
    ],
  };

  it("se queda con la primera pagina que tiene cuenta profesional", async () => {
    const result = await resolveIgAccount("t", fakeFetch(paginas));

    expect(result).toMatchObject({ ok: true, account: { igId: "ig-1", username: "mia", pageId: "p2" } });
  });

  it("deja ver todas, para poder elegir otra", async () => {
    const result = await resolveIgAccount("t", fakeFetch(paginas));

    expect(result.ok && result.account.pages).toHaveLength(2);
  });

  it("respeta la pagina elegida a mano", async () => {
    const result = await resolveIgAccount("t", fakeFetch(paginas), "p3");

    expect(result.ok && result.account.igId).toBe("ig-2");
  });

  it("si la pagina no trae el usuario, lo pregunta aparte", async () => {
    // Sin eso la card mostraria un id numerico.
    const result = await resolveIgAccount(
      "t",
      fakeFetch({ data: [{ id: "p1", instagram_business_account: { id: "ig-9" } }] }, { username: "resuelto" }),
    );

    expect(result.ok && result.account.username).toBe("resuelto");
  });

  it("sin ninguna pagina con Instagram lo dice claro", async () => {
    const result = await resolveIgAccount("t", fakeFetch({ data: [{ id: "p1" }] }));

    expect(result).toMatchObject({ ok: false, reason: "no_page" });
  });

  it("un token invalido no se confunde con no tener paginas", async () => {
    const result = await resolveIgAccount("t", fakeFetch({ error: { code: 190, message: "bad" } }));

    expect(result).toMatchObject({ ok: false, reason: "invalid_token" });
  });
});
