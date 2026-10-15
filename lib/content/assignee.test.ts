import { describe, expect, it } from "vitest";
import { assigneeOf, canReassign, isAuthorOrAssignee } from "./assignee";

const piece = { created_by: "ana", assigned_to: "bruno" };

describe("el responsable de una pieza", () => {
  it("la edita quien la creo o su responsable, nadie mas", () => {
    expect(isAuthorOrAssignee("ana", piece)).toBe(true);
    expect(isAuthorOrAssignee("bruno", piece)).toBe(true);
    expect(isAuthorOrAssignee("carla", piece)).toBe(false);
    expect(isAuthorOrAssignee("carla", { created_by: null, assigned_to: null })).toBe(false);
  });

  it("reasignar es de un administrador o de quien la creo; el responsable no la pasa a otra persona", () => {
    expect(canReassign({ role: "owner", userId: "x", piece })).toBe(true);
    expect(canReassign({ role: "admin", userId: "x", piece })).toBe(true);
    expect(canReassign({ role: "member", userId: "ana", piece })).toBe(true);
    expect(canReassign({ role: "member", userId: "bruno", piece })).toBe(false);
    expect(canReassign({ role: "member", userId: "carla", piece })).toBe(false);
  });

  it("el responsable del tablero sale de los nombres del equipo; sin nombre conocido no se inventa", () => {
    const names = new Map([["bruno", "Bruno Paz"]]);
    expect(assigneeOf("bruno", names)).toEqual({ id: "bruno", name: "Bruno Paz" });
    expect(assigneeOf("fantasma", names)).toBeNull();
    expect(assigneeOf(null, names)).toBeNull();
  });
});
