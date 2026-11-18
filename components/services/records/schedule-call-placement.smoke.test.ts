// @plantilla-quitar(servicios)
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
  usePathname: () => "/dashboard/clientes",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/actions/scheduling/manual-booking-options", () => ({ loadManualBookingForContact: async () => ({ ok: false, error: "x" }) }));
vi.mock("@/lib/actions/scheduling/bookings", () => ({ bookManuallyQuick: async () => ({ ok: false, error: "x" }), searchContactsForBooking: async () => [] }));

const { ClientRecordHeader } = await import("./client-record-view");

const data = {
  contactId: "c1",
  name: "Cliente Prueba",
  email: "",
  phone: "",
  whatsapp: null,
  avatarUrl: null,
  leadSince: null,
  clientSince: null,
  paidCents: null,
  lastContact: null,
  firstSaleAt: null,
  hasPortal: false,
  portal: null,
  services: [],
  events: [],
};
const options = { products: [], members: [], canOffRule: false } as never;

describe("«Agendar llamada» en la ficha del cliente", () => {
  it("aparece con permiso para agendar", () => {
    const html = renderToStaticMarkup(createElement(ClientRecordHeader, { data, canEdit: false, canCreate: false, canBook: true, newServiceOptions: options, timeZone: "UTC" }));
    expect(html).toContain("Agendar llamada");
  });

  it("no aparece sin permiso", () => {
    const html = renderToStaticMarkup(createElement(ClientRecordHeader, { data, canEdit: false, canCreate: false, canBook: false, newServiceOptions: options, timeZone: "UTC" }));
    expect(html).not.toContain("Agendar llamada");
  });
});
