import { describe, expect, it } from "vitest";
import { leadsForPublication, pieceLeads, sumLeads, type LeadTouch } from "./piece-leads";

const PIECE = "piece-1";
const IG = "sp-ig";
const TT = "sp-tt";
const PUBLICATIONS = [IG, TT];

function touch(overrides: Partial<LeadTouch> & { contactId: string }): LeadTouch {
  return {
    occurredAt: "2026-10-01T10:00:00Z",
    origin: "comment",
    medium: "comment",
    socialPostId: IG,
    contentPostId: PIECE,
    ...overrides,
  };
}

describe("pieceLeads (F104)", () => {
  it("cuenta el contacto cuyo PRIMER toque es un comentario en una publicacion de la pieza", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [
        touch({ contactId: "a", socialPostId: IG }),
        touch({ contactId: "b", socialPostId: TT }),
        touch({ contactId: "c", socialPostId: TT }),
      ],
    });

    expect(result.total).toBe(3);
    expect(result.byPublication).toEqual({ [IG]: 1, [TT]: 2 });
    expect(result.unassigned).toBe(0);
  });

  it("un contacto que comento en DOS publicaciones de la misma pieza cuenta UNA sola vez", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [
        touch({ contactId: "a", socialPostId: IG, occurredAt: "2026-10-01T10:00:00Z" }),
        touch({ contactId: "a", socialPostId: TT, occurredAt: "2026-10-02T10:00:00Z" }),
      ],
    });

    expect(result.total).toBe(1);
    // Y se queda con la publicacion donde LLEGO, la del primer comentario.
    expect(result.byPublication).toEqual({ [IG]: 1 });
  });

  it("el mismo toque repetido (una relectura) tampoco suma dos veces", () => {
    const t = touch({ contactId: "a" });
    const result = pieceLeads({ pieceId: PIECE, publicationIds: PUBLICATIONS, touches: [t, { ...t }] });
    expect(result.total).toBe(1);
  });

  it("si el primer toque del contacto es ANTERIOR al comentario, no es un lead de la pieza", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [
        // Ya era contacto: llego por un DM el 20 de septiembre.
        touch({
          contactId: "a",
          origin: "dm",
          medium: "dm",
          socialPostId: null,
          contentPostId: null,
          occurredAt: "2026-09-20T10:00:00Z",
        }),
        touch({ contactId: "a", socialPostId: IG, occurredAt: "2026-10-01T10:00:00Z" }),
      ],
    });

    expect(result.total).toBe(0);
    expect(result.byPublication).toEqual({});
  });

  it("no se atribuye un lead desde un mensaje directo, aunque el toque mencione la pieza", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [touch({ contactId: "a", origin: "dm", medium: "dm" })],
    });

    expect(result.total).toBe(0);
  });

  it("un comentario en una publicacion de OTRA pieza no cuenta", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [touch({ contactId: "a", socialPostId: "sp-otra", contentPostId: "otra-pieza" })],
    });

    expect(result.total).toBe(0);
  });

  it("si el toque trae la pieza pero la publicacion ya no esta, cuenta en el total y queda 'sin red'", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [touch({ contactId: "a", socialPostId: "sp-borrada" })],
    });

    expect(result.total).toBe(1);
    expect(result.unassigned).toBe(1);
    expect(result.byPublication).toEqual({});
  });

  it("un toque que solo trae la publicacion (sin la pieza) tambien se reconoce", () => {
    const result = pieceLeads({
      pieceId: PIECE,
      publicationIds: PUBLICATIONS,
      touches: [touch({ contactId: "a", contentPostId: null, socialPostId: TT })],
    });

    expect(result.total).toBe(1);
    expect(result.byPublication).toEqual({ [TT]: 1 });
  });

  it("sin toques el total es cero y no hay nada por red", () => {
    const result = pieceLeads({ pieceId: PIECE, publicationIds: PUBLICATIONS, touches: [] });
    expect(result).toEqual({ total: 0, byPublication: {}, unassigned: 0 });
  });
});

describe("leadsForPublication / sumLeads (F104)", () => {
  const result = pieceLeads({
    pieceId: PIECE,
    publicationIds: PUBLICATIONS,
    touches: [touch({ contactId: "a", socialPostId: IG })],
  });

  it("una publicacion sin leads es un cero REAL cuando ya salio", () => {
    expect(leadsForPublication(result, IG)).toBe(1);
    expect(leadsForPublication(result, TT)).toBe(0);
  });

  it("una red que no deja comentar en el sistema no muestra cero: muestra el hueco", () => {
    expect(leadsForPublication(result, TT, { tracked: false })).toBeNull();
  });

  it("sumLeads suma por publicacion e ignora los huecos", () => {
    expect(sumLeads([2, null, 3])).toBe(5);
    expect(sumLeads([null, null])).toBeNull();
    expect(sumLeads([])).toBeNull();
  });
});
