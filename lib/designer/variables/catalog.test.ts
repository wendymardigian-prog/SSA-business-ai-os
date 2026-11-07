import { afterEach, describe, expect, it } from "vitest";
import { CONTACT_VARIABLES, WORKSPACE_VARIABLES } from "@/lib/flow-engine/variable-catalog";
import { emitDesignGenerated, onDesignGenerated, registerDesignVariables, registeredSubjectSources, resolveRegisteredValues } from "../extensions";
import { CONTACT_DESIGN_VARIABLES, customVarKey, formatDesignDate, sampleValues, variableGroups, variableInfo, WORKSPACE_DESIGN_VARIABLES } from "./catalog";

let undo: (() => void)[] = [];
afterEach(() => {
  for (const u of undo) u();
  undo = [];
});

describe("catálogo de variables (núcleo de F49)", () => {
  it("las claves de Contacto y Negocio son las de Automatizaciones", () => {
    expect(CONTACT_DESIGN_VARIABLES.map((v) => v.key).sort()).toEqual([...CONTACT_VARIABLES].sort());
    expect(WORKSPACE_DESIGN_VARIABLES.map((v) => v.key)).toEqual([...WORKSPACE_VARIABLES]);
  });

  it("los grupos van en orden: Propias, Contacto, Negocio, Diseño", () => {
    const groups = variableGroups({ customVars: [{ key: "nombre_en_el_certificado", label: "Nombre en el certificado", sample: "Ana Pérez" }], verify: true });
    expect(groups.map((g) => g.label)).toEqual(["Propias", "Contacto", "Negocio", "Diseño"]);
  });

  it("el código y el tipo de documento solo aparecen si la plantilla verifica", () => {
    const keys = (verify: boolean) => variableGroups({ verify }).find((g) => g.key === "diseno")!.vars.map((v) => v.key);
    expect(keys(true)).toEqual(["design.code", "design.doc_type", "design.issued_on", "design.today"]);
    expect(keys(false)).toEqual(["design.issued_on", "design.today"]);
  });

  it("cada variable tiene su nombre en español", () => {
    expect(variableInfo("contact.display_name")).toMatchObject({ label: "Nombre completo", group: "Contacto" });
    expect(variableInfo("algo.raro")).toMatchObject({ label: "algo.raro", known: false });
  });

  it("la clave de una propia sale del nombre en español", () => {
    expect(customVarKey("Nombre en el certificado")).toBe("nombre_en_el_certificado");
    expect(customVarKey("Ñandú Ágil")).toBe("nandu_agil");
    expect(customVarKey("2 apellidos")).toBe("apellidos");
    expect(customVarKey("x")).toMatch(/^dato_/);
  });

  it("los valores de muestra incluyen las propias y el nombre del negocio", () => {
    const values = sampleValues({ customVars: [{ key: "programa", label: "Programa", sample: "Programa de ejemplo" }], workspaceName: "Academia Demo" });
    expect(values["programa"]).toBe("Programa de ejemplo");
    expect(values["workspace.name"]).toBe("Academia Demo");
    expect(values["contact.first_name"]).toBe("Ana");
  });

  it("las fechas en los tres formatos y en la zona del negocio", () => {
    const d = new Date("2026-11-08T02:00:00Z");
    expect(formatDesignDate(d, "long", "America/Argentina/Buenos_Aires")).toBe("7 de noviembre de 2026");
    expect(formatDesignDate(d, "short", "America/Argentina/Buenos_Aires")).toBe("07/11/2026");
    expect(formatDesignDate(d, "en", "UTC")).toBe("November 8, 2026");
  });
});

describe("punto de extensión (§9.3): queda vacío y se prueba con uno de prueba", () => {
  it("por defecto no hay nada registrado", () => {
    expect(variableGroups().some((g) => g.key === "prueba")).toBe(false);
    expect(registeredSubjectSources()).toEqual([]);
  });

  it("un módulo suma su grupo, su origen y sus valores", async () => {
    undo.push(
      registerDesignVariables({
        group: "prueba",
        label: "Prueba",
        source: "Registro de prueba",
        vars: [{ key: "prueba.nombre", label: "Nombre de prueba", sample: "Muestra" }],
        resolve: async () => ({ "prueba.nombre": "Valor real", "otra.cosa": "no se acepta" }),
      }),
    );
    expect(variableGroups().at(-1)).toMatchObject({ key: "prueba", label: "Prueba" });
    expect(registeredSubjectSources()).toEqual([{ group: "prueba", source: "Registro de prueba" }]);
    expect(await resolveRegisteredValues({ workspaceId: "w", subject: null, contactId: null })).toEqual({ "prueba.nombre": "Valor real" });
  });

  it("no deja pisar un grupo del sistema ni variables con otro prefijo", () => {
    expect(() => registerDesignVariables({ group: "contact", label: "X", vars: [] })).toThrow();
    expect(() => registerDesignVariables({ group: "otro", label: "X", vars: [{ key: "contact.email", label: "x", sample: "" }] })).toThrow();
  });

  it("un resolve que falla no frena a los demás", async () => {
    undo.push(registerDesignVariables({ group: "rompe", label: "R", vars: [], resolve: async () => Promise.reject(new Error("x")) }));
    undo.push(registerDesignVariables({ group: "anda", label: "A", vars: [], resolve: async () => ({ "anda.x": "1" }) }));
    expect(await resolveRegisteredValues({ workspaceId: "w", subject: null, contactId: null })).toEqual({ "anda.x": "1" });
  });

  it("onDesignGenerated avisa y un suscriptor que falla no tumba nada", async () => {
    const seen: string[] = [];
    undo.push(onDesignGenerated(() => Promise.reject(new Error("x"))));
    undo.push(onDesignGenerated((d) => void seen.push(d.code)));
    await emitDesignGenerated({ designId: "d", workspaceId: "w", templateId: "t", code: "ABCD-EFGH-JKMN", subjectContactId: null, subjectRef: null });
    expect(seen).toEqual(["ABCD-EFGH-JKMN"]);
  });
});
