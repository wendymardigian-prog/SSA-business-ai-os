// @plantilla-quitar(ventas)
import { describe, expect, it, vi } from "vitest";
import { inheritContactAffiliate, vigenteAffiliate } from "./sale-inherit";

const now = new Date("2026-11-08T12:00:00Z");

describe("la venta hereda el afiliado vigente del contacto", () => {
  it("solo si no venció", () => {
    expect(vigenteAffiliate({ affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "originated", affiliate_expires_at: null }, now)).toEqual({ ref: { type: "user", id: "u1" }, kind: "originated" });
    expect(vigenteAffiliate({ affiliate_user_id: null, affiliate_contact_id: "c1", affiliate_kind: null, affiliate_expires_at: "2026-12-01T00:00:00Z" }, now)).toEqual({ ref: { type: "contact", id: "c1" }, kind: "influenced" });
    expect(vigenteAffiliate({ affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "influenced", affiliate_expires_at: "2026-11-01T00:00:00Z" }, now)).toBeNull();
    expect(vigenteAffiliate(null, now)).toBeNull();
  });

  it("nunca lanza: un error de la base deja la venta sin afiliado", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { affiliate_user_id: "u1", affiliate_contact_id: null, affiliate_kind: "originated", affiliate_expires_at: null } }) };
    const ok = { from: () => chain, rpc: vi.fn().mockResolvedValue({ error: null }) };
    expect(await inheritContactAffiliate(ok as never, "w", "s", "c", now)).toBe(true);
    expect(ok.rpc).toHaveBeenCalledWith("affiliate_set_sale", { p_sale_id: "s", p_affiliate: { type: "user", id: "u1" }, p_kind: "originated", p_reason: null });
    const bad = { from: () => { throw new Error("caida"); }, rpc: vi.fn() };
    expect(await inheritContactAffiliate(bad as never, "w", "s", "c", now)).toBe(false);
  });
});
