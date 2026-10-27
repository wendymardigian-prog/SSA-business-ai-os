import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { checkValues, listMigrations, migrationsDir, readMigration } from "@/lib/test-utils/migrations";
import { PLATFORMS, PLATFORM_LABELS, isSupportedPlatform, platformLabel } from "./platforms";

/**
 * Issue #16: the channel picker offered WhatsApp, the connect route rejected it
 * and the channels check constraint could not have stored it anyway. Each layer
 * carried its own copy of the list. These tests pin them to PLATFORMS.
 */
describe("platform allowlist", () => {
  it("labels every supported platform", () => {
    for (const platform of PLATFORMS) {
      expect(PLATFORM_LABELS[platform]).toBeTruthy();
    }
  });

  it("accepts supported platforms and rejects everything else", () => {
    expect(isSupportedPlatform("whatsapp")).toBe(true);
    expect(isSupportedPlatform("instagram")).toBe(true);
    // Zernio connects these, the app has no inbox for them.
    expect(isSupportedPlatform("tiktok")).toBe(false);
    expect(isSupportedPlatform("youtube")).toBe(false);
    expect(isSupportedPlatform(undefined)).toBe(false);
  });

  it("falls back to a capitalised name for unknown platforms", () => {
    expect(platformLabel("whatsapp")).toBe("WhatsApp");
    expect(platformLabel("mastodon")).toBe("Mastodon");
  });

  it("names the publishing-only networks with their brand spelling", () => {
    expect(platformLabel("tiktok")).toBe("TikTok");
    expect(platformLabel("youtube")).toBe("YouTube");
    expect(platformLabel("linkedin")).toBe("LinkedIn");
    expect(platformLabel("threads")).toBe("Threads");
    // Ser una red de publicacion no la vuelve un canal de mensajes.
    expect(isSupportedPlatform("youtube")).toBe(false);
  });

  it("matches the channels platform check constraint", () => {
    expect(latestChannelsPlatformConstraint()).toEqual([...PLATFORMS].sort());
  });

  it("keeps ALL_MIGRATIONS.sql a faithful in-order copy of every migration", () => {
    const dir = migrationsDir();
    const bundle = readFileSync(join(dir, "ALL_MIGRATIONS.sql"), "utf8");
    let cursor = 0;
    for (const file of listMigrations()) {
      const body = readMigration(file).trim();
      const at = bundle.indexOf(body, cursor);
      expect(at, `${file} missing from ALL_MIGRATIONS.sql or out of order`).toBeGreaterThan(-1);
      cursor = at + body.length;
    }
  });
});

/** La lista de plataformas del CHECK vigente de `channels.platform` (anclado al NOMBRE de la constraint). */
function latestChannelsPlatformConstraint(): string[] {
  const found = checkValues("channels_platform_check");
  if (!found) throw new Error("no migration defines the channels platform constraint");
  return [...found.values].sort();
}
