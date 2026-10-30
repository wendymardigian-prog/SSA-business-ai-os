import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES } from "./types";
import {
  NOTIFICATION_EVENTS,
  NOTIFICATION_SECTIONS,
  eventForType,
  eventVisibleTo,
  mutedBellTypes,
  parseStoredPrefs,
  resolveEventPrefs,
  resolveTypePrefs,
  sectionsFor,
  withPref,
} from "./preferences";

describe("el catalogo de preferencias", () => {
  it("cada tipo de aviso esta en UN evento (un tipo nuevo sin fila rompe este test)", () => {
    for (const type of NOTIFICATION_TYPES) {
      const owners = NOTIFICATION_EVENTS.filter((e) => e.types.includes(type));
      expect(owners.map((e) => e.key), type).toHaveLength(1);
    }
  });

  it("ningun evento nombra un tipo que no existe", () => {
    for (const event of NOTIFICATION_EVENTS) {
      for (const type of event.types) expect(NOTIFICATION_TYPES as readonly string[], event.key).toContain(type);
    }
  });

  it("claves unicas y cada evento en una seccion que existe", () => {
    const keys = NOTIFICATION_EVENTS.map((e) => e.key);
    expect(new Set(keys).size).toBe(keys.length);
    const sections = NOTIFICATION_SECTIONS.map((s) => s.key) as string[];
    for (const event of NOTIFICATION_EVENTS) expect(sections).toContain(event.section);
  });

  it("WhatsApp arranca apagado en todo y la campana prendida en todo", () => {
    for (const event of NOTIFICATION_EVENTS) {
      expect(event.defaults.whatsapp, event.key).toBe(false);
      expect(event.defaults.bell, event.key).toBe(true);
    }
  });

  it("el email arranca prendido solo en lo critico", () => {
    const withEmail = NOTIFICATION_EVENTS.filter((e) => e.defaults.email).map((e) => e.key).sort();
    expect(withEmail).toEqual(["channel_status", "chat_needs_person", "content_problems", "integration_attention"]);
  });
});

describe("resolver lo que eligio la persona", () => {
  it("sin nada guardado, los defaults", () => {
    expect(resolveTypePrefs({}, "needs_human")).toEqual({ bell: true, email: true, whatsapp: false });
    expect(resolveTypePrefs({}, "conversation_assigned")).toEqual({ bell: true, email: false, whatsapp: false });
  });

  it("lo guardado pisa al default canal por canal", () => {
    const stored = parseStoredPrefs({ bookings: { whatsapp: true } });
    expect(resolveTypePrefs(stored, "booking_cancelled")).toEqual({ bell: true, email: false, whatsapp: true });
  });

  it("un tipo desconocido va solo a la campana", () => {
    expect(resolveTypePrefs({ x: { email: true } }, "tipo_del_futuro")).toEqual({ bell: true, email: false, whatsapp: false });
  });

  it("parseStoredPrefs descarta eventos inexistentes y valores que no son booleanos", () => {
    expect(parseStoredPrefs({ inventado: { email: true }, bookings: { email: "si", bell: false } })).toEqual({ bookings: { bell: false } });
    expect(parseStoredPrefs(null)).toEqual({});
    expect(parseStoredPrefs([1, 2])).toEqual({});
  });
});

describe("withPref", () => {
  it("guardar el mismo valor que el default lo saca (asi un cambio de default le llega)", () => {
    const a = withPref({}, "bookings", "email", true);
    expect(a).toEqual({ bookings: { email: true } });
    expect(withPref(a, "bookings", "email", false)).toEqual({});
  });

  it("un evento que no existe no cambia nada", () => {
    expect(withPref({}, "nada", "email", true)).toEqual({});
  });
});

describe("la campana", () => {
  it("silenciar un evento silencia todos sus tipos", () => {
    const muted = mutedBellTypes({ bookings: { bell: false } });
    expect(muted.sort()).toEqual(["booking_cancelled", "booking_created", "booking_rescheduled"]);
  });
  it("sin cambios, nada silenciado", () => {
    expect(mutedBellTypes({})).toEqual([]);
  });
});

describe("quien ve cada fila", () => {
  const member = { isAdmin: false, can: () => false };
  const admin = { isAdmin: true, can: () => false };

  it("un Member no ve lo que va solo a Owner/Admin", () => {
    expect(eventVisibleTo(eventForType("channel_disconnected")!, member)).toBe(false);
    expect(eventVisibleTo(eventForType("conversation_assigned")!, member)).toBe(true);
    expect(eventVisibleTo(eventForType("channel_disconnected")!, admin)).toBe(true);
  });

  it("un permiso puede abrir una fila de admins", () => {
    const configures = { isAdmin: false, can: (k: string) => k === "calls.configure" };
    expect(eventVisibleTo(eventForType("ai_spend_threshold")!, configures)).toBe(true);
  });

  it("no quedan secciones vacias", () => {
    for (const section of sectionsFor(member)) expect(section.events.length).toBeGreaterThan(0);
    expect(sectionsFor(admin).flatMap((s) => s.events)).toHaveLength(NOTIFICATION_EVENTS.length);
  });

  it("resolveEventPrefs con un evento", () => {
    expect(resolveEventPrefs({}, NOTIFICATION_EVENTS[0])).toEqual(NOTIFICATION_EVENTS[0].defaults);
  });
});
