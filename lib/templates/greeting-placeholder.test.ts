import { describe, expect, it } from "vitest";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { firstNameOf, seedContactVariables } from "@/lib/flow-engine/variable-catalog";
import { isGreetingPlaceholder, isPlaceholderName, UNKNOWN_WHATSAPP_NAME } from "@/lib/contacts/anonymous";
import { stepVariables } from "@/lib/sequences/steps";
import { tidyEmptyNames, EMPTY_NAME_MARK } from "@/lib/templates/fallback";

/**
 * Un broadcast saludó «¡Hola Contacto!» a contactos que se llamaban «Contacto de WhatsApp» (el nombre que
 * el sistema les pone cuando WhatsApp no manda el suyo). Estos tests fijan que ningún saludo vuelve a usar un nombre de
 * relleno: ni los flujos, ni las secuencias, ni los broadcasts (estos en `lib/broadcasts/render.test.ts`).
 */
describe("nombres con los que no se saluda", () => {
  it("«Contacto de WhatsApp» no sirve para saludar, pero NO cambia la lista que oculta contactos (gemela en SQL)", () => {
    expect(isGreetingPlaceholder(UNKNOWN_WHATSAPP_NAME)).toBe(true);
    expect(isGreetingPlaceholder("  contacto   de whatsapp ")).toBe(true);
    expect(isPlaceholderName(UNKNOWN_WHATSAPP_NAME)).toBe(false);
    expect(isGreetingPlaceholder("Instagram User")).toBe(true);
    expect(isGreetingPlaceholder("Ana Contacto")).toBe(false);
    expect(isGreetingPlaceholder("Contacto")).toBe(false);
  });

  it("firstNameOf deja vacío un nombre de relleno", () => {
    expect(firstNameOf(UNKNOWN_WHATSAPP_NAME)).toBe("");
    expect(firstNameOf("Instagram User")).toBe("");
    expect(firstNameOf("Ana Pérez")).toBe("Ana");
  });

  it("un flujo usa el respaldo, o saluda sin nombre si no hay respaldo", () => {
    const vars = seedContactVariables({}, { display_name: UNKNOWN_WHATSAPP_NAME }, { name: "N" });
    expect(interpolateVariables("¡Hola {{contact.first_name|de nuevo}}!", vars)).toBe("¡Hola de nuevo!");
    expect(interpolateVariables("¡Hola {{contact.first_name}}!", vars)).toBe("¡Hola!");
    expect(interpolateVariables("Hola {{contact.name}}, te escribo", vars)).toBe("Hola, te escribo");
    const ana = seedContactVariables({}, { display_name: "Ana Pérez" }, { name: "N" });
    expect(interpolateVariables("¡Hola {{contact.first_name}}!", ana)).toBe("¡Hola Ana!");
  });

  it("un flujo sin contacto deja la variable como siempre (no la confunde con un nombre vacío)", () => {
    expect(interpolateVariables("¡Hola {{contact.first_name}}!", {})).toBe("¡Hola {{contact.first_name}}!");
  });

  it("las secuencias saludan igual", () => {
    expect(stepVariables({ display_name: UNKNOWN_WHATSAPP_NAME }).contact).toMatchObject({ first_name: "" });
    expect(interpolateVariables("¡Hola {{contact.first_name}}!", stepVariables({ display_name: UNKNOWN_WHATSAPP_NAME }))).toBe("¡Hola!");
  });

  it("tidyEmptyNames no toca un texto sin la marca", () => {
    expect(tidyEmptyNames("Hola , qué tal !")).toBe("Hola , qué tal !");
    expect(tidyEmptyNames(`Hola${EMPTY_NAME_MARK}`)).toBe("Hola");
  });
});
