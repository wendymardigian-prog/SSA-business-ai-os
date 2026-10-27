/**
 * Caracterizacion de lo que muestra la seccion de atribucion de un contacto
 * para un toque con anuncio de Meta: origen, anuncio, detalle y camino (la URL
 * de entrada de cada visita va aparte). Datos de ejemplo.
 */

import { describe, expect, it } from "vitest";
import { buildAttributionView, type TouchRow } from "./attribution-view";

const ROWS: TouchRow[] = [
  {
    id: "t1",
    occurred_at: "2026-09-20T15:00:00.000Z",
    source: "instagram",
    medium: "social",
    content_label: null,
    content_post_id: null,
    origin: "comment",
    referrer_url: null,
    landing_page: null,
  },
  {
    id: "t2",
    occurred_at: "2026-10-02T13:30:00.000Z",
    source: "facebook",
    medium: "paid",
    content_label: "Video testimonio",
    content_post_id: null,
    origin: "form",
    campaign: "Programa X · clase jueves",
    term: null,
    ad_id: "120214558930140527",
    adset_id: "120214558930130527",
    campaign_id: "120214558930120527",
    fbclid: "IwZXh0bgNhZW0BMABh",
    referrer_url: "https://l.facebook.com/",
    landing_page: "https://ejemplo.test/programa-x?utm_source=facebook",
    raw: { source_id: "form-1" },
  },
];

describe("caracterizacion: buildAttributionView (hoy)", () => {
  it("camino de dos toques, con la zona horaria de quien mira", () => {
    const view = buildAttributionView({ attribution: null, rows: ROWS, timeZone: "America/Costa_Rica", formNames: { "form-1": "Aplicación al Programa X" } });
    expect(view).toMatchSnapshot();
  });

  it("el detalle del toque lista UTM, ids de clic, de donde venia y pagina de llegada, en este orden", () => {
    const view = buildAttributionView({ attribution: null, rows: ROWS });
    const last = view.last ?? view.first;
    expect(last?.details.map((d) => d.label)).toEqual(["Campaña (UTM)", "Clic de Facebook (fbclid)", "Venía de", "Página de llegada"]);
  });

  it("sin toques no hay nada que mostrar", () => {
    expect(buildAttributionView({ attribution: null, rows: [] })).toEqual({ empty: true, first: null, last: null, path: [] });
  });
});

describe("la URL de entrada en la ficha (plano formularios-ui, F19)", () => {
  const ENTRY = "https://ejemplo.test/programa-x?utm_source=facebook&ad_name=Video+Noe&ref=podcast";
  const withEntry = ROWS.map((r) => (r.id === "t2" ? { ...r, entry_url: ENTRY } : r));

  it("el camino y las tarjetas muestran la URL de la visita que la tiene, y solo esa", () => {
    const view = buildAttributionView({ attribution: null, rows: withEntry });
    expect(view.path.map((t) => t.entryUrl)).toEqual([undefined, ENTRY]);
    expect(view.last?.entryUrl).toBe(ENTRY);
    expect(view.first?.entryUrl).toBeUndefined();
  });

  it("con la copia derivada (sin la URL) la URL se busca en la fila de la misma fecha", () => {
    const derived = {
      version: 2,
      first_touch: { occurred_at: ROWS[0].occurred_at, source: "instagram", medium: "social", origin: "comment" },
      last_touch: { occurred_at: ROWS[1].occurred_at, source: "facebook", medium: "paid", content: "Video testimonio", origin: "form" },
    };
    const view = buildAttributionView({ attribution: derived, rows: withEntry });
    expect(view.last?.entryUrl).toBe(ENTRY);
  });

  it("todo lo que ya se mostraba sigue igual: quitando entryUrl, el resultado es el de hoy", () => {
    const strip = (v: ReturnType<typeof buildAttributionView>) =>
      JSON.parse(JSON.stringify(v, (k, val) => (k === "entryUrl" ? undefined : val)));
    expect(strip(buildAttributionView({ attribution: null, rows: withEntry, timeZone: "America/Costa_Rica", formNames: { "form-1": "Aplicación al Programa X" } }))).toEqual(
      strip(buildAttributionView({ attribution: null, rows: ROWS, timeZone: "America/Costa_Rica", formNames: { "form-1": "Aplicación al Programa X" } })),
    );
  });
});
