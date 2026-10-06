/**
 * F88: cómo se muestra la atribución.
 *
 * Los criterios de la funcionalidad: sin toques, el estado vacío de hoy y NADA
 * inventado; con uno solo, primero y último son el mismo y se muestra una vez;
 * y cada toque se lee solo, con el nombre de la pieza como link.
 */
import { describe, it, expect } from "vitest";
import { buildAttributionView, describeTouch, pieceHref, shortDate, type TouchRow } from "./attribution-view";

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
