/**
 * Documentos de muestra para los tests de la IA del Diseñador. Sin nombres reales.
 * No lo importa nada fuera de los tests.
 */

import type { DesignDoc, DesignPage, TextElement } from "../doc/schema";
import type { FormatKey } from "../formats";

export const WS = "11111111-2222-3333-4444-555555555555";

export function textEl(id: string, text: string, over: Partial<TextElement> = {}): TextElement {
  return {
    id,
    type: "text",
    x: 50,
    y: 50,
    w: 80,
    text,
    font: { family: "Inter", weight: 700 },
    size: 64,
    align: "center",
    color: "#ffffff",
    ...over,
  };
}

export function page(id: string, elements: DesignPage["elements"], over: Partial<DesignPage> = {}): DesignPage {
  return { id, background: { type: "color", color: "#0f1115" }, elements, ...over };
}

/** Un carrusel de 3 páginas: gancho, desarrollo y cierre con llamado a la acción. */
export function carousel(format: FormatKey = "v45"): DesignDoc {
  return {
    v: 1,
    format,
    style: "social",
    pages: [
      page("pg_cover01", [textEl("el_title01", "Automatizá tu negocio", { y: 40 }), textEl("el_sub0001", "Tres pasos simples", { y: 60, size: 40 })], { name: "Portada" }),
      page("pg_body001", [textEl("el_body001", "Primero ordená tus datos", { y: 45 })], { name: "Desarrollo" }),
      page("pg_cta0001", [textEl("el_cta0001", "Seguinos y guardá este post", { y: 50 })], { name: "Cierre" }),
    ],
  };
}

export function singlePage(format: FormatKey = "carta_h"): DesignDoc {
  return { v: 1, format, pages: [page("pg_only001", [textEl("el_only001", "Certificado de {{contact.display_name}}", { color: "#111111", size: 48 })], { background: { type: "color", color: "#ffffff" } })] };
}
