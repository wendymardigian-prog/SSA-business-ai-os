import { describe, expect, it } from "vitest";
import { serviceAllowedForCall, serviceLinkOptions } from "./service-link-options";

const svc = (id: string, over: Partial<{ contactId: string; status: string; startsOn: string | null; endsOn: string | null; label: string }> = {}) => ({
  id,
  label: over.label ?? `Servicio ${id}`,
  contactId: over.contactId ?? "c1",
  status: over.status ?? "active",
  startsOn: over.startsOn === undefined ? "2026-11-01" : over.startsOn,
  endsOn: over.endsOn === undefined ? "2026-12-31" : over.endsOn,
});

describe("serviceLinkOptions", () => {
  it("solo ofrece servicios del contacto de la reunión, más «Ninguno»", () => {
    const opts = serviceLinkOptions([svc("a"), svc("b", { contactId: "c2" })], "c1", "2026-11-10");
    expect(opts.map((o) => o.id)).toEqual(["a", null]);
  });
  it("los del período primero, después los otros y al final los cancelados", () => {
    const opts = serviceLinkOptions(
      [svc("viejo", { startsOn: "2025-01-01", endsOn: "2025-06-30" }), svc("cancelado", { status: "cancelled" }), svc("vigente")],
      "c1",
      "2026-11-10",
    );
    expect(opts.map((o) => o.id)).toEqual(["vigente", "viejo", "cancelado", null]);
    expect(opts[0].covers).toBe(true);
    expect(opts[2].label).toMatch(/cancelado/);
  });
  it("sin contacto, solo «Ninguno»", () => {
    expect(serviceLinkOptions([svc("a")], null, "2026-11-10")).toEqual([{ id: null, label: "Ninguno", covers: false }]);
  });
});

describe("serviceAllowedForCall", () => {
  it("rechaza un servicio de otro contacto o de otro negocio", () => {
    expect(serviceAllowedForCall({ contactId: "c1", workspaceId: "w" }, { contactId: "c1", workspaceId: "w" })).toBe(true);
    expect(serviceAllowedForCall({ contactId: "c2", workspaceId: "w" }, { contactId: "c1", workspaceId: "w" })).toBe(false);
    expect(serviceAllowedForCall({ contactId: "c1", workspaceId: "x" }, { contactId: "c1", workspaceId: "w" })).toBe(false);
    expect(serviceAllowedForCall(null, { contactId: "c1", workspaceId: "w" })).toBe(false);
  });
});
