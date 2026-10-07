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
        expect(code).toContain('Agenda("init", {"origin":"https://agenda.ejemplo.com"})');
        expect(code).toContain('Agenda("ui", {"theme":"dark","brandColor":"#aa00ff","hideEventTypeDetails":false})');
        expect(code).toContain("C.Agenda = C.Agenda || function");
        expect(code).not.toContain("Cal.com");
      }
      expect(html.startsWith("<!-- Agenda:")).toBe(true);
      expect(react).toContain("export default function AgendaEmbed()");
      expect(react).toContain("useEffect");
    });
  }

  it("inline: contenedor con data-agenda-fallback y la instrucción inline con la config", () => {
    const { html, react } = generateEmbedCode("inline", options, baseUrl);
    expect(html).toContain(`<div id="agenda-wendy-llamada"`);
    expect(html).toContain(`data-agenda-fallback='${escapeHtmlAttribute(JSON.stringify(fallback))}'`);
    expect(html).toContain('Agenda("inline", {"elementOrSelector":"#agenda-wendy-llamada","calLink":"wendy/llamada","config":{"theme":"dark","color":"#aa00ff"}})');
    expect(react).toContain('data-agenda-fallback={JSON.stringify(fallback)}');
    expect(react).toContain('window.Agenda("inline"');
  });

  it("popup: botón con data-agenda-link, data-agenda-config y el respaldo", () => {
    const { html } = generateEmbedCode("popup", options, baseUrl);
    expect(html).toContain(`<button type="button" data-agenda-link="wendy/llamada" data-agenda-config='{"theme":"dark","color":"#aa00ff"}' data-agenda-fallback='`);
    expect(html).toContain(">Agendar</button>");
    expect(html).not.toContain('Agenda("inline"');
  });

  it("flotante: la instrucción lleva texto, color, posición y el respaldo", () => {
    const { html } = generateEmbedCode("floating", options, baseUrl);
    expect(html).toContain('Agenda("floatingButton", {"calLink":"wendy/llamada","buttonText":"Agendar","buttonColor":"#aa00ff","buttonTextColor":"#ffffff","buttonPosition":"bottom-left","config":{"theme":"dark","color":"#aa00ff"},"fallback":{');
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
