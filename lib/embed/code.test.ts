import { describe, it, expect } from "vitest";
import { generateEmbedCode, escapeHtmlAttribute, jsonForScript, type EmbedCodeOptions } from "./code";

const fallback = { title: "No pudimos cargar el calendario", body: "Revisá tu conexión, o escribinos.", cta: { label: "WhatsApp", href: "https://wa.me/50688881234" } };
const options: EmbedCodeOptions = { calLink: "wendy/llamada", theme: "dark", color: "#aa00ff", hideEventTypeDetails: false, buttonText: "Agendar", buttonPosition: "bottom-left", fallback };
const baseUrl = "https://agenda.ejemplo.com";

describe("generateEmbedCode (F40): 3 modos × HTML y React", () => {
  for (const mode of ["inline", "popup", "floating"] as const) {
    it(`${mode}: el origin correcto, el script y las opciones serializadas`, () => {
      const { html, react } = generateEmbedCode(mode, options, baseUrl);
      for (const code of [html, react]) {
        expect(code).toContain('"https://agenda.ejemplo.com/embed/embed.js"');
        expect(code).toContain('SSA("init", {"origin":"https://agenda.ejemplo.com"})');
        expect(code).toContain('SSA("ui", {"theme":"dark","brandColor":"#aa00ff","hideEventTypeDetails":false})');
        expect(code).toContain("C.SSA = C.SSA || function");
        expect(code).not.toContain("Cal.com");
      }
      expect(html.startsWith("<!-- Agenda:")).toBe(true);
      expect(react).toContain("export default function AgendaEmbed()");
      expect(react).toContain("useEffect");
    });
  }

  it("inline: contenedor con data-ssa-fallback y la instrucción inline con la config", () => {
    const { html, react } = generateEmbedCode("inline", options, baseUrl);
    expect(html).toContain(`<div id="ssa-wendy-llamada"`);
    expect(html).toContain(`data-ssa-fallback='${escapeHtmlAttribute(JSON.stringify(fallback))}'`);
    expect(html).toContain('SSA("inline", {"elementOrSelector":"#ssa-wendy-llamada","calLink":"wendy/llamada","config":{"theme":"dark","color":"#aa00ff"}})');
    expect(react).toContain('data-ssa-fallback={JSON.stringify(fallback)}');
    expect(react).toContain('window.SSA("inline"');
  });

  it("popup: botón con data-ssa-link, data-ssa-config y el respaldo", () => {
    const { html } = generateEmbedCode("popup", options, baseUrl);
    expect(html).toContain(`<button type="button" data-ssa-link="wendy/llamada" data-ssa-config='{"theme":"dark","color":"#aa00ff"}' data-ssa-fallback='`);
    expect(html).toContain(">Agendar</button>");
    expect(html).not.toContain('SSA("inline"');
  });

  it("flotante: la instrucción lleva texto, color, posición y el respaldo", () => {
    const { html } = generateEmbedCode("floating", options, baseUrl);
    expect(html).toContain('SSA("floatingButton", {"calLink":"wendy/llamada","buttonText":"Agendar","buttonColor":"#aa00ff","buttonTextColor":"#ffffff","buttonPosition":"bottom-left","config":{"theme":"dark","color":"#aa00ff"},"fallback":{');
    expect(html).toContain('"href":"https://wa.me/50688881234"');
  });

  it("el respaldo se escapa en el atributo y el JSON del script no puede cerrar el <script>", () => {
    const raro = { ...fallback, title: "Hola <b>'amigo'</b> & co </script>" };
    const { html } = generateEmbedCode("inline", { ...options, fallback: raro }, baseUrl);
    expect(html).not.toContain("<b>'amigo'</b>");
    expect(html).toContain("&lt;b&gt;&#39;amigo&#39;&lt;/b&gt; &amp; co");
    expect(jsonForScript("</script>")).toBe('"\\u003c/script>"');
  });

  it("rechaza calLink inválido y usa el texto de botón por defecto", () => {
    expect(() => generateEmbedCode("inline", { ...options, calLink: "x" }, baseUrl)).toThrow();
    expect(generateEmbedCode("popup", { ...options, buttonText: undefined }, baseUrl).html).toContain(">Agendar una llamada</button>");
  });
});
