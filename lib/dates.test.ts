import { describe, it, expect } from "vitest";
import { resolveDateRange, todayInputValue, APP_TIMEZONE } from "./dates";

/**
 * Argentina es UTC-3 todo el ano, asi que la medianoche local de un dia D es
 * D a las 03:00 UTC. Ese es el numero que aparece en casi todas las
 * expectativas de abajo.
 */

describe("resolveDateRange — presets cruzando el borde del dia", () => {
  it("a las 21:30 de Buenos Aires, 'hoy' sigue siendo hoy y no manana", () => {
    // 2026-09-08 00:30 UTC = 2026-09-07 21:30 en Buenos Aires.
    const ahora = new Date("2026-09-08T00:30:00Z");
    const { from, to } = resolveDateRange("hoy", undefined, undefined, ahora);

    expect(from).toBe("2026-09-07T03:00:00.000Z");
    expect(to).toBeNull();
  });

  it("a las 10:00 de Buenos Aires, 'hoy' arranca en la medianoche local", () => {
    const ahora = new Date("2026-09-07T13:00:00Z");
    expect(resolveDateRange("hoy", undefined, undefined, ahora).from).toBe(
      "2026-09-07T03:00:00.000Z",
    );
  });

  it("un mensaje de las 22:00 de anoche NO entra en el 'hoy' de hoy", () => {
    const ahora = new Date("2026-09-07T13:00:00Z"); // 10:00 local del 7
    const { from } = resolveDateRange("hoy", undefined, undefined, ahora);
    const anoche = new Date("2026-09-07T01:00:00Z"); // 22:00 local del 6
    expect(anoche.toISOString() < from!).toBe(true);
  });

  it("'ultimos 7 dias' cuenta hoy adentro: arranca 6 dias atras", () => {
    const ahora = new Date("2026-09-08T00:30:00Z"); // 7 de septiembre local
    expect(resolveDateRange("7d", undefined, undefined, ahora).from).toBe(
      "2026-09-01T03:00:00.000Z",
    );
  });

  it("'ultimos 30 dias' cruza el cambio de mes", () => {
    const ahora = new Date("2026-09-07T13:00:00Z");
    expect(resolveDateRange("30d", undefined, undefined, ahora).from).toBe(
      "2026-08-09T03:00:00.000Z",
    );
  });

  it("sin preset no filtra nada", () => {
    expect(resolveDateRange("")).toEqual({ from: null, to: null });
  });
});

describe("resolveDateRange — rango personalizado", () => {
  it("toma el dia completo de punta a punta en hora local", () => {
    const { from, to } = resolveDateRange("custom", "2026-09-01", "2026-09-07");
    expect(from).toBe("2026-09-01T03:00:00.000Z");
    expect(to).toBe("2026-09-08T02:59:59.999Z");
  });

  it("da vuelta un rango invertido en vez de devolver nada", () => {
    const alReves = resolveDateRange("custom", "2026-09-07", "2026-09-01");
    const derecho = resolveDateRange("custom", "2026-09-01", "2026-09-07");
    expect(alReves).toEqual(derecho);
  });

  it("acepta un solo extremo", () => {
    expect(resolveDateRange("custom", "2026-09-01").to).toBeNull();
    expect(resolveDateRange("custom", undefined, "2026-09-07").from).toBeNull();
  });

  it("ignora fechas mal formadas o inexistentes", () => {
    expect(resolveDateRange("custom", "ayer")).toEqual({ from: null, to: null });
    expect(resolveDateRange("custom", "2026-02-31")).toEqual({ from: null, to: null });
    expect(resolveDateRange("custom", "2026-13-01")).toEqual({ from: null, to: null });
  });

  it("un mensaje del ultimo minuto del dia final entra en el rango", () => {
    const { to } = resolveDateRange("custom", "2026-09-01", "2026-09-07");
    const ultimoMinuto = new Date("2026-09-08T02:30:00Z"); // 23:30 local del 7
    expect(ultimoMinuto.toISOString() < to!).toBe(true);
  });
});

describe("todayInputValue", () => {
  it("devuelve el dia local, no el de UTC", () => {
    // Ya es 8 en UTC, todavia es 7 en Buenos Aires.
    expect(todayInputValue(new Date("2026-09-08T00:30:00Z"))).toBe("2026-09-07");
  });

  it("usa el formato que espera un input type=date", () => {
    expect(todayInputValue(new Date("2026-01-05T15:00:00Z"))).toBe("2026-01-05");
  });
});

describe("zona horaria", () => {
  it("la constante es la del negocio", () => {
    expect(APP_TIMEZONE).toBe("America/Argentina/Buenos_Aires");
  });

  it("acepta otra zona por parametro, para cuando sea configurable", () => {
    const ahora = new Date("2026-09-07T23:00:00Z");
    // En Tokio (UTC+9) ya es el 8.
    const { from } = resolveDateRange("hoy", undefined, undefined, ahora, "Asia/Tokyo");
    expect(from).toBe("2026-09-07T15:00:00.000Z");
  });
});
