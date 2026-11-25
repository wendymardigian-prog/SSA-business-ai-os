import { describe, expect, it } from "vitest";
import { CUSTOM_FIELDS_GROUP, filterVariableGroups, groupVariables, PREVIOUS_STEPS_GROUP, variableGroup, variableLabel } from "./variable-labels";
import { CONTACT_EXTRA_VARIABLES, CONTACT_VARIABLES } from "./variable-catalog";

describe("variableGroup", () => {
  it("agrupa por raíz y separa lo que deja un paso", () => {
    expect(variableGroup("contact.vendedor_name")).toBe("Contacto");
    expect(variableGroup("contact.custom.presupuesto")).toBe(CUSTOM_FIELDS_GROUP);
    expect(variableGroup("workspace.name")).toBe("Negocio");
    expect(variableGroup("form.answer.x")).toBe("Formulario");
    expect(variableGroup("booking.answer.x")).toBe("Reunión");
    expect(variableGroup("contact.result")).toBe(PREVIOUS_STEPS_GROUP);
    expect(variableGroup("ai.response")).toBe(PREVIOUS_STEPS_GROUP);
    expect(variableGroup("respuesta_crm")).toBe(PREVIOUS_STEPS_GROUP);
  });
});

describe("variableLabel", () => {
  it("toda variable fija del contacto tiene nombre", () => {
    for (const v of [...CONTACT_VARIABLES, ...CONTACT_EXTRA_VARIABLES]) expect(variableLabel(v), v).not.toBe(v);
  });

  it("el rótulo del disparador gana, también con el nombre nuevo", () => {
    expect(variableLabel("form.answer.mejor_horario", { schemaLabels: { "answer.mejor_horario": "¿Qué horario te va mejor?" } })).toBe("¿Qué horario te va mejor?");
    expect(variableLabel("booking.answer.presupuesto", { schemaLabels: { "booking.answers.presupuesto": "Respuesta: Presupuesto" } })).toBe("Respuesta: Presupuesto");
  });

  it("un campo personalizado usa su nombre, o el slug si no se sabe", () => {
    expect(variableLabel("contact.custom.presupuesto", { customFieldNames: { presupuesto: "Presupuesto mensual" } })).toBe("Presupuesto mensual");
    expect(variableLabel("contact.custom.otro")).toBe("otro");
  });
});

describe("groupVariables y el buscador", () => {
  const groups = groupVariables(["sale.status", "contact.first_name", "contact.custom.presupuesto", "workspace.name"], { customFieldNames: { presupuesto: "Presupuesto" } });

  it("respeta el orden de aparición", () => {
    expect(groups.map((g) => g.group)).toEqual(["Venta", "Contacto", CUSTOM_FIELDS_GROUP, "Negocio"]);
  });

  it("busca sin tildes por nombre, ruta o grupo", () => {
    expect(filterVariableGroups(groups, "presu").flatMap((g) => g.items.map((i) => i.path))).toEqual(["contact.custom.presupuesto"]);
    expect(filterVariableGroups(groups, "NEGOCIO").flatMap((g) => g.items.map((i) => i.path))).toEqual(["workspace.name"]);
    expect(filterVariableGroups(groups, "")).toHaveLength(4);
  });
});
