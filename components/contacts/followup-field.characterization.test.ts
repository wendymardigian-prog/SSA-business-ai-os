/**
 * Caracterizacion de `FollowupField` ANTES de Tareas × CRM (R2): fija el HTML que dibuja hoy con la firma de siempre
 * (`contactId`, `value`, `onSaved`), que es como lo usan la ficha del contacto y el panel de la bandeja. Las props
 * nuevas son opcionales: sin ellas, nada de esto puede cambiar.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock("@/lib/actions/contacts", () => ({ updateContact: vi.fn() }));
vi.mock("@/components/dashboard-chrome", () => ({ useViewerTimezone: () => "America/Costa_Rica" }));

import { FollowupField } from "./followup-field";

const html = (props: Parameters<typeof FollowupField>[0]) => renderToStaticMarkup(createElement(FollowupField, props));

describe("FollowupField: lo que dibuja hoy (caracterizacion)", () => {
  it("sin fecha: solo el campo, sin boton de quitar ni leyenda", () => {
    const out = html({ contactId: "c-1", value: null });
    expect(out).toMatchSnapshot();
    expect(out).toContain("Próximo seguimiento");
    expect(out).toContain('type="date"');
    expect(out).not.toContain("Quitar la fecha de seguimiento");
    expect(out).not.toContain("Agendado para");
  });

  it("con fecha: el valor en la zona de quien mira, el boton de quitar y la leyenda", () => {
    // 12:00 en Costa Rica = 18:00 UTC.
    const out = html({ contactId: "c-1", value: "2026-10-20T18:00:00.000Z" });
    expect(out).toMatchSnapshot();
    expect(out).toContain('value="2026-10-20"');
    expect(out).toContain("Quitar la fecha de seguimiento");
    expect(out).toContain("Agendado para el 20/10/2026");
  });

  it("onSaved no cambia lo que se dibuja", () => {
    expect(html({ contactId: "c-1", value: null, onSaved: () => undefined })).toBe(html({ contactId: "c-1", value: null }));
  });
});
