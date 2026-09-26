import { describe, it, expect } from "vitest";
import {
  resolveUnavailableMessage,
  buildCtaHref,
  validateUnavailableMessages,
  fallbackPayload,
  DEFAULT_UNAVAILABLE_MESSAGES,
  replaceMessageVars,
} from "./unavailable";
import type { UnavailableMessages } from "../types";

const vars = { event_title: "Llamada de triaje", host_name: "Wendy" };

describe("resolveUnavailableMessage (F58)", () => {
  it("sin configuración usa el texto por defecto con las variables reemplazadas", () => {
    const m = resolveUnavailableMessage({ unavailable_messages: null }, "no_slots", vars);
    expect(m.custom).toBe(false);
    expect(m.title).toBe("No hay horarios disponibles por ahora");
    expect(m.body).toBe("Todos los espacios de Llamada de triaje están tomados. Escribinos y te buscamos un lugar.");
    expect(m.showRetry).toBe(false);
    expect(resolveUnavailableMessage({ unavailable_messages: null }, "unavailable", vars).showRetry).toBe(true);
  });

  it("devuelve el del caso configurado", () => {
    const cfg: UnavailableMessages = { same_for_all: false, unavailable: { title: "Ups, {{host_name}}", body: "Volvé en un rato" } };
    const m = resolveUnavailableMessage({ unavailable_messages: cfg }, "unavailable", vars);
    expect(m).toMatchObject({ custom: true, title: "Ups, Wendy", body: "Volvé en un rato" });
    // Los otros casos siguen en default.
    expect(resolveUnavailableMessage({ unavailable_messages: cfg }, "load_error", vars).custom).toBe(false);
  });

  it("con same_for_all usa el único cargado para los tres casos", () => {
    const cfg: UnavailableMessages = {
      same_for_all: true,
      no_slots: { title: "Escribinos", body: "Te ayudamos", cta: { label: "WhatsApp", kind: "whatsapp", value: "+506 8888-1234", prefill: "Hola, quiero agendar {{event_title}}" } },
    };
    for (const key of ["no_slots", "unavailable", "load_error"] as const) {
      const m = resolveUnavailableMessage({ unavailable_messages: cfg }, key, vars);
      expect(m.title).toBe("Escribinos");
      expect(m.cta?.prefill).toBe("Hola, quiero agendar Llamada de triaje");
    }
  });

  it("solo reemplaza las dos variables permitidas y nunca interpreta HTML", () => {
    expect(replaceMessageVars("<b>{{event_title}}</b> {{otra}}", vars)).toBe("<b>Llamada de triaje</b> {{otra}}");
  });
});

describe("buildCtaHref", () => {
  it("whatsapp arma wa.me con el número limpio y el texto codificado", () => {
    expect(buildCtaHref({ label: "x", kind: "whatsapp", value: "+506 8888-1234", prefill: "Hola, quiero agendar {{event_title}}" }, vars)).toBe(
      `https://wa.me/50688881234?text=${encodeURIComponent("Hola, quiero agendar Llamada de triaje")}`,
    );
    expect(buildCtaHref({ label: "x", kind: "whatsapp", value: "+506 8888-1234" }, vars)).toBe("https://wa.me/50688881234");
    expect(buildCtaHref({ label: "x", kind: "whatsapp", value: "abc" }, vars)).toBeNull();
  });

  it("email arma mailto con el asunto codificado", () => {
    expect(buildCtaHref({ label: "x", kind: "email", value: "hola@ejemplo.com", prefill: "Agendar {{event_title}}" }, vars)).toBe(
      `mailto:hola@ejemplo.com?subject=${encodeURIComponent("Agendar Llamada de triaje")}`,
    );
    expect(buildCtaHref({ label: "x", kind: "email", value: "no-es-email" }, vars)).toBeNull();
  });

  it("link solo https", () => {
    expect(buildCtaHref({ label: "x", kind: "link", value: "https://mi-web.com/contacto" }, vars)).toBe("https://mi-web.com/contacto");
    expect(buildCtaHref({ label: "x", kind: "link", value: "http://mi-web.com" }, vars)).toBeNull();
  });
});

describe("validateUnavailableMessages", () => {
  it("rechaza un link que no empieza con https://, y títulos o textos fuera de tamaño", () => {
    const r = validateUnavailableMessages({ same_for_all: false, no_slots: { title: "T", body: "B", cta: { label: "Ir", kind: "link", value: "http://x.com" } } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toBe("El link tiene que empezar con https://");
    expect(validateUnavailableMessages({ same_for_all: false, no_slots: { title: "x".repeat(81), body: "B" } }).ok).toBe(false);
    expect(validateUnavailableMessages({ same_for_all: false, no_slots: { title: "T", body: "x".repeat(501) } }).ok).toBe(false);
  });

  it("acepta whatsapp y email válidos y exige uno cargado con same_for_all", () => {
    expect(validateUnavailableMessages({ same_for_all: false, unavailable: { title: "T", body: "B", cta: { label: "WA", kind: "whatsapp", value: "+506 8888 1234" } } }).ok).toBe(true);
    expect(validateUnavailableMessages({ same_for_all: false, unavailable: { title: "T", body: "B", cta: { label: "WA", kind: "whatsapp", value: "12" } } }).ok).toBe(false);
    expect(validateUnavailableMessages({ same_for_all: true }).ok).toBe(false);
    expect(validateUnavailableMessages({ same_for_all: true, load_error: { title: "T", body: "B" } }).ok).toBe(true);
  });
});

describe("fallbackPayload (lo que viaja en el snippet)", () => {
  it("resuelve load_error con el href ya armado", () => {
    const cfg: UnavailableMessages = {
      same_for_all: false,
      load_error: { title: "No carga", body: "Escribinos, {{host_name}}", cta: { label: "WhatsApp", kind: "whatsapp", value: "+50688881234" } },
    };
    expect(fallbackPayload({ unavailable_messages: cfg }, vars)).toEqual({ title: "No carga", body: "Escribinos, Wendy", cta: { label: "WhatsApp", href: "https://wa.me/50688881234" } });
    expect(fallbackPayload({ unavailable_messages: null }, vars)).toEqual({ ...DEFAULT_UNAVAILABLE_MESSAGES.load_error });
  });
});
