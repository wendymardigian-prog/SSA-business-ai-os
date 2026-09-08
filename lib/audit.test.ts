import { describe, it, expect } from "vitest";
import { diffFields } from "./audit";

describe("diffFields", () => {
  it("registra solo lo que cambio", () => {
    const changes = diffFields(
      { display_name: "Juan", phone: null, country: "AR" },
      { display_name: "Juan Perez", phone: "+5491122334455", country: "AR" },
    );

    expect(changes).toEqual({
      display_name: { old: "Juan", new: "Juan Perez" },
      phone: { old: null, new: "+5491122334455" },
    });
  });

  it("devuelve null cuando no cambio nada, para no ensuciar el historial", () => {
    expect(diffFields({ display_name: "Juan" }, { display_name: "Juan" })).toBeNull();
    expect(diffFields({}, {})).toBeNull();
  });

  it("trata null, undefined y vacio como el mismo estado", () => {
    expect(diffFields({ phone: null }, { phone: "" })).toBeNull();
    expect(diffFields({ phone: undefined }, { phone: null })).toBeNull();
    expect(diffFields({ phone: "" }, { phone: "+5491122334455" })).toEqual({
      phone: { old: null, new: "+5491122334455" },
    });
  });

  it("ignora los campos que el update no toco", () => {
    const changes = diffFields(
      { display_name: "Juan", email: "juan@example.com" },
      { display_name: "Ana" },
    );
    expect(changes).toEqual({ display_name: { old: "Juan", new: "Ana" } });
  });

  it("conserva los booleanos como booleanos", () => {
    expect(diffFields({ do_not_contact: false }, { do_not_contact: true })).toEqual({
      do_not_contact: { old: false, new: true },
    });
  });
});
