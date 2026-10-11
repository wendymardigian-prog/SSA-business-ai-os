import { describe, expect, it } from "vitest";
import {
  closerSummaries,
  computeHeadline,
  criteriaAverages,
  lowestCriteria,
  parseCriteria,
  qualificationMatrix,
  topObjections,
  weeklyEvolution,
  type DashboardCall,
} from "./calls";
import { EMPTY_CATEGORIES } from "@/lib/calls/rubric";
import { mergeProposal } from "@/lib/calls/categories";

let n = 0;
const call = (over: Partial<DashboardCall> = {}): DashboardCall => ({
  id: `c${++n}`,
  recordedAt: "2026-10-07T15:00:00Z",
  closerId: "ana",
  callType: "cierre",
  closerScore: 60,
  leadScore: 60,
  qualification: "con_reservas",
  outcome: "seguimiento_con_fecha",
  mainObjection: null,
  hasOpenAlerts: false,
  criteria: [],
  ...over,
});
const crit = (...pairs: Array<[string, number]>) => pairs.map(([code, score]) => ({ code, name: code, score }));

describe("parseCriteria", () => {
  it("lee los criterios del analysis.rubrica y descarta lo invalido", () => {
    expect(parseCriteria([{ codigo: "rapport", nombre: "Rapport", puntaje: 4 }, { codigo: "x", puntaje: 9 }, { nombre: "sin codigo", puntaje: 3 }, "basura", null])).toEqual([{ code: "rapport", name: "Rapport", score: 4 }]);
    expect(parseCriteria(null)).toEqual([]);
    expect(parseCriteria({})).toEqual([]);
  });
  it("sin nombre usa el codigo", () => {
    expect(parseCriteria([{ codigo: "cierre", puntaje: 3 }])[0].name).toBe("cierre");
  });
});

describe("computeHeadline", () => {
  it("sin llamadas no hay promedios: null, nunca un cero inventado", () => {
    expect(computeHeadline([])).toEqual({ analyzed: 0, avgCloserScore: null, avgLeadScore: null, qualifiedPct: null, openAlerts: 0 });
  });
  it("cuenta, promedia, calcula el % de calificados y las alertas abiertas", () => {
    const h = computeHeadline([
      call({ closerScore: 80, leadScore: 70, qualification: "calificado", hasOpenAlerts: true }),
      call({ closerScore: 60, leadScore: 50, qualification: "no_calificado" }),
      call({ closerScore: null, leadScore: null, qualification: null }),
    ]);
    expect(h).toEqual({ analyzed: 3, avgCloserScore: 70, avgLeadScore: 60, qualifiedPct: 50, openAlerts: 1 });
  });
});

describe("foco de cada closer", () => {
  const anaCalls = [
    call({ closerId: "ana", criteria: crit(["descubrimiento", 2], ["rapport", 4]) }),
    call({ closerId: "ana", criteria: crit(["descubrimiento", 3], ["rapport", 5]) }),
    call({ closerId: "ana", criteria: crit(["descubrimiento", 2], ["rapport", 4]) }),
  ];

  it("3 llamadas con descubrimiento 2, 3, 2 y rapport 4, 5, 4: el foco es descubrimiento", () => {
    const [ana] = closerSummaries(anaCalls, new Map([["ana", "Ana"]]));
    expect(ana.name).toBe("Ana");
    expect(ana.focus).toMatchObject({ code: "descubrimiento", avg: 2.3, calls: 3 });
  });
  it("con menos de 3 llamadas no se dice el foco (pocas llamadas para decir)", () => {
    const [ana] = closerSummaries(anaCalls.slice(0, 2), new Map([["ana", "Ana"]]));
    expect(ana.focus).toBeNull();
    expect(ana.criteria).toHaveLength(2);
  });
  it("un criterio con pocas llamadas no le gana a uno bien medido", () => {
    const list = [...anaCalls, call({ closerId: "ana", criteria: crit(["cierre", 1]) })];
    expect(closerSummaries(list, new Map())[0].focus?.code).toBe("descubrimiento");
  });
  it("desempata por codigo y devuelve los n mas bajos", () => {
    const avgs = criteriaAverages([1, 2, 3].map(() => call({ criteria: crit(["b", 2], ["a", 2], ["c", 5]) })));
    expect(lowestCriteria(avgs, 2).map((c) => c.code)).toEqual(["a", "b"]);
  });
  it("separa por closer y ordena por cantidad; un closer sin id va a 'Sin closer'", () => {
    const list = [call({ closerId: "ana" }), call({ closerId: "leo" }), call({ closerId: "leo" }), call({ closerId: null })];
    const out = closerSummaries(list, new Map([["ana", "Ana"], ["leo", "Leo"]]));
    expect(out.map((c) => [c.name, c.calls])).toEqual([["Leo", 2], ["Ana", 1], ["Sin closer", 1]]);
  });
});

describe("topObjections", () => {
  it("4 llamadas con objecion precio, una en venta: la fila dice 4 y 1", () => {
    const list = [
      call({ mainObjection: "precio", outcome: "venta" }),
      call({ mainObjection: "precio", outcome: "no_venta" }),
      call({ mainObjection: "precio", outcome: "seguimiento_con_fecha" }),
      call({ mainObjection: "precio", outcome: "no_venta" }),
      call({ mainObjection: "tiempo", outcome: "venta" }),
    ];
    expect(topObjections(list)).toEqual([
      { key: "precio", label: "Precio", calls: 4, sales: 1 },
      { key: "tiempo", label: "Tiempo", calls: 1, sales: 1 },
    ]);
  });
  it("sin objecion no cuenta; sin llamadas, lista vacia", () => {
    expect(topObjections([call({ mainObjection: null })])).toEqual([]);
    expect(topObjections([])).toEqual([]);
  });
  it("respeta las decisiones de categorias: una unida se muestra como la de destino, sin tocar las llamadas", () => {
    const cats = structuredClone(EMPTY_CATEGORIES);
    cats.accepted.objeciones = [{ clave: "precio", nombre: "Precio" }];
    const merged = mergeProposal(cats, "objeciones", "es_caro", "precio")!;
    const list = [call({ mainObjection: "precio" }), call({ mainObjection: "es_caro", outcome: "venta" })];
    expect(topObjections(list, merged)).toEqual([{ key: "precio", label: "Precio", calls: 2, sales: 1 }]);
    expect(list[1].mainObjection).toBe("es_caro");
  });
});

describe("qualificationMatrix", () => {
  it("cruza calificacion con resultado y la suma de las filas es el total", () => {
    const list = [
      call({ qualification: "calificado", outcome: "venta" }),
      call({ qualification: "calificado", outcome: "venta" }),
      call({ qualification: "calificado", outcome: "no_venta" }),
      call({ qualification: "no_calificado", outcome: "no_venta" }),
      call({ qualification: null, outcome: null }),
    ];
    const m = qualificationMatrix(list);
    expect(m.outcomes).toEqual(["no_venta", "venta", "sin_dato"]);
    expect(m.rows.map((r) => [r.qualification, r.total])).toEqual([["calificado", 3], ["no_calificado", 1], ["sin_dato", 1]]);
    expect(m.rows[0].cells).toEqual({ venta: 2, no_venta: 1 });
    expect(m.rows.reduce((a, r) => a + r.total, 0)).toBe(list.length);
  });
  it("sin llamadas no hay filas", () => {
    expect(qualificationMatrix([])).toEqual({ outcomes: [], rows: [] });
  });
});

describe("weeklyEvolution", () => {
  it("una llamada del domingo 23:30 en Costa Rica (lunes en UTC) cuenta en la semana del domingo", () => {
    // domingo 11/oct/2026 23:30 en Costa Rica (UTC-6) = lunes 12/oct 05:30 UTC
    const out = weeklyEvolution([call({ recordedAt: "2026-10-12T05:30:00Z", closerScore: 80 })], "America/Costa_Rica");
    expect(out).toEqual([{ weekStart: "2026-10-05", avgCloserScore: 80, calls: 1 }]);
    // En UTC esa misma llamada caeria en la semana siguiente: por eso importa la zona.
    expect(weeklyEvolution([call({ recordedAt: "2026-10-12T05:30:00Z" })], "UTC")[0].weekStart).toBe("2026-10-12");
  });
  it("agrupa por semana (lunes), promedia y ordena de la mas vieja a la mas nueva", () => {
    const out = weeklyEvolution(
      [
        call({ recordedAt: "2026-10-14T15:00:00Z", closerScore: 70 }),
        call({ recordedAt: "2026-10-06T15:00:00Z", closerScore: 50 }),
        call({ recordedAt: "2026-10-08T15:00:00Z", closerScore: 60 }),
      ],
      "America/Costa_Rica",
    );
    expect(out).toEqual([
      { weekStart: "2026-10-05", avgCloserScore: 55, calls: 2 },
      { weekStart: "2026-10-12", avgCloserScore: 70, calls: 1 },
    ]);
  });
  it("una semana sin puntajes no inventa un cero", () => {
    expect(weeklyEvolution([call({ closerScore: null })], "UTC")[0].avgCloserScore).toBeNull();
  });
});
