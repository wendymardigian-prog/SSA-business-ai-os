import { describe, expect, it } from "vitest";
import { MANUAL_VERSION_GAP_MS, REASON_LABELS, shouldSnapshotManual, versionAuthor, versionWhen } from "./versions";

const NOW = new Date("2026-11-07T15:00:00Z");

describe("versiones (F27)", () => {
  it("como máximo una versión cada 10 minutos de edición manual", () => {
    expect(MANUAL_VERSION_GAP_MS).toBe(600_000);
    expect(shouldSnapshotManual(null, NOW)).toBe(true);
    expect(shouldSnapshotManual(undefined, NOW)).toBe(true);
    expect(shouldSnapshotManual(new Date(NOW.getTime() - 60_000), NOW)).toBe(false);
    expect(shouldSnapshotManual(new Date(NOW.getTime() - 9 * 60_000 - 59_000), NOW)).toBe(false);
    expect(shouldSnapshotManual(new Date(NOW.getTime() - 10 * 60_000), NOW)).toBe(true);
    expect(shouldSnapshotManual(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe(true);
  });

  it("acepta la fecha como texto y una fecha ilegible deja guardar", () => {
    expect(shouldSnapshotManual("2026-11-07T14:59:00Z", NOW)).toBe(false);
    expect(shouldSnapshotManual("2026-11-07T14:00:00Z", NOW)).toBe(true);
    expect(shouldSnapshotManual("no es una fecha", NOW)).toBe(true);
  });

  it("quién la hizo: la persona (o «Alguien del equipo» si no se sabe) o «IA»", () => {
    expect(versionAuthor({ authorKind: "ai", authorName: null })).toBe("IA");
    expect(versionAuthor({ authorKind: "user", authorName: "Ana Pérez" })).toBe("Ana Pérez");
    expect(versionAuthor({ authorKind: "user", authorName: null })).toBe("Alguien del equipo");
    expect(versionAuthor({ authorKind: "user", authorName: "  " })).toBe("Alguien del equipo");
  });

  it("los motivos tienen su rótulo", () => {
    expect(Object.keys(REASON_LABELS).sort()).toEqual(["ai", "generate", "import", "manual", "publish", "restore"]);
    expect(REASON_LABELS.ai).toBe("Pedido a la IA");
    expect(REASON_LABELS.restore).toBe("Restaurada");
  });

  it("la fecha se ve en la zona de quien mira", () => {
    expect(versionWhen("2026-11-07T09:12:00Z", NOW, "UTC")).toBe("hoy 09:12");
    expect(versionWhen("2026-11-06T18:20:00Z", NOW, "UTC")).toBe("ayer 18:20");
    expect(versionWhen("2026-10-05T10:00:00Z", NOW, "UTC")).toBe("5 oct 10:00");
    expect(versionWhen("2025-03-12T12:00:00Z", NOW, "UTC")).toBe("12 mar 2025 12:00");
    expect(versionWhen("2026-11-07T01:30:00Z", NOW, "America/Costa_Rica")).toBe("ayer 19:30");
    expect(versionWhen("basura", NOW, "UTC")).toBe("");
  });
});
