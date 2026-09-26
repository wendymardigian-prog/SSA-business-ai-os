import { describe, it, expect } from "vitest";
import {
  aggregatePostStatus,
  BOARD_COLUMNS,
  canTransition,
  columnFor,
  statusAfterMaterialChange,
  STATUS_LABELS,
  type ContentPermissions,
} from "./status";
import type { ContentPostStatus, SocialPostStatus } from "@/lib/types/database";

const member: ContentPermissions = { create: true, approve: false, publish: false, isAuthor: true };
const otroMember: ContentPermissions = { ...member, isAuthor: false };
const admin: ContentPermissions = { create: true, approve: true, publish: true, isAuthor: false };

const pubs = (...statuses: Array<SocialPostStatus | null>) => statuses.map((status) => ({ status }));

describe("columnas del tablero (F17)", () => {
  it("son siete, con Ideas primero y Publicado al final", () => {
    expect(BOARD_COLUMNS).toHaveLength(7);
    expect(BOARD_COLUMNS[0]).toBe("ideas");
    expect(BOARD_COLUMNS.at(-1)).toBe("published");
  });

  it("los estados del final comparten columna, con su badge", () => {
    // Tres columnas casi siempre vacias no ayudan a nadie.
    for (const status of ["publishing", "published", "partially_published", "failed"] as const) {
      expect(columnFor(status)).toBe("published");
    }
    expect(columnFor("draft")).toBe("draft");
    expect(columnFor("scheduled")).toBe("scheduled");
  });

  it("todo estado tiene nombre en castellano", () => {
    for (const status of Object.keys(STATUS_LABELS) as ContentPostStatus[]) {
      expect(STATUS_LABELS[status].length).toBeGreaterThan(3);
    }
  });
});

describe("quien puede mover una pieza", () => {
  it("un Member mueve lo suyo entre borrador, produccion y revision", () => {
    expect(canTransition(member, "draft", "in_production").ok).toBe(true);
    expect(canTransition(member, "in_production", "in_review").ok).toBe(true);
    expect(canTransition(member, "in_review", "draft").ok).toBe(true);
  });

  it("un Member no mueve la pieza de otro", () => {
    const result = canTransition(otroMember, "draft", "in_review");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("autor");
  });

  it("un Member no aprueba ni programa, y se le dice por que", () => {
    const aprobar = canTransition(member, "in_review", "approved");
    expect(aprobar).toEqual({ ok: false, reason: expect.stringContaining("Aprobar") });

    const programar = canTransition(member, "approved", "scheduled");
    expect(programar).toEqual({ ok: false, reason: expect.stringContaining("Programar") });
  });

  it("aprobar exige pasar por revision", () => {
    expect(canTransition(admin, "draft", "approved")).toEqual({
      ok: false,
      reason: expect.stringContaining("revision"),
    });
    expect(canTransition(admin, "in_review", "approved").ok).toBe(true);
  });

  it("devolver una pieza aprobada es de quien aprueba", () => {
    expect(canTransition(admin, "approved", "draft").ok).toBe(true);
    expect(canTransition(member, "approved", "draft").ok).toBe(false);
  });

  it("los estados que pone el sistema no se mueven a mano", () => {
    for (const to of ["published", "publishing", "failed", "partially_published"] as const) {
      const result = canTransition(admin, "approved", to);
      expect(result.ok, to).toBe(false);
      if (!result.ok) expect(result.reason).toContain("sistema");
    }
  });

  it("una pieza publicada no vuelve al tablero", () => {
    const result = canTransition(admin, "published", "draft");

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("archivarla");
  });

  it("quedarse en el mismo estado siempre vale", () => {
    expect(canTransition(otroMember, "draft", "draft").ok).toBe(true);
  });

  it("sin permiso de crear no se mueve nada", () => {
    const sinPermiso = { create: false, approve: false, publish: false, isAuthor: true };
    expect(canTransition(sinPermiso, "draft", "in_review").ok).toBe(false);
  });
});

describe("el estado que se deriva de las redes", () => {
  it("todas publicadas: publicada", () => {
    expect(aggregatePostStatus(pubs("published", "published"))).toBe("published");
  });

  it("todas fallidas: fallo", () => {
    expect(aggregatePostStatus(pubs("failed", "failed"))).toBe("failed");
  });

  it("una si y una no: publicada en parte", () => {
    expect(aggregatePostStatus(pubs("published", "failed"))).toBe("partially_published");
  });

  it("mientras algo este saliendo, la pieza esta publicando", () => {
    // Aunque otra red ya haya fallado: todavia puede terminar bien.
    expect(aggregatePostStatus(pubs("publishing", "failed"))).toBe("publishing");
    expect(aggregatePostStatus(pubs("publishing", "published"))).toBe("publishing");
  });

  it("con algo todavia programado sigue programada", () => {
    expect(aggregatePostStatus(pubs("scheduled", "scheduled"))).toBe("scheduled");
  });

  it("una publicada y otra todavia programada es parcial", () => {
    // Es el caso de la redistribucion: ya salio en una red y falta la otra.
    expect(aggregatePostStatus(pubs("published", "scheduled"))).toBe("partially_published");
  });

  it("las canceladas no cuentan", () => {
    expect(aggregatePostStatus(pubs("published", "cancelled"))).toBe("published");
  });

  it("sin ninguna red viva vuelve a aprobada", () => {
    // Desprogramar todo no deja la pieza en un limbo.
    expect(aggregatePostStatus([])).toBe("approved");
    expect(aggregatePostStatus(pubs("cancelled", "cancelled"))).toBe("approved");
    expect(aggregatePostStatus(pubs(null))).toBe("approved");
  });
});

describe("marcar el material", () => {
  it("marcarlo grabado empuja la pieza a produccion", () => {
    expect(statusAfterMaterialChange("draft", "grabado")).toBe("in_production");
    expect(statusAfterMaterialChange("draft", "listo")).toBe("in_production");
  });

  it("no toca una pieza que ya avanzo", () => {
    expect(statusAfterMaterialChange("in_review", "grabado")).toBe("in_review");
    expect(statusAfterMaterialChange("published", "listo")).toBe("published");
  });

  it("volver el material a pendiente no mueve la pieza", () => {
    expect(statusAfterMaterialChange("draft", "pendiente")).toBe("draft");
  });
});
