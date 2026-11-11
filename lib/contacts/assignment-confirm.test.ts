import { describe, expect, it } from "vitest";
import { needsSelfRemovalConfirm } from "./assignment-confirm";

const base = { isAdmin: false, currentUserId: "yo", next: null as string | null, current: "yo", other: null as string | null };

describe("needsSelfRemovalConfirm", () => {
  it("avisa cuando un Member se saca y no le queda otro rol en el lead", () => {
    expect(needsSelfRemovalConfirm(base)).toBe(true);
    expect(needsSelfRemovalConfirm({ ...base, next: "otra" })).toBe(true);
  });
  it("no avisa a un admin", () => {
    expect(needsSelfRemovalConfirm({ ...base, isAdmin: true })).toBe(false);
  });
  it("no avisa si se asigna a si mismo o no era el asignado", () => {
    expect(needsSelfRemovalConfirm({ ...base, next: "yo" })).toBe(false);
    expect(needsSelfRemovalConfirm({ ...base, current: "otra" })).toBe(false);
    expect(needsSelfRemovalConfirm({ ...base, current: null })).toBe(false);
  });
  it("no avisa si sigue en el otro rol", () => {
    expect(needsSelfRemovalConfirm({ ...base, other: "yo" })).toBe(false);
  });
});
