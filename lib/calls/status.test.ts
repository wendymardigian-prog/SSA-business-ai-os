import { describe, expect, it } from "vitest";
import { canAnalyze, statusLabel, statusReasonText } from "./status";

const base = { status: "pending" as const, hasArea: true, noShow: false, hasProfile: true, hasTranscript: true, canEdit: true };

describe("statusLabel / statusReasonText", () => {
  it("cada estado tiene su etiqueta en castellano", () => {
    expect(statusLabel("classifying")).toBe("Clasificando…");
    expect(statusLabel("needs_review")).toBe("Por revisar");
    expect(statusLabel("analyzed")).toBe("Analizada");
    expect(statusLabel("not_applicable")).toBe("No aplica");
    expect(statusLabel("error")).toBe("Error");
    expect(statusLabel(null)).toBe("Pendiente");
  });
  it("el motivo se dice en palabras; uno desconocido no se inventa", () => {
    expect(statusReasonText("pending", "manual")).toBe("Esperando que alguien la analice");
    expect(statusReasonText("pending", "budget")).toContain("tope");
    expect(statusReasonText("pending", "raro")).toBeNull();
    expect(statusReasonText("pending", null)).toBeNull();
  });
});

describe("canAnalyze", () => {
  it("una grabacion pendiente cuyo tipo tiene analizador se puede analizar", () => {
    expect(canAnalyze(base)).toEqual({ ok: true });
  });
  it("sin analizador no se analiza, y lo dice", () => {
    expect(canAnalyze({ ...base, hasProfile: false }).reason).toBe("Falta configurar el analizador de este tipo");
  });
  it("sin permiso, sin transcripcion, ya analizandose o sin clasificar: no, con su motivo", () => {
    expect(canAnalyze({ ...base, canEdit: false }).ok).toBe(false);
    expect(canAnalyze({ ...base, hasTranscript: false }).reason).toContain("transcripción");
    expect(canAnalyze({ ...base, status: "analyzing" }).reason).toContain("analizando");
    expect(canAnalyze({ ...base, status: "classifying" }).ok).toBe(false);
    expect(canAnalyze({ ...base, hasArea: false }).reason).toContain("área");
    expect(canAnalyze({ ...base, noShow: true }).reason).toBe("Nadie se presentó");
  });
  it("una ya analizada o con error se puede volver a analizar (regenerar es otra accion)", () => {
    expect(canAnalyze({ ...base, status: "error" }).ok).toBe(true);
    expect(canAnalyze({ ...base, status: "analyzed" }).ok).toBe(true);
  });
  it("una que no tenia analizador se puede analizar apenas lo tiene", () => {
    expect(canAnalyze({ ...base, status: "not_applicable" }).ok).toBe(true);
  });
});
