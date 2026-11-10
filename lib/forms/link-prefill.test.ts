import { describe, it, expect } from "vitest";
import { linkPrefillValues, withoutUrlOverrides, type LinkPrefillContact } from "./link-prefill";

const contact = (over: Partial<LinkPrefillContact> = {}): LinkPrefillContact => ({
  display_name: "Ana Pérez",
  email: "ana@ejemplo.com",
  phone: "+50688881234",
  whatsapp_phone: null,
  ...over,
});
const fields = [
  { key: "nombre", type: "short_text" },
  { key: "email", type: "email" },
  { key: "telefono", type: "phone" },
  { key: "ciudad", type: "short_text" },
];
const map = [
  { fieldKey: "nombre", target: "contact.display_name" },
  { fieldKey: "email", target: "contact.email" },
  { fieldKey: "telefono", target: "contact.phone" },
  { fieldKey: "ciudad", target: "contact.country" },
];

describe("linkPrefillValues", () => {
  it("rellena nombre, email y teléfono según el mapeo, y nada más", () => {
    expect(linkPrefillValues(contact(), fields, map)).toEqual({ nombre: "Ana Pérez", email: "ana@ejemplo.com", telefono: "+50688881234" });
  });

  it("el campo de WhatsApp prefiere el WhatsApp; el de teléfono, el teléfono; si falta uno sirve el otro", () => {
    const f = [{ key: "wa", type: "phone" }];
    expect(linkPrefillValues(contact({ whatsapp_phone: "+5491122223333" }), f, [{ fieldKey: "wa", target: "contact.whatsapp_phone" }])).toEqual({ wa: "+5491122223333" });
    expect(linkPrefillValues(contact({ whatsapp_phone: "+5491122223333" }), f, [{ fieldKey: "wa", target: "contact.phone" }])).toEqual({ wa: "+50688881234" });
    expect(linkPrefillValues(contact(), f, [{ fieldKey: "wa", target: "contact.whatsapp_phone" }])).toEqual({ wa: "+50688881234" });
    expect(linkPrefillValues(contact({ phone: null, whatsapp_phone: "+5491122223333" }), f, [{ fieldKey: "wa", target: "contact.phone" }])).toEqual({ wa: "+5491122223333" });
  });

  it("un nombre de relleno no se prellena", () => {
    expect(linkPrefillValues(contact({ display_name: "Instagram User" }), fields, map).nombre).toBeUndefined();
    expect(linkPrefillValues(contact({ display_name: "  " }), fields, map).nombre).toBeUndefined();
  });

  it("un dato que el contacto no tiene no se escribe", () => {
    expect(linkPrefillValues(contact({ email: null, phone: null }), fields, map)).toEqual({ nombre: "Ana Pérez" });
  });

  it("sin mapeo, el primer email y el primer teléfono del formulario reciben su dato; el nombre no se adivina", () => {
    expect(linkPrefillValues(contact(), fields, [])).toEqual({ email: "ana@ejemplo.com", telefono: "+50688881234" });
  });

  it("un dato mapeado a un campo de otro tipo se ignora (no rompe el formulario)", () => {
    const f = [{ key: "n", type: "number" }, { key: "m", type: "single_select" }];
    expect(linkPrefillValues(contact(), f, [{ fieldKey: "n", target: "contact.email" }, { fieldKey: "m", target: "contact.display_name" }, { fieldKey: "zzz", target: "contact.email" }])).toEqual({});
  });

  it("un email puede ir en un texto corto si así está mapeado", () => {
    expect(linkPrefillValues(contact(), [{ key: "mail", type: "short_text" }], [{ fieldKey: "mail", target: "contact.email" }])).toEqual({ mail: "ana@ejemplo.com" });
  });
});

describe("withoutUrlOverrides", () => {
  it("lo que la URL ya trae gana sobre el link", () => {
    expect(withoutUrlOverrides({ nombre: "Ana", email: "ana@x.com" }, { Nombre: "Otra", c: "tok" })).toEqual({ email: "ana@x.com" });
    expect(withoutUrlOverrides({ nombre: "Ana" }, {})).toEqual({ nombre: "Ana" });
  });
});
