import { describe, it, expect, vi, afterEach } from "vitest";
import { createLoadWatchdog, parseFallbackAttr, renderFallback, OPEN_IN_TAB_LABEL, RETRY_LABEL, LOAD_TIMEOUT_MS, type FallbackElement, type FallbackDocument } from "./fallback";
import { DEFAULT_UNAVAILABLE_MESSAGES } from "@/lib/scheduling/booker/unavailable";

/** Un DOM de juguete: guarda hijos, atributos y texto. */
class FakeEl implements FallbackElement {
  children: FakeEl[] = [];
  attrs: Record<string, string> = {};
  style: Record<string, string> = {};
  private _text: string | null = null;
  /** Como en el DOM real: asignar textContent borra los hijos. */
  get textContent(): string | null {
    return this._text;
  }
  set textContent(v: string | null) {
    this._text = v;
    this.children = [];
  }
  listeners: Record<string, (() => void)[]> = {};
  constructor(public tag: string) {}
  setAttribute(n: string, v: string) {
    this.attrs[n] = v;
  }
  appendChild(c: FallbackElement) {
    this.children.push(c as FakeEl);
  }
  addEventListener(t: string, cb: () => void) {
    (this.listeners[t] ??= []).push(cb);
  }
  /** Todo el texto visible, en orden. */
  text(): string {
    return [this.textContent ?? "", ...this.children.map((c) => c.text())].filter(Boolean).join(" | ");
  }
  find(tag: string): FakeEl | null {
    if (this.tag === tag) return this;
    for (const c of this.children) {
      const f = c.find(tag);
      if (f) return f;
    }
    return null;
  }
}
const doc: FallbackDocument = { createElement: (tag) => new FakeEl(tag) };

afterEach(() => vi.useRealTimers());

describe("createLoadWatchdog (F58, temporizadores simulados)", () => {
  it("si el iframe no avisa en 10 segundos, dispara el respaldo una sola vez", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const w = createLoadWatchdog({ onTimeout });
    w.start();
    vi.advanceTimersByTime(LOAD_TIMEOUT_MS - 1);
    expect(onTimeout).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(w.timedOut).toBe(true);
    w.loaded(); // tarde: no cambia nada
    expect(w.isLoaded).toBe(false);
  });

  it("si avisa a tiempo, no hay respaldo", () => {
    vi.useFakeTimers();
    const onTimeout = vi.fn();
    const w = createLoadWatchdog({ onTimeout });
    w.start();
    vi.advanceTimersByTime(3000);
    w.loaded();
    vi.advanceTimersByTime(20_000);
    expect(onTimeout).not.toHaveBeenCalled();
    expect(w.isLoaded).toBe(true);
  });

  it("fail() dispara enseguida; cancel() no dispara; los temporizadores se pueden inyectar", () => {
    const onTimeout = vi.fn();
    const timers = { setTimeout: vi.fn(() => "h"), clearTimeout: vi.fn() };
    const w = createLoadWatchdog({ onTimeout, timers, timeoutMs: 500 });
    w.start();
    expect(timers.setTimeout).toHaveBeenCalledWith(expect.any(Function), 500);
    w.fail();
    expect(timers.clearTimeout).toHaveBeenCalledWith("h");
    expect(onTimeout).toHaveBeenCalledTimes(1);

    const w2 = createLoadWatchdog({ onTimeout: vi.fn(), timers });
    w2.start();
    w2.cancel();
    expect(timers.clearTimeout).toHaveBeenCalledTimes(2);
  });
});

describe("parseFallbackAttr", () => {
  it("lee el JSON del snippet, y con código viejo o roto usa el texto por defecto", () => {
    expect(parseFallbackAttr('{"title":"No carga","body":"Escribinos","cta":{"label":"WA","href":"https://wa.me/1"}}')).toEqual({ title: "No carga", body: "Escribinos", cta: { label: "WA", href: "https://wa.me/1" } });
    expect(parseFallbackAttr(null)).toEqual(DEFAULT_UNAVAILABLE_MESSAGES.load_error);
    expect(parseFallbackAttr("{no es json")).toEqual(DEFAULT_UNAVAILABLE_MESSAGES.load_error);
    // Un href que no es https ni mailto se descarta.
    expect(parseFallbackAttr('{"title":"T","body":"B","cta":{"label":"x","href":"javascript:alert(1)"}}').cta).toBeUndefined();
  });
});

describe("renderFallback", () => {
  it("pinta título, texto y botón como texto plano, reemplazando lo que había", () => {
    const container = new FakeEl("div");
    container.children.push(new FakeEl("iframe"));
    renderFallback(container, { title: "No <b>carga</b>", body: "Línea 1\nLínea 2", cta: { label: "WhatsApp", href: "https://wa.me/50688881234" } }, doc, { theme: "dark", color: "#aa00ff" });
    expect(container.children).toHaveLength(1);
    const root = container.children[0];
    expect(root.attrs["data-ssa-fallback-view"]).toBe("load_error");
    expect(root.find("h3")?.textContent).toBe("No <b>carga</b>"); // texto, no HTML
    expect(root.find("p")?.textContent).toBe("Línea 1\nLínea 2");
    const a = root.find("a")!;
    expect(a.textContent).toBe("WhatsApp");
    expect(a.attrs).toMatchObject({ href: "https://wa.me/50688881234", target: "_blank", rel: "noopener noreferrer" });
    expect(a.style.background).toBe("#aa00ff");
    expect(root.style.background).toBe("#111827");
  });

  it("sin botón propio muestra 'Abrir el calendario en otra pestaña', y con onRetry el botón Reintentar", () => {
    const container = new FakeEl("div");
    const onRetry = vi.fn();
    renderFallback(container, { title: DEFAULT_UNAVAILABLE_MESSAGES.load_error.title, body: DEFAULT_UNAVAILABLE_MESSAGES.load_error.body }, doc, { openUrl: "https://agenda.ejemplo.com/calendario/wendy/llamada", onRetry });
    const root = container.children[0];
    expect(root.find("a")?.textContent).toBe(OPEN_IN_TAB_LABEL);
    const btn = root.find("button")!;
    expect(btn.textContent).toBe(RETRY_LABEL);
    btn.listeners.click[0]();
    expect(onRetry).toHaveBeenCalled();
  });
});
