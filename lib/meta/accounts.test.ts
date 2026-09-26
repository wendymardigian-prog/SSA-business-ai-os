/**
 * Cuentas publicitarias de Meta (F40).
 *
 * Portado de ScaleOS y extendido: aca las cuentas viven en la config de la
 * integracion, no en una tabla.
 */

import { describe, it, expect, vi } from "vitest";
import {
  applySelection,
  fetchAdAccounts,
  markSync,
  mergeAdAccounts,
  normalizeAdAccountId,
  parseMetaConfig,
  resolveSyncedAccount,
  syncedAccounts,
  type AdAccount,
} from "./accounts";

const account = (over: Partial<AdAccount> = {}): AdAccount => ({
  ad_account_id: "act_1",
  name: "Cuenta 1",
  currency: "ARS",
  timezone: "America/Argentina/Buenos_Aires",
  sync_enabled: false,
  last_synced_at: null,
  last_error: null,
  first_sync_completed_at: null,
  ...over,
});

function fakeFetch(...pages: unknown[]) {
  const queue = [...pages];
  return vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => queue.shift() ?? {},
  })) as unknown as typeof fetch;
}

describe("el id de la cuenta (F40)", () => {
  it("siempre queda como act_<n>", () => {
    expect(normalizeAdAccountId("123")).toBe("act_123");
    expect(normalizeAdAccountId("act_123")).toBe("act_123");
    expect(normalizeAdAccountId("  act_123  ")).toBe("act_123");
  });
});

describe("traer las cuentas del grafo (F40)", () => {
  it("sigue el cursor hasta agotarlo", async () => {
    const impl = fakeFetch(
      { data: [{ id: "1", name: "Una" }], paging: { next: "https://graph/siguiente" } },
      { data: [{ id: "act_2", name: "Otra" }] },
    );

    const result = await fetchAdAccounts("t", impl);

    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.accounts.map((a) => a.id)).toEqual(["act_1", "act_2"]);
  });

  it("un error del grafo vuelve como resultado, en castellano", async () => {
    const impl = fakeFetch({ error: { code: 190, message: "Invalid OAuth token" } });

    const result = await fetchAdAccounts("t", impl);

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.error).toContain("Business Manager");
  });

  it("un cursor infinito no se lleva puesta la funcion", async () => {
    const impl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: [{ id: "act_1" }], paging: { next: "https://graph/loop" } }),
    })) as unknown as typeof fetch;

    await fetchAdAccounts("t", impl, 3);

    expect(impl).toHaveBeenCalledTimes(3);
  });
});

describe("juntar con lo guardado (F40)", () => {
  it("refresca el nombre y CONSERVA si esta sincronizando", () => {
    // Pisarlo apagaria la sincronizacion cada vez que se abre la card.
    const merged = mergeAdAccounts(
      [{ id: "act_1", name: "Nombre nuevo" }],
      [account({ sync_enabled: true, last_synced_at: "2026-09-01T00:00:00Z" })],
    );

    expect(merged[0]).toMatchObject({
      name: "Nombre nuevo",
      sync_enabled: true,
      last_synced_at: "2026-09-01T00:00:00Z",
    });
  });

  it("una cuenta nueva nace apagada", () => {
    const merged = mergeAdAccounts([{ id: "act_9", name: "Nueva" }], []);

    expect(merged[0].sync_enabled).toBe(false);
  });

  it("una que el token ya no alcanza se conserva visible", () => {
    // Desaparecer sin decir nada es la peor forma de enterarse de que se
    // perdio un permiso.
    const merged = mergeAdAccounts([], [account({ ad_account_id: "act_5", sync_enabled: true })]);

    expect(merged.map((a) => a.ad_account_id)).toEqual(["act_5"]);
  });

  it("el orden es estable", () => {
    const merged = mergeAdAccounts(
      [{ id: "act_3" }, { id: "act_1" }, { id: "act_2" }],
      [],
    );

    expect(merged.map((a) => a.ad_account_id)).toEqual(["act_1", "act_2", "act_3"]);
  });
});

describe("cuales se sincronizan (F40)", () => {
  const cuentas = [
    account({ ad_account_id: "act_1", sync_enabled: true }),
    account({ ad_account_id: "act_2", sync_enabled: false }),
    account({ ad_account_id: "act_3", sync_enabled: true }),
  ];

  it("solo las tildadas", () => {
    expect(syncedAccounts(cuentas).map((a) => a.ad_account_id)).toEqual(["act_1", "act_3"]);
  });

  it("destildar una la saca del cron", () => {
    const after = applySelection(cuentas, ["act_2"]);

    expect(after.find((a) => a.ad_account_id === "act_1")!.sync_enabled).toBe(false);
    expect(after.find((a) => a.ad_account_id === "act_2")!.sync_enabled).toBe(true);
  });

  it("sin pedir ninguna, se usa la primera habilitada", () => {
    expect(resolveSyncedAccount(cuentas)).toEqual({ ok: true, adAccountId: "act_1" });
  });

  it("pedir una que no esta sincronizando se rechaza", () => {
    expect(resolveSyncedAccount(cuentas, "act_2")).toEqual({ ok: false, reason: "not_synced" });
  });

  it("sin ninguna habilitada lo dice", () => {
    expect(resolveSyncedAccount([account()])).toEqual({ ok: false, reason: "no_synced_account" });
  });
});

describe("anotar la sincronizacion (F40)", () => {
  it("una buena deja la fecha y limpia el error", () => {
    const after = markSync([account({ last_error: "algo" })], "act_1", {
      at: "2026-10-01T03:30:00Z",
      firstSync: true,
    });

    expect(after[0]).toMatchObject({
      last_synced_at: "2026-10-01T03:30:00Z",
      last_error: null,
      first_sync_completed_at: "2026-10-01T03:30:00Z",
    });
  });

  it("una fallida igual deja la fecha del intento", () => {
    // Sin eso no se sabe si el cron esta corriendo o si murio.
    const after = markSync([account()], "act_1", { at: "2026-10-01T03:30:00Z", error: "Meta nos corto" });

    expect(after[0]).toMatchObject({
      last_synced_at: "2026-10-01T03:30:00Z",
      last_error: "Meta nos corto",
      first_sync_completed_at: null,
    });
  });

  it("no toca las otras cuentas", () => {
    const otras = [account({ ad_account_id: "act_2" })];
    expect(markSync(otras, "act_1", { at: "x" })).toEqual(otras);
  });
});

describe("la config guardada (F40)", () => {
  it("una config rota se trata como vacia, no rompe la pantalla", () => {
    expect(parseMetaConfig({ ad_accounts: "no soy una lista" })).toMatchObject({ ad_accounts: [] });
  });

  it("una vacia tiene la forma completa", () => {
    expect(parseMetaConfig(null)).toEqual({
      business_id: null,
      ig_business_account_id: null,
      ig_username: null,
      page_id: null,
      ad_accounts: [],
    });
  });
});
