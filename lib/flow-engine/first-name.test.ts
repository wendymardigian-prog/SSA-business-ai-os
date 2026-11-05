/** `firstNameOf`: con quien se puede saludar por su nombre, en flujos y en broadcasts. */
import { describe, expect, it } from "vitest";
import { firstNameOf, seedContactVariables } from "./variable-catalog";
import { broadcastVariables, renderEmail } from "@/lib/broadcasts/render";
import { dropDanglingComma, finalizeEmailHtml, interpolateHtml } from "@/lib/email/html";

describe("firstNameOf", () => {
  it("la primera palabra de un nombre normal, tal como está escrita", () => {
    for (const [name, first] of [
      ["Ana", "Ana"],
      ["Ana Pérez", "Ana"],
      ["  María José  ", "María"],
      ["O'Brien Smith", "O'Brien"],
      ["Ana-Laura Ruiz", "Ana-Laura"],
      ["José", "José"],
      ["ANA", "ANA"],
      ["ana", "ana"],
    ]) expect(firstNameOf(name)).toBe(first);
  });

  it("lo que no sirve para saludar queda vacío", () => {
    for (const name of ["F", "F Gómez", "Prof.", "Prof. Ana", "ana@ejemplo.com", "ana.perez", "@usuario", "17841400", "+5491155555555", "Ana123", "🌸", "Ana🌸", "", "   ", null, undefined]) {
      expect(firstNameOf(name)).toBe("");
    }
  });
});

describe("el saludo de punta a punta", () => {
  const flowGreeting = (displayName: string, template: string) => {
    const vars = seedContactVariables({}, { display_name: displayName }, null);
    return dropDanglingComma(template, finalizeEmailHtml(interpolateHtml(template, vars), true));
  };

  it("en un flujo: con nombre lo usa; si es raro, queda sin coma", () => {
    expect(flowGreeting("Ana Pérez", "<p>¡Hola, {{contact.first_name|}}!</p>")).toContain(">¡Hola, Ana!</p>");
    expect(flowGreeting("Prof. Ana", "<p>¡Hola, {{contact.first_name|}}!</p>")).toContain(">¡Hola!</p>");
    expect(flowGreeting("F", "<p>Hola, {{contact.first_name|}}.</p>")).toContain(">Hola.</p>");
  });

  it("en un broadcast: igual, y no cuenta como dato que falta", () => {
    const send = (display_name: string) => renderEmail("A", "<p>Hola, {{contact.first_name|}}.</p>", broadcastVariables({ display_name, email: null, phone: null }, { name: "N" }));
    expect(send("Ana Pérez").html).toContain(">Hola, Ana.</p>");
    expect(send("F").html).toContain(">Hola.</p>");
    expect(send("Prof. Ana").missing).toEqual([]);
  });

  it("contact.name y contact.display_name no cambian", () => {
    const vars = seedContactVariables({}, { display_name: "Prof. Ana" }, null) as { contact: Record<string, string> };
    expect(vars.contact.display_name).toBe("Prof. Ana");
    expect(vars.contact.name).toBe("Prof. Ana");
  });
});
