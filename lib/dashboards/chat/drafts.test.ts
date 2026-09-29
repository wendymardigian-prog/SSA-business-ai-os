import { describe, expect, it } from "vitest";
import { DIRECT_SEND_REFERENCE_PCT, draftAlertText, draftsCard, parseUneditedWeekly, showDraftAlert, type DraftsSqlRow } from "./drafts";

function row(over: Partial<DraftsSqlRow> = {}): DraftsSqlRow {
  return {
    approved_unchanged: 64,
    corrected: 19,
    answered_manually: 8,
    discarded: 5,
    window_missed: 4,
    agent_median_s: 38,
    approval_median_s: 840,
    pending_now: 5,
    pending_under_6h: 2,
    missed_last_7d: 2,
    unedited_weekly: [{ week_start: "2026-08-03", sent: 10, unedited: 6, pct: 60 }, { week_start: "2026-08-10", sent: 0, unedited: 0, pct: null }],
    ...over,
  };
}

describe("draftsCard", () => {
  it("los cinco resultados suman el total y dan porcentaje", () => {
    const card = draftsCard(row());
    expect(card.total).toBe(100);
    expect(card.outcomes.map((o) => o.percent)).toEqual([64, 19, 8, 5, 4]);
    expect(card.outcomes[0].label).toBe("Aprobada sin cambios");
  });

  it("sin borradores el porcentaje es null, no 0 %", () => {
    const card = draftsCard(row({ approved_unchanged: 0, corrected: 0, answered_manually: 0, discarded: 0, window_missed: 0 }));
    expect(card.total).toBe(0);
    expect(card.outcomes.every((o) => o.percent === null)).toBe(true);
  });

  it("una semana sin envios es un hueco en la mini linea", () => {
    expect(draftsCard(row()).uneditedWeekly).toEqual([60, null]);
  });

  it("marca cuando la ultima semana pasa la referencia del 85 %", () => {
    expect(draftsCard(row()).aboveReference).toBe(false);
    const alto = draftsCard(row({ unedited_weekly: [{ pct: 60 }, { pct: 88 }] }));
    expect(alto.aboveReference).toBe(true);
    expect(DIRECT_SEND_REFERENCE_PCT).toBe(85);
  });

  it("sin fila no explota y no inventa numeros", () => {
    const card = draftsCard(null);
    expect(card.total).toBe(0);
    expect(card.agentMedianSeconds).toBeNull();
    expect(card.uneditedWeekly).toEqual([]);
  });
});

describe("parseUneditedWeekly", () => {
  it("tolera basura de la base", () => {
    expect(parseUneditedWeekly(null)).toEqual([]);
    expect(parseUneditedWeekly("{}")).toEqual([]);
    expect(parseUneditedWeekly([{ pct: "72.5" }, { pct: "x" }])).toEqual([72.5, null]);
  });
});

describe("showDraftAlert", () => {
  it("se muestra con Todos, con el agente y con una persona", () => {
    expect(showDraftAlert({ hasDraftChannels: true, author: null, pendingNow: 3 })).toBe(true);
    expect(showDraftAlert({ hasDraftChannels: true, author: "agent", pendingNow: 3 })).toBe(true);
    expect(showDraftAlert({ hasDraftChannels: true, author: "8f1d3c2a-0000-4000-8000-000000000000", pendingNow: 3 })).toBe(true);
  });

  it("no se muestra filtrando por Automatizaciones o Fuera del sistema", () => {
    expect(showDraftAlert({ hasDraftChannels: true, author: "automations", pendingNow: 3 })).toBe(false);
    expect(showDraftAlert({ hasDraftChannels: true, author: "external", pendingNow: 3 })).toBe(false);
  });

  it("no se muestra sin canales en modo borrador ni sin pendientes", () => {
    expect(showDraftAlert({ hasDraftChannels: false, author: null, pendingNow: 3 })).toBe(false);
    expect(showDraftAlert({ hasDraftChannels: true, author: null, pendingNow: 0 })).toBe(false);
  });
});

describe("draftAlertText", () => {
  it("habla en plural y en singular", () => {
    const muchos = draftAlertText({ pendingNow: 5, pendingUnder6h: 2, missedLast7d: 2 });
    expect(muchos.headline).toBe("5 respuestas del agente esperando aprobación");
    expect(muchos.detail).toBe("2 con menos de 6 h de ventana · 2 ventanas perdidas en los últimos 7 días");

    const uno = draftAlertText({ pendingNow: 1, pendingUnder6h: 1, missedLast7d: 1 });
    expect(uno.headline).toBe("1 respuesta del agente esperando aprobación");
    expect(uno.detail).toBe("1 con menos de 6 h de ventana · 1 ventana perdida en los últimos 7 días");
  });

  it("sin nada por vencer no lo menciona", () => {
    expect(draftAlertText({ pendingNow: 3, pendingUnder6h: 0, missedLast7d: 0 }).detail).toBe(
      "0 ventanas perdidas en los últimos 7 días",
    );
  });
});
