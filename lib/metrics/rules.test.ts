/**
 * Las reglas de recoleccion (F45).
 */

import { describe, it, expect } from "vitest";
import {
  cadenceFor,
  computeD7,
  d7Status,
  dataSinceLabel,
  daysBetween,
  isSyncHour,
  mayStillGrow,
  shouldCollect,
  workspaceDate,
  workspaceHour,
  type DailyPoint,
} from "./rules";

const BA = "America/Argentina/Buenos_Aires";

describe("cada cuanto se actualiza un post (F45)", () => {
  it("hasta 30 dias, todos los dias", () => {
    expect(cadenceFor(0)).toBe("daily");
    expect(cadenceFor(30)).toBe("daily");
  });

  it("de 31 a 90, una vez por semana", () => {
    expect(cadenceFor(31)).toBe("weekly");
    expect(cadenceFor(90)).toBe("weekly");
  });

  it("pasados los 90 no se toca mas", () => {
    // Pedir los mil posts historicos cada noche quema la cuota sin aportar
    // un dato: a esa altura ya no cambian.
    expect(cadenceFor(91)).toBe("never");
  });
});

describe("si entra en la recoleccion de hoy (F45)", () => {
  const now = new Date("2026-10-01T06:00:00Z");

  it("uno de esta semana leido ayer, si", () => {
    expect(
      shouldCollect({ publishedAt: "2026-09-28", lastSyncedAt: "2026-09-30", now }),
    ).toBe(true);
  });

  it("uno de esta semana leido hoy, no de nuevo", () => {
    expect(
      shouldCollect({ publishedAt: "2026-09-28", lastSyncedAt: "2026-10-01", now }),
    ).toBe(false);
  });

  it("uno de dos meses leido hace tres dias, todavia no", () => {
    expect(
      shouldCollect({ publishedAt: "2026-08-01", lastSyncedAt: "2026-09-28", now }),
    ).toBe(false);
  });

  it("uno de dos meses leido hace ocho dias, si", () => {
    expect(
      shouldCollect({ publishedAt: "2026-08-01", lastSyncedAt: "2026-09-23", now }),
    ).toBe(true);
  });

  it("uno que nunca se leyo entra igual, aunque sea viejo", () => {
    // Es la primera vez: si no entrara, nunca tendria metricas.
    expect(shouldCollect({ publishedAt: "2026-08-15", lastSyncedAt: null, now })).toBe(true);
  });

  it("uno de hace mas de 90 dias ya no, ni la primera vez", () => {
    expect(shouldCollect({ publishedAt: "2026-01-01", lastSyncedAt: null, now })).toBe(false);
  });

  it("uno sin fecha de publicacion, no", () => {
    expect(shouldCollect({ publishedAt: null, lastSyncedAt: null, now })).toBe(false);
  });
});

describe("la fecha y la hora del workspace (F45)", () => {
  it("las 2 de la mañana UTC son todavia el dia anterior en Buenos Aires", () => {
    // "El lunes" tiene que ser el lunes de quien mira el dashboard.
    expect(workspaceDate(new Date("2026-10-02T02:00:00Z"), BA)).toBe("2026-10-01");
  });

  it("una zona invalida no deja sin recolectar: cae a UTC", () => {
    expect(workspaceDate(new Date("2026-10-02T02:00:00Z"), "Marte/Olympus")).toBe("2026-10-02");
  });

  it("la hora local decide a quien le toca en esta corrida", () => {
    // El cron corre cada hora y la ruta se queda con los que son las 3.
    expect(workspaceHour(new Date("2026-10-01T06:30:00Z"), BA)).toBe(3);
    expect(isSyncHour(new Date("2026-10-01T06:30:00Z"), BA)).toBe(true);
    expect(isSyncHour(new Date("2026-10-01T12:30:00Z"), BA)).toBe(false);
  });
});

describe("engagement comparable a 7 dias (F45)", () => {
  const daily = (over: Partial<DailyPoint> & { date: string }): DailyPoint => ({
    views: null,
    reach: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    ...over,
  });

  it("se congela con la fila del dia 7", () => {
    const result = computeD7({
      publishedAt: "2026-09-01T12:00:00Z",
      daily: [
        daily({ date: "2026-09-05", likes: 10, reach: 100 }),
        daily({ date: "2026-09-08", likes: 30, comments: 6, shares: 4, reach: 1000 }),
        daily({ date: "2026-09-20", likes: 90, reach: 5000 }),
      ],
      now: new Date("2026-10-01T00:00:00Z"),
    });

    expect(result).toMatchObject({ interactions: 40, reach: 1000, engagement: 4 });
  });

  it("si falta el dia 7, se usa el primero posterior", () => {
    // Una red que fallo un dia no puede dejar al post sin numero comparable
    // para siempre.
    const result = computeD7({
      publishedAt: "2026-09-01T12:00:00Z",
      daily: [daily({ date: "2026-09-11", likes: 20, reach: 200 })],
      now: new Date("2026-10-01T00:00:00Z"),
    });

    expect(result?.interactions).toBe(20);
  });

  it("antes de los 7 dias no hay numero: la pantalla dice en curso", () => {
    expect(
      computeD7({
        publishedAt: "2026-09-28T12:00:00Z",
        daily: [daily({ date: "2026-09-29", likes: 5 })],
        now: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toBeNull();
  });

  it("sin alcance usa las vistas como denominador", () => {
    const result = computeD7({
      publishedAt: "2026-09-01T12:00:00Z",
      daily: [daily({ date: "2026-09-08", likes: 25, views: 500 })],
      now: new Date("2026-10-01T00:00:00Z"),
    });

    expect(result?.engagement).toBe(5);
  });

  it("sin denominador devuelve las interacciones igual, sin tasa", () => {
    const result = computeD7({
      publishedAt: "2026-09-01T12:00:00Z",
      daily: [daily({ date: "2026-09-08", likes: 25 })],
      now: new Date("2026-10-01T00:00:00Z"),
    });

    expect(result).toMatchObject({ interactions: 25, engagement: null });
  });

  it("sin ninguna fila del dia 7 en adelante, todavia no se puede", () => {
    expect(
      computeD7({
        publishedAt: "2026-09-01T12:00:00Z",
        daily: [daily({ date: "2026-09-03", likes: 5 })],
        now: new Date("2026-10-01T00:00:00Z"),
      }),
    ).toBeNull();
  });

  it("dice cuantos dias faltan", () => {
    expect(d7Status("2026-09-28T00:00:00Z", new Date("2026-10-01T00:00:00Z"))).toEqual({
      ready: false,
      daysLeft: 4,
    });
    expect(d7Status("2026-09-01T00:00:00Z", new Date("2026-10-01T00:00:00Z")).ready).toBe(true);
  });
});

describe("datos que todavia pueden subir (F45)", () => {
  it("los dos ultimos dias de Instagram se avisan", () => {
    // Comparar un dia cerrado con uno a medio contar lleva a una conclusion
    // equivocada.
    expect(mayStillGrow({ platform: "instagram", date: "2026-09-30", today: "2026-10-01" })).toBe(true);
    expect(mayStillGrow({ platform: "instagram", date: "2026-09-28", today: "2026-10-01" })).toBe(false);
  });

  it("las otras redes no tienen ese atraso", () => {
    expect(mayStillGrow({ platform: "youtube", date: "2026-09-30", today: "2026-10-01" })).toBe(false);
  });
});

describe("desde cuando hay datos (F45)", () => {
  it("lo dice en castellano", () => {
    // Un grafico que arranca en octubre sin decir por que parece un grafico
    // con datos perdidos.
    expect(dataSinceLabel("2026-10-01")).toBe("Datos desde el 1 de octubre de 2026");
  });

  it("sin datos no dice nada", () => {
    expect(dataSinceLabel(null)).toBeNull();
  });
});

describe("dias entre fechas (F45)", () => {
  it("cuenta dias completos", () => {
    expect(daysBetween("2026-09-01", "2026-09-08")).toBe(7);
  });

  it("una fecha invalida da cero en vez de NaN", () => {
    expect(daysBetween("no soy fecha", "2026-09-08")).toBe(0);
  });
});
