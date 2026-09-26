/**
 * Respaldo del embed (F58): si el iframe no avisa `ssa:loaded` en 10
 * segundos (o falla), se reemplaza por el mensaje `load_error` que viaja en
 * `data-ssa-fallback`. Como el servidor puede estar caído, todo lo que hace
 * falta para pintarlo está acá y en el snippet; nada se descarga.
 *
 * Sin DOM real en los tests: el vigía recibe los temporizadores y el
 * renderizado recibe un `document` mínimo. Todo el texto va por
 * `textContent`, nunca por `innerHTML`.
 */
import { DEFAULT_UNAVAILABLE_MESSAGES } from "@/lib/scheduling/booker/unavailable";
import type { FallbackPayload } from "@/lib/scheduling/booker/unavailable";

export const LOAD_TIMEOUT_MS = 10_000;
export const OPEN_IN_TAB_LABEL = "Abrir el calendario en otra pestaña";
export const RETRY_LABEL = "Reintentar";

export interface WatchdogTimers {
  setTimeout: (cb: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

export interface LoadWatchdog {
  start(): void;
  /** Llamar cuando llega `ssa:loaded`. */
  loaded(): void;
  /** Llamar si el iframe falla antes del tiempo (error de carga). */
  fail(): void;
  cancel(): void;
  readonly isLoaded: boolean;
  readonly timedOut: boolean;
}

export function createLoadWatchdog(options: {
  timeoutMs?: number;
  onTimeout: () => void;
  timers?: WatchdogTimers;
}): LoadWatchdog {
  const timers: WatchdogTimers = options.timers ?? {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };
  const timeoutMs = options.timeoutMs ?? LOAD_TIMEOUT_MS;
  let handle: unknown = null;
  let isLoaded = false;
  let timedOut = false;

  const fire = () => {
    if (isLoaded || timedOut) return;
    timedOut = true;
    handle = null;
    options.onTimeout();
  };

  return {
    start() {
      if (handle !== null || isLoaded || timedOut) return;
      handle = timers.setTimeout(fire, timeoutMs);
    },
    loaded() {
      if (timedOut) return;
      isLoaded = true;
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
    fail() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
      fire();
    },
    cancel() {
      if (handle !== null) timers.clearTimeout(handle);
      handle = null;
    },
    get isLoaded() {
      return isLoaded;
    },
    get timedOut() {
      return timedOut;
    },
  };
}

/** Lee `data-ssa-fallback`. Si falta o está roto (código viejo), el texto por defecto. */
export function parseFallbackAttr(raw: string | null | undefined): FallbackPayload {
  const fallback: FallbackPayload = { ...DEFAULT_UNAVAILABLE_MESSAGES.load_error };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<FallbackPayload>;
    if (typeof parsed.title === "string" && parsed.title.trim()) fallback.title = parsed.title.slice(0, 80);
    if (typeof parsed.body === "string" && parsed.body.trim()) fallback.body = parsed.body.slice(0, 500);
    const cta = parsed.cta;
    if (cta && typeof cta.label === "string" && typeof cta.href === "string" && /^(https:\/\/|mailto:)/i.test(cta.href)) {
      fallback.cta = { label: cta.label.slice(0, 40), href: cta.href };
    }
    return fallback;
  } catch {
    return fallback;
  }
}

/** Lo mínimo que necesita el renderizado; un `HTMLElement` real lo cumple. */
export interface FallbackElement {
  textContent: string | null;
  style: Record<string, string> | { [key: string]: unknown };
  setAttribute(name: string, value: string): void;
  appendChild(child: FallbackElement): unknown;
  addEventListener?(type: string, cb: () => void): void;
}

export interface FallbackDocument {
  createElement(tag: string): FallbackElement;
}

export interface RenderFallbackOptions {
  theme?: "light" | "dark" | "auto";
  /** Color principal (hex) para el botón. */
  color?: string | null;
  /** Link para "Abrir el calendario en otra pestaña"; se muestra cuando el snippet no trae botón propio. */
  openUrl?: string | null;
  onRetry?: () => void;
}

const COLORS = {
  light: { bg: "#ffffff", fg: "#111827", muted: "#4b5563", border: "#e5e7eb" },
  dark: { bg: "#111827", fg: "#f9fafb", muted: "#9ca3af", border: "#374151" },
};

function setStyle(el: FallbackElement, styles: Record<string, string>) {
  const style = el.style as Record<string, string>;
  for (const [k, v] of Object.entries(styles)) style[k] = v;
}

/**
 * Pinta el mensaje dentro de `container`, reemplazando lo que tenía. Devuelve
 * el elemento raíz por si hay que quitarlo después.
 */
export function renderFallback(
  container: FallbackElement,
  message: FallbackPayload,
  doc: FallbackDocument,
  options: RenderFallbackOptions = {},
): FallbackElement {
  const palette = options.theme === "dark" ? COLORS.dark : COLORS.light;
  const accent = options.color ?? "#2563eb";

  container.textContent = "";

  const root = doc.createElement("div");
  root.setAttribute("data-ssa-fallback-view", "load_error");
  root.setAttribute("role", "status");
  setStyle(root, {
    fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    background: palette.bg,
    color: palette.fg,
    border: `1px solid ${palette.border}`,
    borderRadius: "12px",
    padding: "24px",
    maxWidth: "480px",
    margin: "0 auto",
    textAlign: "center",
  });

  const title = doc.createElement("h3");
  title.textContent = message.title;
  setStyle(title, { margin: "0 0 8px", fontSize: "18px", fontWeight: "600" });
  root.appendChild(title);

  const body = doc.createElement("p");
  body.textContent = message.body;
  setStyle(body, { margin: "0 0 16px", color: palette.muted, whiteSpace: "pre-line", fontSize: "14px" });
  root.appendChild(body);

  const actions = doc.createElement("div");
  setStyle(actions, { display: "flex", gap: "8px", justifyContent: "center", flexWrap: "wrap" });

  if (message.cta) {
    const a = doc.createElement("a");
    a.textContent = message.cta.label;
    a.setAttribute("href", message.cta.href);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    setStyle(a, { background: accent, color: "#ffffff", padding: "10px 16px", borderRadius: "8px", textDecoration: "none", fontSize: "14px" });
    actions.appendChild(a);
  } else if (options.openUrl) {
    const a = doc.createElement("a");
    a.textContent = OPEN_IN_TAB_LABEL;
    a.setAttribute("href", options.openUrl);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    setStyle(a, { color: accent, textDecoration: "underline", fontSize: "14px", padding: "10px 0" });
    actions.appendChild(a);
  }

  if (options.onRetry) {
    const btn = doc.createElement("button");
    btn.textContent = RETRY_LABEL;
    btn.setAttribute("type", "button");
    setStyle(btn, { background: "transparent", color: palette.fg, border: `1px solid ${palette.border}`, padding: "10px 16px", borderRadius: "8px", cursor: "pointer", fontSize: "14px" });
    btn.addEventListener?.("click", options.onRetry);
    actions.appendChild(btn);
  }

  root.appendChild(actions);
  container.appendChild(root);
  return root;
}
