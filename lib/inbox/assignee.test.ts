import { describe, expect, it } from "vitest";
import { assigneeControl, assigneeName, assigneeOptions, canChangeConversationAssignee } from "./assignee";

const base = { canAssign: false, canReply: true, viewerId: "yo", current: null as string | null };

describe("canChangeConversationAssignee", () => {
  it("con contacts.assign, cualquier cambio", () => {
    expect(canChangeConversationAssignee({ ...base, canAssign: true, current: "ana", next: "beto" })).toBe(true);
    expect(canChangeConversationAssignee({ ...base, canAssign: true, current: "ana", next: null })).toBe(true);
  });

  it("sin la clave: tomar una sin responsable, para mí, donde respondo", () => {
    expect(canChangeConversationAssignee({ ...base, next: "yo" })).toBe(true);
  });

  it("sin la clave no se toma una que ya tiene responsable ni se le da a otro", () => {
    expect(canChangeConversationAssignee({ ...base, current: "ana", next: "yo" })).toBe(false);
    expect(canChangeConversationAssignee({ ...base, next: "ana" })).toBe(false);
    expect(canChangeConversationAssignee({ ...base, current: "yo", next: null })).toBe(false);
  });

  it("sin poder responder en esa cuenta no se toma", () => {
    expect(canChangeConversationAssignee({ ...base, canReply: false, next: "yo" })).toBe(false);
  });
});

describe("assigneeControl", () => {
  it("selector, tomar o solo lectura", () => {
    expect(assigneeControl({ ...base, canAssign: true })).toEqual({ kind: "select" });
    expect(assigneeControl(base)).toEqual({ kind: "take" });
    expect(assigneeControl({ ...base, current: "ana" })).toEqual({ kind: "readonly" });
    expect(assigneeControl({ ...base, canReply: false })).toEqual({ kind: "readonly" });
  });
});

describe("assigneeOptions y assigneeName", () => {
  const team = [{ userId: "ana", label: "Ana" }];

  it("conserva a quien ya no está, sin inventarle un nombre", () => {
    expect(assigneeOptions(team, "zz").map((m) => m.label)).toEqual(["Ana", "Alguien que ya no está en el equipo"]);
    expect(assigneeOptions(team, "ana")).toBe(team);
    expect(assigneeName(team, "zz")).toBeNull();
    expect(assigneeName(team, "ana")).toBe("Ana");
  });
});
