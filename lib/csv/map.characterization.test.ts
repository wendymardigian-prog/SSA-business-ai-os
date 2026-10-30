/**
 * Caracterizacion del mapeo del importador con los encabezados reales del export
 * de wendymardigian.com, escrita ANTES de la suscripcion a emails.
 *
 * Fija como se mapean hoy las columnas que NO son de suscripcion: tienen que
 * seguir igual despues de sumar las columnas de suscripcion (E6). Las de
 * suscripcion (`email_subscribed`, `subscribed_at`, `unsubscribed_at`,
 * `unsubscribe_source`) tienen su propio test.
 */

import { describe, it, expect } from "vitest";
import { mapRow, suggestMapping } from "./map";

const HEADERS = [
  "id", "email", "email_normalized", "nombre", "telefono", "instagram", "negocio", "source", "canal",
  "lead_status", "utm_source", "utm_medium", "utm_campaign", "created_at",
  "email_subscribed", "subscribed_at", "unsubscribed_at", "unsubscribe_source",
];

describe("suggestMapping con el export real (hoy)", () => {
  const byHeader = Object.fromEntries(suggestMapping(HEADERS).map((m) => [m.header, m.target]));

  it("las columnas de identidad y atribucion caen solas", () => {
    expect(byHeader.email).toBe("email");
    expect(byHeader.nombre).toBe("display_name");
    expect(byHeader.telefono).toBe("phone");
    expect(byHeader.instagram).toBe("instagram_username");
    // `source` va antes en el archivo y se queda con "Fuente": utm_source queda sin mapear
    // (la guia de importacion explica como cambiarlo a mano si conviene).
    expect(byHeader.source).toBe("attr:source");
    expect(byHeader.utm_medium).toBe("attr:medium");
    expect(byHeader.utm_campaign).toBe("attr:campaign");
    expect(byHeader.created_at).toBe("attr:first_touch_at");
  });

  it("utm_source no pisa a `source` (el campo ya esta tomado) y lo demas queda sin mapear", () => {
    expect(byHeader.utm_source).toBe("");
    expect(byHeader.id).toBe("");
    expect(byHeader.email_normalized).toBe("");
    expect(byHeader.negocio).toBe("");
    expect(byHeader.canal).toBe("");
    expect(byHeader.lead_status).toBe("");
  });
});

describe("mapRow con una fila del export (hoy)", () => {
  it("la fecha original va a la fecha del primer contacto", () => {
    const mapping = suggestMapping(HEADERS);
    const values = [
      "1", "Ana@Example.com", "ana@example.com", "Ana", "+5491111111111", "ana_ig", "Neg", "web", "form",
      "nuevo", "google", "cpc", "otono", "2025-03-04", "true", "2025-03-04", "", "",
    ];
    const r = mapRow(values, mapping, 0, [], "2026-10-29");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.patch.email).toBe("ana@example.com");
    expect(r.row.attribution).toEqual({ source: "web", medium: "cpc", campaign: "otono", firstTouchDate: "2025-03-04" });
  });
});
