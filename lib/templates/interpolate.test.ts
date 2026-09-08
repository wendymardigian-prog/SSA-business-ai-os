import { describe, it, expect } from "vitest";
import { interpolateTemplate, usedVariables, TEMPLATE_VARIABLES } from "./interpolate";

const contexto = {
  contact: { display_name: "Ana", email: "ana@ejemplo.com", phone: "+5491122334455" },
  workspace: { name: "Mi Negocio" },
};

describe("interpolateTemplate", () => {
  it("reemplaza las cuatro variables", () => {
    const texto = "Hola {{contact.display_name}}, te escribo de {{workspace.name}}. Tu mail es {{contact.email}} y tu tel {{contact.phone}}.";
    expect(interpolateTemplate(texto, contexto)).toBe(
      "Hola Ana, te escribo de Mi Negocio. Tu mail es ana@ejemplo.com y tu tel +5491122334455.",
    );
  });

  it("una variable sin valor queda vacia, no muestra el placeholder", () => {
    const sinMail = { contact: { display_name: "Ana", email: null }, workspace: { name: "X" } };
    expect(interpolateTemplate("Mail: {{contact.email}}.", sinMail)).toBe("Mail: .");
  });

  it("un contacto o workspace ausente tampoco muestra el placeholder", () => {
    expect(interpolateTemplate("Hola {{contact.display_name}}", {})).toBe("Hola ");
  });

  it("tolera espacios adentro de las llaves", () => {
    expect(interpolateTemplate("Hola {{ contact.display_name }}", contexto)).toBe("Hola Ana");
  });

  it("no distingue mayusculas en el nombre de la variable", () => {
    expect(interpolateTemplate("Hola {{Contact.Display_Name}}", contexto)).toBe("Hola Ana");
  });

  it("deja intacta una variable que no existe", () => {
    expect(interpolateTemplate("Deuda: {{contact.saldo}}", contexto)).toBe("Deuda: {{contact.saldo}}");
  });

  it("no toca llaves sueltas ni texto con formato de codigo", () => {
    expect(interpolateTemplate('{"a": 1} y {{ }} y {esto}', contexto)).toBe('{"a": 1} y {{ }} y {esto}');
  });

  it("reemplaza la misma variable todas las veces que aparece", () => {
    expect(interpolateTemplate("{{contact.display_name}} {{contact.display_name}}", contexto)).toBe("Ana Ana");
  });

  it("NO vuelve a expandir lo que salio de un campo del contacto", () => {
    const malicioso = {
      contact: { display_name: "{{workspace.name}}" },
      workspace: { name: "Secreto SA" },
    };
    expect(interpolateTemplate("Hola {{contact.display_name}}", malicioso)).toBe(
      "Hola {{workspace.name}}",
    );
  });

  it("un template sin variables vuelve igual", () => {
    expect(interpolateTemplate("Hola, gracias por escribir.", contexto)).toBe(
      "Hola, gracias por escribir.",
    );
  });
});

describe("usedVariables", () => {
  it("separa las conocidas de las inventadas, sin repetir", () => {
    const { known, unknown } = usedVariables(
      "{{contact.email}} {{contact.email}} {{contact.saldo}} {{workspace.name}}",
    );
    expect(known).toEqual(["contact.email", "workspace.name"]);
    expect(unknown).toEqual(["contact.saldo"]);
  });

  it("un texto sin variables no reporta ninguna", () => {
    expect(usedVariables("hola")).toEqual({ known: [], unknown: [] });
  });
});

describe("TEMPLATE_VARIABLES", () => {
  it("son las cuatro que pide el requerimiento", () => {
    expect(TEMPLATE_VARIABLES.map((v) => v.key)).toEqual([
      "contact.display_name",
      "contact.email",
      "contact.phone",
      "workspace.name",
    ]);
  });
});
