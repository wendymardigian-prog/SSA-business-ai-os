/**
 * Las cuentas del dashboard de Meta Ads (F56).
 */

import { describe, it, expect } from "vitest";
import {
  computeTotals,
  ctrTone,
  dailySeries,
  funnel,
  groupByObject,
  leadsTone,
  money,
  objectiveLabel,
  percent,
  ratio,
  statusLabel,
  videoRetention,
  type AdsRow,
} from "./ads";

const row = (over: Partial<AdsRow> & { date: string }): AdsRow => ({
  level: "campaign",
  objectId: "c1",
  objectName: "Campaña",
  parentName: null,
  campaignId: "c1",
  adsetId: null,
  spend: null,
  impressions: null,
  reach: null,
  clicks: null,
  outboundClicks: null,
  linkClicks: null,
  leads: null,
  purchases: null,
  purchaseValue: null,
  status: null,
  effectiveStatus: null,
  qualityRanking: null,
  engagementRanking: null,
  conversionRanking: null,
  videoP25: null,
  videoP50: null,
  videoP75: null,
  videoP95: null,
  videoP100: null,
  thruplays: null,
  ...over,
});

describe("dividir sin mentir (F56)", () => {
  it("sin denominador no hay resultado: null y no cero", () => {
    // Un "CPC: $0" se lee como "los clics salen gratis".
    expect(ratio(100, 0)).toBeNull();
    expect(ratio(100, null)).toBeNull();
    expect(ratio(null, 10)).toBeNull();
  });
});

describe("los totales del periodo (F56)", () => {
  const rows = [
    row({ date: "2026-10-01", spend: 100, impressions: 10000, clicks: 350, leads: 10, reach: 8000 }),
    row({ date: "2026-10-02", spend: 50, impressions: 5000, clicks: 100, leads: 5, reach: 4000 }),
  ];

  it("cada formula se calcula sobre los totales, no promediando dias", () => {
    // El CPC del mes es el gasto del mes sobre los clics del mes. Un dia
    // con dos clics y mucho gasto arrastraria el promedio.
    const totals = computeTotals(rows);

    expect(totals.spend).toBe(150);
    expect(totals.clicks).toBe(450);
    expect(totals.cpc).toBeCloseTo(0.33, 2);
    expect(totals.ctr).toBe(3);
    expect(totals.cpm).toBe(10);
  });

  it("el alcance unico del periodo pisa la suma diaria", () => {
    // Sumar alcances cuenta a la misma persona una vez por dia.
    const totals = computeTotals(rows, 9000);

    expect(totals.reach).toBe(9000);
    expect(totals.frequency).toBeCloseTo(1.67, 2);
  });

  it("sin leads, el costo por lead es una raya", () => {
    const totals = computeTotals([row({ date: "2026-10-01", spend: 100, leads: 0 })]);

    expect(totals.cpl).toBeNull();
  });

  it("el ROAS sale del valor de las compras sobre el gasto", () => {
    const totals = computeTotals([
      row({ date: "2026-10-01", spend: 100, purchases: 4, purchaseValue: 450 }),
    ]);

    expect(totals.roas).toBe(4.5);
  });

  it("sin datos, todo en null", () => {
    expect(computeTotals([]).spend).toBeNull();
  });
});

describe("los colores (F56)", () => {
  it("el CTR se pinta verde arriba de 3,5 y rojo debajo de 2", () => {
    expect(ctrTone(4)).toBe("good");
    expect(ctrTone(1.5)).toBe("bad");
    expect(ctrTone(3)).toBe("neutral");
  });

  it("sin CTR no se pinta nada", () => {
    expect(ctrTone(null)).toBe("neutral");
  });

  it("cero leads se marca: es la cifra que dice si la campaña sirve", () => {
    expect(leadsTone(0)).toBe("bad");
    expect(leadsTone(5)).toBe("neutral");
    expect(leadsTone(null)).toBe("neutral");
  });
});

describe("como se muestran los numeros (F56)", () => {
  it("los montos van en la moneda de la cuenta", () => {
    expect(money(1500, "ARS")).toContain("1.500");
  });

  it("una moneda que Intl no conoce no rompe la pantalla", () => {
    expect(money(100, "XYZ")).toContain("100");
  });

  it("sin dato, una raya", () => {
    expect(money(null, "ARS")).toBe("—");
    expect(percent(null)).toBe("—");
  });
});

describe("agrupar por objeto (F56)", () => {
  const rows = [
    row({ date: "2026-10-01", objectId: "c1", objectName: "Vieja", spend: 100, clicks: 50 }),
    row({ date: "2026-10-02", objectId: "c1", objectName: "Renombrada", spend: 50, clicks: 20 }),
    row({ date: "2026-10-01", objectId: "c2", objectName: "Otra", spend: 300 }),
  ];

  it("suma los dias de cada objeto", () => {
    const grouped = groupByObject(rows, "campaign");

    expect(grouped.find((g) => g.objectId === "c1")).toMatchObject({ spend: 150, clicks: 70 });
  });

  it("el nombre es el de la fila mas nueva", () => {
    // Una campaña renombrada tiene que aparecer con su nombre de ahora.
    expect(groupByObject(rows, "campaign").find((g) => g.objectId === "c1")?.objectName).toBe(
      "Renombrada",
    );
  });

  it("se ordena por gasto", () => {
    expect(groupByObject(rows, "campaign").map((g) => g.objectId)).toEqual(["c2", "c1"]);
  });

  it("ignora las filas de otro nivel", () => {
    const mixed = [...rows, row({ date: "2026-10-01", level: "ad", objectId: "a1", spend: 999 })];

    expect(groupByObject(mixed, "campaign").map((g) => g.objectId)).toEqual(["c2", "c1"]);
  });
});

describe("la serie diaria (F56)", () => {
  it("cada dia con su total", () => {
    const series = dailySeries(
      [
        row({ date: "2026-10-01", spend: 100 }),
        row({ date: "2026-10-01", objectId: "c2", spend: 50 }),
        row({ date: "2026-10-02", spend: 80 }),
      ],
      "spend",
    );

    expect(series).toEqual([
      { bucket: "2026-10-01", value: 150 },
      { bucket: "2026-10-02", value: 80 },
    ]);
  });

  it("una metrica derivada se recalcula por dia", () => {
    const series = dailySeries(
      [row({ date: "2026-10-01", clicks: 100, impressions: 5000 })],
      "ctr",
    );

    expect(series[0].value).toBe(2);
  });
});

describe("la retencion de video (F56)", () => {
  it("se calcula sobre las reproducciones, no sobre las impresiones", () => {
    // Sobre impresiones estaria mezclando retencion con cuanta gente
    // decidio ver el video.
    const retention = videoRetention({
      thruplays: 1000,
      videoP25: 800,
      videoP50: 500,
      videoP75: 300,
      videoP95: 150,
      videoP100: 120,
    });

    expect(retention[0]).toEqual({ label: "25%", percent: 80 });
    expect(retention[4]).toEqual({ label: "100%", percent: 12 });
  });

  it("sin reproducciones no hay curva", () => {
    expect(
      videoRetention({
        thruplays: null,
        videoP25: null,
        videoP50: null,
        videoP75: null,
        videoP95: null,
        videoP100: null,
      }),
    ).toEqual([]);
  });
});

describe("objetivos y estados (F56)", () => {
  it("se muestran en castellano", () => {
    expect(objectiveLabel("OUTCOME_LEADS")).toBe("Clientes potenciales");
    expect(statusLabel("PAUSED")).toBe("Pausado");
  });

  it("uno que no conocemos se muestra tal cual, no vacio", () => {
    expect(objectiveLabel("OUTCOME_NUEVO")).toBe("OUTCOME_NUEVO");
  });
});

describe("el embudo (F56)", () => {
  it("cada paso dice que porcentaje del anterior es", () => {
    const steps = funnel(
      computeTotals([
        row({ date: "2026-10-01", impressions: 10000, outboundClicks: 500, leads: 50, purchases: 5 }),
      ]),
    );

    expect(steps[1]).toMatchObject({ label: "Clics salientes", value: 500, conversion: 5 });
    expect(steps[2].conversion).toBe(10);
    expect(steps[3].conversion).toBe(10);
  });

  it("el primer paso no tiene conversion", () => {
    expect(funnel(computeTotals([row({ date: "2026-10-01", impressions: 100 })]))[0].conversion).toBeNull();
  });
});
