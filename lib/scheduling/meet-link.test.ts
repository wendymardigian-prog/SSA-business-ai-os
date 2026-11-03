import { describe, expect, it } from "vitest";
import { canJoinMeet, meetJoinHref, waitingForMeet } from "./meet-link";

describe("meetJoinHref", () => {
  it("devuelve el link https de Meet", () => {
    expect(meetJoinHref("https://meet.google.com/abc-defg-hij")).toBe("https://meet.google.com/abc-defg-hij");
  });

  it("descarta lo que no es https", () => {
    for (const raw of [null, undefined, "", "meet.google.com/abc", "javascript:alert(1)", "http://meet.google.com/abc"]) {
      expect(meetJoinHref(raw)).toBeNull();
    }
  });
});

describe("waitingForMeet", () => {
  it("espera solo un Meet sin link y todavia pendiente", () => {
    expect(waitingForMeet({ locationType: "google_meet", meetUrl: null, syncStatus: "pending" })).toBe(true);
    expect(waitingForMeet({ locationType: "google_meet", meetUrl: "https://meet.google.com/x", syncStatus: "pending" })).toBe(false);
    expect(waitingForMeet({ locationType: "google_meet", meetUrl: null, syncStatus: "not_applicable" })).toBe(false);
    expect(waitingForMeet({ locationType: "manual", meetUrl: null, syncStatus: "pending" })).toBe(false);
  });
});

describe("canJoinMeet", () => {
  it("con link y la reunion activa: si; cancelada o sin link: no", () => {
    expect(canJoinMeet({ meetUrl: "https://meet.google.com/x", status: "scheduled" })).toBe(true);
    expect(canJoinMeet({ meetUrl: "https://meet.google.com/x", status: "cancelled_other" })).toBe(false);
    expect(canJoinMeet({ meetUrl: null, status: "scheduled" })).toBe(false);
  });
});
