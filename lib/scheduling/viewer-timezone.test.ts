import { describe, expect, it } from "vitest";
import { getViewerTimezone } from "./viewer-timezone";

describe("getViewerTimezone (F8)", () => {
  it("perfil > navegador > workspace > default", () => {
    expect(getViewerTimezone({ profileTimezone: "America/Mexico_City", browserTimezone: "Europe/Madrid", workspaceTimezone: "America/Costa_Rica" })).toBe("America/Mexico_City");
    expect(getViewerTimezone({ profileTimezone: null, browserTimezone: "Europe/Madrid", workspaceTimezone: "America/Costa_Rica" })).toBe("Europe/Madrid");
    expect(getViewerTimezone({ workspaceTimezone: "America/Bogota" })).toBe("America/Bogota");
    expect(getViewerTimezone({})).toBe("America/Costa_Rica");
  });
  it("una zona invalida se saltea", () => {
    expect(getViewerTimezone({ profileTimezone: "Marte/Olympus", browserTimezone: "America/Lima" })).toBe("America/Lima");
  });
});
