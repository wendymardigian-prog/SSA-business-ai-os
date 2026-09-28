/**
 * Los filtros de los triggers de agenda (F43, F44).
 *
 * La regla que más importa: un filtro vacío quiere decir "cualquiera", nunca
 * "ninguno". Un flujo configurado sin filtros tiene que disparar para todo.
 */

import { describe, expect, it } from "vitest";
import {
  BOOKING_TRIGGER_TYPES,
  bookingDedupeKey,
  bookingEventMatches,
  describeTrigger,
  isRelativeTrigger,
  matchesCommonFilters,
  planRelativeJobs,
  relativeRunAt,
  RELATIVE_TRIGGER_TYPES,
} from "./triggers";

const booking = {
  id: "bk-1",
  event_type_id: "ev-1",
  host_user_id: "u-1",
  origin: "public_page",
  status: "scheduled" as const,
  category_snapshot: { area_id: "area-ventas", type_id: "tipo-triaje" },
  start_at: "2026-10-01T15:00:00.000Z",
  end_at: "2026-10-01T15:30:00.000Z",
  created_at: "2026-09-20T10:00:00.000Z",
  reschedule_count: 0,
};

describe("el catálogo", () => {
  it("son nueve tipos y tres son relativos", () => {
    expect(BOOKING_TRIGGER_TYPES).toHaveLength(9);
    expect(RELATIVE_TRIGGER_TYPES).toHaveLength(3);
    expect(RELATIVE_TRIGGER_TYPES.every(isRelativeTrigger)).toBe(true);
    expect(isRelativeTrigger("booking_created")).toBe(false);
  });
});

describe("matchesCommonFilters", () => {
  it("sin filtros, pasa todo", () => {
    expect(matchesCommonFilters({}, booking)).toBe(true);
    expect(matchesCommonFilters({ category_ids: [], host_user_ids: [] }, booking)).toBe(true);
  });

  it("filtra por evento, anfitrión y origen", () => {
    expect(matchesCommonFilters({ event_type_ids: ["ev-1"] }, booking)).toBe(true);
    expect(matchesCommonFilters({ event_type_ids: ["ev-2"] }, booking)).toBe(false);
    expect(matchesCommonFilters({ host_user_ids: ["u-2"] }, booking)).toBe(false);
    expect(matchesCommonFilters({ origins: ["manual", "agent"] }, booking)).toBe(false);
    expect(matchesCommonFilters({ origins: ["public_page"] }, booking)).toBe(true);
  });

  it("el área alcanza: no hace falta nombrar cada tipo", () => {
    expect(matchesCommonFilters({ category_ids: ["area-ventas"] }, booking)).toBe(true);
    expect(matchesCommonFilters({ category_ids: ["tipo-triaje"] }, booking)).toBe(true);
    expect(matchesCommonFilters({ category_ids: ["area-servicio"] }, booking)).toBe(false);
  });

  it("una agenda sin categoría no entra en un filtro por categoría", () => {
    expect(matchesCommonFilters({ category_ids: ["area-ventas"] }, { ...booking, category_snapshot: null })).toBe(false);
  });
});

describe("bookingEventMatches", () => {
  it("cancelar filtra por quién canceló", () => {
    const payload = { booking_id: "bk-1", by_whom: "invitee" };
    expect(bookingEventMatches("booking_cancelled", { by_whom: ["invitee"] }, payload, booking)).toBe(true);
    expect(bookingEventMatches("booking_cancelled", { by_whom: ["host"] }, payload, booking)).toBe(false);
    expect(bookingEventMatches("booking_cancelled", {}, payload, booking)).toBe(true);
  });

  it("el cambio de estado filtra por el estado nuevo, el viejo y el grupo", () => {
    const payload = { booking_id: "bk-1", from_status: "scheduled", to_status: "sale" };
    expect(bookingEventMatches("booking_status_changed", { to_status: ["sale"] }, payload, booking)).toBe(true);
    expect(bookingEventMatches("booking_status_changed", { to_status: ["no_show"] }, payload, booking)).toBe(false);
    expect(bookingEventMatches("booking_status_changed", { from_status: ["scheduled"] }, payload, booking)).toBe(true);
    expect(bookingEventMatches("booking_status_changed", { to_group: ["outcome"] }, payload, booking)).toBe(true);
    expect(bookingEventMatches("booking_status_changed", { to_group: ["cancelled"] }, payload, booking)).toBe(false);
  });

  it("los filtros comunes siguen valiendo para los tipos con filtros propios", () => {
    const payload = { booking_id: "bk-1", by_whom: "invitee" };
    expect(bookingEventMatches("booking_cancelled", { by_whom: ["invitee"], host_user_ids: ["otro"] }, payload, booking)).toBe(false);
  });
});

describe("bookingDedupeKey", () => {
  it("los inmediatos disparan una sola vez por agenda", () => {
    expect(bookingDedupeKey("booking_created", "bk-1")).toBe("booking_created:bk-1");
    expect(bookingDedupeKey("booking_created", "bk-1", 3)).toBe("booking_created:bk-1");
  });

  it("los relativos llevan el número de reagendas: mover la reunión vuelve a habilitar el aviso", () => {
    expect(bookingDedupeKey("booking_before_start", "bk-1", 0)).toBe("booking_before_start:bk-1:0");
    expect(bookingDedupeKey("booking_before_start", "bk-1", 1)).toBe("booking_before_start:bk-1:1");
  });
});

describe("relativeRunAt", () => {
  it("antes resta del inicio; después suma al fin; después de agendar suma a la creación", () => {
    expect(relativeRunAt("booking_before_start", 60, booking)?.toISOString()).toBe("2026-10-01T14:00:00.000Z");
    expect(relativeRunAt("booking_after_end", 60, booking)?.toISOString()).toBe("2026-10-01T16:30:00.000Z");
    expect(relativeRunAt("booking_after_created", 120, booking)?.toISOString()).toBe("2026-09-20T12:00:00.000Z");
  });

  it("un desfase negativo se toma como su valor absoluto: 'antes' ya dice la dirección", () => {
    expect(relativeRunAt("booking_before_start", -60, booking)?.toISOString()).toBe("2026-10-01T14:00:00.000Z");
  });

  it("un tipo que no es relativo no tiene hora", () => {
    expect(relativeRunAt("booking_created", 60, booking)).toBeNull();
  });
});

describe("planRelativeJobs", () => {
  const triggers = [
    { id: "t1", type: "booking_before_start", is_active: true, config: { offset_minutes: 1440 } },
    { id: "t2", type: "booking_after_end", is_active: true, config: { offset_minutes: 60 } },
    { id: "t3", type: "booking_created", is_active: true, config: {} },
    { id: "t4", type: "booking_before_start", is_active: false, config: { offset_minutes: 60 } },
  ];
  const now = new Date("2026-09-25T10:00:00.000Z");

  it("agenda solo los relativos activos, ordenados por hora", () => {
    const jobs = planRelativeJobs(booking, triggers, now);
    expect(jobs.map((j) => j.triggerId)).toEqual(["t1", "t2"]);
    expect(jobs[0].runAt).toBe("2026-09-30T15:00:00.000Z");
    expect(jobs[0].dedupeKey).toBe("booking_before_start:bk-1:0");
  });

  it("un aviso cuya hora ya pasó no se agenda", () => {
    const jobs = planRelativeJobs(booking, triggers, new Date("2026-10-01T14:30:00.000Z"));
    expect(jobs.map((j) => j.triggerId)).toEqual(["t2"]);
  });

  it("sin desfase configurado no se agenda nada", () => {
    expect(planRelativeJobs(booking, [{ id: "t", type: "booking_before_start", is_active: true, config: {} }], now)).toEqual([]);
  });

  it("los filtros comunes también valen para los relativos", () => {
    const jobs = planRelativeJobs(booking, [{ id: "t", type: "booking_before_start", is_active: true, config: { offset_minutes: 60, category_ids: ["area-servicio"] } }], now);
    expect(jobs).toEqual([]);
  });

  it("al reagendar, la clave cambia y el aviso se puede volver a mandar", () => {
    const jobs = planRelativeJobs({ ...booking, reschedule_count: 2 }, triggers, now);
    expect(jobs[0].dedupeKey).toBe("booking_before_start:bk-1:2");
  });
});

describe("describeTrigger", () => {
  it("dice en palabras cuándo corre", () => {
    expect(describeTrigger("booking_before_start", { offset_minutes: 1440 })).toBe("1 día antes de la reunión");
    expect(describeTrigger("booking_after_end", { offset_minutes: 60 })).toBe("1 hora después de la reunión");
    expect(describeTrigger("booking_after_created", { offset_minutes: 120 })).toBe("2 horas después de agendar");
    expect(describeTrigger("booking_created", {})).toBe("Se agendó una reunión");
  });

  it("un desfase que no está en la lista igual se explica", () => {
    expect(describeTrigger("booking_before_start", { offset_minutes: 47 })).toBe("47 minutos antes de la reunión");
  });
});
