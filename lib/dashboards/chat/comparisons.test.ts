import { describe, expect, it } from "vitest";
import { comparePercent, comparePoints, formatAgo, formatCount, formatDuration, share } from "./comparisons";

describe("comparePercent", () => {
  it("compara en porcentaje, no en diferencia absoluta", () => {
    const c = comparePercent(120, 100);
    expect(c.percent).toBe(20);
    expect(c.label).toBe("▲ 20 % vs. período anterior");
  });

  it("sin periodo anterior lo dice, no muestra 0 %", () => {
    expect(comparePercent(120, null).label).toBe("Sin datos del período anterior");
    expect(comparePercent(120, null).percent).toBeNull();
  });

  it("un periodo anterior en cero no es crecimiento infinito", () => {
    expect(comparePercent(5, 0).percent).toBeNull();
  });

  it("bajar es bueno cuando la metrica es de tiempo", () => {
    expect(comparePercent(60, 120, "less-is-better").tone).toBe("good");
    expect(comparePercent(120, 60, "less-is-better").tone).toBe("bad");
  });

  it("subir es bueno cuando la metrica es de volumen", () => {
    expect(comparePercent(120, 60).tone).toBe("good");
    expect(comparePercent(60, 120).tone).toBe("bad");
  });

  it("sin cambio es neutro", () => {
    const c = comparePercent(100, 100);
    expect(c.direction).toBe("flat");
    expect(c.tone).toBe("neutral");
  });
});

describe("comparePoints", () => {
  it("una tasa se compara en puntos", () => {
    const c = comparePoints(17, 20, "less-is-better");
    expect(c.points).toBe(-3);
    expect(c.label).toBe("▼ 3 pts vs. período anterior");
    // "Derivó" bajando es bueno: menos conversaciones que el agente no supo.
    expect(c.tone).toBe("good");
  });

  it("sin anterior lo dice", () => {
    expect(comparePoints(17, null).label).toBe("Sin datos del período anterior");
  });
});

describe("share", () => {
  it("es null sin total, no 0 %", () => {
    expect(share(3, 0)).toBeNull();
  });
  it("redondea", () => {
    expect(share(1, 3)).toBe(33);
  });
});

describe("formatDuration", () => {
  it("segundos, minutos y horas", () => {
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(180)).toBe("3 min");
    expect(formatDuration(7800)).toBe("2 h 10 min");
    expect(formatDuration(7200)).toBe("2 h");
  });
  it("sin dato, una raya", () => {
    expect(formatDuration(null)).toBe("—");
  });
});

describe("formatCount", () => {
  it("usa separador de miles", () => {
    expect(formatCount(1180)).toBe("1.180");
  });
  it("sin dato, una raya", () => {
    expect(formatCount(null)).toBe("—");
  });
});

describe("formatAgo", () => {
  const now = new Date("2026-09-28T12:00:00.000Z");
  it("recien cargado", () => {
    expect(formatAgo("2026-09-28T11:59:40.000Z", now)).toContain("menos de un minuto");
  });
  it("minutos y horas, en singular y plural", () => {
    expect(formatAgo("2026-09-28T11:59:00.000Z", now)).toBe("Actualizado hace 1 minuto");
    expect(formatAgo("2026-09-28T11:40:00.000Z", now)).toBe("Actualizado hace 20 minutos");
    expect(formatAgo("2026-09-28T11:00:00.000Z", now)).toBe("Actualizado hace 1 hora");
    expect(formatAgo("2026-09-28T09:00:00.000Z", now)).toBe("Actualizado hace 3 horas");
  });
  it("un reloj adelantado no dice 'hace -2 minutos'", () => {
    expect(formatAgo("2026-09-28T12:05:00.000Z", now)).toBe("Actualizado ahora");
  });
});
