/**
 * F88: cómo se muestra la atribución.
 *
 * Los criterios de la funcionalidad: sin toques, el estado vacío de hoy y NADA
 * inventado; con uno solo, primero y último son el mismo y se muestra una vez;
 * y cada toque se lee solo, con el nombre de la pieza como link.
 */
import { describe, it, expect } from "vitest";
import { accountOfRaw, buildAttributionView, describeTouch, pieceHref, shortDate, type TouchRow } from "./attribution-view";

const CP = "22222222-2222-4222-8222-222222222222";

const row = (over: Partial<TouchRow> = {}): TouchRow => ({
  id: "t-1",
  occurred_at: "2026-09-12T18:00:00Z",
  source: "instagram",
  medium: "dm",
  content_label: null,
  content_post_id: null,
  origin: "dm",
  ...over,
});

describe("pieceHref (Contenido v3)", () => {
  it("abre la pieza en el drawer del tablero, no en la ruta vieja que solo redirige", () => {
    expect(pieceHref("a4e752e4-f5ca-4891-86a4-b4257c06f6a0")).toBe(
      "/dashboard/content?piece=a4e752e4-f5ca-4891-86a4-b4257c06f6a0",
    );
  });
});

describe("la fecha corta (F88)", () => {
  it("se dice como se diría: '12 sep'", () => {
    expect(shortDate("2026-09-12T18:00:00Z")).toBe("12 sep");
    expect(shortDate("2026-01-03T18:00:00Z")).toBe("3 ene");
  });

  it("es la fecha de quien mira (la zona del negocio), no la de UTC", () => {
    // 02:00 UTC del 13 es todavía el 12 a las 20:00 en Costa Rica.
    expect(shortDate("2026-09-13T02:00:00Z", "America/Costa_Rica")).toBe("12 sep");
    expect(shortDate("2026-09-13T02:00:00Z", "UTC")).toBe("13 sep");
  });

  it("sin fecha o con una fecha rota, vacío y no 'Invalid Date'", () => {
    expect(shortDate(null)).toBe("");
    expect(shortDate(undefined)).toBe("");
    expect(shortDate("no-es-una-fecha")).toBe("");
  });

  it("una zona inválida no rompe la ficha", () => {
    expect(shortDate("2026-09-12T18:00:00Z", "Mars/Olympus")).toBe("12 sep");
  });
});

describe("un toque dicho en palabras (F88)", () => {
  it("origen, pieza y fecha, tal como el ejemplo del plano", () => {
    const view = describeTouch({
      source: "instagram", medium: "comment", content: "cómo cobrar en dólares", content_post_id: CP,
      occurred_at: "2026-09-12T18:00:00Z",
    });

    expect(view.text).toBe("Instagram · comentario · «cómo cobrar en dólares» · 12 sep");
    expect(view.origin).toBe("Instagram · comentario");
    expect(view.piece).toBe("cómo cobrar en dólares");
  });

  it("el nombre de la pieza es un link a la pieza, cuando se conoce", () => {
    expect(describeTouch({ source: "instagram", content: "Reel", content_post_id: CP }).href).toBe(pieceHref(CP));
    expect(describeTouch({ source: "instagram", content: "Un post hecho a mano" }).href).toBeNull();
  });

  it("un DM sin pieza ni fecha no deja separadores colgando", () => {
    expect(describeTouch({ source: "instagram", medium: "dm" }).text).toBe("Instagram · mensaje directo");
  });

  it("una fuente o un medio fuera de la lista se muestran tal cual y el medio queda marcado", () => {
    const view = describeTouch({ source: "facebook", medium: "podcast", medium_raw: true });

    expect(view.text).toBe("Facebook · podcast");
    expect(view.rawMedium).toBe(true);
  });

  it("el 'scheduling' viejo de las reservas se llama Agendamiento", () => {
    expect(describeTouch({ source: "scheduling", medium: "booking" }).text).toBe("Agendamiento · reserva");
  });
});

describe("la sección de atribución (F88)", () => {
  it("sin ningún toque: el estado vacío, sin ceros ni guiones inventados", () => {
    expect(buildAttributionView({ attribution: {} })).toEqual({ empty: true, first: null, last: null, path: [] });
    expect(buildAttributionView({ attribution: null }).empty).toBe(true);
    expect(buildAttributionView({ attribution: "basura" }).empty).toBe(true);
  });

  it("con un solo toque, primero y último son el mismo y se muestra UNA vez", () => {
    const touch = { source: "instagram", medium: "dm", occurred_at: "2026-09-12T18:00:00Z" };
    const view = buildAttributionView({ attribution: { version: 2, first_touch: touch, last_touch: { ...touch } } });

    expect(view.empty).toBe(false);
    expect(view.first?.text).toBe("Instagram · mensaje directo · 12 sep");
    expect(view.last).toBeNull();
  });

  it("con un solo toque en la tabla, también se muestra una vez", () => {
    const view = buildAttributionView({ attribution: {}, rows: [row()] });

    expect(view.first?.text).toBe("Instagram · mensaje directo · 12 sep");
    expect(view.last).toBeNull();
    expect(view.path).toHaveLength(1);
  });

  it("con varios, el primero y el último son distintos y el camino va en orden", () => {
    const rows = [
      row({ id: "t-3", occurred_at: "2026-10-01T18:00:00Z", medium: "dm" }),
      row({ id: "t-1", occurred_at: "2026-09-12T18:00:00Z", medium: "comment", content_label: "Reel de dólares", content_post_id: CP }),
      row({ id: "t-2", occurred_at: "2026-09-20T18:00:00Z", medium: "story_reply" }),
    ];
    const view = buildAttributionView({
      attribution: {
        version: 2,
        first_touch: { source: "instagram", medium: "comment", content: "Reel de dólares", content_post_id: CP, occurred_at: "2026-09-12T18:00:00Z" },
        last_touch: { source: "instagram", medium: "dm", occurred_at: "2026-10-01T18:00:00Z" },
      },
      rows,
    });

    expect(view.first?.text).toBe("Instagram · comentario · «Reel de dólares» · 12 sep");
    expect(view.first?.href).toBe(pieceHref(CP));
    expect(view.last?.text).toBe("Instagram · mensaje directo · 1 oct");
    expect(view.path.map((p) => p.when)).toEqual(["12 sep", "20 sep", "1 oct"]);
    expect(view.path[1].text).toContain("respuesta a una historia");
  });

  it("una atribución en la forma vieja (clicks) también se muestra", () => {
    const view = buildAttributionView({
      attribution: { first_click: { utm_source: "facebook", utm_medium: "cpc", captured_at: "2026-09-01T12:00:00Z" } },
    });

    expect(view.empty).toBe(false);
    expect(view.first?.text).toBe("Facebook · anuncio · 1 sep");
  });

  it("la atribución plana de una reserva, que antes era invisible, se muestra", () => {
    const view = buildAttributionView({ attribution: { source: "scheduling", utm_campaign: "octubre" } });

    expect(view.empty).toBe(false);
    expect(view.first?.text).toBe("Agendamiento · reserva");
  });

  it("sin la copia derivada pero con toques en la tabla, se arma desde la tabla", () => {
    const view = buildAttributionView({
      attribution: {},
      rows: [row({ id: "a", occurred_at: "2026-09-01T12:00:00Z" }), row({ id: "b", occurred_at: "2026-09-05T12:00:00Z", medium: "comment" })],
    });

    expect(view.empty).toBe(false);
    expect(view.first?.when).toBe("1 sep");
    expect(view.last?.when).toBe("5 sep");
  });

  it("respeta la zona del negocio", () => {
    const view = buildAttributionView({
      attribution: {},
      rows: [row({ occurred_at: "2026-09-13T02:00:00Z" })],
      timeZone: "UTC",
    });

    expect(view.first?.when).toBe("13 sep");
  });
});

describe("el nombre del formulario ya no es el contenido (Extra L, F18)", () => {
  const formRow = (over: Partial<TouchRow> = {}) =>
    row({ id: "f-1", occurred_at: "2026-09-12T18:00:00Z", source: "web", medium: "form", origin: "form", content_label: null, raw: { source_id: "form-1", source_type: "form" }, ...over });

  it("un toque de formulario sin utm_content muestra el nombre del formulario (de raw.source_id) en el camino y en el primero", () => {
    const view = buildAttributionView({
      attribution: { version: 2, first_touch: { source: "web", medium: "form", origin: "form", occurred_at: "2026-09-12T18:00:00Z" } },
      rows: [formRow()],
      formNames: { "form-1": "Diagnóstico gratis" },
    });
    expect(view.path[0].piece).toBe("Diagnóstico gratis");
    expect(view.first?.piece).toBe("Diagnóstico gratis");
  });

  it("si el toque trae utm_content, ese es el contenido (no el formulario)", () => {
    const view = buildAttributionView({ attribution: {}, rows: [formRow({ content_label: "video-1" })], formNames: { "form-1": "Diagnóstico gratis" } });
    expect(view.path[0].piece).toBe("video-1");
  });

  it("un formulario que ya no existe o un toque que no es de formulario no inventan nada", () => {
    const sin = buildAttributionView({ attribution: {}, rows: [formRow()], formNames: {} });
    expect(sin.path[0].piece).toBeNull();
    const dm = buildAttributionView({ attribution: {}, rows: [row({ raw: { source_id: "form-1" } })], formNames: { "form-1": "X" } });
    expect(dm.path[0].piece).toBeNull();
  });
});

describe("describeTouch (F21: anuncio y detalle)", () => {
  it("un toque de anuncio dice campaña › conjunto › anuncio con los ids crudos y junta el detalle", () => {
    const view = describeTouch({
      source: "facebook",
      medium: "paid_social",
      occurred_at: "2026-10-05T10:00:00Z",
      campaign_id: "77",
      adset_id: "88",
      ad_id: "99",
      fbclid: "abc",
      landing_page: "https://x.com/lp",
    });
    expect(view.adLine).toContain("Campaña 77 › Conjunto 88 › Anuncio 99");
    expect(view.details.map((d) => d.label)).toEqual(["Clic de Facebook (fbclid)", "Página de llegada"]);
  });

  it("sin ids de anuncio ni detalle no inventa nada", () => {
    const view = describeTouch({ source: "instagram", medium: "dm", occurred_at: "2026-10-05T10:00:00Z" });
    expect(view.ad).toBeNull();
    expect(view.adLine).toBeNull();
    expect(view.details).toEqual([]);
  });
});

describe("describeTouch con el vinculo de Meta (AT3, F21)", () => {
  const base = { source: "facebook", medium: "paid_social", occurred_at: "2026-10-05T10:00:00Z" } as const;
  const names = {
    campaigns: { "1001": "Campaña Octubre" },
    adsets: { "2001": "Conjunto Frío" },
    ads: { "3001": { name: "Video Testimonio", thumbnailUrl: "https://signed.example/t.png" } },
  };

  it("con catalogo dice campaña › conjunto › anuncio por NOMBRE y trae la miniatura", () => {
    const view = describeTouch({ ...base, meta_campaign_id: "1001", meta_adset_id: "2001", meta_ad_id: "3001", meta_match_status: "matched", meta_match_method: "utm_content_name" }, undefined, null, names);
    expect(view.adLine).toBe("Meta · Campaña Octubre › Conjunto Frío › Video Testimonio");
    expect(view.adThumbnail).toBe("https://signed.example/t.png");
    expect(view.matchNote).toBe("Vinculado por el nombre del anuncio");
  });

  it("sin catalogo (o sin permiso para verlo) cae a los ids, sin miniatura", () => {
    const view = describeTouch({ ...base, meta_campaign_id: "1001", meta_ad_id: "3001", meta_match_status: "matched", meta_match_method: "ad_id" });
    expect(view.adLine).toBe("Meta · Campaña 1001 › Anuncio 3001");
    expect(view.adThumbnail).toBeNull();
  });

  it("un id que el catalogo no conoce se queda con su id", () => {
    const view = describeTouch({ ...base, meta_campaign_id: "1001", meta_ad_id: "999" }, undefined, null, names);
    expect(view.adLine).toBe("Meta · Campaña Octubre › Anuncio 999");
  });

  it("a mano, sin vincular e ignorado se dicen en palabras", () => {
    expect(describeTouch({ ...base, meta_ad_id: "3001", meta_match_status: "manual" }, undefined, null, names).matchNote).toBe("Vinculado a mano");
    expect(describeTouch({ ...base, ad_id: "9", meta_match_status: "unmatched" }).matchNote).toBe("No se pudo vincular con un anuncio de Meta");
    expect(describeTouch({ ...base, meta_match_status: "ignored" }).matchNote).toBe("Ignorado para el vínculo con Meta");
  });

  it("sin vinculo, los ids que trajo el toque siguen mostrandose como antes (AT1)", () => {
    const view = describeTouch({ ...base, campaign_id: "77", adset_id: "88", ad_id: "99" });
    expect(view.adLine).toContain("Campaña 77 › Conjunto 88 › Anuncio 99");
    expect(view.matchNote).toBeNull();
  });

  it("buildAttributionView usa los nombres en el primer toque, el ultimo y el camino", () => {
    const rows = [row({ id: "t-1", source: "facebook", medium: "paid_social", origin: "booking", meta_campaign_id: "1001", meta_ad_id: "3001", meta_match_status: "matched", meta_match_method: "ad_id" })];
    const view = buildAttributionView({ attribution: null, rows, names });
    expect(view.first?.adLine).toBe("Meta · Campaña Octubre › Video Testimonio");
    expect(view.path[0].adLine).toBe("Meta · Campaña Octubre › Video Testimonio");
  });
});

describe("el canal de cada toque (Extra I, F37)", () => {
  const row = (over: Record<string, unknown>) => ({ id: "t", occurred_at: "2026-09-01T10:00:00Z", source: "instagram", medium: "comment", content_label: null, content_post_id: null, origin: "comment", ...over });

  it("cada toque del camino lleva su canal y su etiqueta", () => {
    const view = buildAttributionView({
      attribution: null,
      rows: [row({ id: "a", channel: "organic" }), row({ id: "b", occurred_at: "2026-09-05T10:00:00Z", channel: "paid", ad_id: "1" })],
    });
    expect(view.path.map((p) => p.channelLabel)).toEqual(["Orgánico", "Pauta"]);
    expect(view.first?.channel).toBe("organic");
    expect(view.last?.channel).toBe("paid");
  });

  it("un toque viejo sin canal no inventa uno (el resultado no tiene las claves)", () => {
    const view = buildAttributionView({ attribution: null, rows: [row({})] });
    expect("channel" in view.path[0]).toBe(false);
    expect("channelLabel" in view.path[0]).toBe(false);
  });
});

describe("la cuenta nuestra en el toque (varias cuentas de la misma red)", () => {
  it("un toque con cuenta la dice en su vista y en su frase", () => {
    const view = describeTouch(
      { source: "instagram", medium: "dm", occurred_at: "2026-09-12T18:00:00Z" } as never,
      "UTC",
      null,
      undefined,
      "@marca_academia",
    );
    expect(view.account).toBe("@marca_academia");
    expect(view.text).toContain("@marca_academia");
    // El origen no cambia: lo usan otras pantallas.
    expect(view.origin).not.toContain("@marca_academia");
  });

  it("sin cuenta el resultado es identico al de siempre", () => {
    const base = describeTouch({ source: "instagram", medium: "dm", occurred_at: "2026-09-12T18:00:00Z" } as never, "UTC");
    expect(base).not.toHaveProperty("account");
    expect(base.text).not.toContain("@");
  });

  it("el camino lee la cuenta del raw de cada toque, y la copia derivada la busca por fecha", () => {
    const rows = [
      row({ id: "t1", occurred_at: "2026-09-10T10:00:00Z", raw: { account_label: "@marca_principal" } }),
      row({ id: "t2", occurred_at: "2026-09-12T18:00:00Z", raw: { message_id: "m1" } }),
    ];
    const view = buildAttributionView({ attribution: null, rows });
    expect(view.path.map((t) => t.account)).toEqual(["@marca_principal", undefined]);
    expect(view.first?.account).toBe("@marca_principal");
    expect(view.last?.account).toBeUndefined();
  });

  it("accountOfRaw ignora un raw sin cuenta o con forma rara", () => {
    expect(accountOfRaw(null)).toBeNull();
    expect(accountOfRaw([])).toBeNull();
    expect(accountOfRaw({ account_label: 5 })).toBeNull();
    expect(accountOfRaw({ account_label: "  " })).toBeNull();
    expect(accountOfRaw({ account_label: " @marca " })).toBe("@marca");
  });
});
