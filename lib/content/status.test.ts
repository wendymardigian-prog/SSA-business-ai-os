import { describe, it, expect } from "vitest";
import {
  aggregatePostStatus,
  BOARD_COLUMNS,
  canTransition,
  columnFor,
  derivePieceStatus,
  isManualStatus,
  MANUAL_STATUSES,
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

// C4 (Contenido v4): se elimino "Estado del material" y el camino que
// marcarlo "Grabado" empujaba la pieza a En produccion sola
// (statusAfterMaterialChange, ya no existe). Ahora ese movimiento lo hace la
// persona con el dropdown, con la regla de siempre: "quien puede mover una
// pieza", arriba, ya prueba Borrador -> En produccion con un Member.

describe("C4 · el estado de la pieza desde TODAS sus redes", () => {
  const derive = (
    rows: Array<[string, SocialPostStatus | null]>,
    platforms: string[] = rows.map(([p]) => p),
    manual: ContentPostStatus = "approved",
  ) =>
    derivePieceStatus({
      platforms,
      publications: rows.map(([platform, status]) => ({ platform, status })),
      manual,
    });

  it("si cada red tiene su fila, da lo mismo que la regla de antes (F17)", () => {
    const S: SocialPostStatus[] = ["scheduled", "uploading", "publishing", "published", "failed"];
    for (const a of S) {
      for (const b of S) {
        for (const c of S) {
          const rows: Array<[string, SocialPostStatus]> = [
            ["instagram", a],
            ["tiktok", b],
            ["youtube", c],
          ];
          expect(derive(rows), `${a}/${b}/${c}`).toBe(
            aggregatePostStatus(rows.map(([, status]) => ({ status }))),
          );
        }
      }
    }
  });

  it("una marcada a mano y dos tentativas: publicada en parte, no publicada", () => {
    expect(derive([["instagram", "published"]], ["instagram", "youtube", "linkedin"], "draft")).toBe(
      "partially_published",
    );
  });

  it("todas marcadas a mano: publicada, sin tocar el dropdown", () => {
    expect(derive([["youtube", "published"], ["linkedin", "published"]], ["youtube", "linkedin"], "draft")).toBe(
      "published",
    );
  });

  it("una programada y el resto tentativas: programada", () => {
    expect(derive([["instagram", "scheduled"]], ["instagram", "youtube"])).toBe("scheduled");
  });

  it("todo tentativo: vale el estado que eligio la persona", () => {
    expect(derive([], ["instagram", "youtube"], "in_production")).toBe("in_production");
    expect(derive([["instagram", "cancelled"]], ["instagram"], "draft")).toBe("draft");
  });

  it("una fallida y otra tentativa: fallo (que no se pierda el aviso)", () => {
    expect(derive([["instagram", "failed"]], ["instagram", "youtube"])).toBe("failed");
  });

  it("una fila viva de una red que ya no esta en la pieza sigue contando", () => {
    expect(derive([["tiktok", "published"]], ["instagram"], "approved")).toBe("partially_published");
  });

  it("sin redes: el estado elegido", () => {
    expect(derive([], [], "in_review")).toBe("in_review");
  });
});

describe("C4 · que estados se eligen y cuales se derivan", () => {
  it("se eligen los cuatro primeros", () => {
    expect(MANUAL_STATUSES).toEqual(["draft", "in_production", "in_review", "approved"]);
    for (const s of ["scheduled", "publishing", "published", "partially_published", "failed"]) {
      expect(isManualStatus(s)).toBe(false);
    }
  });
});
