/**
 * Revision y aprobacion (F37).
 */

import { describe, it, expect } from "vitest";
import type { ContentPermissions } from "./status";
import { canApprove, canEditContent, canRequestReview, canReturn, statusAfterReview } from "./review";

const perms = (over: Partial<ContentPermissions> = {}): ContentPermissions => ({
  create: true,
  approve: false,
  publish: false,
  isAuthor: true,
  ...over,
});

describe("mandar a revision (F37)", () => {
  it("el autor puede desde produccion", () => {
    expect(canRequestReview(perms(), "in_production")).toEqual({ ok: true });
  });

  it("una que ya esta en revision no se manda de nuevo", () => {
    expect(canRequestReview(perms(), "in_review").ok).toBe(false);
  });

  it("alguien que no es el autor ni aprueba, no", () => {
    expect(canRequestReview(perms({ isAuthor: false }), "draft").ok).toBe(false);
  });
});

describe("aprobar (F37)", () => {
  it("quien aprueba, desde revision", () => {
    expect(canApprove(perms({ approve: true }), "in_review")).toEqual({ ok: true });
  });

  it("un Member no aprueba su propia pieza", () => {
    expect(canApprove(perms(), "in_review").ok).toBe(false);
  });

  it("no se aprueba algo que nadie mando a revisar", () => {
    expect(canApprove(perms({ approve: true }), "draft").ok).toBe(false);
  });
});

describe("devolver (F37)", () => {
  it("con un comentario, si", () => {
    expect(canReturn(perms({ approve: true }), "in_review", "Cambia el hook")).toEqual({ ok: true });
  });

  it("sin comentario, no: quien la escribio no sabria que cambiar", () => {
    const result = canReturn(perms({ approve: true }), "in_review", "  ");

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("que hay que cambiar");
  });

  it("una aprobada tambien se puede devolver", () => {
    expect(canReturn(perms({ approve: true }), "approved", "Me equivoque").ok).toBe(true);
  });
});

describe("editar el contenido (F37)", () => {
  it("con redes programadas se bloquea, y dice como destrabarlo", () => {
    // Si no, saldria algo distinto de lo que se aprobo.
    const result = canEditContent({
      perms: perms({ approve: true }),
      status: "scheduled",
      hasScheduledNetworks: true,
    });

    expect(result).toMatchObject({ ok: false });
    expect(result.ok === false && result.reason).toContain("Desprogramalas");
  });

  it("aprobada pero sin programar todavia se edita", () => {
    expect(
      canEditContent({ perms: perms({ approve: true }), status: "approved", hasScheduledNetworks: false }),
    ).toEqual({ ok: true });
  });

  it("una publicada no se edita", () => {
    expect(
      canEditContent({ perms: perms({ approve: true }), status: "published", hasScheduledNetworks: false }).ok,
    ).toBe(false);
  });

  it("un Member no edita la pieza de otro", () => {
    expect(
      canEditContent({ perms: perms({ isAuthor: false }), status: "draft", hasScheduledNetworks: false }).ok,
    ).toBe(false);
  });
});

describe("a donde va la pieza (F37)", () => {
  it("devolver la manda a produccion, no a borrador", () => {
    // El trabajo hecho sigue estando: solo falta corregir.
    expect(statusAfterReview("return")).toBe("in_production");
    expect(statusAfterReview("approve")).toBe("approved");
    expect(statusAfterReview("request")).toBe("in_review");
  });
});
