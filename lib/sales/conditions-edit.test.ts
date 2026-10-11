import { describe, expect, it } from "vitest";
import { EMPTY_CONDITION_TREE } from "./conditions-schema";
import { addGroup, addGroupCondition, addRootCondition, removeGroup, removeGroupCondition, removeRootCondition, setGroupConjunction, setRootConjunction, updateGroupCondition, updateRootCondition } from "./conditions-edit";

describe("ediciones del árbol (inmutables)", () => {
  it("agrega, edita y quita una condición de la raíz sin tocar el original", () => {
    const a = addRootCondition(EMPTY_CONDITION_TREE, "last_source");
    expect(EMPTY_CONDITION_TREE.conditions).toHaveLength(0);
    const b = updateRootCondition(a, 0, { operator: "is", value: "instagram" });
    expect(b.conditions[0]).toEqual({ field: "last_source", operator: "is", value: "instagram" });
    expect(removeRootCondition(b, 0).conditions).toHaveLength(0);
  });

  it("los grupos nacen con O y una condición; se pueden editar y quitar", () => {
    let t = addGroup(EMPTY_CONDITION_TREE, "last_combined");
    expect(t.groups[0]).toMatchObject({ conjunction: "or", conditions: [{ field: "last_combined" }] });
    t = addGroupCondition(t, 0, "first_combined");
    t = updateGroupCondition(t, 0, 1, { value: "jose" });
    t = setGroupConjunction(t, 0, "and");
    expect(t.groups[0].conjunction).toBe("and");
    expect(t.groups[0].conditions[1].value).toBe("jose");
    expect(removeGroupCondition(t, 0, 0).groups[0].conditions).toHaveLength(1);
    expect(removeGroup(t, 0).groups).toHaveLength(0);
  });

  it("la conjunción de la raíz", () => {
    expect(setRootConjunction(EMPTY_CONDITION_TREE, "or").rootConjunction).toBe("or");
  });
});
