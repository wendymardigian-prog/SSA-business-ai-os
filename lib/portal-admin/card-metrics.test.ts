// @plantilla-quitar(servicios)
import { describe, expect, it } from "vitest";
import { cardMetricViews, parseMetricDays } from "./card-metrics";

describe("cards de Portal › Programas", () => {
  it("una sección apagada (null) se ve «—»", () => {
    const v = cardMetricViews("p", { new_students: null, attendance_pct: null, community_posts: 3 });
    expect(v.find((x) => x.key === "new_students")?.value).toBe("—");
    expect(v.find((x) => x.key === "attendance_pct")?.value).toBe("—");
    expect(v.find((x) => x.key === "community_posts")?.value).toBe("3");
  });
  it("lo por revisar y «sin entrar» se resaltan si son más de 0; lo por revisar lleva a Por revisar del programa", () => {
    const v = cardMetricViews("p1", { to_review: 2, to_grade: 0, inactive_14d: 1, attendance_pct: 75 });
    expect(v.find((x) => x.key === "to_review")).toMatchObject({ highlight: true, href: "/dashboard/portal?tab=revisar&programa=p1" });
    expect(v.find((x) => x.key === "to_grade")?.highlight).toBe(false);
    expect(v.find((x) => x.key === "inactive_14d")?.highlight).toBe(true);
    expect(v.find((x) => x.key === "attendance_pct")?.value).toBe("75 %");
    expect(v).toHaveLength(8);
  });
  it("certificados «—» si el bloque no está", () => {
    expect(cardMetricViews("p", { certificates: 4 }, { certificatesAvailable: false }).find((x) => x.key === "certificates")?.value).toBe("—");
  });
  it("el período es 7 o 30 días", () => {
    expect(parseMetricDays("7")).toBe(7);
    expect(parseMetricDays(undefined)).toBe(30);
    expect(parseMetricDays("90")).toBe(30);
  });
});
