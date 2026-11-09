// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import { affiliateDedupeKey, affiliateEventMatches, affiliateVariables } from "./automation";

describe("los disparadores de afiliados", () => {
  it("filtran por afiliado y por tipo; vacío = todos", () => {
    const p = { affiliate_type: "user", affiliate_id: "u1", affiliate_kind: "originated" };
    expect(affiliateEventMatches({}, p)).toBe(true);
    expect(affiliateEventMatches({ affiliateId: "u1" }, p)).toBe(true);
    expect(affiliateEventMatches({ affiliateId: "u2" }, p)).toBe(false);
    expect(affiliateEventMatches({ affiliateKind: "influenced" }, p)).toBe(false);
    expect(affiliateEventMatches(null, null)).toBe(true);
  });
  it("una ejecución por evento y variables en palabras", () => {
    expect(affiliateDedupeKey("affiliate_sale_created", "e1")).toBe("affiliate_sale_created:e1");
    expect(affiliateVariables({ affiliate_type: "contact", affiliate_kind: "influenced", sale_id: "s1" })).toEqual({ "affiliate.type": "externo", "affiliate.kind": "influyó", "affiliate.sale_id": "s1" });
  });
});
