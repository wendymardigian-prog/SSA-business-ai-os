import { describe, it, expect } from "vitest";
import cases from "./identity.cases.json";
import {
  normalizeIdentity,
  identityLockKeys,
  hasStrongIdentity,
  type ContactIdentity,
} from "./identity";

interface Case {
  name: string;
  input: Record<string, unknown>;
  normalized: Record<string, string>;
  lockKeys: string[];
}

describe("normalizeIdentity (casos compartidos con la base)", () => {
  for (const c of cases.cases as unknown as Case[]) {
    it(c.name, () => {
      const normalized = normalizeIdentity(c.input as ContactIdentity);
      expect(normalized).toEqual(c.normalized);
      expect(identityLockKeys(normalized)).toEqual(c.lockKeys);
    });
  }
});

describe("hasStrongIdentity", () => {
  it("sin datos no hay identidad", () => {
    expect(hasStrongIdentity(normalizeIdentity({}))).toBe(false);
    expect(hasStrongIdentity(normalizeIdentity({ phone: "123" }))).toBe(false);
  });

  it("cualquier dato fuerte alcanza", () => {
    expect(hasStrongIdentity(normalizeIdentity({ email: "a@b.com" }))).toBe(true);
    expect(hasStrongIdentity(normalizeIdentity({ instagram: "ana" }))).toBe(true);
    expect(hasStrongIdentity(normalizeIdentity({ channel_id: "c", sender_id: "s" }))).toBe(true);
  });

  it("nunca el nombre", () => {
    expect(hasStrongIdentity(normalizeIdentity({ display_name: "Ana Perez" } as never))).toBe(false);
  });
});

describe("identityLockKeys", () => {
  it("es estable sin importar el orden en que llegan los datos", () => {
    const a = normalizeIdentity({ phone: "+5491122334455", email: "a@x.com", instagram: "ana" });
    const b = normalizeIdentity({ instagram: "ana", email: "a@x.com", phone: "+5491122334455" });
    expect(identityLockKeys(a)).toEqual(identityLockKeys(b));
  });
});
