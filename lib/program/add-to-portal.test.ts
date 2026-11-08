// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { chunkTranscript } from "./transcript";
import { addToPortalPlan, callTranscriptToVtt, suggestOccurrence, timestampSeconds, type CallForPortal } from "./add-to-portal";

const P = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const S = "33333333-3333-4333-8333-333333333333";
const call: CallForPortal = {
  id: "44444444-4444-4444-8444-444444444444",
  title: "Clase 3",
  recorded_at: "2026-11-04T01:03:00Z",
  transcript: [
    { text: "Hola a todos", timestamp: "00:00:05", speaker: { display_name: "Ana" } },
    { text: "Arrancamos con el tema", timestamp: "00:12:30", speaker: { display_name: "Ana" } },
  ],
};

describe("addToPortalPlan", () => {
  it("como grabación de una clase en vivo: un solo paso con la grabación elegida", () => {
    const r = addToPortalPlan(call, { productId: P, target: { kind: "live", sessionId: S, occursOn: "2026-11-03" }, title: "", active: true, saveTranscript: true });
    expect(r).toEqual({ ok: true, warning: null, steps: [{ op: "live_date", sessionId: S, occursOn: "2026-11-03", callId: call.id, recordingUrl: null }] });
  });
  it("como clase nueva en un módulo nuevo, activa y con transcripción", () => {
    const r = addToPortalPlan(call, { productId: P, target: { kind: "lesson", newModuleTitle: "Grabaciones" }, title: " Clase 3 ", description: "Resumen", videoUrl: "https://youtu.be/dQw4w9WgXcQ", active: true, saveTranscript: true });
    if (!r.ok) throw new Error(r.issues.join());
    expect(r.steps.map((s) => s.op)).toEqual(["create_module", "create_lesson", "update_lesson", "activate_lesson", "index_transcript"]);
    expect(r.steps[1]).toEqual({ op: "create_lesson", parent: "new_module", title: "Clase 3" });
    expect(r.steps[2]).toMatchObject({ op: "update_lesson", patch: { source_call_id: call.id, description: "Resumen", video_url: "https://youtu.be/dQw4w9WgXcQ" } });
  });
  it("en un módulo que existe, inactiva y sin transcripción", () => {
    const r = addToPortalPlan(call, { productId: P, target: { kind: "lesson", parentId: M }, title: "Clase 3", active: false, saveTranscript: false });
    if (!r.ok) throw new Error();
    expect(r.steps.map((s) => s.op)).toEqual(["create_lesson", "update_lesson"]);
  });
  it("dice qué falta", () => {
    const r = addToPortalPlan(call, { productId: "x", target: { kind: "lesson", newModuleTitle: " " }, title: "", videoUrl: "no es un link", active: true, saveTranscript: false });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues.length).toBe(4);
  });
});

describe("la transcripción con sus minutos", () => {
  it("timestampSeconds", () => {
    expect(timestampSeconds("01:02:03")).toBe(3723);
    expect(timestampSeconds("12:30")).toBe(750);
    expect(timestampSeconds("")).toBeNull();
  });
  it("el .vtt guarda el segundo de cada parte (start_second)", () => {
    const vtt = callTranscriptToVtt(call.transcript);
    expect(vtt.startsWith("WEBVTT")).toBe(true);
    const chunks = chunkTranscript(vtt, 15);
    expect(chunks[0]).toEqual({ text: "Ana: Hola a todos", startSecond: 5 });
    expect(chunks[chunks.length - 1].startSecond).toBe(750);
  });
  it("sin tiempos, texto suelto; vacía, nada", () => {
    expect(callTranscriptToVtt([{ text: "uno", timestamp: "" }, { text: "dos", timestamp: "" }])).toBe("uno\ndos");
    expect(callTranscriptToVtt([])).toBe("");
  });
});

describe("suggestOccurrence", () => {
  const occ = [
    { id: "a", starts_at: "2026-11-04T01:00:00Z", status: "normal" },
    { id: "b", starts_at: "2026-11-11T01:00:00Z", status: "normal" },
    { id: "c", starts_at: "2026-11-04T01:00:00Z", status: "cancelled" },
  ];
  it("la que empieza más cerca, sin canceladas y a menos de 12 horas", () => {
    expect(suggestOccurrence("2026-11-04T01:03:00Z", occ)?.id).toBe("a");
    expect(suggestOccurrence("2026-11-07T01:00:00Z", occ)).toBeNull();
  });
});
