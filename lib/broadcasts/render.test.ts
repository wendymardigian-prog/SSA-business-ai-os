import { describe, expect, it } from "vitest";
import {
  broadcastVariableList,
  broadcastVariables,
  cleanVariants,
  pickVariant,
  renderChatMessage,
  renderEmail,
  renderTemplate,
  templateVariables,
  unknownVariables,
} from "./render";
import { finalizeEmailHtml } from "@/lib/email/html";

const ana = broadcastVariables(
  { display_name: "Ana María López", email: "ana@x.com", phone: "+5491100000000" },
  { name: "Mi Negocio" },
  [
    { slug: "plan", type: "text" },
    { slug: "vence", type: "date" },
    { slug: "vip", type: "boolean" },
  ],
  { plan: "Pro", vence: "2026-12-01", vip: "true" },
);

describe("renderTemplate", () => {
  it("pega las variables del contacto, el negocio y los campos personalizados", () => {
    const r = renderTemplate("Hola {{contact.first_name}}, tu plan {{custom.plan}} de {{workspace.name}} vence el {{custom.vence}} ({{custom.vip}})", ana);
    expect(r.text).toBe("Hola Ana, tu plan Pro de Mi Negocio vence el 01/12/2026 (Sí)");
    expect(r.missing).toEqual([]);
  });

  it("acepta espacios adentro de las llaves", () => {
    expect(renderTemplate("Hola {{ contact.first_name }}", ana).text).toBe("Hola Ana");
  });

  it("un dato vacío usa el respaldo", () => {
    const sin = broadcastVariables({ display_name: null, email: null, phone: null }, { name: "N" });
    expect(renderTemplate("Hola {{contact.first_name|amigo}}!", sin)).toEqual({ text: "Hola amigo!", missing: [] });
  });

  it("sin respaldo deja el hueco y lo cuenta una vez", () => {
    const sin = broadcastVariables({ display_name: null, email: null, phone: null }, { name: "N" });
    expect(renderTemplate("Hola {{contact.first_name}} {{contact.first_name}}", sin)).toEqual({ text: "Hola  ", missing: ["contact.first_name"] });
  });

  it("un nombre de relleno (id o @usuario) cuenta como vacío", () => {
    const id = broadcastVariables({ display_name: "17841400000000000", email: null, phone: null }, { name: "N" });
    const handle = broadcastVariables({ display_name: "@ana.lopez", email: null, phone: null }, { name: "N" });
    expect(renderTemplate("Hola {{contact.first_name|che}}", id).text).toBe("Hola che");
    expect(renderTemplate("Hola {{contact.first_name|che}}", handle).text).toBe("Hola che");
  });

  it("lo que no es contact, workspace ni custom queda tal cual (lo resuelve quien envía)", () => {
    expect(renderTemplate("Baja: {{unsubscribe_url}}", ana).text).toBe("Baja: {{unsubscribe_url}}");
  });

  it("escapa como HTML cuando se le pide, también el respaldo", () => {
    const evil = broadcastVariables({ display_name: "<b>Juan</b>", email: null, phone: null }, { name: "N" });
    expect(renderTemplate("<p>{{contact.display_name}}</p>", evil, true).text).toBe("<p>&lt;b&gt;Juan&lt;/b&gt;</p>");
    expect(renderTemplate("<p>{{custom.x|<i>}}</p>", evil, true).text).toBe("<p>&lt;i&gt;</p>");
  });
});

describe("variables del editor", () => {
  it("las fijas y una por campo", () => {
    expect(broadcastVariableList([{ slug: "plan" }])).toContain("custom.plan");
    expect(broadcastVariableList([])).toContain("contact.first_name");
  });

  it("detecta las que usa y si tienen respaldo", () => {
    expect(templateVariables("{{contact.first_name|x}} {{contact.email}} {{unsubscribe_url}}")).toEqual([
      { path: "contact.first_name", hasFallback: true },
      { path: "contact.email", hasFallback: false },
    ]);
  });

  it("marca una errata", () => {
    expect(unknownVariables("Hola {{contact.nombre}} {{custom.plan}} {{custom.otro}}", [{ slug: "plan" }])).toEqual(["contact.nombre", "custom.otro"]);
  });
});

describe("variantes", () => {
  it("la misma para el mismo destinatario, y repartidas", () => {
    expect(pickVariant("r-1", 3)).toBe(pickVariant("r-1", 3));
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) seen.add(pickVariant(`r-${i}`, 3));
    expect(seen).toEqual(new Set([0, 1, 2]));
    expect(pickVariant("x", 1)).toBe(0);
  });

  it("cleanVariants saca las vacías y corta en 5", () => {
    expect(cleanVariants(["a", " ", 3, "b", "c", "d", "e", "f"])).toEqual(["a", "b", "c", "d", "e"]);
    expect(cleanVariants("x")).toEqual([]);
  });

  it("renderChatMessage usa la variante del destinatario", () => {
    expect(renderChatMessage(["Hola {{contact.first_name}}", "Buenas {{contact.first_name}}"], 1, ana).text).toBe("Buenas Ana");
  });
});

describe("renderEmail", () => {
  it("cuerpo HTML: valores escapados y limpio", () => {
    const evil = broadcastVariables({ display_name: "<script>x</script>", email: null, phone: null }, { name: "N" });
    const r = renderEmail("Hola {{contact.display_name}}", "<p>Hola {{contact.display_name}}</p>", evil);
    expect(r.html).not.toContain("<script>");
    expect(r.subject).toBe("Hola <script>x</script>");
  });

  it("texto plano: se vuelve HTML con los saltos de línea", () => {
    const r = renderEmail("Asunto", "Hola {{contact.first_name}}\nchau", ana);
    expect(r.html).toContain("Hola Ana<br>chau");
  });

  // Caracterización, antes del preheader y del saludo: sin ellos el email sale byte por byte igual.
  it("sin preheader ni respaldo vacío, el HTML es exactamente el de siempre", () => {
    const plain = renderEmail("Asunto", "Hola, {{contact.first_name}}.\nchau", ana);
    expect(plain.subject).toBe("Asunto");
    expect(plain.html).toBe(finalizeEmailHtml("Hola, Ana.\nchau", false));
    const html = renderEmail("Asunto", '<p>Hola, {{contact.first_name}}.</p><p><a href="https://x.com">x</a></p>', ana);
    expect(html.html).toBe(finalizeEmailHtml('<p>Hola, Ana.</p><p><a href="https://x.com">x</a></p>', true));
  });

  it("saludo con respaldo vacío: «Hola, Ana.» o «Hola.», en texto y en HTML", () => {
    const sinNombre = broadcastVariables({ display_name: null, email: null, phone: null }, { name: "N" });
    expect(renderEmail("A", "Hola, {{contact.first_name|}}.", ana).html).toContain("Hola, Ana.");
    expect(renderEmail("A", "Hola, {{contact.first_name|}}.", sinNombre).html).toContain("<p style=\"margin:0 0 16px;\">Hola.</p>");
    expect(renderEmail("A", "<p>Hola, {{contact.first_name|}}.</p>", ana).html).toContain("Hola, Ana.");
    expect(renderEmail("A", "<p>Hola, {{contact.first_name|}}.</p>", sinNombre).html).toContain(">Hola.</p>");
    expect(renderEmail("A", "<p>Hola, {{contact.first_name|}}.</p>", sinNombre).missing).toEqual([]);
  });

  it("un nombre de relleno saluda igual que sin nombre", () => {
    const relleno = broadcastVariables({ display_name: "@usuario", email: null, phone: null }, { name: "N" });
    expect(renderEmail("A", "Hola, {{contact.first_name|}}.", relleno).html).toContain(">Hola.</p>");
  });

  it("preheader: con variables, oculto delante del cuerpo, escapado y fuera de los datos que faltan si tiene respaldo", () => {
    const r = renderEmail("A", "<p>Cuerpo</p>", ana, "Para {{contact.first_name|vos}}: <lunes>");
    expect(r.preheader).toBe("Para Ana: <lunes>");
    expect(r.html.startsWith('<div style="display:none;')).toBe(true);
    expect(r.html).toContain("Para Ana: &lt;lunes&gt;</div>");
    expect(r.missing).toEqual([]);
  });

  it("preheader con una variable sin respaldo: cuenta como dato que falta", () => {
    const sinNombre = broadcastVariables({ display_name: null, email: null, phone: null }, { name: "N" });
    expect(renderEmail("A", "<p>Cuerpo</p>", sinNombre, "Para {{contact.first_name}}").missing).toEqual(["contact.first_name"]);
  });

  it("sin preheader no hay nada oculto", () => {
    const r = renderEmail("A", "<p>Cuerpo</p>", ana);
    expect(r.preheader).toBe("");
    expect(r.html).not.toContain("display:none");
  });

  it("una coma antes de un punto en una plantilla sin respaldo vacío no se toca", () => {
    const r = renderEmail("Asunto", "Texto raro, . sigue igual", ana);
    expect(r.html).toContain("Texto raro, . sigue igual");
  });
});
