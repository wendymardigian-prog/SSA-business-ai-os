/**
 * El dashboard unificado (F59).
 */

import { describe, it, expect } from "vitest";
import { buildUnified, comparison, type OrganicSummary, type PaidSummary } from "./unified";

const organic: OrganicSummary = {
  reach: 8000,
  interactions: 450,
  followersGained: 120,
  posts: 12,
  daily: [{ date: "2026-10-01", reach: 3000 }],
};

const paid: PaidSummary = {
  reach: 25000,
  spend: 40000,
  leads: 30,
  impressions: 60000,
  clicks: 1200,
  daily: [{ date: "2026-10-01", reach: 9000, spend: 15000 }],
};

describe("las dos fuentes juntas (F59)", () => {
  it("con las dos, no hay avisos", () => {
    const view = buildUnified({ organic, paid, organicConnected: true, paidConnected: true });

    expect(view.notices).toEqual([]);
    expect(view.costPerLead).toBeCloseTo(1333.33, 2);
  });

  it("sin Meta conectado, se muestra lo organico con un aviso", () => {
    // Una pantalla vacia esconderia lo organico, que si esta.
    const view = buildUnified({ organic, paid: null, organicConnected: true, paidConnected: false });

    expect(view.paidState).toBe("not_connected");
    expect(view.notices[0]).toContain("Meta Ads no esta conectado");
    expect(view.organic).not.toBeNull();
  });

  it("sin redes conectadas, se muestra lo pago con un aviso", () => {
    const view = buildUnified({ organic: null, paid, organicConnected: false, paidConnected: true });

    expect(view.organicState).toBe("not_connected");
    expect(view.notices[0]).toContain("solo lo pago");
  });

  it("conectado pero sin actividad es distinto de no conectado", () => {
    const view = buildUnified({
      organic: { ...organic, posts: 0 },
      paid: { ...paid, spend: 0 },
      organicConnected: true,
      paidConnected: true,
    });

    expect(view.organicState).toBe("no_data");
    expect(view.paidState).toBe("no_data");
    expect(view.notices).toHaveLength(2);
  });

  it("sin leads no hay costo por lead", () => {
    const view = buildUnified({
      organic,
      paid: { ...paid, leads: 0 },
      organicConnected: true,
      paidConnected: true,
    });

    expect(view.costPerLead).toBeNull();
  });
});

describe("la serie combinada (F59)", () => {
  it("junta los dias de las dos fuentes", () => {
    const view = buildUnified({
      organic: { ...organic, daily: [{ date: "2026-10-01", reach: 3000 }] },
      paid: { ...paid, daily: [{ date: "2026-10-02", reach: 9000, spend: 15000 }] },
      organicConnected: true,
      paidConnected: true,
    });

    expect(view.daily.map((d) => d.date)).toEqual(["2026-10-01", "2026-10-02"]);
    expect(view.daily[0].paidReach).toBeNull();
    expect(view.daily[1].organicReach).toBeNull();
  });
});

describe("la comparacion lado a lado (F59)", () => {
  const view = buildUnified({ organic, paid, organicConnected: true, paidConnected: true });

  it("el alcance NO se suma, y dice por que", () => {
    // Meta no informa cuanta gente vio las dos cosas: el total seria un
    // numero mas grande que la realidad.
    const row = comparison(view).find((r) => r.label === "Alcance");

    expect(row).toMatchObject({ organic: 8000, paid: 25000 });
    expect(row?.note).toContain("No se suman");
  });

  it("los seguidores ganados son solo organicos, y lo aclara", () => {
    const row = comparison(view).find((r) => r.label === "Seguidores ganados");

    expect(row?.paid).toBeNull();
    expect(row?.note).toContain("no informan");
  });

  it("lo organico no gasta", () => {
    expect(comparison(view).find((r) => r.label === "Gasto")?.organic).toBe(0);
  });
});
