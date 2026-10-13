import { describe, it, expect } from "vitest";
import { isInAudience } from "./audience";
import { defaultEodConfig } from "./config";

const ANA = "11111111-1111-4111-8111-111111111111";
const BETO = "22222222-2222-4222-8222-222222222222";
const SETTER_ROLE = "33333333-3333-4333-8333-333333333333";
const CLOSER_ROLE = "44444444-4444-4444-8444-444444444444";

const member = (userId: string, roleId: string | null, isMember = true) => ({ userId, roleId, isMember });

describe("isInAudience", () => {
  it("todo el equipo: cualquiera que sea miembro", () => {
    const config = defaultEodConfig("setter");
    expect(isInAudience(config, member(ANA, null))).toBe(true);
  });

  it("personas elegidas", () => {
    const config = { ...defaultEodConfig("setter"), audience: { mode: "users" as const, userIds: [ANA], roleIds: [] } };
    expect(isInAudience(config, member(ANA, null))).toBe(true);
    expect(isInAudience(config, member(BETO, null))).toBe(false);
  });

  it("roles elegidos", () => {
    const config = { ...defaultEodConfig("setter"), audience: { mode: "roles" as const, userIds: [], roleIds: [SETTER_ROLE] } };
    expect(isInAudience(config, member(ANA, SETTER_ROLE))).toBe(true);
    expect(isInAudience(config, member(BETO, CLOSER_ROLE))).toBe(false);
    expect(isInAudience(config, member(BETO, null))).toBe(false);
  });

  it("alguien que salió del workspace nunca está", () => {
    const config = { ...defaultEodConfig("setter"), audience: { mode: "users" as const, userIds: [ANA], roleIds: [] } };
    expect(isInAudience(config, member(ANA, null, false))).toBe(false);
    expect(isInAudience(defaultEodConfig("setter"), member(ANA, null, false))).toBe(false);
  });
});
