import { describe, expect, it } from "vitest";
import { inferTimezone, shouldAskTimezone, timezoneFromPhone } from "./timezone";

describe("timezoneFromPhone", () => {
  it("reconoce el prefijo más largo primero", () => {
    expect(timezoneFromPhone("+50688881234")).toBe("America/Costa_Rica");
    expect(timezoneFromPhone("+5215512345678")).toBe("America/Mexico_City");
    expect(timezoneFromPhone("+5491112345678")).toBe("America/Argentina/Buenos_Aires");
  });

  it("tolera espacios y guiones", () => {
    expect(timezoneFromPhone("+506 8888-1234")).toBe("America/Costa_Rica");
  });

  it("un prefijo que no está en la lista no inventa nada", () => {
    expect(timezoneFromPhone("+81312345678")).toBeNull();
    expect(timezoneFromPhone("")).toBeNull();
    expect(timezoneFromPhone(null)).toBeNull();
  });
});

describe("inferTimezone", () => {
  const workspaceTimezone = "America/Costa_Rica";

  it("la del contacto gana sobre todo", () => {
    expect(inferTimezone({ contactTimezone: "Europe/Madrid", phone: "+5215512345678", workspaceTimezone })).toEqual({
      timezone: "Europe/Madrid",
      source: "contact",
    });
  });

  it("sin dato del contacto, la deduce del teléfono", () => {
    expect(inferTimezone({ phone: "+5215512345678", workspaceTimezone }).source).toBe("phone");
  });

  it("sin nada, cae a la del negocio", () => {
    expect(inferTimezone({ workspaceTimezone })).toEqual({ timezone: workspaceTimezone, source: "workspace" });
  });
});

describe("shouldAskTimezone", () => {
  it("solo pregunta cuando la zona es una suposición sobre el lead", () => {
    expect(shouldAskTimezone({ timezone: "x", source: "contact" })).toBe(false);
    expect(shouldAskTimezone({ timezone: "x", source: "phone" })).toBe(false);
    expect(shouldAskTimezone({ timezone: "x", source: "workspace" })).toBe(true);
  });
});
