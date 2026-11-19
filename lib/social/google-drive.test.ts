import { describe, expect, it } from "vitest";
import { DRIVE_FILE_SCOPE, driveScopesAreNarrow, googleDriveAdapter } from "./google-drive";

describe("Drive: el token que va al navegador trae solo drive.file", () => {
  it("la autorizacion de Drive no suma los permisos que la cuenta ya dio (YouTube, Calendar)", () => {
    const url = new URL(googleDriveAdapter.authorizeUrl({ clientId: "c", redirectUri: "https://app.example/cb", state: "s" }));
    expect(url.searchParams.get("include_granted_scopes")).toBeNull();
    expect(url.searchParams.get("scope")).toContain(DRIVE_FILE_SCOPE);
  });

  it("acepta drive.file con la identidad de la cuenta", () => {
    expect(driveScopesAreNarrow([DRIVE_FILE_SCOPE, "openid", "https://www.googleapis.com/auth/userinfo.email"])).toBe(true);
  });

  it("rechaza una conexion que arrastra YouTube o Calendar", () => {
    expect(driveScopesAreNarrow([DRIVE_FILE_SCOPE, "openid", "https://www.googleapis.com/auth/youtube.upload"])).toBe(false);
    expect(driveScopesAreNarrow([DRIVE_FILE_SCOPE, "https://www.googleapis.com/auth/calendar.events"])).toBe(false);
  });

  it("sin drive.file, o sin saber que trae, no entrega nada", () => {
    expect(driveScopesAreNarrow(["openid", "email"])).toBe(false);
    expect(driveScopesAreNarrow(null)).toBe(false);
    expect(driveScopesAreNarrow([])).toBe(false);
  });
});
