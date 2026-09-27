import { describe, it, expect } from "vitest";
import { buildIcs, icsDate, escapeIcsText, foldIcsLine, googleCalendarLink, outlookLink, icsFilename, bookingLocationText } from "./ics";
import type { Booking } from "./types";

const booking: Pick<Booking, "uid" | "title" | "start_at" | "end_at" | "status" | "ical_uid" | "location_type" | "location_text" | "meet_url"> = {
  uid: "AbC123xyz_-AbC123xyz_-",
  title: "Llamada de triaje con Ana",
  start_at: "2026-10-06T20:00:00.000Z",
  end_at: "2026-10-06T20:30:00.000Z",
  status: "scheduled",
  ical_uid: null,
  location_type: "google_meet",
  location_text: null,
  meet_url: "https://meet.google.com/abc-defg-hij",
};
const now = new Date("2026-10-01T12:00:00.000Z");

describe("buildIcs (F27)", () => {
  it("genera un VEVENT válido con DTSTART y DTEND en UTC, UID = uid@dominio, SUMMARY y LOCATION", () => {
    const ics = buildIcs(booking, { domain: "agenda.ejemplo.com", now });
    const lines = ics.split("\r\n");
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines).toContain("BEGIN:VEVENT");
    expect(lines).toContain("UID:AbC123xyz_-AbC123xyz_-@agenda.ejemplo.com");
    expect(lines).toContain("DTSTAMP:20261001T120000Z");
    expect(lines).toContain("DTSTART:20261006T200000Z");
    expect(lines).toContain("DTEND:20261006T203000Z");
    expect(lines).toContain("SUMMARY:Llamada de triaje con Ana");
    expect(lines).toContain("LOCATION:https://meet.google.com/abc-defg-hij");
    expect(lines).toContain("STATUS:CONFIRMED");
    expect(lines).toContain("END:VCALENDAR");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("usa el iCalUID de Google cuando existe, y marca canceladas", () => {
    const ics = buildIcs({ ...booking, ical_uid: "abc@google.com", status: "cancelled_other" }, { domain: "x.com", now });
    expect(ics).toContain("UID:abc@google.com");
    expect(ics).toContain("METHOD:CANCEL");
    expect(ics).toContain("STATUS:CANCELLED");
  });

  it("escapa texto y pliega líneas largas a 75 octetos", () => {
    expect(escapeIcsText("a;b,c\\d\nx")).toBe("a\;b\\,c\\\\d\\nx");
    const folded = foldIcsLine(`DESCRIPTION:${"á".repeat(60)}`);
    for (const l of folded.split("\r\n")) expect(Buffer.byteLength(l, "utf8")).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n")[1]?.startsWith(" ")).toBe(true);
    const ics = buildIcs(booking, { domain: "x.com", now, description: "Con, coma; y punto y coma\nY salto" });
    expect(ics).toContain("DESCRIPTION:Con\\, coma\; y punto y coma\\nY salto");
  });

  it("ubicación manual y sin Meet todavía", () => {
    expect(bookingLocationText({ ...booking, meet_url: null })).toBe("Google Meet");
    expect(bookingLocationText({ location_type: "manual", location_text: "Oficina", meet_url: null })).toBe("Oficina");
    expect(icsDate("2026-01-05T03:04:05.678Z")).toBe("20260105T030405Z");
    expect(icsFilename(booking)).toBe("agenda-AbC123xyz_-AbC123xyz_-.ics");
  });

  it("links de Google y Outlook", () => {
    const g = new URL(googleCalendarLink(booking));
    expect(g.hostname).toBe("calendar.google.com");
    expect(g.searchParams.get("dates")).toBe("20261006T200000Z/20261006T203000Z");
    expect(g.searchParams.get("text")).toBe("Llamada de triaje con Ana");
    expect(g.searchParams.get("location")).toBe("https://meet.google.com/abc-defg-hij");

    const o = new URL(outlookLink(booking, "Detalle"));
    expect(o.hostname).toBe("outlook.live.com");
    expect(o.searchParams.get("startdt")).toBe("2026-10-06T20:00:00.000Z");
    expect(o.searchParams.get("subject")).toBe("Llamada de triaje con Ana");
    expect(o.searchParams.get("body")).toBe("Detalle");
  });
});
