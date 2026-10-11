import { describe, it, expect, vi, afterEach } from "vitest";
import { bootstrap, trackEmbedVisit, trackEnvOf, EmbedRuntime, FLOATING_BUTTON_ID, MODAL_ID, type EmbedDocument, type EmbedElement, type EmbedWindow, type AgendaGlobal } from "./embed-source";
import { decodeAttr } from "@/lib/forms/embed-attr";
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

/** Un `localStorage` de juguete (o uno que lanza, para el navegador que lo bloquea). */
function memoryStorage(blocked = false) {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => {
      if (blocked) throw new Error("bloqueado");
      return data.get(k) ?? null;
    },
    setItem: (k: string, v: string) => {
      if (blocked) throw new Error("bloqueado");
      data.set(k, v);
    },
  };
}

function makeEnv(search = "?utm_source=web") {
  const body = new FakeEl("body");
  const head = new FakeEl("head");
  const byId = new Map<string, FakeEl>();
  const docListeners: Record<string, ((ev: any) => void)[]> = {};
  const winListeners: Record<string, ((ev: any) => void)[]> = {};
  const document: EmbedDocument = {
    cookie: "",
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
    const container = env.register(Object.assign(new FakeEl("div"), { id: "agenda-inline" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([
      ["init", { origin: ORIGIN }],
      ["inline", { elementOrSelector: "#agenda-inline", calLink: "ana/llamada", config: { theme: "dark", color: "#aa00ff", email: "a@b.com" } }],
    ]);
    const iframe = container.find((e) => e.tag === "iframe")!;
    expect(iframe).toBeTruthy();
    const u = new URL(iframe.src!);
    expect(u.origin).toBe(ORIGIN);
    expect(u.pathname).toBe("/calendario/ana/llamada");
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ embed: "1", theme: "dark", color: "#aa00ff", email: "a@b.com", utm_source: "web", referrer: "https://mi-web.com/landing?utm_source=web" });
    // Una segunda instrucción inline sobre el mismo contenedor no duplica.
    rt.processInstruction(["inline", { elementOrSelector: "#agenda-inline", calLink: "ana/llamada" }]);
    expect(container.children.filter((c) => c.tag === "iframe")).toHaveLength(1);
  });

  it("si el iframe no manda agenda:loaded en 10 segundos, se reemplaza por el mensaje de respaldo del snippet", () => {
    vi.useFakeTimers();
    const env = makeEnv();
    const container = env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    container.setAttribute("data-agenda-fallback", JSON.stringify({ title: "No carga (custom)", body: "Escribinos", cta: { label: "WA", href: "https://wa.me/1" } }));
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    rt.inline({ elementOrSelector: "#c", calLink: "ana/llamada" });
    vi.advanceTimersByTime(9_999);
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
    vi.advanceTimersByTime(1);
    expect(container.find((e) => e.tag === "iframe")).toBeNull();
    expect(container.find((e) => e.tag === "h3")?.textContent).toBe("No carga (custom)");
    expect(container.find((e) => e.tag === "a")?.attrs.href).toBe("https://wa.me/1");
    // Reintentar vuelve a crear el iframe.
    container.find((e) => e.tag === "button")!.listeners.click[0]({});
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
  });

  it("si agenda:loaded llega a tiempo desde el origen correcto, no hay respaldo; desde otro origen se ignora", () => {
    vi.useFakeTimers();
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "ana/llamada" }]]);
    env.window.fire({ origin: "https://evil.com", data: embedMessage("agenda:loaded", {}, "") });
    env.window.fire({ origin: ORIGIN, data: embedMessage("agenda:loaded", {}, "") });
    vi.advanceTimersByTime(20_000);
    const container = env.document.querySelector("#c") as FakeEl;
    expect(container.find((e) => e.tag === "iframe")).toBeTruthy();
    expect(container.find((e) => e.tag === "h3")).toBeNull();
    // Al cargar, se le manda la config de ui al iframe.
    const iframe = container.find((e) => e.tag === "iframe")!;
    expect(iframe.contentWindow.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "agenda:ui" }), ORIGIN);
  });

  it("on/off: los eventos públicos llegan al callback con el payload; la altura ajusta el iframe inline", () => {
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const rt = new EmbedRuntime(env, "");
    const cb = vi.fn();
    rt.processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "ana/llamada" }], ["on", { action: "agenda:bookingSuccessful", callback: cb }]]);
    const payload = { uid: "u1", startTime: "x", endTime: "y", eventSlug: "llamada" };
    env.window.fire({ origin: ORIGIN, data: embedMessage("agenda:bookingSuccessful", payload, "") });
    expect(cb).toHaveBeenCalledWith(payload);
    env.window.fire({ origin: ORIGIN, data: embedMessage("agenda:height", { height: 812.4 }, "") });
    const iframe = (env.document.querySelector("#c") as FakeEl).find((e) => e.tag === "iframe")!;
    expect(iframe.style.height).toBe("813px");
    rt.off("agenda:bookingSuccessful", cb);
    env.window.fire({ origin: ORIGIN, data: embedMessage("agenda:bookingSuccessful", payload, "") });
    expect(cb).toHaveBeenCalledTimes(1);
    expect(() => rt.on("agenda:loaded" as never, cb)).toThrow();
  });

  it("popup: un clic en [data-agenda-link] abre el modal con el iframe; Escape lo cierra", () => {
    const env = makeEnv();
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    const btn = env.register(new FakeEl("button"));
    btn.setAttribute("data-agenda-link", "ana/llamada");
    btn.setAttribute("data-agenda-config", '{"theme":"light"}');
    const preventDefault = vi.fn();
    env.docListeners.click[0]({ target: btn, preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    const modal = env.body.find((e) => e.id === MODAL_ID)!;
    expect(modal).toBeTruthy();
    const iframe = modal.find((e) => e.tag === "iframe")!;
    expect(iframe.src).toContain("/calendario/ana/llamada?embed=1&theme=light");
    env.docListeners.keydown[0]({ key: "Escape" });
    expect(env.body.find((e) => e.id === MODAL_ID)).toBeNull();
  });

  it("floatingButton agrega el botón con texto, color y posición", () => {
    const env = makeEnv();
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    rt.floatingButton({ calLink: "ana/llamada", buttonText: "Agendar", buttonColor: "#aa00ff", buttonPosition: "bottom-left" });
    const btn = env.body.find((e) => e.id === FLOATING_BUTTON_ID)!;
    expect(btn.textContent).toBe("Agendar");
    expect(btn.attrs["data-agenda-link"]).toBe("ana/llamada");
    expect(btn.style).toMatchObject({ background: "#aa00ff", left: "24px" });
  });

  it("bootstrap toma window.Agenda del snippet, procesa la cola y marca loaded; es idempotente", () => {
    const env = makeEnv();
    env.register(Object.assign(new FakeEl("div"), { id: "c" }));
    const q: [string, ...unknown[]][] = [["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#c", calLink: "ana/llamada" }]];
    const Agenda = Object.assign(() => undefined, { q, ns: {} }) as unknown as AgendaGlobal;
    env.window.Agenda = Agenda;
    const rt = bootstrap(env);
    expect(rt).toBeInstanceOf(EmbedRuntime);
    expect(Agenda.loaded).toBe(true);
    expect(q).toHaveLength(0);
    expect((env.document.querySelector("#c") as FakeEl).find((e) => e.tag === "iframe")).toBeTruthy();
    expect(bootstrap(env)).toBe(rt);
    // Lo que se encola después se ejecuta enseguida.
    const cb = vi.fn();
    q.push(["on", { action: "agenda:bookerReady", callback: cb }]);
    env.window.fire({ origin: ORIGIN, data: embedMessage("agenda:bookerReady", { eventSlug: "llamada" }, "") });
    expect(cb).toHaveBeenCalled();
  });

  it("instrucciones desconocidas no rompen la cola; inline sin init lanza y se loguea", () => {
    const env = makeEnv();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([["noExiste", {}], ["inline", { elementOrSelector: "#nada", calLink: "ana/llamada" }]]);
    expect(error).toHaveBeenCalledTimes(2);
    error.mockRestore();
  });
});

describe("embed de un formulario (F10)", () => {
  it("carga /f/<slug>, pasa los parámetros de la página y la atribución, y NO los sensibles", () => {
    const env = makeEnv("?utm_source=facebook&ad_id=123&email=ana%40x.com&token=secreto&msclkid=m1");
    const container = env.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([
      ["init", { origin: ORIGIN }],
      ["inline", { elementOrSelector: "#f1", calLink: "f/aplicacion", config: { prefill: { plan: "pro" } } }],
    ]);
    const u = new URL(container.find((e) => e.tag === "iframe")!.src!);
    expect(u.pathname).toBe("/f/aplicacion");
    const p = u.searchParams;
    expect(p.get("embed")).toBe("1");
    expect(p.get("utm_source")).toBe("facebook");
    expect(p.get("ad_id")).toBe("123");
    expect(p.get("msclkid")).toBe("m1");
    expect(p.get("email")).toBe("ana@x.com");
    expect(p.get("plan")).toBe("pro");
    expect(p.has("token")).toBe(false);
    expect(p.get("referrer")).toContain("https://mi-web.com/landing");
  });

  it("DADO un sitio con cookie _fbp, el iframe recibe attr con fbp", () => {
    const env = makeEnv("");
    env.document.cookie = "otra=1; _fbp=fb.1.1.2; _ga=GA1.1.111.222";
    const container = env.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    const rt = new EmbedRuntime(env, "");
    rt.processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#f1", calLink: "f/aplicacion" }]]);
    const attr = new URL(container.find((e) => e.tag === "iframe")!.src!).searchParams.get("attr");
    expect(attr).toBeTruthy();
    expect(decodeAttr(attr)).toMatchObject({ fbp: "fb.1.1.2", ga_client_id: "111.222" });
  });

  it("un sitio sin cookies de anuncios no manda attr", () => {
    const env = makeEnv("");
    const container = env.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    new EmbedRuntime(env, "").processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#f1", calLink: "f/aplicacion" }]]);
    expect(new URL(container.find((e) => e.tag === "iframe")!.src!).searchParams.has("attr")).toBe(false);
  });

  it("reintentar un formulario que no cargó vuelve a crear el iframe de /f/<slug>", () => {
    vi.useFakeTimers();
    const env = makeEnv("");
    const container = env.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    const rt = new EmbedRuntime(env, "");
    rt.init({ origin: ORIGIN });
    rt.inline({ elementOrSelector: "#f1", calLink: "f/aplicacion" });
    vi.advanceTimersByTime(10_000);
    container.find((e) => e.tag === "button")!.listeners.click[0]({});
    const again = container.find((e) => e.tag === "iframe");
    expect(new URL(again!.src!).pathname).toBe("/f/aplicacion");
  });
});

describe("seguimiento de la atribución en la web que contiene el script (F29)", () => {
  it("al cargarse guarda la visita con UTM en el localStorage de esa web, con la clave ssa_attr", () => {
    const env = makeEnv("?utm_source=meta&utm_campaign=octubre");
    const storage = memoryStorage();
    env.window.localStorage = storage;
    trackEmbedVisit(env);
    expect(JSON.parse(storage.data.get("ssa_attr")!)).toMatchObject({ v: 1, first: { utm_campaign: "octubre" }, last: { utm_campaign: "octubre" } });
  });

  it("modo 'solo seguimiento': bootstrap sin window.Agenda igual guarda la visita y no rompe", () => {
    const env = makeEnv("?gclid=g1");
    const storage = memoryStorage();
    env.window.localStorage = storage;
    expect(bootstrap(env)).toBeNull();
    expect(JSON.parse(storage.data.get("ssa_attr")!).last).toMatchObject({ gclid: "g1" });
  });

  it("DADO un document con ?utm_source=meta y un localStorage que tira error, NO lanza", () => {
    const env = makeEnv("?utm_source=meta");
    env.window.localStorage = memoryStorage(true);
    expect(() => trackEmbedVisit(env)).not.toThrow();
    expect(() => bootstrap(env)).not.toThrow();
  });

  it("sin localStorage (undefined) tampoco lanza", () => {
    const env = makeEnv("?utm_source=meta");
    expect(env.window.localStorage).toBeUndefined();
    expect(() => trackEmbedVisit(env)).not.toThrow();
  });

  it("una visita sin UTM no escribe nada", () => {
    const env = makeEnv("");
    const storage = memoryStorage();
    env.window.localStorage = storage;
    trackEmbedVisit(env);
    expect(storage.data.size).toBe(0);
  });

  it("cuando después se abre un embed de formulario, el iframe recibe la atribución GUARDADA aunque la página no traiga UTM", () => {
    const first = makeEnv("?utm_source=meta&utm_campaign=octubre");
    const storage = memoryStorage();
    first.window.localStorage = storage;
    trackEmbedVisit(first);

    const later = makeEnv("");
    later.window.localStorage = storage;
    const container = later.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    new EmbedRuntime(later, "").processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#f1", calLink: "f/aplicacion" }]]);
    const attr = decodeAttr(new URL(container.find((e) => e.tag === "iframe")!.src!).searchParams.get("attr"));
    expect(attr).toMatchObject({ utm_source: "meta", utm_campaign: "octubre", first_visit: { utm_campaign: "octubre" } });
  });

  it("con UTM nuevos en la URL, esos mandan y la primera visita viaja aparte", () => {
    const env = makeEnv("?gclid=g2");
    const storage = memoryStorage();
    storage.data.set("ssa_attr", JSON.stringify({ v: 1, first: { utm_campaign: "octubre", ts: Date.now() }, last: { utm_campaign: "octubre", ts: Date.now() } }));
    env.window.localStorage = storage;
    const container = env.register(Object.assign(new FakeEl("div"), { id: "f1" }));
    new EmbedRuntime(env, "").processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#f1", calLink: "f/aplicacion" }]]);
    const attr = decodeAttr(new URL(container.find((e) => e.tag === "iframe")!.src!).searchParams.get("attr"));
    expect(attr).toMatchObject({ gclid: "g2", first_visit: { utm_campaign: "octubre" } });
    expect(attr).not.toHaveProperty("utm_campaign");
  });

  it("los embeds de AGENDA no cambian su URL por el seguimiento", () => {
    const env = makeEnv("?utm_source=meta");
    env.window.localStorage = memoryStorage();
    const container = env.register(Object.assign(new FakeEl("div"), { id: "a1" }));
    new EmbedRuntime(env, "").processQueue([["init", { origin: ORIGIN }], ["inline", { elementOrSelector: "#a1", calLink: "ana/llamada" }]]);
    const u = new URL(container.find((e) => e.tag === "iframe")!.src!);
    expect(u.pathname).toBe("/calendario/ana/llamada");
    expect(u.searchParams.has("attr")).toBe(false);
    expect(u.searchParams.get("utm_source")).toBe("meta");
  });

  it("trackEnvOf toma el hostname del href si la ubicación no lo trae", () => {
    const env = makeEnv("");
    expect(trackEnvOf(env).hostname).toBe("mi-web.com");
  });
});
