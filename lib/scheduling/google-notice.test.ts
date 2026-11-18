import { describe, expect, it } from "vitest";
import { googleCalendarState, googleCalendarStatesByUser, googleStateTag, NO_GOOGLE_BODY, otherPersonNotice } from "./google-notice";

describe("googleCalendarState", () => {
  it("sin ninguna cuenta: sin Google", () => {
    expect(googleCalendarState([])).toBe("none");
    expect(googleCalendarState([null, undefined])).toBe("none");
  });
  it("una cuenta que funciona basta, aunque otra esté rota", () => {
    expect(googleCalendarState(["active"])).toBe("connected");
    expect(googleCalendarState(["attention"])).toBe("connected");
    expect(googleCalendarState(["revoked", "active"])).toBe("connected");
  });
  it("todas rotas: desconectado (aviso de reconectar, no de conectar)", () => {
    expect(googleCalendarState(["revoked"])).toBe("broken");
    expect(googleCalendarState(["error", "revoked"])).toBe("broken");
  });
  it("el aviso dice que la agenda sigue funcionando y qué se pierde", () => {
    expect(NO_GOOGLE_BODY).toMatch(/funciona igual/);
    expect(NO_GOOGLE_BODY).toMatch(/Meet/);
  });
});

describe("Disponibilidad marca quién no tiene Google", () => {
  it("conectado, roto y sin cuenta, por persona", () => {
    const states = googleCalendarStatesByUser(
      [
        { user_id: "a", status: "active" },
        { user_id: "b", status: "revoked" },
        { user_id: null, status: "active" },
      ],
      ["a", "b", "c"],
    );
    expect(states).toEqual({ a: "connected", b: "broken", c: "none" });
  });
  it("la etiqueta del selector solo aparece si falta algo", () => {
    expect(googleStateTag("connected")).toBeNull();
    expect(googleStateTag(undefined)).toBeNull();
    expect(googleStateTag("none")).toBe("sin Google Calendar");
    expect(googleStateTag("broken")).toBe("Google desconectado");
  });
  it("el aviso de otra persona la nombra y no le pide a quien mira que conecte", () => {
    expect(otherPersonNotice("none", "Persona A").title).toBe("Persona A no tiene Google Calendar conectado");
    expect(otherPersonNotice("broken", "Persona A").title).toMatch(/desconectado/);
  });
});
