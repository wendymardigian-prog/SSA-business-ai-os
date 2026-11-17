// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { transcriptBadge } from "./transcript-status";

describe("el estado de la transcripción en el editor", () => {
  it("sin transcripción, falta", () => expect(transcriptBadge(null)).toMatchObject({ tone: "missing", label: "Falta" }));
  it("lista: partes y fecha", () =>
    expect(transcriptBadge({ status: "ready", chunks: 134, at: "2026-11-17T20:10:00Z" })).toEqual({ tone: "ok", label: "Cargada", detail: "Lista para el tutor · 134 partes · actualizada el 17/11/2026" }));
  it("una sola parte, sin fecha", () => expect(transcriptBadge({ status: "ready", chunks: 1, at: null }).detail).toBe("Lista para el tutor · 1 parte"));
  it("guardada pero sin indexar avisa", () => expect(transcriptBadge({ status: "failed", chunks: null, at: null })).toMatchObject({ tone: "warn", label: "Sin indexar" }));
});
