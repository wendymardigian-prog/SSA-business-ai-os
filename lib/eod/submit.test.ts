import { describe, it, expect, vi } from "vitest";
import { defaultEodConfig, type EodConfig } from "./config";
import { setterTemplate } from "./templates";
import { diffReports, notificationTitle, saveDraftCore, submitEodCore, validateEodReport, type EodFormContext, type EodPorts, type EodReportState, type EodVersion } from "./submit";
import type { EodDraftData } from "./draft";

const WS = "11111111-1111-4111-8111-111111111111";
const FORM = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const BETO = "44444444-4444-4444-8444-444444444444";

function version(): EodVersion {
  const def = setterTemplate();
  return { id: "v1", number: 1, fields: def.fields, channelSelector: def.channelSelector!, channels: def.channels! };
}

const sixZeros = { conv_inbound: 0, conv_outbound: 0, seguimientos: 0, respuestas: 0, links_enviados: 0, llamadas_agendadas: 0 };
function fullDraft(overrides: Partial<EodDraftData> = {}): EodDraftData {
  return {
    answers: { horas_trabajadas: 8, rendimiento: 7 },
    channels: {
      instagram: { selected: true, answers: { ...sixZeros, links_enviados: 5 } },
      whatsapp: { selected: true, answers: { ...sixZeros, links_enviados: 7 } },
      linkedin: { selected: false, answers: { ...sixZeros, links_enviados: 100 } },
    },
    ...overrides,
  };
}

function ports(opts: { config?: Partial<EodConfig>; report?: EodReportState | null; status?: string; member?: boolean } = {}) {
  const form: EodFormContext = {
    id: FORM,
    workspaceId: WS,
    name: "EOD Setters",
    status: opts.status ?? "published",
    config: { ...defaultEodConfig("setter"), ...opts.config },
    version: version(),
  };
  const calls = { saveDraft: vi.fn(), submit: vi.fn(), notify: vi.fn() };
  const p: EodPorts = {
    loadForm: async (id) => (id === FORM ? form : null),
    loadMember: async (_ws, userId) => (opts.member === false ? null : { userId, roleId: null, isMember: true, name: userId === ANA ? "Ana" : "Beto" }),
    timezoneOf: async () => "America/Costa_Rica",
    loadReport: async () => opts.report ?? null,
    saveDraft: async (args) => {
      calls.saveDraft(args);
      return { ok: true, rev: args.rev + 1, savedAt: "2026-10-12T20:00:00Z", status: "draft" };
    },
    submit: async (args) => {
      calls.submit(args);
      return { ok: true, reportId: "r1", first: opts.report?.status !== "submitted", editCount: opts.report?.status === "submitted" ? 1 : 0, rev: args.rev + 1 };
    },
    notify: async (args) => {
      calls.notify(args);
    },
    now: () => new Date("2026-10-12T20:00:00Z"), // 14:00 en Costa Rica
  };
  return { p, calls, form };
}

const draftState = (draft: EodDraftData, rev = 3): EodReportState => ({ id: "r1", status: "draft", rev, savedAt: null, draft, submitted: null, editCount: 0 });
const base = { workspaceId: WS, userId: ANA, formId: FORM, reportDate: "2026-10-12", rev: 3 };

describe("validateEodReport", () => {
  it("con un canal elegido al que le falta una obligatoria, rechaza nombrando el canal y la pregunta", () => {
    const draft = fullDraft();
    delete draft.channels.whatsapp.answers.seguimientos;
    const result = validateEodReport(version(), draft);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toContain('Canal "WhatsApp": "Seguimientos": Completá este campo');
  });

  it("un canal NO elegido no se guarda ni suma", () => {
    const result = validateEodReport(version(), fullDraft());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.report.channels)).toEqual(["instagram", "whatsapp"]);
    expect(result.report.metrics.total.links_enviados).toBe(12);
    expect(result.report.metrics.linkedin).toBeUndefined();
    expect(result.report.answers.horas_trabajadas).toEqual({ label: "Horas trabajadas hoy", type: "number", value: 8 });
    expect(result.report.channels.instagram.answers.links_enviados.value).toBe(5);
  });

  it("el selector obligatorio exige al menos un canal", () => {
    const result = validateEodReport(version(), fullDraft({ channels: {} }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0]).toMatch(/Elegí al menos un canal/);
  });

  it("números dentro de rango y enteros", () => {
    expect(validateEodReport(version(), fullDraft({ answers: { horas_trabajadas: 25, rendimiento: 7 } })).ok).toBe(false);
    expect(validateEodReport(version(), fullDraft({ answers: { horas_trabajadas: 7.5, rendimiento: 7 } })).ok).toBe(false);
  });

  it("una pregunta que ya no existe se descarta con aviso, sin perder el resto", () => {
    const result = validateEodReport(version(), fullDraft({ answers: { horas_trabajadas: 8, rendimiento: 7, vieja: "x" } }));
    expect(result.ok && result.report.discarded).toEqual(["vieja"]);
  });
});

describe("submitEodCore", () => {
  it("envía, guarda los totales y avisa a quien eligió el reporte", async () => {
    const { p, calls } = ports({ report: draftState(fullDraft()) });
    const result = await submitEodCore(p, base);
    expect(result).toMatchObject({ ok: true, reportId: "r1", edited: false });
    expect(calls.submit.mock.calls[0][0].metrics.total.links_enviados).toBe(12);
    expect(calls.submit.mock.calls[0][0].auditChanges).toBeNull();
    expect(calls.notify).toHaveBeenCalledOnce();
  });

  it("alguien que no está en la audiencia se rechaza sin escribir nada", async () => {
    const { p, calls } = ports({ config: { audience: { mode: "users", userIds: [BETO], roleIds: [] } }, report: draftState(fullDraft()) });
    const result = await submitEodCore(p, base);
    expect(result).toMatchObject({ ok: false, code: "not_available", error: "Este reporte no está disponible para vos" });
    expect(calls.submit).not.toHaveBeenCalled();
    const saved = await saveDraftCore(p, { ...base, data: fullDraft() });
    expect(saved).toMatchObject({ ok: false, code: "not_available" });
    expect(calls.saveDraft).not.toHaveBeenCalled();
  });

  it("un reporte no publicado no está disponible", async () => {
    const { p } = ports({ status: "paused", report: draftState(fullDraft()) });
    expect(await submitEodCore(p, base)).toMatchObject({ ok: false, code: "not_available" });
  });

  it("una fecha futura o más vieja que pastDays se rechaza", async () => {
    const { p, calls } = ports({ config: { pastDays: 2 }, report: draftState(fullDraft()) });
    expect(await submitEodCore(p, { ...base, reportDate: "2026-10-13" })).toMatchObject({ ok: false, code: "date" });
    expect(await submitEodCore(p, { ...base, reportDate: "2026-10-09" })).toMatchObject({ ok: false, code: "date" });
    expect(await submitEodCore(p, { ...base, reportDate: "2026-10-10" })).toMatchObject({ ok: true });
    expect(calls.submit).toHaveBeenCalledOnce();
  });

  it("uno por día: si ya está enviado, 'Ya enviaste el reporte de este día'", async () => {
    const report: EodReportState = { ...draftState(fullDraft()), status: "submitted" };
    const { p, calls } = ports({ report });
    expect(await submitEodCore(p, base)).toMatchObject({ ok: false, error: "Ya enviaste el reporte de este día" });
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it("se puede corregir: el reenvío es una corrección con lo que cambió para el historial", async () => {
    const before = validateEodReport(version(), fullDraft());
    if (!before.ok) throw new Error("fixture");
    const corrected = fullDraft();
    corrected.channels.instagram.answers.links_enviados = 9;
    const report: EodReportState = { id: "r1", status: "submitted", rev: 3, savedAt: null, draft: corrected, submitted: { answers: before.report.answers, channels: before.report.channels }, editCount: 0 };
    const { p, calls } = ports({ config: { reportMode: "editable" }, report });
    const result = await submitEodCore(p, base);
    expect(result).toMatchObject({ ok: true, edited: true });
    expect(calls.submit.mock.calls[0][0].auditChanges).toEqual({ "instagram.links_enviados": { old: 5, new: 9 } });
  });

  it("una revisión vieja (otra pestaña guardó) no envía", async () => {
    const { p, calls } = ports({ report: draftState(fullDraft(), 5) });
    expect(await submitEodCore(p, base)).toMatchObject({ ok: false, code: "conflict" });
    expect(calls.submit).not.toHaveBeenCalled();
  });

  it("si el aviso falla, el envío sigue siendo un éxito", async () => {
    const { p } = ports({ report: draftState(fullDraft()) });
    p.notify = async () => {
      throw new Error("campana caída");
    };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await submitEodCore(p, base)).toMatchObject({ ok: true });
    err.mockRestore();
  });
});

describe("saveDraftCore", () => {
  it("un borrador sin forma no llega a la base", async () => {
    const { p, calls } = ports();
    expect(await saveDraftCore(p, { ...base, data: { answers: { "Mala Clave": 1 }, channels: {} } })).toMatchObject({ ok: false, code: "invalid" });
    expect(await saveDraftCore(p, { ...base, rev: -1, data: fullDraft() })).toMatchObject({ ok: false, code: "invalid" });
    expect(calls.saveDraft).not.toHaveBeenCalled();
  });

  it("guarda con la revisión y el modo del reporte", async () => {
    const { p, calls } = ports();
    expect(await saveDraftCore(p, { ...base, data: fullDraft() })).toEqual({ ok: true, rev: 4, savedAt: "2026-10-12T20:00:00Z" });
    expect(calls.saveDraft.mock.calls[0][0]).toMatchObject({ rev: 3, reportMode: "single", userId: ANA });
  });
});

describe("textos", () => {
  it("el aviso de la campana", () => {
    expect(notificationTitle("Ana", "2026-10-12", false)).toBe("Ana envió su reporte del 12/10");
    expect(notificationTitle("Ana", "2026-10-12", true)).toBe("Ana corrigió su reporte del 12/10");
  });
  it("diffReports marca un canal que se sumó", () => {
    expect(diffReports({ answers: {}, channels: {} }, { answers: {}, channels: { tiktok: { label: "TikTok", answers: {} } } })).toEqual({ "canal.tiktok": { old: null, new: "elegido" } });
  });
});
