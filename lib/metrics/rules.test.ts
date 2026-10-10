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
  readWindowStart,
  selectPostsToPersist,
  shouldCollect,
  type StoredPost,
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

  it("hasta 7 dias tarde todavia sirve: la fila del dia 14", () => {
    const result = computeD7({
      publishedAt: "2026-09-01T12:00:00Z",
      daily: [daily({ date: "2026-09-15", likes: 20, reach: 200 })],
      now: new Date("2026-10-01T00:00:00Z"),
    });

    expect(result?.interactions).toBe(20);
  });

  it("un post importado a los 95 dias no congela su total de hoy como d7", () => {
    // La primera fila es el acumulado de cuatro meses: no es un numero a 7 dias.
    expect(
      computeD7({
        publishedAt: "2026-07-07T12:00:00Z",
        daily: [daily({ date: "2026-10-10", likes: 300, views: 9000 })],
        now: new Date("2026-10-10T12:00:00Z"),
      }),
    ).toBeNull();
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


// ── F79: la regla de frecuencia por fin se aplica ──────────────────────────

describe("la ventana que se le pide a la red (F79)", () => {
  // El 1 de octubre. Un post del 17 de agosto tiene 45 dias.
  const now = new Date("2026-10-01T06:00:00Z");
  const post = (publishedAt: string | null, lastSyncedAt: string | null, id = "p"): StoredPost => ({
    externalPostId: id,
    publishedAt,
    lastSyncedAt,
  });

  it("sin posts viejos, son los 30 dias de siempre", () => {
    expect(readWindowStart(now, [])).toBe("2026-09-01");
    expect(readWindowStart(now, [post("2026-09-20", "2026-09-30")])).toBe("2026-09-01");
  });

  it("uno de 45 dias leido hace 3 NO estira la ventana: no se le pide nada", () => {
    expect(readWindowStart(now, [post("2026-08-17T12:00:00Z", "2026-09-28T06:00:00Z")])).toBe("2026-09-01");
  });

  // La cuenta: el 17 de agosto a las 12:00 y el 1 de octubre a las 06:00 hay 44,75
  // dias, o sea 44 enteros. Con el dia de margen la ventana arranca 45 dias antes
  // de las 06:00 del 1 de octubre: el 17 de agosto, el dia en que se publico.
  // Lo que importa es eso: que el dia del post quede ADENTRO.
  it("uno de 45 dias leido hace 8 SI la estira, para pedirlo", () => {
    expect(readWindowStart(now, [post("2026-08-17T12:00:00Z", "2026-09-23T06:00:00Z")])).toBe("2026-08-17");
  });

  it("uno de 45 dias que nunca se leyo tambien la estira", () => {
    expect(readWindowStart(now, [post("2026-08-17T12:00:00Z", null)])).toBe("2026-08-17");
  });

  it("uno de 100 dias NUNCA la estira, ni aunque nunca se haya leido", () => {
    expect(readWindowStart(now, [post("2026-06-23T12:00:00Z", null)])).toBe("2026-09-01");
  });

  it("con varios, manda el mas viejo al que le toca", () => {
    const stored = [
      post("2026-08-17T12:00:00Z", null, "a"), // ~45 dias
      post("2026-07-20T12:00:00Z", null, "b"), // ~73 dias: el mas viejo al que le toca
      post("2026-08-01T12:00:00Z", "2026-09-30T06:00:00Z", "c"), // leido ayer: no cuenta
    ];
    expect(readWindowStart(now, stored)).toBe("2026-07-20");
  });

  it("el post mas viejo que entra (90 dias) deja la ventana en 91 dias atras, y no mas", () => {
    // 2 de julio 12:00 -> 1 de octubre 06:00 = 90,75 dias: 90 enteros, el limite.
    expect(readWindowStart(now, [post("2026-07-02T12:00:00Z", null)])).toBe("2026-07-02");
  });

  it("uno de 91 dias ya no entra y no mueve la ventana", () => {
    expect(readWindowStart(now, [post("2026-07-01T12:00:00Z", null)])).toBe("2026-09-01");
  });
});

describe("de lo que devuelve la red, que se guarda hoy (F79)", () => {
  const now = new Date("2026-10-01T06:00:00Z");
  const fromNetwork = (externalPostId: string, publishedAt: string | null) => ({ externalPostId, publishedAt });
  const ids = (posts: Array<{ externalPostId: string }>) => posts.map((p) => p.externalPostId);

  it("hasta 30 dias entra siempre, aunque se haya leido hoy", () => {
    // Es lo que hace el cron desde siempre, y lo que "Actualizar ahora" necesita.
    const stored = [{ externalPostId: "a", publishedAt: "2026-09-25T12:00:00Z", lastSyncedAt: "2026-10-01T05:00:00Z" }];

    expect(ids(selectPostsToPersist([fromNetwork("a", "2026-09-25T12:00:00Z")], stored, now))).toEqual(["a"]);
  });

  it("uno de 45 dias leido hace 3 dias NO se guarda; a los 8 SI", () => {
    const reciente = [{ externalPostId: "a", publishedAt: "2026-08-17T12:00:00Z", lastSyncedAt: "2026-09-28T06:00:00Z" }];
    const viejo = [{ externalPostId: "a", publishedAt: "2026-08-17T12:00:00Z", lastSyncedAt: "2026-09-23T06:00:00Z" }];
    const post = fromNetwork("a", "2026-08-17T12:00:00Z");

    expect(selectPostsToPersist([post], reciente, now)).toEqual([]);
    expect(ids(selectPostsToPersist([post], viejo, now))).toEqual(["a"]);
  });

  // Una cuenta que ya tiene algo guardado: la primera importacion ya paso.
  const yaImportada = [{ externalPostId: "otro", publishedAt: "2026-09-25T12:00:00Z", lastSyncedAt: "2026-10-01T05:00:00Z" }];

  it("uno de 100 dias no se guarda en una cuenta que ya se importo", () => {
    expect(selectPostsToPersist([fromNetwork("a", "2026-06-23T12:00:00Z")], yaImportada, now)).toEqual([]);
  });

  it("la primera importacion guarda todo, aunque tenga mas de 90 dias", () => {
    // Un canal cuyo ultimo video tiene cuatro meses quedaba vacio para siempre.
    const posts = [
      fromNetwork("julio", "2026-07-07T12:00:00Z"),
      fromNetwork("2025", "2025-08-30T12:00:00Z"),
      fromNetwork("reciente", "2026-09-25T12:00:00Z"),
    ];

    expect(ids(selectPostsToPersist(posts, [], now))).toEqual(["julio", "2025", "reciente"]);
  });

  it("uno que todavia no tenemos y esta dentro de 90 dias entra", () => {
    expect(ids(selectPostsToPersist([fromNetwork("nuevo", "2026-08-17T12:00:00Z")], yaImportada, now))).toEqual([
      "nuevo",
    ]);
  });

  it("uno sin fecha de publicacion se guarda: sin fecha no hay regla", () => {
    expect(ids(selectPostsToPersist([fromNetwork("sin-fecha", null)], yaImportada, now))).toEqual(["sin-fecha"]);
  });

  it("usa la fecha que ya teniamos guardada cuando la red no la trae", () => {
    const stored = [{ externalPostId: "a", publishedAt: "2026-08-17T12:00:00Z", lastSyncedAt: "2026-09-28T06:00:00Z" }];

    expect(selectPostsToPersist([fromNetwork("a", null)], stored, now)).toEqual([]);
  });
});

describe("la tolerancia del cron (F79)", () => {
  const post = { publishedAt: "2026-08-17T12:00:00Z" };

  it("la corrida de la semana pasada unos segundos mas tarde NO saltea la semana", () => {
    // 03:30:12 de hace siete dias y 03:30:05 de hoy: 6,99 dias. Por dias
    // enteros eran 6, y el post esperaba una semana de mas.
    const now = new Date("2026-10-01T09:30:05Z");
    const lastSyncedAt = "2026-09-24T09:30:12Z";

    expect(shouldCollect({ ...post, lastSyncedAt, now })).toBe(false);
    expect(shouldCollect({ ...post, lastSyncedAt, now, graceMs: 6 * 3600_000 })).toBe(true);
  });

  it("la tolerancia no adelanta una lectura que de verdad es de hace tres dias", () => {
    const now = new Date("2026-10-01T09:30:05Z");

    expect(shouldCollect({ ...post, lastSyncedAt: "2026-09-28T09:30:05Z", now, graceMs: 6 * 3600_000 })).toBe(false);
  });
});
