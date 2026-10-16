/**
 * El cuerpo de un email entre el campo guardado y el editor de texto
 * enriquecido. Puro: se prueba sin DOM.
 *
 * El campo `body` de una automatizacion guarda HTML (lo que arma el editor) o,
 * en las automatizaciones que ya existian, texto plano. Las dos cosas conviven:
 * el texto plano se abre convertido a parrafos y se vuelve HTML recien cuando
 * alguien lo edita. No hace falta migrar nada.
 */

import { escapeHtml, isHtmlTemplate } from "@/lib/email/html";

/** Lo que se le da al editor para mostrar. */
export function bodyToEditorHtml(body: string): string {
  if (!body.trim()) return "";
  if (isHtmlTemplate(body)) return body;
  return body
    .split(/\n{2,}/)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * Lo que se guarda a partir de lo que devuelve el editor. Un documento vacio
 * (`<p></p>`) se guarda como "" para que "sin mensaje no se manda nada" siga
 * valiendo; una variable sola cuenta como contenido.
 */
export function editorHtmlToBody(html: string): string {
  const hasVariable = /data-variable=/.test(html);
  const text = html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();
  return text || hasVariable ? html : "";
}

/** El texto de una variable como se guarda: `{{contact.first_name}}`. */
export function variableToken(name: string): string {
  return `{{${name}}}`;
}

/** Normaliza lo que escribe la persona en el campo de enlace; null si no sirve. */
export function normalizeLink(input: string): string | null {
  const value = input.trim();
  if (!value) return null;
  if (/^(https?:\/\/|mailto:|tel:)/i.test(value)) return value;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return `mailto:${value}`;
  if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(value)) return `https://${value}`;
  return null;
}
