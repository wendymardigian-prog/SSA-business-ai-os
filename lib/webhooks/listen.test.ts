import { describe, expect, it } from "vitest";
import { isListening, listenUntilFrom } from "./listen";

const NOW = new Date("2026-10-12T12:00:00Z");

describe("escucha", () => {
  it("dura 15 minutos", () => {
    expect(listenUntilFrom(NOW).getTime() - NOW.getTime()).toBe(15 * 60_000);
  });
  it("vencida o ilegible cuenta como no escuchando", () => {
    expect(isListening(NOW, listenUntilFrom(NOW).toISOString())).toBe(true);
    expect(isListening(new Date(NOW.getTime() + 15 * 60_000), listenUntilFrom(NOW).toISOString())).toBe(false);
    expect(isListening(NOW, null)).toBe(false);
    expect(isListening(NOW, "x")).toBe(false);
  });
});
