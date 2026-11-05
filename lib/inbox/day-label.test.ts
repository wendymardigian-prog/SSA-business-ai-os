import { describe, expect, it } from "vitest";
import { calendarDaysAgo } from "@/lib/dates";
import { listTimeLabel, threadDayLabel } from "./day-label";

// Instantes con "Z" y zona explicita: el resultado no puede depender de la zona
// de la maquina que corre el test.
const BA = "America/Argentina/Buenos_Aires"; // UTC-3, sin horario de verano
const CR = "America/Costa_Rica"; // UTC-6
const at = (s: string) => new Date(s);

describe("calendarDaysAgo", () => {
  it("ayer a la tarde, mirado hoy temprano, es ayer aunque pasaron menos de 24 h", () => {
    expect(calendarDaysAgo(at("2026-10-23T18:54:00Z"), at("2026-10-24T11:00:00Z"), BA)).toBe(1);
  });
  it("hoy a la madrugada, mirado hoy a la noche, es hoy", () => {
    expect(calendarDaysAgo(at("2026-10-24T03:10:00Z"), at("2026-10-25T02:50:00Z"), BA)).toBe(0);
  });
});

describe("threadDayLabel", () => {
  const now = at("2026-10-24T11:00:00Z"); // 8:00 en Buenos Aires

  it("hoy y ayer en castellano", () => {
    expect(threadDayLabel(at("2026-10-24T10:00:00Z"), BA, now)).toBe("Hoy");
    expect(threadDayLabel(at("2026-10-23T18:54:00Z"), BA, now)).toBe("Ayer");
  });

  it("mas atras, la fecha", () => {
    expect(threadDayLabel(at("2026-10-20T13:00:00Z"), BA, now)).not.toMatch(/Hoy|Ayer/);
  });

  it("es 'Ayer' en una zona donde en UTC todavia es hoy", () => {
    const mensaje = at("2026-10-24T01:00:00Z"); // 23/10 22:00 en Buenos Aires
    const ahora = at("2026-10-24T15:00:00Z"); // 24/10 12:00 en Buenos Aires
    expect(threadDayLabel(mensaje, "UTC", ahora)).toBe("Hoy");
    expect(threadDayLabel(mensaje, BA, ahora)).toBe("Ayer");
  });

  it("la medianoche de la zona es el corte, no la de UTC", () => {
    const ahora = at("2026-10-24T12:00:00Z");
    expect(threadDayLabel(at("2026-10-24T03:00:00Z"), BA, ahora)).toBe("Hoy"); // 00:00 justo
    expect(threadDayLabel(at("2026-10-24T02:59:59Z"), BA, ahora)).toBe("Ayer"); // 23:59:59
  });

  it("el cambio de año se cuenta en la zona", () => {
    // 31/12/2026 23:30 en Buenos Aires, que en UTC ya es 2027.
    const mensaje = at("2027-01-01T02:30:00Z");
    expect(threadDayLabel(mensaje, BA, at("2027-01-01T13:00:00Z"))).toBe("Ayer");
    expect(threadDayLabel(mensaje, "UTC", at("2027-01-01T13:00:00Z"))).toBe("Hoy");

    // Unos dias despues: el año se escribe porque en la zona el mensaje es de 2026.
    const despues = at("2027-01-05T13:00:00Z");
    expect(threadDayLabel(mensaje, BA, despues)).toContain("2026");
    expect(threadDayLabel(mensaje, "UTC", despues)).not.toContain("202");
  });

  it("la fecha que escribe es la del dia en la zona", () => {
    const mensaje = at("2026-10-20T01:00:00Z"); // 19/10 en Buenos Aires
    expect(threadDayLabel(mensaje, BA, now)).toContain("19");
    expect(threadDayLabel(mensaje, "UTC", now)).toContain("20");
  });
});

describe("listTimeLabel", () => {
  const now = at("2026-10-24T11:00:00Z");

  it("un mensaje de ayer a la noche dice 'Ayer', no la hora", () => {
    expect(listTimeLabel(at("2026-10-24T01:25:00Z"), BA, now)).toBe("Ayer");
  });

  it("uno de hoy dice la hora de la zona de quien mira", () => {
    const mensaje = at("2026-10-24T10:19:00Z");
    expect(listTimeLabel(mensaje, BA, now)).toMatch(/^07:19/);
    expect(listTimeLabel(mensaje, "UTC", now)).toMatch(/^10:19/);
  });

  it("el mismo mensaje puede ser de hoy para uno y de ayer para otro", () => {
    const mensaje = at("2026-10-24T04:00:00Z"); // 24/10 01:00 en BA, 23/10 22:00 en Costa Rica
    expect(listTimeLabel(mensaje, BA, now)).toMatch(/^01:00/);
    expect(listTimeLabel(mensaje, CR, now)).toBe("Ayer");
  });

  it("mas de una semana: la fecha del dia en la zona", () => {
    const mensaje = at("2026-10-10T01:00:00Z"); // 9/10 en Buenos Aires
    expect(listTimeLabel(mensaje, BA, now)).toContain("9");
    expect(listTimeLabel(mensaje, BA, now)).not.toContain("10");
  });
});
