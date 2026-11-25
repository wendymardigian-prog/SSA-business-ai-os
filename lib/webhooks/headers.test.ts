import { describe, expect, it } from "vitest";
import { sanitizeHeaders } from "./headers";

describe("sanitizeHeaders", () => {
  it("guarda lo útil y saca credenciales e IP", () => {
    const out = sanitizeHeaders([
      ["Content-Type", "application/json"],
      ["User-Agent", "Pabbly"],
      ["X-Webhook-Secret", "s3cr3t"],
      ["Authorization", "Bearer x"],
      ["Cookie", "a=b"],
      ["X-Forwarded-For", "1.2.3.4"],
      ["X-Signature", "abc"],
      ["X-Access-Token", "t"],
      ["X-Pabbly-Event", "sale"],
    ]);
    expect(out).toEqual({ "content-type": "application/json", "user-agent": "Pabbly", "x-pabbly-event": "sale" });
  });

  it("respeta los topes", () => {
    const many = Array.from({ length: 80 }, (_, i) => [`x-h${i}`, "v".repeat(1000)] as [string, string]);
    const out = sanitizeHeaders(many);
    expect(Object.values(out).every((v) => v.length <= 500)).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(8 * 1024);
  });
});
