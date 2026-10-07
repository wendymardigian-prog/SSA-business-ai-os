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

const FAKE_PHONE = "5491100000000";

describe("normalizePhone", () => {
  it("quita +, espacios, guiones y parentesis", () => {
    expect(normalizePhone("+54 9 11 0000-0000")).toBe(FAKE_PHONE);
    expect(normalizePhone("(54) 9 11 00000000")).toBe(FAKE_PHONE);
  });
});

describe("configSchema (via la definicion)", () => {
  const schema = whatsappLinkTool.configSchema;
  it("normaliza el numero al validar y rechaza uno de 5 digitos", () => {
    const ok = schema.safeParse({ numero: "+54 9 11 0000-0000" });
    expect(ok.success && ok.data.numero).toBe(FAKE_PHONE);
    expect(schema.safeParse({ numero: "12345" }).success).toBe(false);
    expect(schema.safeParse({ numero: "012345678" }).success).toBe(false); // empieza en 0
  });
  it("vacio es valido (para poder guardar sin numero)", () => {
    const r = schema.safeParse({});
    expect(r.success && r.data.numero).toBe("");
  });
  it("nombre_destino es opcional y vacio por defecto", () => {
    const r = schema.safeParse({});
    expect(r.success && r.data.nombre_destino).toBe("");
  });
});

describe("inputSchema: rechaza campos extra", () => {
  it("un numero propio del modelo se rechaza (strict)", () => {
    expect(whatsappLinkTool.inputSchema.safeParse({ contexto: "hola", numero: FAKE_PHONE }).success).toBe(false);
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
    const link = buildWhatsappLink(FAKE_PHONE, texto);
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
  it("con nombre y contexto, sin nombre_destino configurado: saludo generico", () => {
    expect(composePrewrittenText({ nombre: "Ana", contexto: "quiero el curso", plantillaDefault: "x", max: 180 })).toBe(
      "Hola, soy Ana. quiero el curso",
    );
  });
  it("sin nombre", () => {
    expect(composePrewrittenText({ nombre: null, contexto: "quiero el curso", plantillaDefault: "x", max: 180 })).toBe(
      "Hola. quiero el curso",
    );
  });
  it("con nombre_destino configurado, el saludo lo nombra", () => {
    expect(
      composePrewrittenText({ nombre: "Ana", contexto: "quiero el curso", plantillaDefault: "x", max: 180, nombreDestino: "Juan" }),
    ).toBe("Hola Juan, soy Ana. quiero el curso");
    expect(
      composePrewrittenText({ nombre: null, contexto: "quiero el curso", plantillaDefault: "x", max: 180, nombreDestino: "Juan" }),
    ).toBe("Hola Juan. quiero el curso");
  });
  it("sin contexto usa la plantilla por defecto", () => {
    expect(composePrewrittenText({ nombre: "Ana", contexto: undefined, plantillaDefault: "Hola, vengo de Instagram.", max: 180 })).toBe(
      "Hola, vengo de Instagram.",
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
      agentRow({ allowed_tools: ["generar_link_whatsapp"], tools_config: { generar_link_whatsapp: { numero: FAKE_PHONE } } }),
    );
    expect(toolsForAgent(con).map((t) => t.name)).toContain("generar_link_whatsapp");
  });
});
