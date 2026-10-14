import { describe, expect, it } from "vitest";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { memberRowControls, teamSections, type TeamViewer } from "./view-model";

const viewerWith = (userId: string, keys: string[]): TeamViewer => ({ userId, can: (k) => keys.includes(k) });
const owner = viewerWith("owner", SYSTEM_ROLE_PERMISSIONS.owner.keys);
const admin = viewerWith("admin", SYSTEM_ROLE_PERMISSIONS.admin.keys);
const member = viewerWith("member", SYSTEM_ROLE_PERMISSIONS.member.keys);
const soloVer = viewerWith("ver", ["team.view"]);

describe("memberRowControls", () => {
  it("el Owner ve selector, closer y quitar en las demás personas", () => {
    expect(memberRowControls(owner, { userId: "x", role: "member" })).toEqual({ roleSelect: true, closer: true, remove: true, roleBadge: false });
  });

  it("el Admin cambia roles y closer, pero no quita (team.remove es solo del Owner)", () => {
    expect(memberRowControls(admin, { userId: "x", role: "member" })).toEqual({ roleSelect: true, closer: true, remove: false, roleBadge: false });
  });

  it("nadie ve selector sobre el Owner ni sobre sí mismo", () => {
    expect(memberRowControls(admin, { userId: "o", role: "owner" }).roleSelect).toBe(false);
    expect(memberRowControls(admin, { userId: "admin", role: "admin" })).toMatchObject({ roleSelect: false, remove: false, roleBadge: true });
    expect(memberRowControls(owner, { userId: "owner", role: "owner" })).toMatchObject({ roleSelect: false, remove: false });
  });

  it("quien solo tiene team.view ve la lista: sin selector, sin closer, sin quitar", () => {
    expect(memberRowControls(soloVer, { userId: "x", role: "member" })).toEqual({ roleSelect: false, closer: false, remove: false, roleBadge: true });
  });

  it("el Member de sistema no ve ningún control", () => {
    expect(memberRowControls(member, { userId: "x", role: "member" })).toEqual({ roleSelect: false, closer: false, remove: false, roleBadge: true });
  });
});

describe("teamSections", () => {
  it("invitar, pendientes e historial salen juntos con team.invite", () => {
    expect(teamSections(admin)).toEqual({ members: true, invite: true, pending: true, history: true });
    expect(teamSections(soloVer)).toEqual({ members: true, invite: false, pending: false, history: false });
    expect(teamSections(viewerWith("x", ["team.invite"]))).toMatchObject({ invite: true, pending: true, history: true, members: false });
  });
});
