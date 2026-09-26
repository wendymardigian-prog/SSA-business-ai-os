/**
 * Generador de código del embed (F40): el snippet en HTML y en React para
 * los tres modos, con el mensaje de respaldo `load_error` adentro
 * (`data-ssa-fallback`, F58).
 */
import type { BookerTheme } from "@/lib/scheduling/booker/embed-params";
import { normalizeHexColor } from "@/lib/scheduling/booker/embed-params";
import type { FallbackPayload } from "@/lib/scheduling/booker/unavailable";
import { CAL_LINK_RE } from "./url";
import { loaderSnippet, embedScriptUrl } from "./snippet";

export type EmbedMode = "inline" | "popup" | "floating";

export const EMBED_MODE_LABELS: Record<EmbedMode, string> = {
  inline: "Dentro de la página",
  popup: "Popup al hacer clic",
  floating: "Botón flotante",
};

export type ButtonPosition = "bottom-right" | "bottom-left";

export interface EmbedCodeOptions {
  /** `usuario/evento`. */
  calLink: string;
  theme?: BookerTheme;
  /** Color principal, hex. */
  color?: string | null;
  hideEventTypeDetails?: boolean;
  /** Texto del botón (popup y flotante). */
  buttonText?: string;
  buttonColor?: string | null;
  buttonTextColor?: string | null;
  buttonPosition?: ButtonPosition;
  /** Mensaje de respaldo ya resuelto para este evento (F58). */
  fallback: FallbackPayload;
  /** Precarga opcional. */
  prefill?: Record<string, string>;
}

export interface EmbedCode {
  html: string;
  react: string;
}

/** Escapa un valor para ir entre comillas simples en un atributo HTML. */
export function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** JSON seguro para ir dentro de un `<script>`: sin `</script>` ni separadores de línea raros. */
export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}

function uiConfig(options: EmbedCodeOptions) {
  const color = normalizeHexColor(options.color);
  return {
    theme: options.theme ?? "auto",
    ...(color ? { brandColor: color } : {}),
    hideEventTypeDetails: !!options.hideEventTypeDetails,
  };
}

function iframeConfig(options: EmbedCodeOptions) {
  const color = normalizeHexColor(options.color);
  return {
    theme: options.theme ?? "auto",
    ...(color ? { color } : {}),
    ...(options.hideEventTypeDetails ? { hideEventTypeDetails: true } : {}),
    ...(options.prefill ?? {}),
  };
}

function instructions(mode: EmbedMode, options: EmbedCodeOptions, baseUrl: string, elementId: string): string[] {
  const origin = baseUrl.replace(/\/$/, "");
  const lines = [`SSA("init", ${jsonForScript({ origin })});`];
  if (mode === "inline") {
    lines.push(
      `SSA("inline", ${jsonForScript({ elementOrSelector: `#${elementId}`, calLink: options.calLink, config: iframeConfig(options) })});`,
    );
  }
  if (mode === "floating") {
    lines.push(
      `SSA("floatingButton", ${jsonForScript({
        calLink: options.calLink,
        buttonText: options.buttonText || "Agendar una llamada",
        buttonColor: normalizeHexColor(options.buttonColor) ?? normalizeHexColor(options.color) ?? "#111827",
        buttonTextColor: normalizeHexColor(options.buttonTextColor) ?? "#ffffff",
        buttonPosition: options.buttonPosition ?? "bottom-right",
        config: iframeConfig(options),
        fallback: options.fallback,
      })});`,
    );
  }
  lines.push(`SSA("ui", ${jsonForScript(uiConfig(options))});`);
  return lines;
}

/**
 * `generateEmbedCode("inline", {...}, "https://app.ejemplo.com")` → `{ html, react }`.
 * El `origin` del `init` y la URL de `embed.js` salen de `baseUrl`
 * (`workspaces.scheduling_public_base_url` o `NEXT_PUBLIC_APP_URL`).
 */
export function generateEmbedCode(mode: EmbedMode, options: EmbedCodeOptions, baseUrl: string): EmbedCode {
  if (!CAL_LINK_RE.test(options.calLink)) throw new Error(`calLink inválido: "${options.calLink}"`);
  const elementId = `ssa-${options.calLink.replace("/", "-")}`;
  const fallbackAttr = escapeHtmlAttribute(JSON.stringify(options.fallback));
  const loader = loaderSnippet(embedScriptUrl(baseUrl));
  const lines = instructions(mode, options, baseUrl, elementId);
  const script = `<script type="text/javascript">\n${loader}\n${lines.join("\n")}\n</script>`;

  let markup = "";
  if (mode === "inline") {
    markup = `<div id="${elementId}" style="width:100%;height:100%;min-height:640px;overflow:auto" data-ssa-fallback='${fallbackAttr}'></div>`;
  } else if (mode === "popup") {
    const config = escapeHtmlAttribute(JSON.stringify(iframeConfig(options)));
    markup = `<button type="button" data-ssa-link="${options.calLink}" data-ssa-config='${config}' data-ssa-fallback='${fallbackAttr}'>${escapeHtmlAttribute(options.buttonText || "Agendar una llamada")}</button>`;
  } else {
    markup = `<!-- El botón flotante lo agrega el script; el respaldo viaja en la instrucción. -->`;
  }

  const html = `<!-- Agenda: ${EMBED_MODE_LABELS[mode]} -->\n${markup}\n${script}`;

  const reactMarkup =
    mode === "inline"
      ? `<div id="${elementId}" style={{ width: "100%", height: "100%", minHeight: 640, overflow: "auto" }} data-ssa-fallback={JSON.stringify(fallback)} />`
      : mode === "popup"
        ? `<button type="button" data-ssa-link="${options.calLink}" data-ssa-config={JSON.stringify(${jsonForScript(iframeConfig(options))})} data-ssa-fallback={JSON.stringify(fallback)}>\n        ${escapeHtmlAttribute(options.buttonText || "Agendar una llamada")}\n      </button>`
        : `null`;

  const react = `import { useEffect } from "react";

const fallback = ${JSON.stringify(options.fallback, null, 2)};

export default function AgendaEmbed() {
  useEffect(() => {
    ${loader.split("\n").join("\n    ")}
    ${lines.map((l) => `window.${l}`).join("\n    ")}
  }, []);

  return (
    ${reactMarkup}
  );
}`;

  return { html, react };
}
