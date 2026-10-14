/**
 * Caracterizacion ANTES de B6 (plano formularios-ui): lo que muestra HOY la
 * seccion de atribucion de un contacto para un toque con anuncio de Meta.
 *
 * B6 suma la URL de entrada a cada visita; lo que ya se muestra (origen,
 * anuncio, detalle, camino) no cambia. Datos de ejemplo.
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
