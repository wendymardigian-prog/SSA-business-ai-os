/**
 * Los dos paneles dibujados: «Esperar hasta» en la hora del negocio y la casilla «Una sola vez por contacto».
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/flow-capabilities", () => ({ loadBusinessTimeZone: vi.fn(async () => "America/Costa_Rica") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/dashboard-chrome", () => ({ useActiveWorkspaceId: () => "ws-1" }));

import { DelayPanel } from "./DelayPanel";
import { TriggerPanel } from "./TriggerPanel";

const delay = (data: Record<string, unknown>) => renderToStaticMarkup(createElement(DelayPanel, { data, onChange: () => {} }));
const trigger = (data: Record<string, unknown>) => renderToStaticMarkup(createElement(TriggerPanel, { data, onChange: () => {} }));

describe("DelayPanel", () => {
  it("muestra la hora guardada tal cual y dice que es la del negocio", () => {
    const html = delay({ waitUntilLocal: "2026-11-07T10:00" });
    expect(html).toContain('value="2026-11-07T10:00"');
    expect(html).toContain("En la hora del negocio");
    expect(html).toContain("se saltea el paso siguiente");
    expect(html).toMatch(/Espera hasta el 7 nov.*10:00.*\(hora del negocio\)/);
  });

  it("una espera por duración sigue igual", () => {
    const html = delay({ duration: 2, unit: "hours" });
    expect(html).toContain("Espera 2 horas y sigue");
    expect(html).not.toContain("En la hora del negocio");
  });
});

describe("TriggerPanel", () => {
  it("un disparador de contacto ofrece la casilla, apagada por defecto", () => {
    const html = trigger({ triggerType: "booking_created" });
    expect(html).toContain("Una sola vez por contacto");
    expect(html).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked[^>]*>\s*<span>Una sola vez/);
  });

  it("prendida se ve marcada", () => {
    expect(trigger({ triggerType: "booking_created", oncePerContact: true })).toMatch(/<input[^>]*checked[^>]*>\s*<span>Una sola vez/);
  });

  it("un disparador de mensaje no la ofrece", () => {
    expect(trigger({ triggerType: "keyword" })).not.toContain("Una sola vez por contacto");
  });
});

// @plantilla-desde(formularios)
describe("TriggerPanel en un formulario", () => {
  it("«Se envió un formulario» ofrece la casilla", () => {
    expect(trigger({ triggerType: "form_submitted" })).toContain("Una sola vez por contacto");
  });
});
// @plantilla-hasta(formularios)
