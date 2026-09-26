// Adaptado de Cal.diy (https://github.com/calcom/cal.diy), MIT License, Copyright (c) 2020-present Cal.com, Inc.
/**
 * Fuente del script del embed (F39, F41, F58). Adaptado de
 * `packages/embeds/embed-core/src/embed.ts` y `sdk-action-manager.ts`,
 * reducido a lo que pide el plano: `init`, `inline`, `floatingButton`,
 * popup por `data-ssa-link`, `ui`, `on`/`off` y `preload`. Sin
 * pre-renderizado, sin namespaces anidados en el iframe, sin CSS inyectado
 * más allá de estilos inline.
 *
 * NO está integrado al build (tanda A). La Tanda B compila `entry.ts` a
 * `public/embed/embed.js`. Para poder testearlo en Node, el runtime recibe
 * `window` y `document` con una interfaz mínima (`EmbedWindow`,
 * `EmbedDocument`) que el DOM real cumple.
 */
import { buildEmbedIframeUrl, parentUtmFromSearch, type EmbedConfig, type ParentUtm } from "./url";
import { parseEmbedMessage, isTrustedOrigin, isEmbedEventName, embedMessage, type EmbedEventName } from "./events";
import { createLoadWatchdog, parseFallbackAttr, renderFallback, LOAD_TIMEOUT_MS, type FallbackElement } from "./fallback";
import type { FallbackPayload } from "@/lib/scheduling/booker/unavailable";

export type Instruction = [string, ...unknown[]];
export type Queue = Instruction[];

export interface SsaGlobal {
  (...args: unknown[]): void;
  q: Queue;
  ns: Record<string, SsaGlobal>;
  loaded?: boolean;
  instance?: EmbedRuntime;
}

export interface EmbedElement extends FallbackElement {
  id?: string;
  src?: string;
  className?: string;
  dataset?: Record<string, string | undefined>;
  getAttribute(name: string): string | null;
  remove(): void;
  addEventListener?(type: string, cb: (ev: { key?: string; target?: unknown; preventDefault?: () => void }) => void): void;
  contentWindow?: { postMessage(message: unknown, targetOrigin: string): void } | null;
  closest?(selector: string): EmbedElement | null;
}

export interface EmbedDocument {
  createElement(tag: string): EmbedElement;
  querySelector(selector: string): EmbedElement | null;
  body: EmbedElement;
  head: EmbedElement;
  addEventListener(type: string, cb: (ev: { target?: unknown; preventDefault?: () => void; key?: string }) => void): void;
}

export interface MessageEventLike {
  origin: string;
  data: unknown;
  source?: unknown;
}

export interface EmbedWindow {
  addEventListener(type: string, cb: (ev: MessageEventLike) => void): void;
  setTimeout(cb: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  location: { href: string; search: string };
  SSA?: SsaGlobal;
}

export interface RuntimeEnv {
  window: EmbedWindow;
  document: EmbedDocument;
}

type Listener = (payload: unknown) => void;

interface UiConfig {
  theme?: "light" | "dark" | "auto";
  brandColor?: string | null;
  hideEventTypeDetails?: boolean;
  layout?: "month_view";
}

interface Frame {
  iframe: EmbedElement;
  container: EmbedElement;
  fallback: FallbackPayload;
  openUrl: string;
  watchdog: ReturnType<typeof createLoadWatchdog>;
}

export const FLOATING_BUTTON_ID = "ssa-floating-button";
export const MODAL_ID = "ssa-modal";

function style(el: EmbedElement, styles: Record<string, string>) {
  const s = el.style as Record<string, string>;
  for (const [k, v] of Object.entries(styles)) s[k] = v;
}

export class EmbedRuntime {
  readonly namespace: string;
  private origin: string | null = null;
  private ui: UiConfig = {};
  private listeners = new Map<EmbedEventName, Set<Listener>>();
  private frames = new Map<EmbedElement, Frame>();
  private parentUtm: ParentUtm;
  private modalRoot: EmbedElement | null = null;
  private inlineContainer: EmbedElement | null = null;

  constructor(
    private env: RuntimeEnv,
    namespace = "",
  ) {
    this.namespace = namespace;
    this.parentUtm = parentUtmFromSearch(env.window.location.search);
    env.window.addEventListener("message", (ev) => this.onMessage(ev));
  }

  // --- cola de instrucciones -------------------------------------------------

  processQueue(queue: Queue): void {
    for (const instruction of queue) this.processInstruction(instruction);
    queue.splice(0);
    // Las instrucciones que lleguen después se ejecutan al toque.
    queue.push = ((instruction: Instruction) => {
      this.processInstruction(instruction);
      return 0;
    }) as Queue["push"];
  }

  processInstruction(instruction: Instruction | ArrayLike<unknown>): void {
    const [method, ...args] = Array.from(instruction as ArrayLike<unknown>) as Instruction;
    const api = this.api[method as keyof typeof this.api];
    if (typeof api !== "function") {
      console.error(`[SSA embed] instrucción desconocida: ${String(method)}`);
      return;
    }
    try {
      (api as (...a: unknown[]) => void).call(this, ...args);
    } catch (e) {
      console.error(`[SSA embed] no se pudo ejecutar ${String(method)}`, e);
    }
  }

  private api = {
    init: (config: { origin?: string } = {}) => this.init(config),
    initNamespace: (_ns: string) => undefined,
    inline: (arg: { elementOrSelector: string | EmbedElement; calLink: string; config?: EmbedConfig }) => this.inline(arg),
    floatingButton: (arg: FloatingButtonArgs) => this.floatingButton(arg),
    modal: (arg: { calLink: string; config?: EmbedConfig; fallback?: FallbackPayload }) => this.openModal(arg.calLink, arg.config, arg.fallback),
    ui: (cfg: UiConfig) => this.setUi(cfg),
    on: (arg: { action: EmbedEventName; callback: Listener }) => this.on(arg.action, arg.callback),
    off: (arg: { action: EmbedEventName; callback: Listener }) => this.off(arg.action, arg.callback),
    preload: (arg: { calLink: string }) => this.preload(arg.calLink),
  };

  // --- API pública -----------------------------------------------------------

  init(config: { origin?: string } = {}): void {
    if (config.origin) this.origin = config.origin.replace(/\/$/, "");
    this.bindPopupLinks();
  }

  getOrigin(): string {
    if (!this.origin) throw new Error('SSA("init", {origin}) tiene que llamarse antes');
    return this.origin;
  }

  inline({ elementOrSelector, calLink, config }: { elementOrSelector: string | EmbedElement; calLink: string; config?: EmbedConfig }): void {
    const container = typeof elementOrSelector === "string" ? this.env.document.querySelector(elementOrSelector) : elementOrSelector;
    if (!container) throw new Error(`No se encontró el elemento ${String(elementOrSelector)}`);
    if (this.inlineContainer === container) return; // no duplicar
    this.inlineContainer = container;
    const fallback = parseFallbackAttr(container.getAttribute("data-ssa-fallback"));
    const iframe = this.createIframe(calLink, { ...this.uiAsConfig(), ...config }, container, fallback);
    style(iframe, { width: "100%", height: "100%", minHeight: "480px", border: "0" });
    container.appendChild(iframe);
  }

  floatingButton(args: FloatingButtonArgs): void {
    const doc = this.env.document;
    const btn = doc.createElement("button");
    btn.id = FLOATING_BUTTON_ID;
    btn.setAttribute("type", "button");
    btn.setAttribute("data-ssa-link", args.calLink);
    btn.textContent = args.buttonText || "Agendar una llamada";
    style(btn, {
      position: "fixed",
      bottom: "24px",
      [args.buttonPosition === "bottom-left" ? "left" : "right"]: "24px",
      zIndex: "9999",
      background: args.buttonColor || "#111827",
      color: args.buttonTextColor || "#ffffff",
      border: "0",
      borderRadius: "999px",
      padding: "14px 20px",
      fontSize: "15px",
      fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.2)",
      cursor: "pointer",
    });
    if (args.fallback) btn.setAttribute("data-ssa-fallback", JSON.stringify(args.fallback));
    if (args.config) btn.setAttribute("data-ssa-config", JSON.stringify(args.config));
    doc.body.appendChild(btn);
  }

  setUi(cfg: UiConfig): void {
    this.ui = { ...this.ui, ...cfg };
    for (const frame of this.frames.values()) this.postToFrame(frame, embedMessage("ssa:ui", this.ui, this.namespace));
  }

  on(action: EmbedEventName, callback: Listener): void {
    if (!isEmbedEventName(action)) throw new Error(`Evento desconocido: ${String(action)}`);
    (this.listeners.get(action) ?? this.listeners.set(action, new Set()).get(action)!).add(callback);
  }

  off(action: EmbedEventName, callback: Listener): void {
    this.listeners.get(action)?.delete(callback);
  }

  preload(calLink: string): void {
    const link = this.env.document.createElement("link");
    link.setAttribute("rel", "prefetch");
    link.setAttribute("href", buildEmbedIframeUrl(calLink, this.uiAsConfig(), this.parentUtm, this.getOrigin()));
    this.env.document.head.appendChild(link);
  }

  openModal(calLink: string, config: EmbedConfig = {}, fallback?: FallbackPayload): void {
    this.closeModal();
    const doc = this.env.document;
    const overlay = doc.createElement("div");
    overlay.id = MODAL_ID;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    style(overlay, {
      position: "fixed",
      inset: "0",
      zIndex: "10000",
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "16px",
    });

    const box = doc.createElement("div");
    style(box, { position: "relative", width: "100%", maxWidth: "1080px", height: "min(92vh, 760px)", background: "transparent" });
    box.setAttribute("data-ssa-fallback", JSON.stringify(fallback ?? parseFallbackAttr(null)));

    const close = doc.createElement("button");
    close.setAttribute("type", "button");
    close.setAttribute("aria-label", "Cerrar");
    close.textContent = "×";
    style(close, { position: "absolute", top: "-12px", right: "-12px", width: "36px", height: "36px", borderRadius: "999px", border: "0", background: "#111827", color: "#fff", fontSize: "20px", cursor: "pointer", zIndex: "1" });
    close.addEventListener?.("click", () => this.closeModal());

    const iframe = this.createIframe(calLink, { ...this.uiAsConfig(), ...config }, box, fallback ?? parseFallbackAttr(null));
    style(iframe, { width: "100%", height: "100%", border: "0", borderRadius: "12px", background: "transparent" });

    box.appendChild(close);
    box.appendChild(iframe);
    overlay.appendChild(box);
    overlay.addEventListener?.("click", (ev) => {
      if (ev.target === overlay) this.closeModal();
    });
    doc.body.appendChild(overlay);
    this.modalRoot = overlay;
  }

  closeModal(): void {
    if (!this.modalRoot) return;
    for (const [iframe, frame] of this.frames) {
      if (frame.container !== this.modalRoot && frame.container.closest?.(`#${MODAL_ID}`) === null) continue;
      frame.watchdog.cancel();
      this.frames.delete(iframe);
    }
    this.modalRoot.remove();
    this.modalRoot = null;
  }

  // --- internos ----------------------------------------------------------------

  private uiAsConfig(): EmbedConfig {
    return {
      theme: this.ui.theme,
      color: this.ui.brandColor,
      hideEventTypeDetails: this.ui.hideEventTypeDetails,
      layout: this.ui.layout,
      referrer: this.env.window.location.href,
    };
  }

  private createIframe(calLink: string, config: EmbedConfig, container: EmbedElement, fallback: FallbackPayload): EmbedElement {
    const origin = this.getOrigin();
    const url = buildEmbedIframeUrl(calLink, config, this.parentUtm, origin);
    const iframe = this.env.document.createElement("iframe");
    iframe.src = url;
    iframe.setAttribute("title", "Agenda");
    iframe.setAttribute("allow", "clipboard-write");
    iframe.setAttribute("loading", "eager");
    if (this.namespace) iframe.setAttribute("name", `ssa-embed=${this.namespace}`);

    const openUrl = url.replace(/([?&])embed=1&?/, "$1").replace(/[?&]$/, "");
    const watchdog = createLoadWatchdog({
      timeoutMs: LOAD_TIMEOUT_MS,
      timers: { setTimeout: (cb, ms) => this.env.window.setTimeout(cb, ms), clearTimeout: (h) => this.env.window.clearTimeout(h) },
      onTimeout: () => this.showFallback(iframe),
    });
    const frame: Frame = { iframe, container, fallback, openUrl, watchdog };
    this.frames.set(iframe, frame);
    iframe.addEventListener?.("error", () => watchdog.fail());
    watchdog.start();
    return iframe;
  }

  private showFallback(iframe: EmbedElement): void {
    const frame = this.frames.get(iframe);
    if (!frame) return;
    this.frames.delete(iframe);
    iframe.remove();
    renderFallback(frame.container, frame.fallback, this.env.document, {
      theme: this.ui.theme === "dark" ? "dark" : "light",
      color: this.ui.brandColor ?? null,
      openUrl: frame.openUrl,
      onRetry: () => {
        frame.container.textContent = "";
        const again = this.createIframe(this.calLinkFromUrl(frame.openUrl), this.uiAsConfig(), frame.container, frame.fallback);
        style(again, { width: "100%", height: "100%", minHeight: "480px", border: "0" });
        frame.container.appendChild(again);
      },
    });
  }

  private calLinkFromUrl(url: string): string {
    const m = /\/calendario\/([a-z0-9-]+\/[a-z0-9-]+)/.exec(url);
    return m ? m[1] : "";
  }

  private postToFrame(frame: Frame, message: unknown): void {
    frame.iframe.contentWindow?.postMessage(message, this.getOrigin());
  }

  private onMessage(ev: MessageEventLike): void {
    if (!this.origin || !isTrustedOrigin(ev.origin, this.origin)) return;
    const msg = parseEmbedMessage(ev.data);
    if (!msg || msg.namespace !== this.namespace) return;

    const frame = [...this.frames.values()].find((f) => f.iframe.contentWindow === ev.source) ?? [...this.frames.values()][0];

    if (msg.type === "ssa:loaded") {
      frame?.watchdog.loaded();
      if (frame) this.postToFrame(frame, embedMessage("ssa:ui", this.ui, this.namespace));
      return;
    }
    if (msg.type === "ssa:height") {
      const h = typeof msg.payload === "number" ? msg.payload : Number((msg.payload as { height?: number })?.height);
      if (frame && Number.isFinite(h) && h > 0 && frame.container === this.inlineContainer) style(frame.iframe, { height: `${Math.ceil(h)}px` });
      return;
    }
    if (msg.type === "ssa:ui") return;
    for (const cb of this.listeners.get(msg.type) ?? []) {
      try {
        cb(msg.payload);
      } catch (e) {
        console.error("[SSA embed] error en un listener", e);
      }
    }
  }

  private popupBound = false;

  private bindPopupLinks(): void {
    if (this.popupBound) return;
    this.popupBound = true;
    this.env.document.addEventListener("click", (ev) => {
      const target = ev.target as EmbedElement | null | undefined;
      const el = target?.closest?.("[data-ssa-link]") ?? (target?.getAttribute?.("data-ssa-link") ? target : null);
      if (!el) return;
      const calLink = el.getAttribute("data-ssa-link");
      if (!calLink) return;
      ev.preventDefault?.();
      let config: EmbedConfig = {};
      try {
        config = JSON.parse(el.getAttribute("data-ssa-config") || "{}") as EmbedConfig;
      } catch {
        config = {};
      }
      this.openModal(calLink, config, parseFallbackAttr(el.getAttribute("data-ssa-fallback")));
    });
    this.env.document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape") this.closeModal();
    });
  }
}

export interface FloatingButtonArgs {
  calLink: string;
  buttonText?: string;
  buttonColor?: string | null;
  buttonTextColor?: string | null;
  buttonPosition?: "bottom-right" | "bottom-left";
  config?: EmbedConfig;
  fallback?: FallbackPayload;
}

/**
 * Arranque del script: toma `window.SSA` (creado por el snippet), procesa
 * la cola por defecto y la de cada namespace. Idempotente.
 */
export function bootstrap(env: RuntimeEnv): EmbedRuntime | null {
  const global = env.window.SSA;
  if (!global) return null;
  if (global.instance) return global.instance;
  global.q = global.q || [];
  global.ns = global.ns || {};
  const runtime = new EmbedRuntime(env, "");
  global.instance = runtime;
  runtime.processQueue(global.q);
  for (const [ns, api] of Object.entries(global.ns)) {
    if (api.instance) continue;
    const r = new EmbedRuntime(env, ns);
    api.instance = r;
    r.processQueue(api.q || []);
  }
  global.loaded = true;
  return runtime;
}
