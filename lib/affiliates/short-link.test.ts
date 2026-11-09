// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import { resolveShortLink, type ShortLinkDeps, type ShortLinkProduct } from "./short-link";

const product = (over: Partial<ShortLinkProduct> = {}): ShortLinkProduct => ({
  id: "p1",
  workspaceId: "w1",
  name: "Programa Élite",
  active: true,
  links: { v: 1, items: [{ key: "lk_abc123", name: "Landing", kind: "landing", url: "https://ejemplo.test/landing?x=1", active: true, valid_until: null, variant_id: null }] },
  ...over,
});

const deps = (products: ShortLinkProduct[], owners: string[]): ShortLinkDeps => ({
  productsWithKey: async () => products,
  workspacesWithCode: async (_c, ids) => ids.filter((id) => owners.includes(id)),
  today: "2026-11-08",
});

describe("el link corto de un afiliado", () => {
  it("redirige al link con el código y las UTM, sin pisar lo que tenía", async () => {
    const r = await resolveShortLink("ANA12", "lk_abc123", deps([product()], ["w1"]));
    expect(r.status).toBe("redirect");
    const u = new URL((r as { url: string }).url);
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.searchParams.get("ref")).toBe("ana12");
    expect(u.searchParams.get("utm_campaign")).toBe("programa-elite");
    expect(u.searchParams.get("utm_content")).toBe("lk_abc123");
  });

  it("rechaza lo mal formado sin leer nada", async () => {
    expect(await resolveShortLink("a", "lk_abc123", deps([product()], ["w1"]))).toEqual({ status: "fallback", reason: "bad_input" });
    expect(await resolveShortLink("ana12", "otra", deps([product()], ["w1"]))).toEqual({ status: "fallback", reason: "bad_input" });
  });

  it("no adivina el negocio", async () => {
    expect(await resolveShortLink("ana12", "lk_abc123", deps([product()], []))).toEqual({ status: "fallback", reason: "not_found" });
    const two = [product(), product({ id: "p2", workspaceId: "w2" })];
    expect(await resolveShortLink("ana12", "lk_abc123", deps(two, ["w1", "w2"]))).toEqual({ status: "fallback", reason: "ambiguous" });
    expect((await resolveShortLink("ana12", "lk_abc123", deps(two, ["w2"]))).status).toBe("redirect");
  });

  it("un link inactivo, vencido o de un producto inactivo no redirige", async () => {
    const off = product();
    off.links.items[0].active = false;
    expect(await resolveShortLink("ana12", "lk_abc123", deps([off], ["w1"]))).toEqual({ status: "fallback", reason: "inactive" });
    const old = product();
    old.links.items[0].valid_until = "2026-11-07";
    expect(await resolveShortLink("ana12", "lk_abc123", deps([old], ["w1"]))).toEqual({ status: "fallback", reason: "inactive" });
    expect(await resolveShortLink("ana12", "lk_abc123", deps([product({ active: false })], ["w1"]))).toEqual({ status: "fallback", reason: "inactive" });
  });
});
