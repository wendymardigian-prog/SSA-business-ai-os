import { describe, it, expect } from "vitest";
import { needsOutcome, quickFilterOf, applyQuickFilter, quickFilterCounts, groupForKanban, allowedDrops, filterBookings } from "./bookings-view";
import type { BookingStatus } from "./types";

const now = new Date("2026-10-06T16:00:00.000Z");
const b = (status: BookingStatus, start: string, minutes = 30) => ({
  status,
  start_at: start,
  end_at: new Date(Date.parse(start) + minutes * 60_000).toISOString(),
});

describe("needsOutcome (F32)", () => {
  it("una agenda scheduled que terminó hace 1 minuto: true", () => {
    expect(needsOutcome(b("scheduled", "2026-10-06T15:29:00.000Z"), now)).toBe(true);
  });

  it("no si todavía no terminó, ni si ya tiene resultado o está cancelada", () => {
    expect(needsOutcome(b("confirmed", "2026-10-06T15:45:00.000Z"), now)).toBe(false);
    expect(needsOutcome(b("sale", "2026-10-06T14:00:00.000Z"), now)).toBe(false);
    expect(needsOutcome(b("cancelled_other", "2026-10-06T14:00:00.000Z"), now)).toBe(false);
  });
});

describe("filtros rápidos (F33)", () => {
  const list = [
    b("scheduled", "2026-10-08T15:00:00.000Z"),
    b("confirmed", "2026-10-07T15:00:00.000Z"),
    b("scheduled", "2026-10-06T14:00:00.000Z"), // sin resultado
    b("no_show", "2026-10-05T14:00:00.000Z"),
    b("sale", "2026-10-01T14:00:00.000Z"),
    b("cancelled_no_response", "2026-10-09T14:00:00.000Z"),
  ];

  it("clasifica y cuenta", () => {
    expect(quickFilterOf(list[2], now)).toBe("needs_outcome");
    expect(quickFilterCounts(list, now)).toEqual({ upcoming: 2, needs_outcome: 1, with_outcome: 2, cancelled: 1 });
  });

  it("'Sin resultado' lista solo activas con el fin en el pasado; próximas ascendente, el resto descendente", () => {
    expect(applyQuickFilter(list, "needs_outcome", now).map((x) => x.start_at)).toEqual(["2026-10-06T14:00:00.000Z"]);
    expect(applyQuickFilter(list, "upcoming", now).map((x) => x.start_at)).toEqual(["2026-10-07T15:00:00.000Z", "2026-10-08T15:00:00.000Z"]);
    expect(applyQuickFilter(list, "with_outcome", now).map((x) => x.status)).toEqual(["no_show", "sale"]);
  });
});

describe("groupForKanban / allowedDrops", () => {
  it("una columna por estado en el orden de la tabla, siempre las 11, ordenadas por fecha", () => {
    const cols = groupForKanban([b("sale", "2026-10-02T14:00:00.000Z"), b("sale", "2026-10-01T14:00:00.000Z"), b("scheduled", "2026-10-08T15:00:00.000Z")]);
    expect(cols).toHaveLength(11);
    expect(cols.map((c) => c.status)[0]).toBe("scheduled");
    expect(cols.find((c) => c.status === "sale")?.bookings.map((x) => x.start_at)).toEqual(["2026-10-01T14:00:00.000Z", "2026-10-02T14:00:00.000Z"]);
    expect(cols.find((c) => c.status === "no_show")?.bookings).toEqual([]);
  });

  it("allowedDrops respeta canTransition", () => {
    expect(allowedDrops(b("scheduled", "2026-10-08T15:00:00.000Z"), now)).not.toContain("sale");
    expect(allowedDrops(b("scheduled", "2026-10-06T14:00:00.000Z"), now)).toContain("sale");
    expect(allowedDrops(b("cancelled_other", "2026-10-06T14:00:00.000Z"), now)).toEqual([]);
  });
});

describe("filterBookings", () => {
  const now = new Date("2026-10-01T12:00:00.000Z");
  const row = (over: Partial<Parameters<typeof filterBookings>[0][number]> = {}) => ({
    status: "scheduled" as const,
    start_at: "2026-10-02T15:00:00.000Z",
    end_at: "2026-10-02T15:30:00.000Z",
    host_user_id: "u1",
    event_type_id: "ev1",
    category_snapshot: { area_id: "area-ventas", area_name: "Ventas", type_id: "tipo-triaje", type_name: "Triaje" },
    booker_name: "Ana Pérez",
    booker_email: "ana@estudio.test",
    booker_phone: "+50687123344",
    ...over,
  });

  it("sin filtros devuelve todo, con las próximas primero", () => {
    const a = row({ start_at: "2026-10-03T15:00:00.000Z", end_at: "2026-10-03T15:30:00.000Z" });
    const b = row();
    expect(filterBookings([a, b], { quick: "upcoming" }, now).map((r) => r.start_at)).toEqual([b.start_at, a.start_at]);
  });

  it("el alcance propio esconde las de otra persona", () => {
    const mias = row();
    const ajenas = row({ host_user_id: "u2" });
    expect(filterBookings([mias, ajenas], {}, now, { scope: "own", userId: "u1" })).toEqual([mias]);
    expect(filterBookings([mias, ajenas], {}, now, { scope: "all", userId: "u1" })).toHaveLength(2);
  });

  it("filtra por área usando el snapshot, no la categoría actual", () => {
    const ventas = row();
    const servicio = row({ category_snapshot: { area_id: "area-servicio", area_name: "Servicio", type_id: "tipo-onb", type_name: "Onboarding" } });
    expect(filterBookings([ventas, servicio], { categoryIds: ["area-ventas"] }, now)).toEqual([ventas]);
    expect(filterBookings([ventas, servicio], { categoryIds: ["tipo-onb"] }, now)).toEqual([servicio]);
  });

  it("una agenda sin categoría no entra en un filtro por categoría", () => {
    const sin = row({ category_snapshot: null });
    expect(filterBookings([sin], { categoryIds: ["area-ventas"] }, now)).toEqual([]);
    expect(filterBookings([sin], {}, now)).toEqual([sin]);
  });

  it("busca por nombre, email o teléfono, sin distinguir mayúsculas", () => {
    const uno = row();
    const otro = row({ booker_name: "Juan", booker_email: "juan@otro.test", booker_phone: "+5215555" });
    expect(filterBookings([uno, otro], { search: "ANA" }, now)).toEqual([uno]);
    expect(filterBookings([uno, otro], { search: "juan@otro" }, now)).toEqual([otro]);
    expect(filterBookings([uno, otro], { search: "8712" }, now)).toEqual([uno]);
    expect(filterBookings([uno, otro], { search: "nadie" }, now)).toEqual([]);
  });

  it("el rango compara contra el inicio, con el final abierto", () => {
    const uno = row();
    expect(filterBookings([uno], { from: "2026-10-02T00:00:00.000Z", to: "2026-10-03T00:00:00.000Z" }, now)).toEqual([uno]);
    expect(filterBookings([uno], { from: "2026-10-03T00:00:00.000Z" }, now)).toEqual([]);
    // El "hasta" no incluye su propio instante.
    expect(filterBookings([uno], { to: "2026-10-02T15:00:00.000Z" }, now)).toEqual([]);
  });

  it("combina estado y anfitrión", () => {
    const mia = row();
    const cancelada = row({ status: "cancelled_other" });
    const ajena = row({ host_user_id: "u2" });
    expect(filterBookings([mia, cancelada, ajena], { statuses: ["scheduled"], hostUserIds: ["u1"] }, now)).toEqual([mia]);
  });
});
