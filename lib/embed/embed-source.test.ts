import { describe, it, expect, vi, afterEach } from "vitest";
import { bootstrap, EmbedRuntime, FLOATING_BUTTON_ID, MODAL_ID, type EmbedDocument, type EmbedElement, type EmbedWindow, type SsaGlobal } from "./embed-source";
import { embedMessage } from "./events";

/** DOM de juguete suficiente para el runtime. */
class FakeEl implements EmbedElement {
  id?: string;
  src?: string;
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
  listeners: Record<string, ((ev: any) => void)[]> = {};
  parent: FakeEl | null = null;
  contentWindow = { postMessage: vi.fn() };
  constructor(public tag: string) {}
  setAttribute(n: string, v: string) {
    this.attrs[n] = v;
  }
  getAttribute(n: string) {
    return this.attrs[n] ?? null;
  }
  appendChild(c: EmbedElement) {
    (c as FakeEl).parent = this;
    this.children.push(c as FakeEl);
  }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  addEventListener(t: string, cb: (ev: any) => void) {
    (this.listeners[t] ??= []).push(cb);
  }
  closest(selector: string): EmbedElement | null {
    const attr = /^\[(.+)\]$/.exec(selector)?.[1];
    const id = /^#(.+)$/.exec(selector)?.[1];
    let cur: FakeEl | null = this;
    while (cur) {
      if (attr && cur.attrs[attr] !== undefined) return cur;
      if (id && cur.id === id) return cur;
      cur = cur.parent;
    }
    return null;
  }
  find(pred: (el: FakeEl) => boolean): FakeEl | null {
    if (pred(this)) return this;
    for (const c of this.children) {
      const f = c.find(pred);
      if (f) return f;
    }
    return null;
  }
}

function makeEnv(search = "?utm_source=web") {
  const body = new FakeEl("body");
  const head = new FakeEl("head");
  const byId = new Map<string, FakeEl>();
  const docListeners: Record<string, ((ev: any) => void)[]> = {};
  const winListeners: Record<string, ((ev: any) => void)[]> = {};
  const document: EmbedDocument = {
    body,
    head,
    createElement: (tag) => new FakeEl(tag),
    querySelector: (sel) => (sel.startsWith("#") ? byId.get(sel.slice(1)) ?? null : null),
    addEventListener: (t, cb) => (docListeners[t] ??= []).push(cb),
  };
  const window: EmbedWindow & { fire: (ev: any) => void } = {
    addEventListener: (t, cb) => (winListeners[t] ??= []).push(cb),
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
    location: { href: `https://mi-web.com/landing${search}`, search },
    fire: (ev) => winListeners.message?.forEach((cb) => cb(ev)),
  };
  const register = (el: FakeEl) => {
    if (el.id) byId.set(el.id, el);
    body.appendChild(el);
    return el;
  };
  return { window, document, body, head, register, docListeners };
}

const ORIGIN = "https://agenda.ejemplo.com";

afterEach(() => vi.useRealTimers());

describe("runtime del embed (F39, F41, F58)", () => {
  it("inline: procesa la cola del snippet, crea el iframe con la URL correcta y conserva los UTM del padre", () => {
    const env = makeEnv();
    const container = env.register(Object.assign(new FakeEl("div"), { id: "ssa-inline" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([
      ["init", { origin: ORIGIN }],
      ["inline", { elementOrSelector: "#ssa-inline", calLink: "wendy/llamada", config: { theme: "dark", color: "#aa00ff", email: "a@b.com" } }],
    ]);
    const iframe = container.find((e) => e.tag === "iframe")!;
    expect(iframe).toBeTruthy();
    const u = new URL(iframe.src!);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/calendario/wendy/llamada");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ embed: "1", theme: "dark", color: "#aa00ff", email: "a@b.com", utm_source: "web", referrer: "https://mi-web.com/landing?utm_source=web" });
    // Una segunda instrucción inline sobre el mismo contenedor no duplica.
    rt.processInstruction(["inline", { elementOrSelector: "#ssa-inline", calLink: "wendy/llamada" }]);
    expect(container.children.filter((c) => c.tag === "iframe")).toHaveLength(1);
  });

  it("si el iframe no manda ssa:loaded en 10 segundos, se reemplaza por el mensaje de respaldo del snippet", () => {
    vi.useFakeTimers();
    const env = makeEnv();
    const container = env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    container.setAttribute("data-ssa-fallback", JSON.stringify({ title: "No carga (custom)", body: "Escribinos", cta: { label: "WA", href: "https://wa.me/1" } }));
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    rt.inline({ elementOrSelector: "#c", calLink: "wendy/llamada" });
    vi.advanceTimersByTime(9_999);
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(container.find((e) => e.tag === "iframe")).toBeNull();
    expect(container.find((e) => e.tag === "h3")?.textContent).toBe("No carga (custom)");
    expect(container.find((e) => e.tag === "a")?.attrs.href).toBe("https://wa.me/1");
    // Reintentar vuelve a crear el iframe.
    container.find((e) => e.tag === "button")!.listeners.click[0]();
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
  });

  it("si ssa:loaded llega a tiempo desde el origen correcto, no hay respaldo; desde otro origen se ignora", () => {
    vi.useFakeTimers();
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "wendy/llamada" }]]);
    env.window.fire({ origin: "https://evil.com", data: embedMessage("ssa:loaded", {}, "") });
    env.window.fire({ origin: ORIGIN, data: embedMessage("ssa:loaded", {}, "") });
    vi.advanceTimersByTime(20_000);
    const container = env.document.querySelector("#c") as FakeEl;
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
    expect(container.find((e) => e.tag === "h3")).toBeNull();
    // Al cargar, se le manda la config de ui al iframe.
    const iframe = container.find((e) => e.tag === "iframe")!;
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "ssa:ui" }), ORIGIN);
  });

  it("on/off: los eventos públicos llegan al callback con el payload; la altura ajusta el iframe inline", () => {
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const rt = new EmbedRuntime(env, "");
    const cb = vi.fn();
    rt.processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "wendy/llamada" }], ["on", { action: "ssa:bookingSuccessful", callback: cb }]]);
    const payload = { uid: "u1", startTime: "x", endTime: "y", eventSlug: "llamada" };
    env.window.fire({ origin: ORIGIN, data: embedMessage("ssa:bookingSuccessful", payload, "") });
    expect(cb).toHaveBeenCalledWith(payload);
    env.window.fire({ origin: ORIGIN, data: embedMessage("ssa:height", { height: 812.4 }, "") });
    const iframe = (env.document.querySelector("#c") as FakeEl).find((e) => e.tag === "iframe")!;
    expect(iframe.style.height).toBe("813px");
    rt.off("ssa:bookingSuccessful", cb);
    env.window.fire({ origin: ORIGIN, data: embedMessage("ssa:bookingSuccessful", payload, "") });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(() => rt.on("ssa:loaded" as never, cb)).toThrow();
  });

  it("popup: un clic en [data-ssa-link] abre el modal con el iframe; Escape lo cierra", () => {
    const env = makeEnv();
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    const btn = env.register(new FakeEl("button"));
    btn.setAttribute("data-ssa-link", "wendy/llamada");
    btn.setAttribute("data-ssa-config", '{"theme":"light"}');
    const preventDefault = vi.fn();
    env.docListeners.click[0]({ target: btn, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    const modal = env.body.find((e) => e.id === MODAL_ID)!;
    expect(modal).toBeTruthy();
    const iframe = modal.find((e) => e.tag === "iframe")!;
    expect(iframe.src).toContain("/calendario/wendy/llamada?embed=1&theme=light");
    env.docListeners.keydown[0]({ key: "Escape" });
    expect(env.body.find((e) => e.id === MODAL_ID)).toBeNull();
  });

  it("floatingButton agrega el botón con texto, color y posición", () => {
    const env = makeEnv();
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    rt.floatingButton({ calLink: "wendy/llamada", buttonText: "Agendar", buttonColor: "#aa00ff", buttonPosition: "bottom-left" });
    const btn = env.body.find((e) => e.id === FLOATING_BUTTON_ID)!;
    expect(btn.textContent).toBe("Agendar");
    expect(btn.attrs["data-ssa-link"]).toBe("wendy/llamada");
    expect(btn.style).toMatchObject({ background: "#aa00ff", left: "24px" });
  });

  it("bootstrap toma window.SSA del snippet, procesa la cola y marca loaded; es idempotente", () => {
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const q: [string, ...unknown[]][] = [["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "wendy/llamada" }]];
    const SSA = Object.assign(() => undefined, { q, ns: {} }) as unknown as SsaGlobal;
    env.window.SSA = SSA;
    const rt = bootstrap(env);
    expect(rt).toBeInstanceOf(EmbedRuntime);
    expect(SSA.loaded).toBe(true);
    expect(q).toHaveLength(0);
    expect((env.document.querySelector("#c") as FakeEl).find((e) => e.tag === "iframe")).toBeTruthy();
    expect(bootstrap(env)).toBe(rt);
    // Lo que se encola después se ejecuta enseguida.
    const cb = vi.fn();
    q.push(["on", { action: "ssa:bookerReady", callback: cb }]);
    env.window.fire({ origin: ORIGIN, data: embedMessage("ssa:bookerReady", { eventSlug: "llamada" }, "") });
    expect(cb).toHaveBeenCalled();
  });

  it("instrucciones desconocidas no rompen la cola; inline sin init lanza y se loguea", () => {
    const env = makeEnv();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([["noExiste", {}], ["inline", { elementOrSelector: "#nada", calLink: "wendy/llamada" }]]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});
