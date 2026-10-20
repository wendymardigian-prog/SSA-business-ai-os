import { describe, expect, it } from "vitest";
import { isSystemOnly } from "./system-only";

const active = new Set(["cal-1"]);

describe("isSystemOnly", () => {
  it("sin calendario propio ni por defecto: solo en el sistema", () => {
    expect(isSystemOnly({ destination_calendar_id: null }, null, active)).toBe(true);
  });

  it("sin calendario propio pero con el del perfil: usa Google (así se vincula solo al conectar)", () => {
    expect(isSystemOnly({ destination_calendar_id: null }, "cal-1", active)).toBe(false);
  });

  it("el del evento gana sobre el del perfil, y uno desactivado (cuenta desconectada) no cuenta", () => {
    expect(isSystemOnly({ destination_calendar_id: "cal-1" }, null, active)).toBe(false);
    expect(isSystemOnly({ destination_calendar_id: "cal-viejo" }, "cal-1", active)).toBe(true);
  });
});
