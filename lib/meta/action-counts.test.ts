/**
 * La regla de «un nombre por evento» (Tirón 2, E1). Los casos de leads y compras son los MISMOS que corre la gemela en
 * SQL (`00220_meta_leads_recount`, y `verify-ads-attribution` los compara contra la base).
 */
import { describe, expect, it } from "vitest";
import cases from "./action-counts.cases.json";
import {
  canonicalCount,
  countLeadActions,
  countPurchaseActions,
  countScheduleActions,
  countSubmitApplicationActions,
  countViewContentActions,
  toActionMap,
} from "./action-counts";

describe("casos compartidos con SQL", () => {
  for (const c of cases.leads) {
    it(`leads: ${c.nombre}`, () => {
      expect(countLeadActions(c.actions as unknown as Record<string, number>)).toBe(c.esperado);
    });
  }
  for (const c of cases.compras) {
    it(`compras: ${c.nombre}`, () => {
      expect(countPurchaseActions(c.actions as unknown as Record<string, number>)).toBe(c.esperado);
    });
  }
});

describe("las dos formas de `actions` dan lo mismo", () => {
  it("la lista cruda de la API y el mapa guardado", () => {
    const raw = [
      { action_type: "lead", value: "3" },
      { action_type: "onsite_conversion.lead_grouped", value: "3" },
    ];
    expect(countLeadActions(raw)).toBe(3);
    expect(countLeadActions(toActionMap(raw))).toBe(3);
  });

  it("un mismo tipo repetido (por plataforma) se suma al armar el mapa", () => {
    expect(toActionMap([{ action_type: "lead", value: "2" }, { action_type: "lead", value: 1 }])).toEqual({ lead: 3 });
  });

  it("valores que no son numeros se tratan como 0 al sumar y un mapa vacio es null", () => {
    expect(toActionMap([{ action_type: "lead", value: "x" }, { value: 4 }])).toEqual({ lead: 0 });
    expect(countLeadActions({})).toBeNull();
    expect(countLeadActions(undefined)).toBeNull();
    expect(countLeadActions(null)).toBeNull();
  });
});

describe("los demás eventos del píxel", () => {
  it("agendas: omni gana y los demás nombres del mismo evento NO se suman", () => {
    expect(countScheduleActions({ omni_schedule: 4, "offsite_conversion.fb_pixel_schedule": 4, schedule_total: 4 })).toBe(4);
  });

  it("agendas: un nombre que no esta en la lista pero dice «schedule» vale por el mayor (nunca por la suma)", () => {
    expect(countScheduleActions({ "onsite_web_schedule": 3, "web_schedule_extra": 5 })).toBe(5);
  });

  it("agendas: sin ese evento es null (la columna dice «—»)", () => {
    expect(countScheduleActions({ lead: 5, link_click: 9 })).toBeNull();
  });

  it("vistas de contenido: NO se confunde con la variante de leads que lleva «content_view» en el nombre", () => {
    expect(countViewContentActions({ offsite_content_view_add_meta_leads: 12, lead: 12 })).toBeNull();
    expect(countViewContentActions({ omni_view_content: 30, view_content: 30 })).toBe(30);
  });

  it("aplicaciones", () => {
    expect(countSubmitApplicationActions({ "offsite_conversion.fb_pixel_submit_application": 2 })).toBe(2);
    expect(countSubmitApplicationActions({ lead: 3 })).toBeNull();
  });
});

describe("canonicalCount", () => {
  it("el primero de la lista que venga, aunque el siguiente sea mayor", () => {
    expect(canonicalCount({ a: 1, b: 9 }, ["a", "b"])).toBe(1);
    expect(canonicalCount({ b: 9 }, ["a", "b"])).toBe(9);
  });

  it("un cero informado es 0, no null", () => {
    expect(canonicalCount({ a: 0 }, ["a"])).toBe(0);
  });
});
