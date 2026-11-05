/**
 * Los dos paneles dibujados: «Esperar hasta» en la hora del negocio y la casilla «Una sola vez por contacto».
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/actions/flow-capabilities", () => ({ loadBusinessTimeZone: vi.fn(async () => "America/Costa_Rica") }));
vi.mock("@/lib/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/dashboard-chrome", () => ({ useActiveWorkspaceId: () => "ws-1", useViewerTimezone: () => "America/Argentina/Buenos_Aires" }));

import { waitUntilInputValue } from "@/lib/flow-engine/wait-until";
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

describe("el campo de «Esperar hasta»", () => {
  const CR = "America/Costa_Rica";

  it("un nodo viejo (un instante) se muestra en la hora del negocio, la misma en que se va a leer lo que se edite", () => {
    expect(waitUntilInputValue({ waitUntil: "2026-11-07T16:00:00.000Z" }, CR)).toBe("2026-11-07T10:00");
    expect(waitUntilInputValue({ waitUntil: "2026-11-07T16:00:00.000Z" }, "America/Argentina/Buenos_Aires")).toBe("2026-11-07T13:00");
  });

  it("sin saber la zona del negocio queda vacío, nunca una hora de otra zona", () => {
    expect(waitUntilInputValue({ waitUntil: "2026-11-07T16:00:00.000Z" }, null)).toBe("");
  });

  it("la hora del negocio guardada no pasa por ninguna zona", () => {
    expect(waitUntilInputValue({ waitUntilLocal: "2026-11-07T10:00", waitUntil: "2026-01-01T00:00:00.000Z" }, CR)).toBe("2026-11-07T10:00");
    expect(waitUntilInputValue({ waitUntilLocal: "2026-11-07T10:00" }, null)).toBe("2026-11-07T10:00");
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
