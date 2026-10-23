import { describe, expect, it } from "vitest";
import {
  averageResponse,
  bucketTrends,
  daysBetween,
  median,
  mondayOf,
  shouldGroupWeekly,
  trendTabLabel,
  trendTotals,
  withResponseTimes,
  type TrendRow,
} from "./trends";

function row(day: string, over: Partial<TrendRow> = {}): TrendRow {
  return {
    day,
    messages_in: 10,
    messages_out: 12,
    new_conversations: 3,
    sent_agent: 6,
    sent_team: 4,
    sent_automations: 1,
    sent_external: 1,
    response_turns: 2,
    response_total_seconds: 600,
    ...over,
  };
}

describe("shouldGroupWeekly", () => {
  it("hasta 62 dias, por dia", () => {
    expect(shouldGroupWeekly(62)).toBe(false);
  });
  it("con 63 dias pasa a semanal", () => {
    expect(shouldGroupWeekly(63)).toBe(true);
  });
});

describe("mondayOf", () => {
  it("un miercoles cae en su lunes", () => {
    expect(mondayOf("2026-09-23")).toBe("2026-09-21");
  });
  it("un domingo cae en el lunes anterior, no en el siguiente", () => {
    expect(mondayOf("2026-09-27")).toBe("2026-09-21");
  });
  it("un lunes es su propio lunes", () => {
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
  });
  it("cruza el fin de mes", () => {
    expect(mondayOf("2026-10-01")).toBe("2026-09-28");
  });
});

describe("bucketTrends", () => {
  it("por dia devuelve los dias tal cual", () => {
    const out = bucketTrends([row("2026-09-21"), row("2026-09-22")], false);
    expect(out.map((b) => b.key)).toEqual(["2026-09-21", "2026-09-22"]);
    expect(out[0].messagesIn).toBe(10);
  });

  it("por semana suma los dias y guarda el ultimo como fin", () => {
    const out = bucketTrends([row("2026-09-21"), row("2026-09-22"), row("2026-09-28")], true);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ key: "2026-09-21", end: "2026-09-22", messagesIn: 20, newConversations: 6 });
    expect(out[0].sent).toEqual({ agent: 12, team: 8, automations: 2, external: 2 });
    expect(out[1].key).toBe("2026-09-28");
  });

  it("el tiempo de respuesta de la semana se pondera por esperas, no promedia promedios", () => {
    const out = bucketTrends(
      [
        // Un dia con una espera de 1 hora y otro con nueve esperas de 1 minuto.
        row("2026-09-21", { response_turns: 1, response_total_seconds: 3600 }),
        row("2026-09-22", { response_turns: 9, response_total_seconds: 540 }),
      ],
      true,
    );
    expect(averageResponse(out[0])).toBe(414);
  });

  it("una semana sin esperas respondidas queda en null, no en cero", () => {
    const out = bucketTrends([row("2026-09-21", { response_turns: 0, response_total_seconds: 0 })], true);
    expect(averageResponse(out[0])).toBeNull();
  });

  it("los grupos salen ordenados aunque las filas vengan al revés", () => {
    const out = bucketTrends([row("2026-09-28"), row("2026-09-21")], true);
    expect(out.map((b) => b.key)).toEqual(["2026-09-21", "2026-09-28"]);
  });
});

describe("trendTotals", () => {
  it("suma los volumenes y las esperas", () => {
    const totals = trendTotals(bucketTrends([row("2026-09-21"), row("2026-09-22")], false));
    expect(totals.messagesOut).toBe(24);
    expect(totals.sent.agent).toBe(12);
    expect(averageResponse(totals)).toBe(300);
  });

  it("sin ninguna espera respondida, el promedio es null", () => {
    const totals = trendTotals(bucketTrends([row("2026-09-21", { response_turns: 0, response_total_seconds: 0 })], false));
    expect(averageResponse(totals)).toBeNull();
  });
});

describe("withResponseTimes", () => {
  it("junta por dia y deja en cero los dias sin esperas", () => {
    const rows = withResponseTimes([row("2026-09-21"), row("2026-09-22")], [{ day: "2026-09-22", turns: 3, total_seconds: 900 }]);
    expect(rows.map((r) => [r.response_turns, r.response_total_seconds])).toEqual([
      [0, 0],
      [3, 900],
    ]);
  });
});

describe("median", () => {
  it("impar toma el del medio; par, el promedio de los dos", () => {
    expect(median([1, 5, 3])).toBe(3);
    expect(median([1, 3])).toBe(2);
  });
  it("vacia es null", () => {
    expect(median([])).toBeNull();
  });
});

describe("trendTabLabel", () => {
  it("la primera pestaña cambia con el filtro de persona", () => {
    expect(trendTabLabel("conversaciones", false)).toBe("Conversaciones nuevas");
    expect(trendTabLabel("conversaciones", true)).toBe("Conversaciones");
  });
});

describe("daysBetween", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  it("cuenta los dos extremos", () => {
    expect(daysBetween("2026-09-22T00:00:00.000Z", "2026-09-28T23:59:59.999Z", now)).toBe(7);
  });
  it("un rango abierto llega hasta ahora", () => {
    expect(daysBetween("2026-09-28T00:00:00.000Z", null, now)).toBe(1);
  });
  it("historico siempre agrupa por semana", () => {
    expect(shouldGroupWeekly(daysBetween(null, null, now))).toBe(true);
  });
});
