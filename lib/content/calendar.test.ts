import { describe, it, expect } from "vitest";
import {
  buildCalendar,
  cardCount,
  dayIn,
  reschedule,
  summarize,
  zonedToUtc,
  type CalendarPiece,
} from "./calendar";

const TZ = "America/Costa_Rica"; // UTC-6 todo el año: sin horario de verano
const AR = "America/Argentina/Buenos_Aires"; // UTC-3

const piece = (over: Partial<CalendarPiece> = {}): CalendarPiece => ({
  id: "p1",
  title: "Una pieza",
  format: "reel",
  networks: [],
  ...over,
});

describe("una tarjeta por pieza por dia (F21)", () => {
  it("tres redes el mismo dia son UNA tarjeta con tres iconos", () => {
    const cards = buildCalendar(
      [
        piece({
          networks: [
            { platform: "instagram", at: "2026-10-01T21:00:00Z", status: "scheduled" },
            { platform: "tiktok", at: "2026-10-01T21:00:00Z", status: "scheduled" },
            { platform: "threads", at: "2026-10-01T22:00:00Z", status: "scheduled" },
          ],
        }),
      ],
      TZ,
    );

    expect(cards).toHaveLength(1);
    expect(cards[0].networks).toHaveLength(3);
    expect(cards[0].redistribution).toBe(false);
  });

  it("una red en otro dia es otra tarjeta, marcada como redistribucion", () => {
    const cards = buildCalendar(
      [
        piece({
          networks: [
            { platform: "instagram", at: "2026-10-01T21:00:00Z", status: "published" },
            { platform: "youtube", at: "2026-10-08T21:00:00Z", status: "scheduled" },
          ],
        }),
      ],
      TZ,
    );

    expect(cards).toHaveLength(2);
    expect(cards[0].redistribution).toBe(false);
    expect(cards[1].redistribution).toBe(true);
    expect(cards[1].networks[0].platform).toBe("youtube");
  });

  it("la primera fecha es la publicacion, aunque venga desordenada", () => {
    const cards = buildCalendar(
      [
        piece({
          networks: [
            { platform: "youtube", at: "2026-10-08T21:00:00Z", status: "scheduled" },
            { platform: "instagram", at: "2026-10-01T21:00:00Z", status: "scheduled" },
          ],
        }),
      ],
      TZ,
    );

    expect(cards[0].networks[0].platform).toBe("instagram");
    expect(cards[0].redistribution).toBe(false);
  });

  it("una pieza sin ninguna fecha no aparece", () => {
    expect(buildCalendar([piece({ networks: [] })], TZ)).toEqual([]);
  });

  it("una tarjeta con todas las redes sin agendar es tentativa", () => {
    const cards = buildCalendar(
      [piece({ networks: [{ platform: "instagram", at: "2026-10-01T21:00:00Z", status: null }] })],
      TZ,
    );

    expect(cards[0].tentative).toBe(true);
  });

  it("basta con que una red este agendada para que ya no sea tentativa", () => {
    const cards = buildCalendar(
      [
        piece({
          networks: [
            { platform: "instagram", at: "2026-10-01T21:00:00Z", status: "scheduled" },
            { platform: "tiktok", at: "2026-10-01T21:00:00Z", status: null },
          ],
        }),
      ],
      TZ,
    );

    expect(cards[0].tentative).toBe(false);
  });
});

describe("el dia depende de la zona del negocio", () => {
  it("las 21:00 UTC son el mismo dia en Costa Rica y el siguiente en UTC+X", () => {
    // 2026-10-01T21:00Z = 15:00 en Costa Rica (UTC-6), mismo dia.
    expect(dayIn("2026-10-01T21:00:00Z", TZ)).toBe("2026-10-01");
    expect(dayIn("2026-10-02T01:00:00Z", TZ)).toBe("2026-10-01");
    expect(dayIn("2026-10-02T01:00:00Z", AR)).toBe("2026-10-01");
    expect(dayIn("2026-10-02T04:00:00Z", AR)).toBe("2026-10-02");
  });

  it("la misma publicacion cae en dias distintos segun la zona", () => {
    // Si el calendario usara la zona del navegador, dos personas del mismo
    // equipo verian la misma pieza en dias distintos.
    const networks = [{ platform: "instagram", at: "2026-10-02T02:00:00Z", status: null }];
    expect(buildCalendar([piece({ networks })], TZ)[0].day).toBe("2026-10-01");
    expect(buildCalendar([piece({ networks })], "Europe/Madrid")[0].day).toBe("2026-10-02");
  });
});

describe("el resumen del mes", () => {
  const cards = buildCalendar(
    [
      piece({
        id: "a",
        networks: [
          { platform: "instagram", at: "2026-10-01T21:00:00Z", status: "published" },
          { platform: "tiktok", at: "2026-10-01T21:00:00Z", status: "published" },
          { platform: "youtube", at: "2026-10-08T21:00:00Z", status: "scheduled" },
        ],
      }),
      piece({
        id: "b",
        networks: [{ platform: "instagram", at: "2026-10-15T21:00:00Z", status: "scheduled" }],
      }),
    ],
    TZ,
  );

  it("cuenta piezas, publicaciones y redistribuciones por separado", () => {
    // El caso del plano: una pieza en 3 redes con una redistribuida.
    expect(summarize(cards, "2026-10")).toEqual({
      pieces: 2,
      publications: 4,
      redistributions: 1,
    });
  });

  it("una pieza redistribuida en otro mes no cuenta como pieza nueva de ese mes", () => {
    // Contarla infla el numero que sirve para saber si se esta produciendo.
    const cruzada = buildCalendar(
      [
        piece({
          id: "c",
          networks: [
            { platform: "instagram", at: "2026-09-28T21:00:00Z", status: "published" },
            { platform: "youtube", at: "2026-10-05T21:00:00Z", status: "scheduled" },
          ],
        }),
      ],
      TZ,
    );

    expect(summarize(cruzada, "2026-10")).toEqual({
      pieces: 0,
      publications: 1,
      redistributions: 1,
    });
  });

  it("al contar piezas, una redistribucion vale cero", () => {
    const primera = cards.find((c) => !c.redistribution)!;
    const redistribucion = cards.find((c) => c.redistribution)!;
    expect(cardCount(primera, "pieces")).toBe(1);
    expect(cardCount(primera, "publications")).toBe(2);
    expect(cardCount(redistribucion, "pieces")).toBe(0);
  });
});

describe("mover una publicacion de dia", () => {
  const now = new Date("2026-09-26T12:00:00Z");

  it("conserva la hora y cambia solo el dia", () => {
    // Arrastrar dice "este otro dia", no "a las 00:00".
    const result = reschedule({
      currentAt: "2026-10-01T21:00:00Z", // 15:00 en Costa Rica
      toDay: "2026-10-05",
      timeZone: TZ,
      now,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(dayIn(result.at, TZ)).toBe("2026-10-05");
    expect(new Date(result.at).toISOString()).toBe("2026-10-05T21:00:00.000Z");
  });

  it("al pasado se rechaza", () => {
    const result = reschedule({
      currentAt: "2026-10-01T21:00:00Z",
      toDay: "2026-09-01",
      timeZone: TZ,
      now,
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("pasado") });
  });

  it("a menos de 5 minutos tampoco: no llega a la cola", () => {
    const result = reschedule({
      currentAt: "2026-09-26T06:02:00Z", // 00:02 en Costa Rica
      toDay: "2026-09-26",
      timeZone: TZ,
      now: new Date("2026-09-26T05:59:00Z"),
    });

    expect(result).toEqual({ ok: false, error: expect.stringContaining("5 minutos") });
  });

  it("una fecha rota no rompe: devuelve el motivo", () => {
    expect(reschedule({ currentAt: "no es fecha", toDay: "2026-10-05", timeZone: TZ, now }).ok).toBe(
      false,
    );
  });
});

describe("pasar una hora local a UTC", () => {
  it("usa el desfase real de la zona", () => {
    expect(zonedToUtc("2026-10-05T15:00", TZ)?.toISOString()).toBe("2026-10-05T21:00:00.000Z");
    expect(zonedToUtc("2026-10-05T15:00", AR)?.toISOString()).toBe("2026-10-05T18:00:00.000Z");
  });

  it("respeta el horario de verano en vez de un desfase fijo", () => {
    // Madrid: UTC+2 en julio, UTC+1 en diciembre. Con un desfase fijo, medio
    // año de publicaciones saldria una hora corrida.
    expect(zonedToUtc("2026-07-15T12:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-07-15T10:00:00.000Z",
    );
    expect(zonedToUtc("2026-12-15T12:00", "Europe/Madrid")?.toISOString()).toBe(
      "2026-12-15T11:00:00.000Z",
    );
  });

  it("un texto que no es una fecha devuelve null", () => {
    expect(zonedToUtc("mañana", TZ)).toBeNull();
  });
});
