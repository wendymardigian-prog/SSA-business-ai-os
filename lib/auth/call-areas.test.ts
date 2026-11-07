import { describe, expect, it } from "vitest";
import cases from "./call-areas.cases.json";
import { callAreasExceed, callAreasOf, parseCallAreas, roleSeesCallArea, type CallAreaPermissions } from "./call-areas";

const ids = cases.ids as Record<string, string>;
const resolve = <T>(value: T): T => {
  if (value === null || typeof value !== "object") return value;
  const p = value as unknown as CallAreaPermissions;
  return (p.call_areas ? { ...p, call_areas: p.call_areas.map((k) => ids[k]) } : p) as T;
};

describe("casos compartidos: quien ve un area", () => {
  for (const c of cases.sees) {
    it(c.name, () => {
      expect(roleSeesCallArea(resolve(c.permissions) as CallAreaPermissions, c.area ? ids[c.area] : null)).toBe(c.sees);
    });
  }
});

describe("casos compartidos: dar un area", () => {
  for (const c of cases.exceeds) {
    it(c.name, () => {
      expect(callAreasExceed(resolve(c.wanted) as CallAreaPermissions, resolve(c.before) as CallAreaPermissions | null, resolve(c.actor) as CallAreaPermissions)).toBe(c.exceeds);
    });
  }
});

describe("parseCallAreas", () => {
  it("se queda con los ids, sin repetidos", () => {
    expect(parseCallAreas([ids.A, ids.A, "otra cosa", 3, null, ids.B])).toEqual([ids.A, ids.B]);
  });
  it("lo que no es una lista no da ninguna area", () => {
    expect(parseCallAreas("todas")).toEqual([]);
    expect(parseCallAreas(null)).toEqual([]);
  });
});

describe("callAreasOf", () => {
  it("una lista sin el alcance no cuenta", () => {
    expect(callAreasOf({ scopes: { calls: "own" }, call_areas: [ids.A] })).toEqual([]);
    expect(callAreasOf({ scopes: { calls: "areas" }, call_areas: [ids.A] })).toEqual([ids.A]);
    expect(callAreasOf(null)).toEqual([]);
  });
});
