import { describe, expect, it } from "vitest";
import {
  connectAreaFrom,
  fathomSettingsForm,
  fathomSettingsFromForm,
  meetingPassesRules,
  nextFathomSettings,
  parseFathomSettings,
  syncCreatedAfter,
  type FathomSettings,
} from "./settings";

const NOW = new Date("2026-11-06T12:00:00.000Z");
const AREA = "11111111-1111-4111-8111-111111111111";
const settings = (over: Partial<FathomSettings> = {}): FathomSettings => ({ ...parseFathomSettings({}), ...over });
const rules = (over: Partial<FathomSettings["rules"]>) => settings({ mode: "rules", rules: { ...settings().rules, ...over } });
const meeting = { title: "Demo con Ana", durationSeconds: 1800, attendees: [{ name: "Ana", email: "ana@lead.com", is_external: true }], recorderEmail: "yo@negocio.io", teamEmails: ["yo@negocio.io"] };
const windows = { overlapMs: 2 * 3600_000, initialMs: 14 * 24 * 3600_000 };

describe("parseFathomSettings", () => {
  it("sin configurar es automatico y sin area: una conexion vieja no cambia", () => {
    expect(parseFathomSettings({})).toEqual({ mode: "auto", rules: { title_contains: [], title_excludes: [], min_duration_minutes: null, with_external: false }, default_area_id: null, auto_since: null });
    expect(parseFathomSettings(null).mode).toBe("auto");
    expect(parseFathomSettings({ mode: "raro" }).mode).toBe("auto");
  });
  it("una fecha que no es fecha no cuenta", () => {
    expect(parseFathomSettings({ auto_since: "ayer" }).auto_since).toBeNull();
  });
  it("las reglas ignoran lo que no sirve", () => {
    expect(parseFathomSettings({ rules: { title_contains: [" demo ", "", 3, "demo"], min_duration_minutes: "15", with_external: "si" } }).rules).toEqual({ title_contains: ["demo"], title_excludes: [], min_duration_minutes: 15, with_external: false });
  });
});

describe("meetingPassesRules", () => {
  it("automatico y manual dejan pasar todo, aunque haya reglas guardadas", () => {
    const guardadas = { ...settings().rules, title_contains: ["otra cosa"] };
    expect(meetingPassesRules(settings({ mode: "auto", rules: guardadas }), meeting)).toBe(true);
    expect(meetingPassesRules(settings({ mode: "manual", rules: guardadas }), meeting)).toBe(true);
  });
  it("mira el nombre sin tildes ni mayusculas", () => {
    expect(meetingPassesRules(rules({ title_contains: ["DEMO"] }), meeting)).toBe(true);
    expect(meetingPassesRules(rules({ title_contains: ["cierre"] }), meeting)).toBe(false);
    expect(meetingPassesRules(rules({ title_excludes: ["demo"] }), meeting)).toBe(false);
    expect(meetingPassesRules(rules({ title_contains: ["diagnostico"] }), { ...meeting, title: "Diagnóstico" })).toBe(true);
  });
  it("una duracion que falta no cumple un minimo", () => {
    expect(meetingPassesRules(rules({ min_duration_minutes: 30 }), meeting)).toBe(true);
    expect(meetingPassesRules(rules({ min_duration_minutes: 31 }), meeting)).toBe(false);
    expect(meetingPassesRules(rules({ min_duration_minutes: 10 }), { ...meeting, durationSeconds: null })).toBe(false);
  });
  it("con alguien de afuera: mira a los invitados, sin contar al equipo", () => {
    expect(meetingPassesRules(rules({ with_external: true }), meeting)).toBe(true);
    expect(meetingPassesRules(rules({ with_external: true }), { ...meeting, attendees: [{ name: "Yo", email: "yo@negocio.io", is_external: false }] })).toBe(false);
    expect(meetingPassesRules(rules({ with_external: true }), { ...meeting, attendees: [] })).toBe(false);
  });
});

describe("syncCreatedAfter", () => {
  it("sin marca de agua mira los ultimos 14 dias, y con marca solapa 2 horas", () => {
    expect(syncCreatedAfter(settings(), null, NOW, windows)).toBe("2026-10-23T12:00:00.000Z");
    expect(syncCreatedAfter(settings(), "2026-11-05T12:00:00.000Z", NOW, windows)).toBe("2026-11-05T10:00:00.000Z");
  });
  it("quien salio de manual arranca en ese momento: no trae lo anterior de golpe", () => {
    const s = settings({ auto_since: "2026-11-06T11:00:00.000Z" });
    expect(syncCreatedAfter(s, null, NOW, windows)).toBe("2026-11-06T11:00:00.000Z");
    expect(syncCreatedAfter(s, "2026-10-01T00:00:00.000Z", NOW, windows)).toBe("2026-11-06T11:00:00.000Z");
  });
  it("una marca de agua posterior sigue mandando", () => {
    expect(syncCreatedAfter(settings({ auto_since: "2026-11-01T00:00:00.000Z" }), "2026-11-06T10:00:00.000Z", NOW, windows)).toBe("2026-11-06T08:00:00.000Z");
  });
});

describe("nextFathomSettings", () => {
  const input = (over = {}) => ({ mode: "auto" as const, rules: {}, default_area_id: null, ...over });

  it("al salir de manual marca desde cuando corre sola", () => {
    const r = nextFathomSettings(settings({ mode: "manual" }), input(), [], NOW);
    expect(r.ok && r.settings.auto_since).toBe(NOW.toISOString());
  });
  it("seguir en automatico no mueve esa marca", () => {
    const r = nextFathomSettings(settings({ auto_since: "2026-01-01T00:00:00.000Z" }), input({ mode: "rules", rules: { with_external: true } }), [], NOW);
    expect(r.ok && r.settings.auto_since).toBe("2026-01-01T00:00:00.000Z");
  });
  it("pasar a manual la borra", () => {
    const r = nextFathomSettings(settings({ auto_since: "2026-01-01T00:00:00.000Z" }), input({ mode: "manual" }), [], NOW);
    expect(r.ok && r.settings.auto_since).toBeNull();
  });
  it("con reglas exige al menos una", () => {
    expect(nextFathomSettings(settings(), input({ mode: "rules" }), [], NOW).ok).toBe(false);
  });
  it("el area tiene que ser del negocio", () => {
    expect(nextFathomSettings(settings(), input({ default_area_id: AREA }), [], NOW).ok).toBe(false);
    const r = nextFathomSettings(settings(), input({ default_area_id: AREA }), [AREA], NOW);
    expect(r.ok && r.settings.default_area_id).toBe(AREA);
  });
  it("un modo que no existe se rechaza", () => {
    expect(nextFathomSettings(settings(), input({ mode: "raro" }), [], NOW).ok).toBe(false);
  });
  it("auto_since no se puede mandar de afuera", () => {
    const r = nextFathomSettings(settings(), { ...input(), auto_since: "2020-01-01T00:00:00.000Z" } as never, [], NOW);
    expect(r.ok && r.settings.auto_since).toBeNull();
  });
});

describe("connectAreaFrom", () => {
  it("lee el area de la vuelta firmada", () => {
    expect(connectAreaFrom(`/dashboard/llamadas/mi-fathom?area=${AREA}`)).toBe(AREA);
  });
  it("sin area, o con algo que no es un id, nada", () => {
    expect(connectAreaFrom("/dashboard/llamadas/mi-fathom")).toBeNull();
    expect(connectAreaFrom("/dashboard/llamadas/mi-fathom?area=ventas")).toBeNull();
    expect(connectAreaFrom(null)).toBeNull();
  });
});

describe("el formulario", () => {
  it("ida y vuelta conserva las reglas", () => {
    const s = settings({ mode: "rules", rules: { title_contains: ["demo", "cierre"], title_excludes: ["interno"], min_duration_minutes: 15, with_external: true }, default_area_id: AREA });
    const back = fathomSettingsFromForm(fathomSettingsForm(s));
    const r = nextFathomSettings(settings(), back, [AREA], NOW);
    expect(r.ok && r.settings).toEqual({ ...s, auto_since: null });
  });
  it("el area del link queda elegida", () => {
    expect(fathomSettingsForm(settings(), AREA).areaId).toBe(AREA);
  });
});
