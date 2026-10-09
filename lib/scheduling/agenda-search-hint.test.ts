import { describe, expect, it } from "vitest";
import { agendaSearchHint } from "./agenda-search-hint";

const base = { view: "list" as const, period: "7-30" as const, customRange: null, timezone: "America/Costa_Rica" };

describe("agendaSearchHint", () => {
  it("con un periodo elegido, avisa que la busqueda se limita a esas fechas", () => {
    expect(agendaSearchHint(base)).toBe(
      "Se busca solo dentro de: Últimos 7 + próximos 30 días. Cambiá el período para buscar en otras fechas.",
    );
    expect(agendaSearchHint({ ...base, period: "hoy" })).toContain("Hoy");
  });

  it("con 'Todo' no hay filtro de fecha y no hace falta avisar", () => {
    expect(agendaSearchHint({ ...base, period: "todo" })).toBeNull();
  });

  it("un rango a medida gana sobre el atajo, y se dice con las fechas", () => {
    // 1 a 15 de octubre de 2026, en hora de Costa Rica (UTC-6).
    const hint = agendaSearchHint({
      ...base,
      period: "todo",
      customRange: { from: "2026-10-01T06:00:00.000Z", to: "2026-10-16T05:59:59.999Z" },
    });
    expect(hint).toMatch(/^Se busca solo dentro de: .*oct.*–.*oct/);
  });

  it("en el calendario, la busqueda se limita a lo que se ve", () => {
    expect(agendaSearchHint({ ...base, view: "calendar", period: "todo" })).toBe(
      "Se busca solo dentro de lo que muestra el calendario.",
    );
  });
});
