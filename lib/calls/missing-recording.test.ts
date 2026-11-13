import { describe, expect, it } from "vitest";
import { bookingsToNotify, missingRecordingDecision, missingRecordingWindow, type MissingRecordingCandidate } from "./missing-recording";

const NOW = new Date("2026-11-12T17:00:00Z");
const base = (over: Partial<MissingRecordingCandidate> = {}): MissingRecordingCandidate => ({
  bookingId: "b1",
  endAt: "2026-11-12T15:00:00Z", // terminó hace 2 h
  status: "scheduled",
  areaKey: "servicio",
  typeKey: null,
  contactHasActiveService: true,
  hasRecording: false,
  hostHasFathom: true,
  alreadyNotified: false,
  ...over,
});

describe("missingRecordingDecision (reloj simulado)", () => {
  it("avisa a las 2 horas exactas de terminada", () => {
    expect(missingRecordingDecision(base(), NOW)).toEqual({ notify: true });
  });
  it("no antes de las 2 horas ni después de las 26", () => {
    expect(missingRecordingDecision(base({ endAt: "2026-11-12T15:30:00Z" }), NOW)).toEqual({ notify: false, reason: "too_early" });
    expect(missingRecordingDecision(base({ endAt: "2026-11-11T14:00:00Z" }), NOW)).toEqual({ notify: false, reason: "too_late" });
    expect(missingRecordingDecision(base({ endAt: "2026-11-11T15:00:00Z" }), NOW)).toEqual({ notify: true });
  });
  it("excluye Clase, otras áreas, canceladas y «no se presentó»", () => {
    expect(missingRecordingDecision(base({ typeKey: "servicio.clase" }), NOW)).toMatchObject({ reason: "not_service" });
    expect(missingRecordingDecision(base({ areaKey: "ventas" }), NOW)).toMatchObject({ reason: "not_service" });
    expect(missingRecordingDecision(base({ status: "cancelled_by_host" }), NOW)).toMatchObject({ reason: "cancelled" });
    expect(missingRecordingDecision(base({ status: "no_show" }), NOW)).toMatchObject({ reason: "no_show" });
  });
  it("sin servicio activo, con grabación, sin Fathom o ya avisada: no", () => {
    expect(missingRecordingDecision(base({ contactHasActiveService: false }), NOW)).toMatchObject({ reason: "no_active_service" });
    expect(missingRecordingDecision(base({ hasRecording: true }), NOW)).toMatchObject({ reason: "has_recording" });
    expect(missingRecordingDecision(base({ hostHasFathom: false }), NOW)).toMatchObject({ reason: "no_fathom" });
    expect(missingRecordingDecision(base({ alreadyNotified: true }), NOW)).toMatchObject({ reason: "already_notified" });
  });
});

describe("bookingsToNotify", () => {
  it("una sola vez por agenda", () => {
    expect(bookingsToNotify([base(), base(), base({ bookingId: "b2", hasRecording: true })], NOW)).toEqual(["b1"]);
  });
  it("la ventana va de 26 a 2 horas atrás", () => {
    expect(missingRecordingWindow(NOW)).toEqual({ from: "2026-11-11T15:00:00.000Z", to: "2026-11-12T15:00:00.000Z" });
  });
});
