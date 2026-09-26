import { describe, it, expect } from "vitest";
import { draftFromIdea, ideaActions, ideaWaitingLabel, validateIdea } from "./ideas";

const idea = {
  id: "idea-1",
  title: "Como cobrar sin miedo",
  hook: "Si te da vergüenza decir el precio, mira esto",
  angle: "Desde la objecion mas comun",
  format: "reel",
  notes: "Usar el caso de la clienta de marzo",
  status: "nueva" as const,
};

describe("validar una idea (F19)", () => {
  it("el titulo es lo unico obligatorio", () => {
    expect(validateIdea({ title: "  Una idea  " })).toEqual({
      ok: true,
      idea: expect.objectContaining({ title: "Una idea" }),
    });
    expect(validateIdea({ title: "   " })).toEqual({ ok: false, error: expect.any(String) });
  });

  it("los campos vacios quedan en null, no en cadena vacia", () => {
    // Asi "sin angulo" se distingue de "angulo en blanco" al leer la fila.
    const result = validateIdea({ title: "x", angle: "   ", hook: "" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.idea.angle).toBeNull();
    expect(result.idea.hook).toBeNull();
  });

  it("un titulo enorme se rechaza", () => {
    expect(validateIdea({ title: "a".repeat(201) }).ok).toBe(false);
  });
});

describe("el post que sale de aprobar", () => {
  it("queda vinculado a la idea y hereda titulo y formato", () => {
    const post = draftFromIdea(idea);

    expect(post.idea_id).toBe("idea-1");
    expect(post.title).toBe("Como cobrar sin miedo");
    expect(post.format).toBe("reel");
  });

  it("el hook de la idea es el hook del guion", () => {
    expect(draftFromIdea(idea).copy.hook).toContain("vergüenza");
  });

  it("el guion y el caption arrancan vacios: no se inventan", () => {
    const post = draftFromIdea(idea);

    expect(post.copy.body).toBe("");
    expect(post.copy.cta).toBe("");
    expect(post.caption).toBeNull();
  });

  it("el angulo y las notas quedan como notas de grabacion", () => {
    // Si no, se pierden al aprobar, que es justo cuando hacen falta.
    const notas = draftFromIdea(idea).copy.recording_notes;

    expect(notas).toContain("objecion");
    expect(notas).toContain("clienta de marzo");
  });

  it("una idea pelada igual produce un post usable", () => {
    const post = draftFromIdea({ ...idea, hook: null, angle: null, notes: null, format: null });

    expect(post.copy.hook).toBe("");
    expect(post.copy.recording_notes).toBe("");
  });
});

describe("los botones de una tarjeta de idea", () => {
  const conIa = { approve: true, ai: true, aiAvailable: true };

  it("quien aprueba ve aprobar, aprobar y producir, y descartar", () => {
    expect(ideaActions("nueva", conIa).map((a) => a.action)).toEqual([
      "approve",
      "approve_and_generate",
      "discard",
    ]);
  });

  it("quien no aprueba no ve ninguno", () => {
    expect(ideaActions("nueva", { approve: false, ai: true, aiAvailable: true })).toEqual([]);
  });

  it("sin permiso de IA, no aparece el de producir copy", () => {
    expect(ideaActions("nueva", { approve: true, ai: false, aiAvailable: true }).map((a) => a.action)).toEqual([
      "approve",
      "discard",
    ]);
  });

  it("sin proveedor de IA conectado aparece deshabilitado y dice como arreglarlo", () => {
    // Esconderlo no enseña que la funcion existe.
    const accion = ideaActions("nueva", { approve: true, ai: true, aiAvailable: false }).find(
      (a) => a.action === "approve_and_generate",
    );

    expect(accion?.disabledReason).toContain("Integraciones");
  });

  it("una idea ya aprobada o descartada no ofrece nada", () => {
    expect(ideaActions("aprobada", conIa)).toEqual([]);
    expect(ideaActions("descartada", conIa)).toEqual([]);
  });

  it("a quien no aprueba se le dice que su idea esta esperando", () => {
    expect(ideaWaitingLabel("nueva", false)).toBe("Esperando aprobacion");
    expect(ideaWaitingLabel("nueva", true)).toBeNull();
    expect(ideaWaitingLabel("aprobada", false)).toBeNull();
  });
});
