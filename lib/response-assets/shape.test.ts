import { describe, it, expect } from "vitest";
import {
  KIND_SHAPE,
  normalizeUrl,
  parseTagInput,
  urlDomain,
  validateAssetFields,
  validateTags,
  type AssetFieldsInput,
} from "./shape";
import { ASSET_KINDS, type AssetKind } from "./kind";

const PATH = "ws/library/x.bin";

const VALID: Record<AssetKind, AssetFieldsInput> = {
  text: { name: "Bienvenida", content: "Hola {{contact.display_name}}" },
  audio: { name: "Precio", description: "Explica el precio", storagePath: PATH },
  video: { name: "Testimonio", description: "Ana cuenta su resultado", storagePath: PATH, caption: "Mirá lo que logró Ana" },
  image: { name: "Flyer", description: "El flyer del lanzamiento", storagePath: PATH },
  file: { name: "Propuesta", description: "PDF con los planes", storagePath: PATH, caption: "Te paso la propuesta" },
  link: { name: "Agenda", description: "Para reservar la llamada", url: "calendly.com/demo", linkKind: "agenda" },
};

describe("validateAssetFields — una forma valida por tipo", () => {
  for (const kind of ASSET_KINDS) {
    it(kind, () => {
      const result = validateAssetFields(kind, VALID[kind]);
      expect(result.ok).toBe(true);
    });
  }

  it("lo que no aplica al tipo queda en null aunque venga cargado", () => {
    const result = validateAssetFields("text", { ...VALID.text, url: "https://x.com", linkKind: "otro", caption: "c" });
    expect(result).toMatchObject({ ok: true, value: { url: null, linkKind: null, caption: null } });
  });

  it("un enlace sin esquema se guarda con https", () => {
    const result = validateAssetFields("link", VALID.link);
    expect(result).toMatchObject({ ok: true, value: { url: "https://calendly.com/demo", linkKind: "agenda" } });
  });
});

describe("validateAssetFields — al menos una invalida por tipo", () => {
  it("texto sin contenido", () => {
    expect(validateAssetFields("text", { name: "x", content: "   " })).toMatchObject({ ok: false, field: "content" });
  });

  it("texto con una variable inventada", () => {
    expect(validateAssetFields("text", { name: "x", content: "Hola {{contact.apodo}}" })).toMatchObject({ ok: false, field: "content" });
  });

  it("audio sin descripcion", () => {
    expect(validateAssetFields("audio", { ...VALID.audio, description: "" })).toMatchObject({ ok: false, field: "description" });
  });

  it("video sin archivo", () => {
    expect(validateAssetFields("video", { ...VALID.video, storagePath: null })).toMatchObject({ ok: false, field: "file" });
  });

  it("imagen sin descripcion", () => {
    expect(validateAssetFields("image", { ...VALID.image, description: null })).toMatchObject({ ok: false, field: "description" });
  });

  it("archivo con un caption larguisimo", () => {
    expect(validateAssetFields("file", { ...VALID.file, caption: "x".repeat(1001) })).toMatchObject({ ok: false, field: "caption" });
  });

  it("enlace sin URL, con una URL que no es http, y sin clase", () => {
    expect(validateAssetFields("link", { ...VALID.link, url: "" })).toMatchObject({ ok: false, field: "url" });
    expect(validateAssetFields("link", { ...VALID.link, url: "javascript:alert(1)" })).toMatchObject({ ok: false, field: "url" });
    expect(validateAssetFields("link", { ...VALID.link, linkKind: "testimonios" })).toMatchObject({ ok: false, field: "linkKind" });
  });

  it("enlace sin descripcion", () => {
    expect(validateAssetFields("link", { ...VALID.link, description: " " })).toMatchObject({ ok: false, field: "description" });
  });

  it("cualquier tipo sin nombre o con un atajo invalido", () => {
    expect(validateAssetFields("image", { ...VALID.image, name: "" })).toMatchObject({ ok: false, field: "name" });
    expect(validateAssetFields("image", { ...VALID.image, shortcut: "/con espacio!" })).toMatchObject({ ok: false, field: "shortcut" });
  });
});

describe("KIND_SHAPE", () => {
  it("la descripcion es obligatoria en todo menos el texto (§5)", () => {
    for (const kind of ASSET_KINDS) {
      expect(KIND_SHAPE[kind].required.includes("description")).toBe(kind !== "text");
    }
  });

  it("lo obligatorio siempre esta permitido", () => {
    for (const kind of ASSET_KINDS) {
      for (const field of KIND_SHAPE[kind].required) {
        expect(KIND_SHAPE[kind].allowed).toContain(field);
      }
    }
  });

  it("caption solo en imagen, video y archivo", () => {
    const withCaption = ASSET_KINDS.filter((k) => KIND_SHAPE[k].allowed.includes("caption"));
    expect(withCaption).toEqual(["video", "image", "file"]);
  });
});

describe("normalizeUrl", () => {
  it("acepta http y https, y completa el esquema", () => {
    expect(normalizeUrl("https://ejemplo.com/a?b=1")).toEqual({ ok: true, value: "https://ejemplo.com/a?b=1" });
    expect(normalizeUrl("http://ejemplo.com")).toEqual({ ok: true, value: "http://ejemplo.com/" });
    expect(normalizeUrl("  ejemplo.com/agenda  ")).toEqual({ ok: true, value: "https://ejemplo.com/agenda" });
  });

  it("rechaza otros esquemas, espacios y hosts incompletos", () => {
    expect(normalizeUrl("ftp://ejemplo.com").ok).toBe(false);
    expect(normalizeUrl("file:///etc/passwd").ok).toBe(false);
    expect(normalizeUrl("https://wen dy.com").ok).toBe(false);
    expect(normalizeUrl("hola").ok).toBe(false);
  });

  it("el dominio para mostrar", () => {
    expect(urlDomain("https://www.calendly.com/demo")).toBe("calendly.com");
    expect(urlDomain(null)).toBe("");
  });
});

describe("etiquetas", () => {
  it("separa por coma, recorta y deduplica sin distinguir mayusculas", () => {
    expect(parseTagInput(" precios, objeciones ,, ")).toEqual(["precios", "objeciones"]);
    expect(validateTags(["Precios", "precios", " objeciones "])).toEqual({ ok: true, value: ["Precios", "objeciones"] });
  });

  it("respeta el tope de la base", () => {
    expect(validateTags(Array.from({ length: 21 }, (_, i) => `e${i}`)).ok).toBe(false);
  });
});
