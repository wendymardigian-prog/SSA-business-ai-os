/**
 * Lo que dibuja la ficha del estado de email (E5): el badge con su detalle, el
 * boton segun el estado, los dos estados si el secundario es distinto, y la
 * entrada del historial con quien lo hizo y por que.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/actions/contact-email-status", () => ({ setContactEmailStatus: vi.fn() }));

import { EmailStatusControl } from "./email-status-control";
import { EmailStatusBadge, emailStatusDetail } from "./email-status-badge";
import { HistorySection } from "./history-section";
import { emailStatusActorLabel } from "@/lib/email/subscription";

const control = (props: Partial<Parameters<typeof EmailStatusControl>[0]>) =>
  renderToStaticMarkup(createElement(EmailStatusControl, { contactId: "c-1", status: "subscribed", at: null, source: null, canEdit: true, ...props }));

describe("el estado de email en la ficha", () => {
  it("suscripto: 'Email: Suscripto' y 'Dar de baja de emails'", () => {
    const out = control({});
    expect(out).toContain("Email: Suscripto");
    expect(out).toContain("Dar de baja de emails");
    expect(out).not.toContain("Volver a suscribir");
  });

  it("dado de baja: el detalle (desde cuando y por que) va en el title, y el boton es 'Volver a suscribir'", () => {
    const out = control({ status: "unsubscribed", at: "2026-03-03T12:00:00Z", source: "one_click", timeZone: "America/Argentina/Buenos_Aires" });
    expect(out).toContain("Email: Dado de baja");
    expect(out).toContain("Volver a suscribir");
    expect(out).toContain("desde el 3 de marzo de 2026");
    expect(out).toContain("un clic");
  });

  it("rebota / marcó spam se nombran asi", () => {
    expect(renderToStaticMarkup(createElement(EmailStatusBadge, { status: "bounced" }))).toContain("Email: Rebota");
    expect(renderToStaticMarkup(createElement(EmailStatusBadge, { status: "complained" }))).toContain("Email: Marcó spam");
  });

  it("sin permiso de editar: el badge sin boton", () => {
    const out = control({ canEdit: false });
    expect(out).toContain("Email: Suscripto");
    expect(out).not.toContain("Dar de baja de emails");
  });

  it("con un secundario de otro estado se muestran los dos", () => {
    const out = control({ secondary: { status: "bounced" } });
    expect(out).toContain("Email principal: Suscripto");
    expect(out).toContain("Email secundario: Rebota");
  });

  it("el detalle de un suscripto del estado inicial no dice de donde vino", () => {
    expect(emailStatusDetail({ status: "subscribed", source: "backfill" })).toBe("Suscripto");
  });
});

describe("el historial", () => {
  it("quien lo hizo, cuando no fue alguien del equipo", () => {
    expect(emailStatusActorLabel("unsubscribe_page")).toBe("La persona, desde el link de baja");
    expect(emailStatusActorLabel("one_click")).toBe("La persona, desde el link de baja");
    expect(emailStatusActorLabel("import:otro-sistema")).toBe("La importación");
    expect(emailStatusActorLabel("resend_bounce")).toBe("El sistema (aviso de Resend)");
    expect(emailStatusActorLabel("inherit")).toBe("El sistema");
  });

  it("la entrada dice el cambio en palabras, el origen, el motivo y las secuencias pausadas", () => {
    const out = renderToStaticMarkup(
      createElement(HistorySection, {
        items: [
          {
            source: "audit",
            id: "audit:1",
            at: "2026-10-29T12:00:00Z",
            action: "email_status",
            changes: { email_status: { old: "subscribed", new: "unsubscribed" } },
            metadata: { source: "import:otro-sistema", original_source: "email_footer", enrollments_paused: 2 },
            actorLabel: "La importación",
            flowName: null,
          },
        ],
      }),
    );
    expect(out).toContain("La importación");
    expect(out).toContain("cambió el estado de email");
    expect(out).toContain("Estado de email");
    expect(out).toContain("Suscripto → Dado de baja");
    expect(out).toContain("importación (otro-sistema)");
    expect(out).toContain("en el otro sistema: email_footer");
    expect(out).toContain("2 secuencias pausadas");
  });
});
