import { describe, it, expect } from "vitest";
import { bookingVariables, emptyBookingVariables, schedulingLinkVariables, answerToText, BOOKING_VARIABLE_KEYS } from "./variables";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import type { Booking } from "../types";

const booking: Booking = {
  id: "b1",
  uid: "u1u1u1u1u1u1u1u1u1u1u1",
  event_type_id: "e1",
  host_user_id: "h1",
  contact_id: "c1",
  title: "Llamada de triaje",
  start_at: "2026-10-06T20:00:00.000Z",
  end_at: "2026-10-06T20:30:00.000Z",
  status: "scheduled",
  booker_timezone: "America/Mexico_City",
  host_timezone: "America/Costa_Rica",
  location_type: "google_meet",
  meet_url: "https://meet.google.com/abc",
  responses: { name: "Ana", email: "ana@ejemplo.com", canales: ["Instagram", "WhatsApp"], presupuesto: "1000" },
  category_snapshot: { area_id: "a", area_name: "Ventas", type_id: "t", type_name: "Triaje" },
};
const eventType = { title: "Llamada de triaje", duration_minutes: 30 };
const host = { name: "Ana", timezone: "America/Costa_Rica" };
const opts = { baseUrl: "https://agenda.ejemplo.com/" };

describe("bookingVariables (F47)", () => {
  const v = bookingVariables(booking, eventType, host, opts);

  it("formatea start_invitee en la zona del invitado y en español", () => {
    expect(v.start_invitee).toBe("martes 6 de octubre, 14:00 (hora de Ciudad de México)");
    expect(v.start_host).toBe("martes 6 de octubre, 14:00 (hora de Costa Rica)");
    expect(v.date_invitee).toBe("martes 6 de octubre");
    expect(v.time_invitee).toBe("14:00");
    expect(v.invitee_timezone).toBe("America/Mexico_City");
    expect(v.duration).toBe("30 minutos");
  });

  it("una respuesta de selección múltiple queda unida por comas", () => {
    expect(v.answers.canales).toBe("Instagram, WhatsApp");
    expect(v.answers.presupuesto).toBe("1000");
    expect(answerToText(null)).toBe("");
  });

  it("el resto de las variables", () => {
    expect(v).toMatchObject({
      event_title: "Llamada de triaje",
      category_area: "Ventas",
      category_type: "Triaje",
      location: "https://meet.google.com/abc",
      meet_url: "https://meet.google.com/abc",
      host_name: "Ana",
      reschedule_url: "https://agenda.ejemplo.com/calendario/agenda/u1u1u1u1u1u1u1u1u1u1u1/reagendar",
      cancel_url: "https://agenda.ejemplo.com/calendario/agenda/u1u1u1u1u1u1u1u1u1u1u1",
      cancellation_reason: "",
      status: "scheduled",
    });
  });

  it("days_since_end: días enteros desde que terminó la reunión (0 si no terminó o la fecha no se lee)", () => {
    const at = (iso: string) => bookingVariables(booking, eventType, host, { ...opts, now: new Date(iso) }).days_since_end;
    // La reunión termina el 6/10 a las 20:30Z.
    expect(at("2026-10-06T19:00:00Z")).toBe("0"); // todavía no empezó
    expect(at("2026-10-06T21:00:00Z")).toBe("0"); // terminó hace 30 min
    expect(at("2026-10-07T20:29:00Z")).toBe("0"); // falta 1 min para el día 1
    expect(at("2026-10-07T20:30:00Z")).toBe("1");
    expect(at("2026-10-09T00:00:00Z")).toBe("2");
    expect(at("2026-11-09T00:00:00Z")).toBe("33");
    expect(bookingVariables({ ...booking, end_at: "no es una fecha" }, eventType, host, opts).days_since_end).toBe("0");
  });

  it("se interpolan con el flow engine", () => {
    const text = interpolateVariables("Hola {{booking.answers.name}}, tu {{booking.event_title}} es el {{booking.start_invitee}}. Reagendar: {{booking.reschedule_url}}", { booking: v });
    expect(text).toBe(
      "Hola Ana, tu Llamada de triaje es el martes 6 de octubre, 14:00 (hora de Ciudad de México). Reagendar: https://agenda.ejemplo.com/calendario/agenda/u1u1u1u1u1u1u1u1u1u1u1/reagendar",
    );
  });

  it("sin agenda en el contexto, las variables quedan vacías sin romper el mensaje", () => {
    const empty = emptyBookingVariables();
    expect(Object.keys(empty).sort()).toEqual([...BOOKING_VARIABLE_KEYS, "answers"].sort());
    expect(interpolateVariables("Hola {{booking.event_title}}.", { booking: empty })).toBe("Hola .");
  });

  it("scheduling.link.<usuario>.<slug> con guiones como guión bajo", () => {
    const vars = schedulingLinkVariables([{ username: "ana", slug: "llamada-de-triaje" }], opts.baseUrl);
    expect(vars.scheduling.link.ana.llamada_de_triaje).toBe("https://agenda.ejemplo.com/calendario/ana/llamada-de-triaje");
    expect(interpolateVariables("Agendá acá: {{scheduling.link.ana.llamada_de_triaje}}", vars)).toBe(
      "Agendá acá: https://agenda.ejemplo.com/calendario/ana/llamada-de-triaje",
    );
  });
});
