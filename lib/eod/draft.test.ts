/**
 * Los cinco casos de E7 (que no se pierda nada en todo el día), con un servidor que se
 * comporta como `save_eod_draft` (revisión), un localStorage en memoria y un reloj fijo.
 */
import { describe, it, expect } from "vitest";
import {
  applyLocalChange,
  beginSend,
  crossedMidnight,
  draftStorageKey,
  emptyDraft,
  initialLocal,
  mergeDrafts,
  nextRetryDelay,
  onSaveConflict,
  onSaveOk,
  parseLocalDraft,
  rebaseCounters,
  countLoaded,
  type EodDraftData,
  type LocalDraft,
  type ServerDraft,
} from "./draft";

/** El servidor: acepta solo el guardado que viene de la revisión vigente. */
class FakeServer {
  state: ServerDraft = { data: emptyDraft(), rev: 0, savedAt: null };
  save(payload: { data: EodDraftData; rev: number }, at: string): { ok: true; rev: number } | { ok: false; current: ServerDraft } {
    if (payload.rev !== this.state.rev) return { ok: false, current: structuredClone(this.state) };
    this.state = { data: structuredClone(payload.data), rev: this.state.rev + 1, savedAt: at };
    return { ok: true, rev: this.state.rev };
  }
}

/** Un navegador: su localStorage y la copia local; nada más que las funciones puras. */
class Browser {
  storage = new Map<string, string>();
  local!: LocalDraft;
  constructor(
    private server: FakeServer,
    private key: string,
    private clock: () => string,
  ) {}
  open(): { rebased: boolean } {
    const merged = mergeDrafts(structuredClone(this.server.state), parseLocalDraft(this.storage.get(this.key) ?? null));
    this.local = initialLocal(merged, this.clock());
    this.persist();
    return { rebased: merged.rebased };
  }
  persist() {
    this.storage.set(this.key, JSON.stringify(this.local));
  }
  plusOne(channel: string, field: string, times = 1) {
    for (let i = 0; i < times; i++) {
      const data = structuredClone(this.local.data);
      const ch = (data.channels[channel] ??= { selected: true, answers: {} });
      ch.selected = true;
      ch.answers[field] = ((ch.answers[field] as number | undefined) ?? 0) + 1;
      this.local = applyLocalChange(this.local, data, this.clock());
      this.persist(); // sincrónico, en cada cambio
    }
  }
  /** Un guardado agrupado (el debounce de 1,5 s). `online=false`: el pedido no llega. */
  flush(online = true): "ok" | "conflict" | "offline" | "idle" {
    if (!this.local.pending) return "idle";
    const { local, payload } = beginSend(this.local);
    this.local = local;
    this.persist();
    if (!online) return "offline";
    const result = this.server.save(payload, this.clock());
    if (result.ok) this.local = onSaveOk(this.local, payload.data, result.rev);
    else this.local = onSaveConflict(this.local, result.current);
    this.persist();
    return result.ok ? "ok" : "conflict";
  }
  /** El pedido llega al servidor pero la respuesta se pierde (se cayó la red a la vuelta). */
  flushLosingResponse() {
    const { local, payload } = beginSend(this.local);
    this.local = local;
    this.persist();
    this.server.save(payload, this.clock());
  }
  value(channel: string, field: string) {
    return this.local.data.channels[channel]?.answers[field];
  }
}

const KEY = draftStorageKey("ws", "form", "user", "2026-10-12");
const clock = (() => {
  let t = Date.parse("2026-10-12T15:00:00Z");
  return () => new Date((t += 1000)).toISOString();
})();

describe("el borrador de un EOD no pierde nada", () => {
  it("DADO 15 '+1' cargados, CUANDO se recarga la página, siguen los 15", () => {
    const server = new FakeServer();
    const tab = new Browser(server, KEY, clock);
    tab.open();
    tab.plusOne("instagram", "links_enviados", 15);
    // Recarga antes de que el guardado agrupado salga: queda lo del navegador.
    const reloaded = new Browser(server, KEY, clock);
    reloaded.storage = tab.storage;
    reloaded.open();
    expect(reloaded.value("instagram", "links_enviados")).toBe(15);
    expect(reloaded.local.pending).toBe(true);
    expect(reloaded.flush()).toBe("ok");
    expect(server.state.data.channels.instagram.answers.links_enviados).toBe(15);
  });

  it("DADO que se cortó internet y se cargaron 5 más, CUANDO vuelve la conexión, el servidor queda con 20", () => {
    const server = new FakeServer();
    const tab = new Browser(server, KEY, clock);
    tab.open();
    tab.plusOne("instagram", "links_enviados", 15);
    expect(tab.flush()).toBe("ok");
    tab.plusOne("instagram", "links_enviados", 5);
    expect(tab.flush(false)).toBe("offline");
    expect(server.state.data.channels.instagram.answers.links_enviados).toBe(15);
    // Vuelve la conexión: el reintento sube lo pendiente, sin que la persona toque nada.
    expect(tab.flush()).toBe("ok");
    expect(server.state.data.channels.instagram.answers.links_enviados).toBe(20);
  });

  it("DADA la compu y el celular sobre el mismo campo que valía 10, +3 en uno y +2 en el otro dan 15", () => {
    const server = new FakeServer();
    const compu = new Browser(server, KEY, clock);
    compu.open();
    compu.plusOne("whatsapp", "seguimientos", 10);
    compu.flush();
    const celular = new Browser(server, KEY, clock); // otro dispositivo: su propio localStorage
    celular.open();
    expect(celular.value("whatsapp", "seguimientos")).toBe(10);

    compu.plusOne("whatsapp", "seguimientos", 3);
    celular.plusOne("whatsapp", "seguimientos", 2);
    expect(compu.flush()).toBe("ok");
    expect(celular.flush()).toBe("conflict");
    expect(celular.value("whatsapp", "seguimientos")).toBe(15);
    expect(celular.flush()).toBe("ok");
    expect(server.state.data.channels.whatsapp.answers.seguimientos).toBe(15);
    // La compu se pone al día al volver a abrir.
    compu.local.pending = false;
    compu.persist();
    compu.open();
    expect(compu.value("whatsapp", "seguimientos")).toBe(15);
  });

  it("CUANDO se cierra la pestaña dos segundos después de un '+1', al volver a abrir está en pantalla", () => {
    const server = new FakeServer();
    const tab = new Browser(server, KEY, clock);
    tab.open();
    tab.plusOne("instagram", "respuestas", 4);
    tab.flush();
    tab.plusOne("instagram", "respuestas"); // el guardado agrupado no llegó a salir
    const storage = tab.storage; // se cierra la pestaña: queda solo localStorage
    const again = new Browser(server, KEY, clock);
    again.storage = storage;
    again.open();
    expect(again.value("instagram", "respuestas")).toBe(5);
  });

  it("si el guardado llegó pero la respuesta se perdió, no se suma dos veces", () => {
    const server = new FakeServer();
    const tab = new Browser(server, KEY, clock);
    tab.open();
    tab.plusOne("instagram", "links_enviados", 3);
    tab.flushLosingResponse();
    tab.plusOne("instagram", "links_enviados", 2);
    const again = new Browser(server, KEY, clock);
    again.storage = tab.storage;
    again.open();
    expect(again.value("instagram", "links_enviados")).toBe(5);
    again.flush();
    expect(server.state.data.channels.instagram.answers.links_enviados).toBe(5);
  });

  it("CUANDO la pestaña queda abierta pasada la medianoche, el reporte no cambia de fecha y aparece el aviso", () => {
    const tz = "America/Costa_Rica";
    expect(crossedMidnight("2026-10-12", new Date("2026-10-13T05:30:00Z"), tz)).toBe(false); // 23:30 en Costa Rica
    expect(crossedMidnight("2026-10-12", new Date("2026-10-13T06:30:00Z"), tz)).toBe(true); // 00:30 del 13
    // La clave del borrador lleva la fecha con la que se abrió: nunca se mueve sola.
    expect(KEY.endsWith(":2026-10-12")).toBe(true);
  });
});

describe("rebaseCounters", () => {
  const data = (answers: EodDraftData["answers"], channels: EodDraftData["channels"] = {}): EodDraftData => ({ answers, channels });

  it("los textos: gana el último que se escribió; lo que no toqué queda el de ellos", () => {
    const base = data({ mejor: "a", otra: "x" });
    const mine = data({ mejor: "b", otra: "x" });
    const theirs = data({ mejor: "c", otra: "y" });
    expect(rebaseCounters(base, mine, theirs).answers).toEqual({ mejor: "b", otra: "y" });
  });

  it("prender un canal acá y cargar allá no se pisa", () => {
    const base = data({}, { instagram: { selected: false, answers: {} } });
    const mine = data({}, { instagram: { selected: true, answers: {} } });
    const theirs = data({}, { instagram: { selected: false, answers: { links_enviados: 4 } } });
    expect(rebaseCounters(base, mine, theirs).channels.instagram).toEqual({ selected: true, answers: { links_enviados: 4 } });
  });

  it("dos dispositivos que arrancaron vacíos suman los dos", () => {
    const merged = rebaseCounters(emptyDraft(), data({ horas_trabajadas: 3 }), data({ horas_trabajadas: 2 }));
    expect(merged.answers.horas_trabajadas).toBe(5);
  });
});

describe("reintentos, clave y conteo", () => {
  it("espera 2, 5, 15, 30 y después cada 30 segundos", () => {
    expect([0, 1, 2, 3, 4, 10].map(nextRetryDelay)).toEqual([2000, 5000, 15000, 30000, 30000, 30000]);
  });

  it("la clave del navegador es por workspace, formulario, persona y fecha", () => {
    expect(draftStorageKey("w", "f", "u", "2026-10-12")).toBe("eod:w:f:u:2026-10-12");
  });

  it("una copia local rota se ignora", () => {
    expect(parseLocalDraft("{no es json")).toBeNull();
    expect(parseLocalDraft(JSON.stringify({ v: 2 }))).toBeNull();
  });

  it("cuenta lo cargado solo en los canales prendidos", () => {
    expect(
      countLoaded({
        answers: { horas_trabajadas: 8, mejor: "" },
        channels: { instagram: { selected: true, answers: { a: 1, b: 0 } }, linkedin: { selected: false, answers: { a: 9 } } },
      }),
    ).toBe(3);
  });
});

describe("onSaveConflict", () => {
  it("si el servidor ya tiene lo que se mandó, no suma dos veces", async () => {
    const { onSaveConflict: conflict, beginSend: send, applyLocalChange: change, initialLocal: init, mergeDrafts: merge, emptyDraft: empty, setDraftValue: set } = await import("./draft");
    let local = init(merge(null, null), "t0");
    local = change(local, set(empty(), null, "horas_trabajadas", 3), "t1");
    const { local: sending, payload } = send(local);
    const after = conflict(sending, { data: payload.data, rev: 1, savedAt: "t2" });
    expect(after.data.answers.horas_trabajadas).toBe(3);
    expect(after.pending).toBe(false);
    expect(after.baseRev).toBe(1);
  });
});
