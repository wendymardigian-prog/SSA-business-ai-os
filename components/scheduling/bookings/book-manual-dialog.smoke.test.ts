import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));
vi.mock("@/lib/actions/scheduling/bookings", () => ({
  bookManuallyQuick: async () => ({ ok: true, data: { bookingId: "b" } }),
  searchContactsForBooking: async () => [],
}));

const { BookManualDialog } = await import("./book-manual-dialog");

const base = {
  events: [],
  timezone: "America/Costa_Rica",
  onClose: () => undefined,
  searchContacts: async () => [],
  hosts: [{ userId: "u1", label: "Ana", meetAvailable: false }],
  currentUserId: "u1",
  areas: [
    { id: "a-otros", name: "Otros", isDefault: false },
    { id: "a-serv", name: "Servicio", isDefault: true },
  ],
};

const preset = { id: "c1", name: "Cliente Prueba", detail: "cliente@ejemplo.com", timezone: null, email: "cliente@ejemplo.com", phone: null };

describe("BookManualDialog con el contacto fijo («Agendar llamada» desde las fichas)", () => {
  it("muestra el contacto ya elegido y sin «Cambiar»", () => {
    const html = renderToStaticMarkup(createElement(BookManualDialog, { ...base, presetContact: preset }));
    expect(html).toContain("Cliente Prueba");
    expect(html).toContain("cliente@ejemplo.com");
    expect(html).not.toContain(">Cambiar<");
    // No ofrece buscar otro invitado.
    expect(html).not.toContain("Buscá por nombre, email o teléfono");
  });

  it("arranca en el área marcada por defecto («Servicio»)", () => {
    const html = renderToStaticMarkup(createElement(BookManualDialog, { ...base, presetContact: preset }));
    expect(html).toMatch(/<option value="a-serv" selected="">Servicio<\/option>/);
  });

  it("sin la prop, el modal de siempre: sin invitado elegido", () => {
    const html = renderToStaticMarkup(createElement(BookManualDialog, base));
    expect(html).not.toContain("Cliente Prueba");
    expect(html).toContain("Buscá por nombre, email o teléfono");
  });
});
