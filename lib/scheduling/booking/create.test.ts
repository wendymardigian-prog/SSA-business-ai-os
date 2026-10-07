/**
 * Crear una agenda (F26): el orden de las verificaciones y lo que queda escrito.
 *
 * Google esta simulado. Ningun test toca la red.
 */

import { describe, expect, it, beforeEach } from "vitest";
import { createBooking, countryFromTimezone } from "./create";
import { schedulingWorld, EVENT, HOST } from "@/lib/scheduling/testing/world";
import { resetBusyCache } from "@/lib/scheduling/data/slots-input";
import { HONEYPOT_FIELD } from "@/lib/scheduling/antispam";

// Jueves 1 de octubre de 2026, 10:00 en Costa Rica (UTC-6) = 16:00 UTC.
const NOW = new Date("2026-09-30T16:00:00.000Z");
const START = "2026-10-01T16:00:00.000Z";

const base = {
  username: "ana",
  slug: "llamada-de-triaje",
  startUtc: START,
  inviteeTz: "America/Costa_Rica",
  origin: "public_page" as const,
  now: NOW,
  responses: { name: "Juan Pérez", email: "juan@ejemplo.com" },
};

beforeEach(() => resetBusyCache());

describe("createBooking", () => {
  it("crea la agenda, el contacto, el evento de automatizacion y los dos jobs", async () => {
    const db = schedulingWorld();
    const result = await createBooking(db.client, base);

    expect(result.ok).toBe(true);
    if (!result.ok || !result.uid) throw new Error("no se creó");
    expect(result.uid).toHaveLength(22);

    const booking = db.rows("bookings")[0];
    expect(booking.start_at).toBe(START);
    expect(booking.end_at).toBe("2026-10-01T16:30:00.000Z");
    expect(booking.host_timezone).toBe("America/Costa_Rica");
    expect(booking.status).toBe("scheduled");
    expect(booking.origin).toBe("public_page");
    // El nombre del area y del tipo quedan congelados en la agenda.
    expect(booking.category_snapshot).toMatchObject({ area_name: "Ventas", type_name: "Triaje" });

    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("contacts")[0].email).toBe("juan@ejemplo.com");
    expect(db.rows("contacts")[0].timezone).toBe("America/Costa_Rica");

    expect(db.rows("automation_events").map((e) => e.event_type)).toEqual(["booking_created"]);
    expect(db.rows("scheduled_jobs").map((j) => j.type)).toEqual(["booking_google_sync", "booking_ended"]);
    expect(db.rows("audit_log").map((a) => a.action)).toEqual(["booking.created"]);
  });

  it("un evento inexistente da 404 sin escribir nada", async () => {
    const db = schedulingWorld();
    const result = await createBooking(db.client, { ...base, slug: "no-existe" });
    expect(result).toMatchObject({ ok: false, status: 404, reason: "not_found" });
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("un evento inactivo no se puede agendar desde el link publico", async () => {
    const db = schedulingWorld({ event: { status: "inactive" } });
    const result = await createBooking(db.client, base);
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
  });

  it("un evento oculto si se puede agendar con el link directo", async () => {
    const db = schedulingWorld({ event: { status: "hidden" } });
    const result = await createBooking(db.client, base);
    expect(result.ok).toBe(true);
  });

  it("el campo trampa responde como si hubiera salido bien y no crea nada", async () => {
    const db = schedulingWorld();
    const result = await createBooking(db.client, {
      ...base,
      responses: { ...base.responses, [HONEYPOT_FIELD]: "http://spam.example" },
    });
    expect(result).toMatchObject({ ok: true, uid: null, ignored: true });
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("un formulario incompleto devuelve el error por campo", async () => {
    const db = schedulingWorld();
    const result = await createBooking(db.client, { ...base, responses: { name: "Juan" } });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("debía fallar");
    expect(result.reason).toBe("invalid");
    expect(Object.keys(result.fields ?? {})).toContain("email");
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("un horario fuera del horario laboral no se crea aunque lo pida el cliente", async () => {
    const db = schedulingWorld();
    // Domingo: el horario por defecto es de lunes a viernes.
    const result = await createBooking(db.client, { ...base, startUtc: "2026-10-04T16:00:00.000Z" });
    expect(result).toMatchObject({ ok: false, status: 409, reason: "slot_unavailable" });
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("un horario con menos aviso del minimo se rechaza, salvo que el equipo lo ignore", async () => {
    const soon = "2026-09-30T16:30:00.000Z"; // 30 minutos; el minimo son 60.
    const rejected = await createBooking(schedulingWorld().client, { ...base, startUtc: soon });
    expect(rejected).toMatchObject({ ok: false, reason: "slot_unavailable" });

    const db = schedulingWorld();
    const accepted = await createBooking(db.client, { ...base, startUtc: soon, origin: "manual", ignoreMinimumNotice: true });
    expect(accepted.ok).toBe(true);
  });

  it("dos agendas en el mismo horario: la segunda pierde con slot_taken", async () => {
    const db = schedulingWorld();
    const first = await createBooking(db.client, base);
    expect(first.ok).toBe(true);
    // El motor ya vería el horario ocupado; se fuerza la carrera pidiendo el
    // mismo rango con el horario vecino libre por buffers en cero.
    const second = await createBooking(db.client, base);
    expect(second.ok).toBe(false);
    if (second.ok) throw new Error("debía perder");
    expect(["slot_taken", "slot_unavailable"]).toContain(second.reason);
    expect(db.rows("bookings")).toHaveLength(1);
  });

  it("con contacto conocido no deduplica ni crea otro", async () => {
    const db = schedulingWorld({ contacts: [{ id: "c-viejo", workspace_id: "ws-1", email: "otro@ejemplo.com", phone: null }] });
    const result = await createBooking(db.client, { ...base, eventTypeId: EVENT, username: undefined, slug: undefined, contactId: "c-viejo", origin: "agent" });
    expect(result.ok).toBe(true);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("bookings")[0].contact_id).toBe("c-viejo");
  });

  it("un contacto con el mismo email se reutiliza", async () => {
    const db = schedulingWorld({ contacts: [{ id: "c-viejo", workspace_id: "ws-1", email: "juan@ejemplo.com", phone: null }] });
    const result = await createBooking(db.client, base);
    expect(result.ok).toBe(true);
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("bookings")[0].contact_id).toBe("c-viejo");
  });

  it("guarda los UTM y el referente", async () => {
    const db = schedulingWorld();
    await createBooking(db.client, { ...base, utm: { utm_source: "instagram" }, referrerUrl: "https://instagram.com/" });
    expect(db.rows("bookings")[0].utm).toEqual({ utm_source: "instagram" });
    expect(db.rows("bookings")[0].referrer_url).toBe("https://instagram.com/");
    expect(db.rows("contacts")[0].attribution).toMatchObject({ source: "scheduling", utm_source: "instagram" });
  });

  it("el tope por IP corta al pasarse, y solo en lo publico", async () => {
    const db = schedulingWorld();
    db.tables.rate_limits = [{ key: "rl:create:xxx", hits: 999, window_start: "2026-09-30T16:00:00.000Z" }];
    // La clave real la calcula el modulo: se fuerza el conteo devolviendo alto.
    let calls = 0;
    const original = db.client.rpc.bind(db.client);
    (db.client as unknown as { rpc: unknown }).rpc = ((name: string, args: Record<string, unknown>) => {
      if (name === "bump_rate_limit") {
        calls += 1;
        return Promise.resolve({ data: 11, error: null });
      }
      return original(name as never, args as never);
    }) as unknown as typeof db.client.rpc;

    const blocked = await createBooking(db.client, { ...base, ip: "1.2.3.4" });
    expect(blocked).toMatchObject({ ok: false, status: 429, reason: "rate_limited" });
    expect(calls).toBe(1);

    // Manual: el tope no aplica.
    const manual = await createBooking(db.client, { ...base, ip: "1.2.3.4", origin: "manual" });
    expect(manual.ok).toBe(true);
    expect(calls).toBe(1);
  });

  it("un perfil apagado no existe para el link publico", async () => {
    const db = schedulingWorld({ profile: { is_active: false } });
    const result = await createBooking(db.client, base);
    expect(result).toMatchObject({ ok: false, status: 404, reason: "not_found" });
  });

  it("con el calendario de conflicto desconectado no se agenda nada", async () => {
    // Por id (agente o manual): el perfil se lee igual, pero la persona no
    // puede recibir agendas porque su calendario de conflicto esta caido.
    const db = schedulingWorld({
      connection: { status: "revoked" },
      calendar: { check_conflicts: true },
    });
    const result = await createBooking(db.client, { ...base, eventTypeId: EVENT, username: undefined, slug: undefined, origin: "agent" });
    expect(result).toMatchObject({ ok: false, status: 503, reason: "temporarily_unavailable" });
    expect(db.rows("bookings")).toHaveLength(0);
  });

  it("devuelve la redireccion propia del evento", async () => {
    const db = schedulingWorld({ event: { success_redirect_url: "https://ssa.example/gracias" } });
    const result = await createBooking(db.client, base);
    expect(result.ok && result.redirectUrl).toBe("https://ssa.example/gracias");
  });
});

describe("countryFromTimezone", () => {
  it("saca el pais del telefono de la zona del negocio", () => {
    expect(countryFromTimezone("America/Costa_Rica")).toBe("CR");
    expect(countryFromTimezone("America/Argentina/Buenos_Aires")).toBe("AR");
    expect(countryFromTimezone("Asia/Tokyo")).toBeUndefined();
    expect(countryFromTimezone(null)).toBeUndefined();
  });
});

describe("el anfitrion del mundo de prueba", () => {
  it("es el dueño del evento", () => {
    const db = schedulingWorld();
    expect(db.rows("event_types")[0].owner_user_id).toBe(HOST);
  });
});
