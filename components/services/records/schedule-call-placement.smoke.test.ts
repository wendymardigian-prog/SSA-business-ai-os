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
type ClientRecordData = import("./client-record-view").ClientRecordData;

const data: ClientRecordData = {
  contactId: "c1",
  name: "Cliente Prueba",
  email: "",
  phone: "",
  whatsapp: null,
  whatsappConversationId: null,
  whatsappUnread: 0,
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

describe("WhatsApp en la ficha del cliente", () => {
  const render = (over: Partial<ClientRecordData>) =>
    renderToStaticMarkup(createElement(ClientRecordHeader, { data: { ...data, ...over }, canEdit: false, canCreate: false, canBook: false, newServiceOptions: options, timeZone: "UTC" }));

  it("con chat en la bandeja, lleva al chat y muestra los no leídos", () => {
    const html = render({ whatsappConversationId: "conv-1", whatsappUnread: 3, whatsapp: "5491100000000" });
    expect(html).toContain('href="/dashboard/inbox?c=conv-1"');
    expect(html).toContain("3 mensajes sin leer");
    expect(html).toContain(">3<");
    expect(html).not.toContain("wa.me");
  });

  it("más de 9 sin leer se muestra como 9+", () => {
    expect(render({ whatsappConversationId: "conv-1", whatsappUnread: 12 })).toContain(">9+<");
  });

  it("sin chat, abre WhatsApp con el número", () => {
    const html = render({ whatsapp: "+54 9 11 0000-0000" });
    expect(html).toContain("https://wa.me/5491100000000");
    expect(html).not.toContain("/dashboard/inbox");
  });

  it("sin chat ni número, no hay botón", () => {
    expect(render({})).not.toContain("WhatsApp");
  });
});
