import { describe, expect, it } from "vitest";
import { fallbackText, needsFallback } from "./fallback";
import { interpolateVariables } from "@/lib/flow-engine/interpolate";
import { interpolateHtml } from "@/lib/email/html";

const vars = { contact: { first_name: "Ana", display_name: "@ana_ok" }, answer: { vacio: "", cero: 0 } };

describe("respaldo de una variable", () => {
  it.each([
    ["{{contact.first_name|hola}}", "Ana"],
    ["{{contact.display_name|hola}}", "hola"],
    ["{{contact.email|sin email}}", "sin email"],
    ["{{answer.vacio|nada}}", "nada"],
    ['{{answer.vacio | "nada"}}', "nada"],
    ["{{answer.vacio|}}", ""],
    ["{{answer.cero|nada}}", "0"],
  ])("%s", (template, expected) => {
    expect(interpolateVariables(template, vars)).toBe(expected);
    expect(interpolateHtml(template, vars)).toBe(expected);
  });

  it("sin |, igual que siempre: lo que no resuelve queda literal y un valor vacío se pega", () => {
    expect(interpolateVariables("{{nada}}", vars)).toBe("{{nada}}");
    expect(interpolateVariables("[{{answer.vacio}}]", vars)).toBe("[]");
    expect(interpolateHtml("{{nada}}", vars)).toBe("{{nada}}");
  });

  it("el valor se escapa en un email; el respaldo lo escribió quien armó el flujo y lo limpia el sanitizador", () => {
    expect(interpolateHtml("{{n|x}}", { n: "<b>" })).toBe("&lt;b&gt;");
  });

  it("un relleno solo cuenta en un nombre", () => {
    expect(needsFallback("contact.first_name", "@ana")).toBe(true);
    expect(needsFallback("answer.instagram", "@ana")).toBe(false);
    expect(fallbackText('  "hola, ana" ')).toBe("hola, ana");
    expect(fallbackText("&quot;hola&quot;")).toBe("hola");
  });
});
