import { describe, expect, it } from "vitest";
import { pickServiceOwnerTarget, serviceOwnerFallbackProblem } from "./service-owner-target";

const team = new Set(["a", "b"]);
const isMember = (id: string) => team.has(id);

describe("el responsable del servicio (A4, F157)", () => {
  it("va al responsable si es del equipo; si no, al plan B; si tampoco, a nadie", () => {
    expect(pickServiceOwnerTarget("a", "b", isMember)).toEqual({ userId: "a", usedFallback: false });
    expect(pickServiceOwnerTarget(null, "b", isMember)).toEqual({ userId: "b", usedFallback: true });
    expect(pickServiceOwnerTarget("x", "b", isMember)).toEqual({ userId: "b", usedFallback: true });
    expect(pickServiceOwnerTarget("x", "y", isMember)).toEqual({ userId: null, usedFallback: true });
  });
  it("publicar exige el plan B solo cuando se eligió «el responsable del servicio»", () => {
    expect(serviceOwnerFallbackProblem({ type: "create_task", data: { owner: "service_owner" } })).not.toBeNull();
    expect(serviceOwnerFallbackProblem({ type: "create_task", data: { owner: "service_owner", ownerFallbackId: "b" } })).toBeNull();
    expect(serviceOwnerFallbackProblem({ type: "notify_team", data: { to: "service_owner" } })).not.toBeNull();
    expect(serviceOwnerFallbackProblem({ type: "notify_team", data: { to: "service_owner", fallbackUserId: "b" } })).toBeNull();
    expect(serviceOwnerFallbackProblem({ type: "create_task", data: { owner: "user" } })).toBeNull();
    expect(serviceOwnerFallbackProblem({ type: "send_message", data: {} })).toBeNull();
  });
});
