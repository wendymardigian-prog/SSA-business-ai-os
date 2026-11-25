import { describe, expect, it } from "vitest";
import { applyCallFilters, callFiltersToParams, cleanCallTitle, countActiveCallFilters, EMPTY_FILTERS, parseCallFilters } from "./list";
import { cardParticipants, participantsLine } from "./participants";
import { BULK_ANALYZE_LIMIT, BULK_TYPE_LIMIT, bulkAnalyzeSummary, planBulkAnalyze } from "./bulk";
import { RECLASSIFY_LIMIT, reclassifyDecision, reclassifySummary } from "./reclassify-request";
import { analyzerAgentForArea, areaKeyForAnalyzerAgent } from "./area-analyzers";
import { ANALYZE_PENDING_LIMIT } from "./edit-rules";

const HOST = "11111111-1111-4111-8111-111111111111";
const MATE = "22222222-2222-4222-8222-222222222222";
const members = [
  { userId: HOST, name: "Laura Prueba", email: "laura@ejemplo.test" },
  { userId: MATE, name: "Pablo Prueba", email: "pablo@ejemplo.test" },
];

describe("cleanCallTitle", () => {
  it("quita la marca repetida al final", () => {
    expect(cleanCallTitle("Ana Cliente - Reunión | Mi Marca", "Mi Marca")).toBe("Ana Cliente - Reunión");
  });
  it("quita el guion suelto del principio", () => {
    expect(cleanCallTitle("- Reunión | Mi Marca", "Mi Marca")).toBe("Reunión");
  });
  it("no deja el título vacío", () => {
    expect(cleanCallTitle("Mi Marca", "Mi Marca")).toBe("Mi Marca");
  });
  it("sin marca o sin título no cambia nada", () => {
    expect(cleanCallTitle("Reunión de Zoom", "")).toBe("Reunión de Zoom");
    expect(cleanCallTitle(null, "X")).toBe("");
  });
  it("una marca con caracteres especiales no rompe la expresión", () => {
    expect(cleanCallTitle("Kickoff | A+B (Co.)", "A+B (Co.)")).toBe("Kickoff");
  });
});

describe("cardParticipants", () => {
  it("el host no se repite como invitado y un compañero lleva su persona", () => {
    const p = cardParticipants({
      hostUserId: HOST,
      attendees: [
        { name: "Laura Prueba", email: "LAURA@ejemplo.test" },
        { name: "Pablo Prueba", email: "pablo@ejemplo.test" },
        { name: null, email: "ana@cliente.test" },
        { name: null, email: "ana@cliente.test" },
      ],
      contact: null,
      members,
    });
    expect(p.host?.label).toBe("Laura Prueba");
    expect(p.guests.map((g) => g.label)).toEqual(["Pablo Prueba", "ana@cliente.test"]);
    expect(p.guests[0].userId).toBe(MATE);
  });
  it("el contacto vinculado usa su nombre y su foto", () => {
    const p = cardParticipants({
      hostUserId: HOST,
      attendees: [{ name: null, email: "ana@cliente.test" }],
      contact: { name: "Ana Cliente", email: "ana@cliente.test", avatarUrl: "https://x/a.png" },
      members,
    });
    expect(p.guests).toEqual([{ label: "Ana Cliente", email: "ana@cliente.test", userId: null, avatarUrl: "https://x/a.png" }]);
  });
  it("una grabación sin lista de invitados tiene al contacto como invitado", () => {
    const p = cardParticipants({ hostUserId: HOST, attendees: null, contact: { name: "Ana", email: null, avatarUrl: null }, members });
    expect(p.guests.map((g) => g.label)).toEqual(["Ana"]);
  });
  it("host que no es del equipo: su correo", () => {
    const p = cardParticipants({ hostUserId: null, hostEmail: "otro@x.test", attendees: [{ email: "otro@x.test" }], contact: null, members });
    expect(p.host?.label).toBe("otro@x.test");
    expect(p.guests).toEqual([]);
  });
  it("sin datos no inventa a nadie", () => {
    expect(cardParticipants({ hostUserId: null, attendees: [{}, "x", null], contact: null, members })).toEqual({ host: null, guests: [] });
  });
});

describe("participantsLine", () => {
  const g = (label: string) => ({ label, email: null, userId: null, avatarUrl: null });
  it("resume con «y N más»", () => {
    expect(participantsLine([])).toBeNull();
    expect(participantsLine([g("Ana")])).toBe("Con Ana");
    expect(participantsLine([g("Ana"), g("Bea")])).toBe("Con Ana y Bea");
    expect(participantsLine([g("Ana"), g("Bea"), g("Ceci")])).toBe("Con Ana, Bea y 1 más");
    expect(participantsLine([g("Ana"), g("Bea"), g("Ceci"), g("Dani")])).toBe("Con Ana, Bea y 2 más");
  });
});

describe("filtro de internas", () => {
  const ctx = { closerIds: [] };
  it("se lee de la URL, cuenta como filtro y vuelve a la URL", () => {
    const f = parseCallFilters({ internas: "ocultar" }, ctx);
    expect(f.internas).toBe("ocultar");
    expect(countActiveCallFilters(f)).toBe(1);
    expect(callFiltersToParams(f).get("internas")).toBe("ocultar");
    expect(parseCallFilters({ internas: "cualquiera" }, ctx).internas).toBe("");
    expect(EMPTY_FILTERS.internas).toBe("");
  });
  function spy() {
    const calls: Array<[string, string, unknown]> = [];
    const q = {
      eq: (c: string, v: unknown) => (calls.push(["eq", c, v]), q),
      is: () => q,
      not: () => q,
      gte: () => q,
      lte: () => q,
      or: (f: string) => (calls.push(["or", f, null]), q),
    };
    return { q, calls };
  }
  it("«solo» pide el área Equipo y «ocultar» la deja afuera, en la consulta", () => {
    const solo = spy();
    applyCallFilters(solo.q as never, parseCallFilters({ internas: "solo" }, ctx), { timeZone: "UTC", teamAreaId: "area-equipo" });
    expect(solo.calls).toEqual([["eq", "area_id", "area-equipo"]]);
    const ocultar = spy();
    applyCallFilters(ocultar.q as never, parseCallFilters({ internas: "ocultar" }, ctx), { timeZone: "UTC", teamAreaId: "area-equipo" });
    expect(ocultar.calls).toEqual([["or", "area_id.is.null,area_id.neq.area-equipo", null]]);
  });
  it("sin área Equipo, «solo» no trae nada y «ocultar» no cambia nada", () => {
    const solo = spy();
    applyCallFilters(solo.q as never, parseCallFilters({ internas: "solo" }, ctx), { timeZone: "UTC" });
    expect(solo.calls).toEqual([["eq", "area_id", "00000000-0000-0000-0000-000000000000"]]);
    const ocultar = spy();
    applyCallFilters(ocultar.q as never, parseCallFilters({ internas: "ocultar" }, ctx), { timeZone: "UTC" });
    expect(ocultar.calls).toEqual([]);
  });
});

describe("selección múltiple", () => {
  it("el tope es el del servidor", () => {
    expect(BULK_ANALYZE_LIMIT).toBe(ANALYZE_PENDING_LIMIT);
    expect(BULK_TYPE_LIMIT).toBe(30);
    expect(RECLASSIFY_LIMIT).toBe(30);
  });
  it("manda las primeras 20 y pide el tipo de las que no lo tienen", () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ callId: `c${i}`, needsType: i % 5 === 0 }));
    const plan = planBulkAnalyze(items);
    expect(plan.toAnalyze).toHaveLength(20);
    expect(plan.overLimit).toBe(3);
    expect(plan.needType.map((c) => c.callId)).toEqual(["c0", "c5", "c10", "c15"]);
  });
  it("el aviso dice cuántas y por qué no las otras", () => {
    expect(bulkAnalyzeSummary({ queued: 3, skipped: { analyzed: 2, no_transcript: 1 }, typeErrors: 0 })).toBe(
      "Se analizarán 3 grabaciones (una cada 30 segundos). 2 ya estaban analizadas; 1 no tiene transcripción.",
    );
    expect(bulkAnalyzeSummary({ queued: 0, skipped: {}, typeErrors: 1 }, 2)).toBe(
      "No se encoló ninguna para analizar. 1 no pudo guardar el tipo; 2 quedaron fuera por el tope de 20.",
    );
    expect(bulkAnalyzeSummary({ queued: 1, skipped: {}, typeErrors: 0 })).toBe("Se analizará 1 grabación.");
  });
});

describe("volver a clasificar", () => {
  it("lo que eligió una persona no se toca", () => {
    expect(reclassifyDecision({ classification_source: "human", analysis_status: "needs_review" })).toEqual({ action: "skip", why: "human" });
  });
  it("por revisar, pendiente, no aplica o con error vuelve a la cola", () => {
    for (const status of ["needs_review", "pending", "not_applicable", "error"]) {
      expect(reclassifyDecision({ classification_source: "connection", analysis_status: status })).toEqual({ action: "requeue" });
    }
    expect(reclassifyDecision({ classification_source: null, analysis_status: "needs_review" })).toEqual({ action: "requeue" });
  });
  it("lo analizado conserva su análisis y lo que está en curso no se pisa", () => {
    expect(reclassifyDecision({ classification_source: "ai", analysis_status: "analyzed" })).toEqual({ action: "skip", why: "analyzed" });
    expect(reclassifyDecision({ classification_source: "ai", analysis_status: "analyzing" })).toEqual({ action: "skip", why: "busy" });
    expect(reclassifyDecision({ classification_source: null, analysis_status: "classifying" })).toEqual({ action: "skip", why: "busy" });
  });
  it("el aviso cuenta lo que se encoló y por qué no el resto", () => {
    expect(reclassifySummary({ queued: 3, skipped: {} })).toBe("3 grabaciones vuelven a clasificarse.");
    expect(reclassifySummary({ queued: 1, skipped: { human: 2, analyzed: 1 } })).toBe("1 grabación vuelve a clasificarse; 2 tienen el tipo elegido a mano; 1 ya está analizada.");
  });
});

describe("analizador por área", () => {
  it("cada área tiene su agente y solo el suyo", () => {
    expect(analyzerAgentForArea("servicio")).toBe("service_analyzer");
    expect(analyzerAgentForArea("ventas")).toBe("sales_analyzer");
    expect(analyzerAgentForArea("equipo")).toBeNull();
    expect(analyzerAgentForArea(null)).toBeNull();
  });
  it("de vuelta: el agente dice qué área analiza", () => {
    expect(areaKeyForAnalyzerAgent("service_analyzer")).toBe("servicio");
    expect(areaKeyForAnalyzerAgent("sales_analyzer")).toBe("ventas");
    expect(areaKeyForAnalyzerAgent("chat")).toBeNull();
  });
});
