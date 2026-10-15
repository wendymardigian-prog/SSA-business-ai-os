import { describe, expect, it } from "vitest";
import { buildResponsible } from "./responsible";

const members = [
  { userId: "u1", name: "Ana" },
  { userId: "u2", name: "Beto" },
];

describe("buildResponsible", () => {
  it("una publicación con pieza muestra el responsable de la pieza, solo lectura", () => {
    const r = buildResponsible({
      contentPostId: "p1",
      postAssignedTo: "u2", // se ignora: manda la pieza
      piece: { title: "3 errores", assignedTo: "u1" },
      members,
      canAssign: true,
    });
    expect(r).toEqual({ mode: "piece", pieceId: "p1", pieceTitle: "3 errores", assignee: { id: "u1", name: "Ana" } });
  });

  it("la pieza sin responsable o con alguien que ya no está no inventa un nombre", () => {
    expect(buildResponsible({ contentPostId: "p1", postAssignedTo: null, piece: { title: null, assignedTo: null }, members, canAssign: true })).toMatchObject({
      mode: "piece",
      assignee: null,
    });
    expect(buildResponsible({ contentPostId: "p1", postAssignedTo: null, piece: { title: "x", assignedTo: "u9" }, members, canAssign: true })).toMatchObject({
      assignee: null,
    });
  });

  it("sin pieza y con permiso: el selector trae el equipo", () => {
    const r = buildResponsible({ contentPostId: null, postAssignedTo: "u2", piece: null, members, canAssign: true });
    expect(r).toEqual({
      mode: "post",
      assignee: { id: "u2", name: "Beto" },
      canAssign: true,
      team: [
        { id: "u1", name: "Ana" },
        { id: "u2", name: "Beto" },
      ],
    });
  });

  it("sin pieza y sin permiso: se ve quién es pero no se reparte el equipo", () => {
    const r = buildResponsible({ contentPostId: null, postAssignedTo: "u1", piece: null, members, canAssign: false });
    expect(r).toEqual({ mode: "post", assignee: { id: "u1", name: "Ana" }, canAssign: false, team: [] });
  });

  it("sin responsable: assignee null", () => {
    const r = buildResponsible({ contentPostId: null, postAssignedTo: null, piece: null, members, canAssign: false });
    expect(r).toMatchObject({ mode: "post", assignee: null });
  });
});
