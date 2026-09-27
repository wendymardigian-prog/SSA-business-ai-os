import { describe, it, expect } from "vitest";
import {
  normalizePhone,
  sanitizeForLink,
  cutForLink,
  composePrewrittenText,
  buildWhatsappLink,
  whatsappLinkTool,
  WHATSAPP_MARKER,
} from "./whatsapp-link";
import { toAgentConfig } from "../config";
import { agentRow } from "../testing/fixtures";
import { toolsForAgent } from "./index";

describe("normalizePhone", () => {
  it("quita +, espacios, guiones y parentesis", () => {
    expect(normalizePhone("+506 7081-4873")).toBe("50670814873");
    expect(normalizePhone("(506) 7081 4873")).toBe("50670814873");
  });
});

describe("configSchema (via la definicion)", () => {
  const schema = whatsappLinkTool.configSchema;
  it("normaliza el numero al validar y rechaza uno de 5 digitos", () => {
    const ok = schema.safeParse({ numero: "+506 7081-4873" });
    expect(ok.success && ok.data.numero).toBe("50670814873");
    expect(schema.safeParse({ numero: "12345" }).success).toBe(false);
    expect(schema.safeParse({ numero: "012345678" }).success).toBe(false); // empieza en 0
  });
  it("vacio es valido (para poder guardar sin numero)", () => {
    const r = schema.safeParse({});
    expect(r.success && r.data.numero).toBe("");
  });
});

describe("inputSchema: rechaza campos extra", () => {
  it("un numero propio del modelo se rechaza (strict)", () => {
    expect(whatsappLinkTool.inputSchema.safeParse({ contexto: "hola", numero: "50611112222" }).success).toBe(false);
    expect(whatsappLinkTool.inputSchema.safeParse({ contexto: "hola", nombre: "Ana" }).success).toBe(true);
  });
});

describe("sanitizeForLink", () => {
  it("saca saltos, tabs y caracteres de ancho cero, colapsa espacios", () => {
    const dirty = "hola\n\tmundo​‍﻿   dos";
    expect(sanitizeForLink(dirty)).toBe("hola mundo dos");
  });
  it("saca links y dominios del texto del lead", () => {
    expect(sanitizeForLink("anda a https://spam.com ya")).not.toContain("spam.com");
    expect(sanitizeForLink("mira www.malo.net ahora")).not.toContain("malo");
    expect(sanitizeForLink("visita ejemplo.com.ar hoy")).not.toContain("ejemplo");
  });
  it("no toca tildes ni ñ", () => {
    expect(sanitizeForLink("mañana con acentuación")).toBe("mañana con acentuación");
  });
});

describe("cutForLink + codificacion", () => {
  it("recorta en borde de palabra y el link decodifica igual al texto", () => {
    const texto = composePrewrittenText({
      nombre: "Ana",
      contexto: "quiero información sobre el programa de aceleración para mi ñoño negocio",
      plantillaDefault: "x",
      max: 40,
    });
    expect(texto.length).toBeLessThanOrEqual(40);
    expect(texto).not.toMatch(/\s$/); // no corta dejando espacio colgando
    const link = buildWhatsappLink("50670814873", texto);
    const decoded = decodeURIComponent(link.split("?text=")[1]);
    expect(decoded).toBe(texto);
    // Ningun escape partido: el %XX siempre completo.
    expect(() => decodeURIComponent(link.split("?text=")[1])).not.toThrow();
  });
  it("texto larguisimo con tildes: sin escape partido", () => {
    const largo = "árbol ".repeat(200);
    const texto = composePrewrittenText({ nombre: null, contexto: largo, plantillaDefault: "x", max: 300 });
    const encoded = encodeURIComponent(texto);
    expect(() => decodeURIComponent(encoded)).not.toThrow();
    expect(decodeURIComponent(encoded)).toBe(texto);
  });
});

describe("composePrewrittenText", () => {
  it("con nombre y contexto", () => {
    expect(composePrewrittenText({ nombre: "Ana", contexto: "quiero el curso", plantillaDefault: "x", max: 180 })).toBe(
      "Hola Wendy, soy Ana. quiero el curso",
    );
  });
  it("sin nombre", () => {
    expect(composePrewrittenText({ nombre: null, contexto: "quiero el curso", plantillaDefault: "x", max: 180 })).toBe(
      "Hola Wendy. quiero el curso",
    );
  });
  it("sin contexto usa la plantilla por defecto", () => {
    expect(composePrewrittenText({ nombre: "Ana", contexto: undefined, plantillaDefault: "Hola Wendy, vengo de Instagram.", max: 180 })).toBe(
      "Hola Wendy, vengo de Instagram.",
    );
  });
  it("un contexto que es solo un link cae a la plantilla (se saneo a vacio)", () => {
    expect(composePrewrittenText({ nombre: null, contexto: "https://spam.com", plantillaDefault: "def", max: 180 })).toBe("def");
  });
});

describe("descripcion: nombra el marcador exacto", () => {
  it("le dice al modelo que escriba {{LINK_WHATSAPP}}", () => {
    expect(whatsappLinkTool.description).toContain(WHATSAPP_MARKER);
  });
});

describe("isAvailable / toolsForAgent", () => {
  it("sin numero no se ofrece; con numero valido si", () => {
    const sin = toAgentConfig(agentRow({ allowed_tools: ["generar_link_whatsapp"], tools_config: {} }));
    expect(toolsForAgent(sin).map((t) => t.name)).not.toContain("generar_link_whatsapp");
    const con = toAgentConfig(
      agentRow({ allowed_tools: ["generar_link_whatsapp"], tools_config: { generar_link_whatsapp: { numero: "50670814873" } } }),
    );
    expect(toolsForAgent(con).map((t) => t.name)).toContain("generar_link_whatsapp");
  });
});
