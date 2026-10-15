import { describe, expect, it } from "vitest";
import {
  backToLastTouch,
  chooseTouch,
  DEFAULT_ATTRIBUTION_STATE,
  initialAttributionState,
  initialPanel,
  loadChannelChoice,
  loadManually,
  modeLead,
  suggestionNotice,
} from "./attribution-field";

describe("estado del componente de atribución", () => {
  it("por defecto es el último toque (el servidor resuelve el resto al guardar)", () => {
    expect(DEFAULT_ATTRIBUTION_STATE).toEqual({ mode: "last_touch" });
  });

  it("elegir otro toque deja { mode: 'touch', touchId }", () => {
    expect(chooseTouch("t1")).toEqual({ mode: "touch", touchId: "t1" });
  });

  it("cargar a mano deja { mode: 'manual', manual }", () => {
    expect(loadManually({ source: "instagram", campaign: "octubre" })).toEqual({ mode: "manual", manual: { source: "instagram", campaign: "octubre" } });
  });

  it("'Volver al último toque' restaura el modo por defecto", () => {
    expect(backToLastTouch()).toEqual({ mode: "last_touch" });
  });

  it("sin toques el panel abre directo en 'Cargar a mano'; con toques, en la lista", () => {
    expect(initialPanel(0)).toBe("manual");
    expect(initialPanel(3)).toBe("touches");
  });

  it("la línea dice de dónde sale la atribución", () => {
    expect(modeLead({ mode: "last_touch" }, true)).toBe("último toque");
    expect(modeLead({ mode: "last_touch" }, false)).toBe("sin toques");
    expect(modeLead({ mode: "touch", touchId: "t" }, true)).toBe("elegida del historial");
    expect(modeLead({ mode: "manual", manual: { source: "web" } }, false)).toBe("cargada a mano");
  });
});

describe("cargar a mano con canal (F47)", () => {
  it("deja { mode: 'manual_channel', choice, label }", () => {
    expect(loadChannelChoice({ kind: "event", name: "Expo" }, "Evento · Expo")).toEqual({ mode: "manual_channel", choice: { kind: "event", name: "Expo" }, label: "Evento · Expo" });
    expect(loadChannelChoice({ kind: "other" })).toEqual({ mode: "manual_channel", choice: { kind: "other" } });
  });

  it("la línea dice 'cargada a mano'", () => {
    expect(modeLead({ mode: "manual_channel", choice: { kind: "other" } }, true)).toBe("cargada a mano");
  });
});

// Los tres casos del plano F46.
const touch = (id: string, occurred_at: string, channel: string, extra: Record<string, unknown> = {}) => ({ id, occurred_at, channel, source: "instagram", medium: null, ...extra });
const TZ = "America/Argentina/Buenos_Aires";

describe("la sugerencia de toque al cargar la venta (F46)", () => {
  it("[orgánico A (1/10), directo (5/10)]: arranca en A, con el aviso y la salida «Usar el último toque igual»", () => {
    const touches = [touch("A", "2026-10-03T15:00:00Z", "organic", { content_label: "Reel: 3 errores al cobrar" }), touch("D", "2026-10-05T15:00:00Z", "direct")];
    const initial = initialAttributionState(touches);
    expect(initial.state).toEqual({ mode: "touch", touchId: "A" });
    expect(initial.suggestion).toEqual({ touchId: "A", reason: "last_is_direct" });

    const notice = suggestionNotice({ state: initial.state, suggestion: initial.suggestion, touches, timeZone: TZ });
    expect(notice).toMatchObject({
      kind: "applied",
      title: "Reel: 3 errores al cobrar",
      action: { label: "Usar el último toque igual", to: "last_touch" },
    });
    expect(`${notice!.before}${notice!.title}${notice!.after}`).toBe("El último toque fue un mensaje sin origen; te sugerimos Reel: 3 errores al cobrar del 3/10.");
  });

  it("con un solo toque directo no hay sugerencia que mostrar: se queda en el último toque", () => {
    const touches = [touch("D", "2026-10-05T15:00:00Z", "direct")];
    const initial = initialAttributionState(touches);
    expect(initial.state).toEqual(DEFAULT_ATTRIBUTION_STATE);
    expect(initial.suggestion).toEqual({ touchId: "D", reason: "only_touch" });
    expect(suggestionNotice({ state: initial.state, suggestion: initial.suggestion, touches, timeZone: TZ })).toBeNull();
  });

  it("[pauta B (2/10), orgánico A (1/10)]: el último ya tiene origen, se queda en el último toque y no hay aviso", () => {
    const touches = [touch("A", "2026-10-01T15:00:00Z", "organic"), touch("B", "2026-10-02T15:00:00Z", "paid")];
    const initial = initialAttributionState(touches);
    expect(initial.state).toEqual(DEFAULT_ATTRIBUTION_STATE);
    expect(initial.suggestion).toEqual({ touchId: "B", reason: "last_touch" });
    expect(suggestionNotice({ state: initial.state, suggestion: initial.suggestion, touches, timeZone: TZ })).toBeNull();
  });

  it("sin toques no hay sugerencia", () => {
    expect(initialAttributionState([])).toEqual({ state: DEFAULT_ATTRIBUTION_STATE, suggestion: null });
  });

  it("«Usar el último toque igual» vuelve a last_touch y el aviso ofrece volver a la sugerencia", () => {
    const touches = [touch("A", "2026-10-03T15:00:00Z", "organic", { campaign: "Octubre" }), touch("D", "2026-10-05T15:00:00Z", "direct")];
    const { suggestion } = initialAttributionState(touches);
    const notice = suggestionNotice({ state: backToLastTouch(), suggestion, touches, timeZone: TZ });
    expect(notice).toMatchObject({ kind: "available", title: "Octubre", action: { label: "Usar la sugerencia", to: "suggested" } });
  });

  it("si la persona eligió otra cosa (otro toque o a mano), el aviso no insiste", () => {
    const touches = [touch("A", "2026-10-03T15:00:00Z", "organic"), touch("X", "2026-10-04T15:00:00Z", "paid"), touch("D", "2026-10-05T15:00:00Z", "direct")];
    const { suggestion } = initialAttributionState(touches);
    expect(suggestionNotice({ state: chooseTouch("A"), suggestion, touches, timeZone: TZ })).toBeNull();
    expect(suggestionNotice({ state: loadChannelChoice({ kind: "other" }), suggestion, touches, timeZone: TZ })).toBeNull();
  });

  it("el título sale del nombre de la pieza o del anuncio cuando se conocen", () => {
    const touches = [touch("A", "2026-10-03T15:00:00Z", "organic", { content_post_id: "p1", content_label: "cab2c3" }), touch("D", "2026-10-05T15:00:00Z", "direct")];
    const { state, suggestion } = initialAttributionState(touches);
    const notice = suggestionNotice({ state, suggestion, touches, timeZone: TZ, names: { pieces: { p1: "Reel: 3 errores" }, ads: {} } });
    expect(notice?.title).toBe("Reel: 3 errores");
  });
});
