import { describe, expect, it } from "vitest";
import {
  UNASSIGNED_KEY,
  UNASSIGNED_LABEL,
  categoryLabel,
  computeCards,
  groupBookings,
  isAgendaDimension,
  parseAxis,
  sumBookings,
  type AgendaBooking,
} from "./agenda";

let n = 0;
function booking(over: Partial<AgendaBooking> = {}): AgendaBooking {
  n += 1;
  return {
    id: `b-${n}`,
    contactId: `c-${n}`,
    status: "scheduled",
    statusGroup: "active",
    hostUserId: "u-ana",
    origin: "public_page",
    categorySnapshot: { area_name: "Ventas", type_name: "Triaje" },
    utm: { utm_source: "instagram", utm_medium: "bio", utm_campaign: "otoño" },
    ...over,
  };
}

const HOSTS = new Map([
  ["u-ana", "Ana"],
  ["u-leo", "Leo"],
]);

describe("computeCards", () => {
  it("cuenta agendas y contactos por separado: una persona que agenda dos veces son dos agendas y un contacto", () => {
    const rows = [booking({ contactId: "c-x" }), booking({ contactId: "c-x" }), booking({ contactId: "c-y" })];
    const cards = computeCards(rows);
    expect(cards.bookings).toBe(3);
    expect(cards.contacts).toBe(2);
  });

  it("cuenta canceladas, no-show, con resultado y ventas por su grupo y estado", () => {
    const rows = [
      booking({ status: "cancelled_other", statusGroup: "cancelled" }),
      booking({ status: "cancelled_no_response", statusGroup: "cancelled" }),
      booking({ status: "no_show", statusGroup: "no_show" }),
      booking({ status: "sale", statusGroup: "outcome" }),
      booking({ status: "followup_warm", statusGroup: "outcome" }),
      booking({ status: "confirmed", statusGroup: "active" }),
    ];
    expect(computeCards(rows)).toEqual({ bookings: 6, contacts: 6, cancelled: 2, noShow: 1, outcome: 2, sales: 1 });
  });

  it("sin agendas no hay nada que contar: la pantalla muestra su estado vacio, no ceros inventados", () => {
    expect(computeCards([]).bookings).toBe(0);
    expect(groupBookings([], "status")).toEqual([]);
  });
});

describe("groupBookings", () => {
  it("la suma de las filas es el total, en cualquier dimension", () => {
    const rows = [
      booking(),
      booking({ hostUserId: "u-leo", origin: "manual", utm: {}, categorySnapshot: null }),
      booking({ hostUserId: null, origin: null, utm: null, status: "sale", statusGroup: "outcome" }),
      booking({ utm: { utm_source: "  " } }),
    ];
    for (const dim of ["status", "category", "host", "origin", "utm_source", "utm_medium", "utm_campaign"] as const) {
      expect(sumBookings(groupBookings(rows, dim, HOSTS)), dim).toBe(rows.length);
    }
  });

  it("lo que no tiene valor va a 'Sin asignar', siempre al final aunque sea lo mas grande", () => {
    const rows = [booking({ utm: {} }), booking({ utm: {} }), booking({ utm: {} }), booking({ utm: { utm_source: "google" } })];
    const out = groupBookings(rows, "utm_source", HOSTS);
    expect(out.map((r) => r.label)).toEqual(["google", UNASSIGNED_LABEL]);
    expect(out[1]).toMatchObject({ key: UNASSIGNED_KEY, bookings: 3 });
  });

  it("agrupa por estado con su etiqueta en castellano", () => {
    const out = groupBookings([booking({ status: "no_show", statusGroup: "no_show" }), booking()], "status");
    expect(out.map((r) => r.label).sort()).toEqual(["Agendada", "No-show"]);
  });

  it("un estado que no conoce no rompe: se muestra tal cual", () => {
    expect(groupBookings([booking({ status: "raro" })], "status")[0].label).toBe("raro");
  });

  it("agrupa por responsable con su nombre, y 'Sin nombre' si ya no esta en el equipo", () => {
    const rows = [booking(), booking({ hostUserId: "u-leo" }), booking({ hostUserId: "u-fantasma" })];
    expect(groupBookings(rows, "host", HOSTS).map((r) => r.label).sort()).toEqual(["Ana", "Leo", "Sin nombre"]);
  });

  it("agrupa por origen con su etiqueta", () => {
    const out = groupBookings([booking({ origin: "agent" }), booking({ origin: "embed" })], "origin");
    expect(out.map((r) => r.label).sort()).toEqual(["Agente", "Formulario embebido"]);
  });

  it("los contactos de cada fila son personas distintas EN esa fila; el total aparte no es la suma", () => {
    const rows = [
      booking({ contactId: "c-1", utm: { utm_source: "instagram" } }),
      booking({ contactId: "c-1", utm: { utm_source: "instagram" } }),
      booking({ contactId: "c-1", utm: { utm_source: "google" } }),
      booking({ contactId: "c-2", utm: { utm_source: "google" } }),
    ];
    const out = groupBookings(rows, "utm_source");
    expect(out.find((r) => r.label === "instagram")).toMatchObject({ bookings: 2, contacts: 1 });
    expect(out.find((r) => r.label === "google")).toMatchObject({ bookings: 2, contacts: 2 });
    // c-1 esta en las dos filas: 3 en la suma de filas, 2 personas de verdad.
    expect(out.reduce((t, r) => t + r.contacts, 0)).toBe(3);
    expect(computeCards(rows).contacts).toBe(2);
  });

  it("ordena de mas a menos agendas", () => {
    const rows = [booking({ origin: "manual" }), booking(), booking(), booking({ origin: "agent" })];
    expect(groupBookings(rows, "origin")[0].label).toBe("Página pública");
  });

  it("cuenta las ventas y canceladas dentro de cada fila", () => {
    const rows = [
      booking({ status: "sale", statusGroup: "outcome" }),
      booking({ status: "cancelled_other", statusGroup: "cancelled" }),
      booking({ origin: "manual" }),
    ];
    const out = groupBookings(rows, "origin");
    expect(out.find((r) => r.key === "public_page")).toMatchObject({ bookings: 2, sales: 1, cancelled: 1, outcome: 1 });
  });
});

describe("categoryLabel", () => {
  it("area y tipo, o el que haya, o nada", () => {
    expect(categoryLabel({ area_name: "Ventas", type_name: "Triaje" })).toBe("Ventas · Triaje");
    expect(categoryLabel({ area_name: "Ventas" })).toBe("Ventas");
    expect(categoryLabel({ type_name: "Triaje" })).toBe("Triaje");
    expect(categoryLabel(null)).toBeNull();
    expect(categoryLabel("raro")).toBeNull();
    expect(categoryLabel({ area_name: "  " })).toBeNull();
  });
});

describe("parametros de la URL", () => {
  it("el eje es 'cuando agendo' salvo que pida la fecha de la reunion", () => {
    expect(parseAxis(undefined)).toBe("created");
    expect(parseAxis("basura")).toBe("created");
    expect(parseAxis("start")).toBe("start");
  });

  it("solo existen las dimensiones del catalogo", () => {
    expect(isAgendaDimension("utm_source")).toBe(true);
    expect(isAgendaDimension("contacto")).toBe(false);
  });
});
