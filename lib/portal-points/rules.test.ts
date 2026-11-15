// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./points.cases.json";
import { dailyCap, levelOf, pointsFor, pointsSettingsProblems, type PointsSettings } from "./rules";

describe("cuántos puntos (casos compartidos con la base)", () => {
  for (const c of cases.pointsFor) it(c.name, () => expect(pointsFor(c.event, c.settings as PointsSettings | null, c.override)).toEqual(c.expected));
  it("hay al menos 10 casos", () => expect(cases.pointsFor.length).toBeGreaterThanOrEqual(10));
});
describe("los topes por día (casos compartidos con la base)", () => {
  for (const c of cases.dailyCap) it(c.name, () => expect(dailyCap(c.event, c.settings as PointsSettings)).toBe(c.expected));
});
describe("el nivel (casos compartidos con la base)", () => {
  for (const c of cases.levelOf) it(c.name, () => expect(levelOf(c.total, c.levels)).toEqual(c.expected));
});
describe("los ajustes de puntos (casos compartidos con la base)", () => {
  for (const c of cases.settings) it(c.name, () => expect(pointsSettingsProblems(c.points)).toEqual(c.expected));
});
