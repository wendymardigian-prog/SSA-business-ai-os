// @plantilla-quitar(ventas)
import { describe, expect, it } from "vitest";
import { buildAffiliateUrl, campaignSlug, shortAffiliateUrl, withRef } from "./url";
import { myLinksView } from "./my-links";

describe("el link con codigo", () => {
  it("suma ref y las UTM del afiliado", () => {
    expect(buildAffiliateUrl("https://ejemplo.test/bsl", "diego42", "programa-x", "lk_aaaaa1")).toBe(
      "https://ejemplo.test/bsl?ref=diego42&utm_source=afiliado&utm_medium=referral&utm_campaign=programa-x&utm_content=lk_aaaaa1",
    );
  });
  it("no pisa los parametros que el link ya tenia", () => {
    const u = new URL(buildAffiliateUrl("https://ejemplo.test/bsl?utm_source=ig&x=1", "diego42", "p", "lk_aaaaa1"));
    expect(u.searchParams.get("utm_source")).toBe("ig");
    expect(u.searchParams.get("x")).toBe("1");
    expect(u.searchParams.get("ref")).toBe("diego42");
  });
  it("el link corto y el ?ref= de agenda o formulario", () => {
    expect(shortAffiliateUrl("https://app.test/", "diego42", "lk_aaaaa1")).toBe("https://app.test/r/diego42/lk_aaaaa1");
    expect(withRef("https://app.test/f/clase?utm_source=x", "diego42")).toBe("https://app.test/f/clase?utm_source=x&ref=diego42");
    expect(campaignSlug("Programa Ácido 2.0")).toBe("programa-acido-2-0");
  });
});

describe("Mis links", () => {
  it("deja afuera los inactivos y vencidos, y pone los principales primero", () => {
    const view = myLinksView(
      [
        {
          id: "p1",
          name: "Programa",
          active: true,
          links: {
            v: 1,
            primary_learn: "lk_aaaaa2",
            primary_convert: "lk_aaaaa3",
            items: [
              { key: "lk_aaaaa1", name: "Otro", kind: "other", url: "https://a.test/1", active: true, valid_until: null, variant_id: null },
              { key: "lk_aaaaa2", name: "BSL", kind: "landing", url: "https://a.test/2", active: true, valid_until: null, variant_id: null },
              { key: "lk_aaaaa3", name: "Agenda", kind: "booking", url: "https://a.test/3", active: true, valid_until: null, variant_id: null },
              { key: "lk_aaaaa4", name: "Viejo", kind: "landing", url: "https://a.test/4", active: false, valid_until: null, variant_id: null },
              { key: "lk_aaaaa5", name: "Vencido", kind: "landing", url: "https://a.test/5", active: true, valid_until: "2026-01-01", variant_id: null },
            ],
          },
        },
        { id: "p2", name: "Inactivo", active: false, links: { v: 1, items: [] } },
      ],
      "diego42",
      "2026-11-08",
      "https://app.test",
    );
    expect(view.map((p) => p.id)).toEqual(["p1"]);
    expect(view[0].links.map((l) => l.key)).toEqual(["lk_aaaaa2", "lk_aaaaa3", "lk_aaaaa1"]);
    expect(view[0].links[0].withCode).toBe("https://app.test/r/diego42/lk_aaaaa2");
  });
});

import { leadDisplayName } from "./my-links";

describe("el nombre de un referido", () => {
  it("por defecto nombre e inicial; completo o escondido según la regla", () => {
    expect(leadDisplayName("Ana Pérez Gómez", undefined)).toBe("Ana P.");
    expect(leadDisplayName("Ana", "first_name_initial")).toBe("Ana");
    expect(leadDisplayName("Ana Pérez", "full")).toBe("Ana Pérez");
    expect(leadDisplayName("Ana Pérez", "hidden")).toBe("Un contacto");
    expect(leadDisplayName("  ", "full")).toBe("Un contacto");
  });
});
