/**
 * El formato del documento de diseño (`DesignDoc`, F8 y §8.3 del plano).
 *
 * Es el contrato de todo el módulo: lo arma la IA, lo edita la persona, lo lee
 * el render. Posiciones y tamaños en PORCENTAJE de la página (el centro del
 * elemento), así el mismo documento sirve en el lienzo, en el link y en el PDF.
 *
 * El orden del arreglo `elements` ES el orden de capas: el último queda adelante.
 *
 * La base tiene una gemela mínima (`public.validate_design_doc`, D2) que mira
 * la estructura, los conteos y los tipos. La validación fina es esta, en el
 * servidor, antes de guardar. Los casos de `doc.cases.json` corren contra las
 * dos (vitest y `verify-designer --bloque ds0`).
 *
 * Módulo puro.
 */

import { z } from "zod";
import { FORMAT_KEYS, MAX_PAGES, type FormatKey } from "../formats";

export const DESIGN_DOC_VERSION = 1;

/** "#rrggbb" o "#rrggbbaa". */
export const COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
export const PAGE_ID_RE = /^pg_[a-z0-9]{4,24}$/;
export const ELEMENT_ID_RE = /^el_[a-z0-9]{4,24}$/;
/** Una clave de variable: `contact.first_name`, `design.code`, `nombre_en_el_certificado`. */
export const VARIABLE_KEY_RE = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;

const MAX_TEXT = 5_000;
const MAX_HTML = 2_000_000;
const MAX_CSS = 500_000;
const MAX_ELEMENTS_PER_PAGE = 200;

const pct = z.number().min(0, { message: "va de 0 a 100" }).max(100, { message: "va de 0 a 100" });
const color = z.string().regex(COLOR_RE, { message: "no es un color válido (#rrggbb)" });

/** Los problemas de las variables de un texto: una sin cerrar, vacía o mal escrita. */
export function variableProblems(text: string): string[] {
  const problems: string[] = [];
  const stripped = text.replace(/\{\{([^{}]*)\}\}/g, (_match, inner: string) => {
    if (!VARIABLE_KEY_RE.test(inner)) problems.push(`la variable «{{${inner}}}» está mal escrita`);
    return "";
  });
  if (stripped.includes("{{") || stripped.includes("}}")) problems.push("hay una variable sin abrir o sin cerrar ({{ … }})");
  return problems;
}

/** Las claves de variables que usa un texto, en orden y sin repetir. */
export function variablesIn(text: string): string[] {
  const keys: string[] = [];
  for (const match of text.matchAll(/\{\{([^{}]*)\}\}/g)) {
    const key = match[1];
    if (VARIABLE_KEY_RE.test(key) && !keys.includes(key)) keys.push(key);
  }
  return keys;
}

const fontSchema = z.object({
  family: z.string().trim().min(1, { message: "la fuente está vacía" }).max(80),
  weight: z.number().int().min(100).max(900).refine((w) => w % 100 === 0, { message: "el peso va de 100 a 900, de a 100" }),
  italic: z.boolean().optional(),
});

const baseElement = {
  id: z.string().regex(ELEMENT_ID_RE, { message: "el elemento no tiene un id válido (el_…)" }),
  name: z.string().max(120).optional(),
  x: pct,
  y: pct,
  w: z.number().gt(0, { message: "el ancho tiene que ser mayor que 0" }).max(100, { message: "va de 0 a 100" }),
  h: z.number().gt(0).max(100, { message: "va de 0 a 100" }).optional(),
  rotation: z.number().min(-360).max(360).optional(),
  opacity: z.number().min(0).max(1).optional(),
  locked: z.boolean().optional(),
  hidden: z.boolean().optional(),
};

const textElement = z.object({
  ...baseElement,
  type: z.literal("text"),
  text: z
    .string()
    .max(MAX_TEXT, { message: "el texto es demasiado largo" })
    .superRefine((text, ctx) => {
      for (const message of variableProblems(text)) ctx.addIssue({ code: "custom", message });
    }),
  font: fontSchema,
  size: z.number().min(4, { message: "la letra es demasiado chica" }).max(1000, { message: "la letra es demasiado grande" }),
  lineHeight: z.number().min(0.5).max(4).optional(),
  letterSpacing: z.number().min(-50).max(200).optional(),
  align: z.enum(["left", "center", "right", "justify"]),
  color,
  transform: z.enum(["none", "uppercase"]).optional(),
  highlight: z.object({ color, opacity: z.number().min(0).max(1) }).optional(),
  shadow: z.boolean().optional(),
});

const assetPath = z.string().trim().min(1, { message: "falta el archivo" }).max(500);

const imageElement = z.object({
  ...baseElement,
  type: z.literal("image"),
  asset: assetPath,
  fit: z.enum(["cover", "contain"]),
  radius: z.number().min(0).max(2000).optional(),
});

const shapeElement = z.object({
  ...baseElement,
  type: z.literal("shape"),
  shape: z.enum(["rect", "circle", "line"]),
  fill: color.optional(),
  stroke: z.object({ color, width: z.number().min(0).max(200) }).optional(),
  radius: z.number().min(0).max(2000).optional(),
});

const htmlElement = z.object({
  ...baseElement,
  type: z.literal("html"),
  html: z.string().max(MAX_HTML, { message: "el HTML es demasiado grande" }),
  css: z.string().max(MAX_CSS, { message: "el CSS es demasiado grande" }).optional(),
});

export const elementSchema = z.discriminatedUnion("type", [textElement, imageElement, shapeElement, htmlElement]);

const backgroundSchema = z
  .object({
    type: z.enum(["color", "gradient", "image"]),
    color: color.optional(),
    gradient: z.object({ from: color, to: color, angle: z.number().min(-360).max(360) }).optional(),
    image: z
      .object({
        asset: assetPath,
        fit: z.enum(["cover", "contain"]),
        focal: z.object({ x: pct, y: pct }),
        locked: z.boolean(),
      })
      .optional(),
    overlay: z.object({ color, opacity: z.number().min(0).max(0.9, { message: "la capa de color va de 0 a 90 %" }) }).optional(),
  })
  .superRefine((bg, ctx) => {
    if (bg.type === "color" && !bg.color) ctx.addIssue({ code: "custom", message: "el fondo de color no tiene color" });
    if (bg.type === "gradient" && !bg.gradient) ctx.addIssue({ code: "custom", message: "el degradé no tiene sus dos colores" });
    if (bg.type === "image" && !bg.image) ctx.addIssue({ code: "custom", message: "el fondo de imagen no tiene imagen" });
  });

const pageSchema = z.object({
  id: z.string().regex(PAGE_ID_RE, { message: "la página no tiene un id válido (pg_…)" }),
  name: z.string().max(120).optional(),
  background: backgroundSchema,
  elements: z.array(elementSchema).max(MAX_ELEMENTS_PER_PAGE, { message: "la página tiene demasiados elementos" }),
  height: z.number().int().min(400).max(20_000).optional(),
});

export const designDocSchema = z
  .object({
    v: z.literal(DESIGN_DOC_VERSION),
    format: z.enum(FORMAT_KEYS),
    style: z.string().max(40).optional(),
    pages: z
      .array(pageSchema)
      .min(1, { message: "el diseño necesita al menos una página" })
      .max(MAX_PAGES, { message: `el diseño admite hasta ${MAX_PAGES} páginas` }),
  })
  .superRefine((doc, ctx) => {
    if (doc.format === "web" && doc.pages.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "una página web tiene una sola página" });
    }
    if (doc.format !== "web" && doc.pages.some((p) => p.height !== undefined)) {
      ctx.addIssue({ code: "custom", path: ["pages"], message: "solo una página web tiene alto propio" });
    }
    const pageIds = new Set<string>();
    const elementIds = new Set<string>();
    doc.pages.forEach((page, pi) => {
      if (pageIds.has(page.id)) ctx.addIssue({ code: "custom", path: ["pages", pi, "id"], message: `la página ${page.id} está repetida` });
      pageIds.add(page.id);
      page.elements.forEach((el, ei) => {
        if (elementIds.has(el.id)) {
          ctx.addIssue({ code: "custom", path: ["pages", pi, "elements", ei, "id"], message: `el elemento ${el.id} está repetido` });
        }
        elementIds.add(el.id);
      });
    });
  });

export type DesignDoc = z.infer<typeof designDocSchema>;
export type DesignPage = DesignDoc["pages"][number];
export type DesignElement = z.infer<typeof elementSchema>;
export type TextElement = Extract<DesignElement, { type: "text" }>;
export type ImageElement = Extract<DesignElement, { type: "image" }>;
export type ShapeElement = Extract<DesignElement, { type: "shape" }>;
export type HtmlElement = Extract<DesignElement, { type: "html" }>;
export type PageBackground = DesignPage["background"];

export type ParseDocResult = { ok: true; doc: DesignDoc } | { ok: false; problems: string[] };

/** Describe dónde está un problema en palabras: "Página 2 › elemento 3". */
function where(path: readonly PropertyKey[]): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const key = path[i];
    if (key === "pages" && typeof path[i + 1] === "number") {
      parts.push(`Página ${(path[i + 1] as number) + 1}`);
      i++;
    } else if (key === "elements" && typeof path[i + 1] === "number") {
      parts.push(`elemento ${(path[i + 1] as number) + 1}`);
      i++;
    }
  }
  return parts.join(" › ");
}

/**
 * Pasa un documento viejo al formato vigente. Hoy hay una sola versión: lo
 * que no dice `v` se trata como la 1. Una versión futura suma su paso acá.
 */
export function migrateDesignDoc(json: unknown): unknown {
  if (!json || typeof json !== "object" || Array.isArray(json)) return json;
  const record = json as Record<string, unknown>;
  if (record.v === undefined) return { ...record, v: DESIGN_DOC_VERSION };
  return record;
}

/** Valida un documento y devuelve el documento o la lista de problemas en español. */
export function parseDesignDoc(json: unknown): ParseDocResult {
  const result = designDocSchema.safeParse(migrateDesignDoc(json));
  if (result.success) return { ok: true, doc: result.data };
  const problems = result.error.issues.map((issue) => {
    const place = where(issue.path);
    return place ? `${place}: ${issue.message}` : issue.message;
  });
  return { ok: false, problems: [...new Set(problems)] };
}

/** Un id nuevo para una página o un elemento (`pg_xxxxxx` / `el_xxxxxx`). */
export function newId(prefix: "pg" | "el", random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "";
  for (let i = 0; i < 8; i++) id += alphabet[Math.floor(random() * alphabet.length)];
  return `${prefix}_${id}`;
}

/** Un documento vacío de una página, con el fondo de un color. */
export function emptyDoc(format: FormatKey, background = "#ffffff"): DesignDoc {
  return {
    v: DESIGN_DOC_VERSION,
    format,
    pages: [{ id: newId("pg"), background: { type: "color", color: background }, elements: [] }],
  };
}

/** Todas las claves de variables que usa el documento (textos y nodos `data-tx` del HTML). */
export function docVariables(doc: DesignDoc): string[] {
  const keys: string[] = [];
  const push = (text: string) => {
    for (const key of variablesIn(text)) if (!keys.includes(key)) keys.push(key);
  };
  for (const page of doc.pages) {
    for (const el of page.elements) {
      if (el.type === "text") push(el.text);
      if (el.type === "html") push(el.html);
    }
  }
  return keys;
}
