/**
 * Los textos de la tarjeta que se ve al compartir un link (WhatsApp, redes). Puro:
 * sin base ni red, se prueba entero con Vitest.
 */
import { createHash } from "node:crypto";
import { formatDuration } from "@/lib/calendar/time";

const DESCRIPTION_MAX = 160;
const IMAGE_TITLE_MAX = 90;

/** Sube cuando cambia el dibujo de la imagen: así un link nuevo no reusa una imagen vieja. */
const IMAGE_REVISION = 1;

/** Corta en la última palabra que entra y suma "…". Un texto que entra queda igual. */
export function truncateText(text: string, max: number): string {
  const clean = text.trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** El texto plano de un markdown: lo que se lee, sin sus marcas. Un guion bajo adentro de una palabra se queda. */
export function plainText(markdown: string | null | undefined): string {
  return (markdown ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/(\*\*|\*|~~|`)(?=\S)(.+?)(?<=\S)\1/g, "$2")
    .replace(/(?<!\w)(__|_)(?=\S)(.+?)(?<=\S)\1(?!\w)/g, "$2")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ShareText {
  /** El título de la tarjeta. */
  title: string;
  /** La línea de abajo de la tarjeta. Sin dato, no va. */
  description?: string;
  /** Lo que se dibuja en la imagen. */
  imageTitle: string;
  imageSubtitle: string;
}

/** Agenda: la descripción del evento o, si no tiene, una línea armada con su duración y su anfitrión. */
export function eventShareText(input: {
  title: string;
  hostName: string;
  durationMinutes: number | null;
  description: string | null;
}): ShareText {
  const duration = formatDuration(input.durationMinutes);
  const fallback = duration ? `${duration} con ${input.hostName}. Elegí un horario.` : `Elegí un horario con ${input.hostName}.`;
  return {
    title: `${input.title} · ${input.hostName}`,
    description: truncateText(plainText(input.description), DESCRIPTION_MAX) || fallback,
    imageTitle: truncateText(input.title, IMAGE_TITLE_MAX),
    imageSubtitle: [duration, `con ${input.hostName}`].filter(Boolean).join(" · "),
  };
}

/** Formulario: su título o, si no tiene, el nombre del negocio. La descripción sale de su introducción, si hay. */
export function formShareText(input: { title?: string | null; intro?: string | null; businessName: string }): ShareText {
  const title = input.title?.trim() || input.businessName;
  const description = truncateText(plainText(input.intro), DESCRIPTION_MAX);
  return {
    title,
    ...(description ? { description } : {}),
    imageTitle: truncateText(title, IMAGE_TITLE_MAX),
    imageSubtitle: input.businessName,
  };
}

/** Un título largo va más chico, para que entre sin salirse de la imagen. */
export function titleFontSize(title: string): number {
  if (title.length <= 28) return 76;
  if (title.length <= 56) return 62;
  return 50;
}

/** La marca de versión de la imagen: si cambia lo que se dibuja, cambia la URL. */
export function shareVersion(parts: Array<string | null | undefined>): string {
  return createHash("sha256")
    .update(JSON.stringify([IMAGE_REVISION, ...parts]))
    .digest("hex")
    .slice(0, 12);
}
