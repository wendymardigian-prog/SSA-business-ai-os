// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import cases from "./rules.cases.json";
import { activeDaysPlan, notificationPrefs } from "./rules";

describe("las preferencias de avisos (casos compartidos con la base)", () => {
  for (const c of cases.prefs) it(c.name, () => expect(notificationPrefs(c.saved)).toEqual(c.expected));
});
describe("los días que entró al portal (casos compartidos con la base)", () => {
  for (const c of cases.activeDays) it(c.name, () => expect(activeDaysPlan(c.days, c.today)).toEqual(c.expected));
});
