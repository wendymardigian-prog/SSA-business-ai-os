/**
 * Caracterizacion ANTES de B6 (plano formularios-ui): lo que muestra HOY la
 * atribucion del detalle de una respuesta con anuncio de Meta y primera visita.
 *
 * B6 suma la URL de entrada como un dato APARTE (`entry_url`): estas secciones,
 * con las mismas claves de hoy, tienen que seguir dando exactamente esto. Los
 * valores son de ejemplo (nada de personas reales).
 */

import { describe, expect, it } from "vitest";
import { attributionSections } from "./attribution-view";

const META = {
  utm_source: "facebook",
  utm_medium: "paid",
  utm_campaign: "Programa X · clase jueves",
  utm_content: "Video testimonio",
  ad_id: "120214558930140527",
  adset_id: "120214558930130527",
  campaign_id: "120214558930120527",
  placement: "Instagram_Reels",
  fbclid: "IwZXh0bgNhZW0BMABh",
  fbp: "fb.1.1758810022.4410293",
  fbc: "fb.1.1760368140.IwZXh0",
  landing_page: "https://ejemplo.test/programa-x?utm_source=facebook&utm_medium=paid",
  page_url: "https://ejemplo.test/aplicar",
  referrer_url: "https://l.facebook.com/",
  first_visit: {
    utm_source: "instagram",
    utm_medium: "social",
    utm_campaign: "bio",
    landing_page: "https://ejemplo.test/?utm_source=instagram",
    ts: 1758000000,
  },
};

describe("caracterizacion: attributionSections (hoy)", () => {
  it("una respuesta con anuncio de Meta y una primera visita distinta", () => {
    expect(attributionSections(META)).toMatchSnapshot();
  });

  it("sin primera visita no hay seccion de primera visita", () => {
    const { first_visit: _f, ...rest } = META;
    expect(attributionSections(rest).map((s) => s.title)).toEqual(["Campaña", "Anuncio", "Navegador", "Páginas"]);
  });

  it("una primera visita igual a la actual no se repite", () => {
    const same = { utm_source: "facebook", first_visit: { utm_source: "facebook", ts: 1 } };
    expect(attributionSections(same).map((s) => s.title)).toEqual(["Campaña"]);
  });

  it("sin atribucion no hay secciones", () => {
    expect(attributionSections(null)).toEqual([]);
    expect(attributionSections({})).toEqual([]);
  });

  it("una clave que no esta en las listas (entry_url incluida) NO aparece en las secciones de hoy", () => {
    // B6 la muestra en su propio bloque, no en estas secciones.
    const out = attributionSections({ utm_source: "facebook", entry_url: "https://ejemplo.test/?ref=x", ad_name: "algo" });
    expect(out.flatMap((s) => s.items.map((i) => i.key))).toEqual(["utm_source"]);
  });
});
