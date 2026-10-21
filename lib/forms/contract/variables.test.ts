import { describe, expect, it } from "vitest";
import cases from "./render-match.cases.json";
import {
  availableVariables,
  contractDate,
  contractValues,
  markdownValue,
  renderContractTemplate,
  renderMatchesTemplate,
  templateVariables,
  unknownVariables,
} from "./variables";
import { renderContractMarkdown } from "./markdown";

describe("renderMatchesTemplate (casos compartidos con la base)", () => {
  for (const c of cases) {
    it(c.name, () => {
      expect(renderMatchesTemplate(c.template, c.rendered)).toBe(c.matches);
    });
  }
});

describe("las variables del texto", () => {
  it("lista las que usa, sin repetir", () => {
    expect(templateVariables("{{a.b}} y {{ fecha }} y {{a.b}}")).toEqual(["a.b", "fecha"]);
  });

  it("las de las preguntas más las fijas", () => {
    expect(availableVariables(["empresa"])).toContain("respuesta.empresa");
    expect(availableVariables([])).toContain("venta.monto");
  });

  it("una variable de una pregunta que no existe, o mal escrita, es desconocida", () => {
    expect(unknownVariables("{{respuesta.empresa}} {{respuesta.cuit}} {{contacto.nombr}} {{fecha}}", ["empresa"])).toEqual(["respuesta.cuit", "contacto.nombr"]);
  });
});

describe("armar el texto", () => {
  it("reemplaza cada variable; lo que falta queda como —", () => {
    expect(renderContractTemplate("Entre {{respuesta.empresa}} por {{venta.monto}}.", { "respuesta.empresa": "Acme" })).toBe("Entre Acme por —.");
  });

  it("una respuesta con formato o saltos no rompe el contrato", () => {
    const rendered = renderContractTemplate("Empresa: {{respuesta.empresa}}\n\nFin.", { "respuesta.empresa": "**Acme**\n# hack\n- lista" });
    expect(rendered).toBe("Empresa: \\*\\*Acme\\*\\* # hack - lista\n\nFin.");
    const blocks = renderContractMarkdown(rendered);
    expect(blocks.map((b) => b.type)).toEqual(["paragraph", "paragraph"]);
    expect(blocks[0].type === "paragraph" && blocks[0].runs).toEqual([{ text: "Empresa: **Acme** # hack - lista" }]);
  });

  it("lo armado siempre pasa la comprobación de la base", () => {
    const template = "# Contrato\n\nEntre **{{respuesta.empresa}}** ({{contacto.email}}) y {{negocio.nombre}}, el {{fecha}}.";
    const rendered = renderContractTemplate(template, { "respuesta.empresa": "A {{fecha}} B", "negocio.nombre": "Scaling" });
    expect(renderMatchesTemplate(template, rendered)).toBe(true);
  });

  it("markdownValue: vacío o con espacios es —", () => {
    expect(markdownValue("  ")).toBe("—");
    expect(markdownValue(null)).toBe("—");
  });

  it("los valores juntan las respuestas, el link, el negocio y la fecha", () => {
    const values = contractValues({
      answers: { empresa: "Acme" },
      link: { contacto: { nombre: "Ana" }, venta: { monto: "1500.00" } },
      businessName: "Scaling Systems",
      date: "21 de octubre de 2026",
    });
    expect(values).toMatchObject({ "respuesta.empresa": "Acme", "contacto.nombre": "Ana", "venta.monto": "1500.00", "venta.producto": null, "negocio.nombre": "Scaling Systems", fecha: "21 de octubre de 2026" });
  });

  it("la fecha del contrato va en la zona del negocio", () => {
    // 02:00 UTC del 22 es todavía el 21 en Costa Rica.
    expect(contractDate(new Date("2026-10-22T02:00:00Z"), "America/Costa_Rica")).toBe("21 de octubre de 2026");
    expect(contractDate(new Date("2026-10-22T02:00:00Z"), "zona/rota")).toBe("22 de octubre de 2026");
  });
});
