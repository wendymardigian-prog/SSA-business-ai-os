import { describe, it, expect } from "vitest";
import { parseUserAgent, buildLegal } from "./legal";

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const CHROME_ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const EDGE = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0";
const FIREFOX = "Mozilla/5.0 (X11; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0";
const CHROME_IOS = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1";

describe("parseUserAgent", () => {
  it("un iPhone con Safari: mobile, iOS, Safari", () => {
    expect(parseUserAgent(IPHONE)).toEqual({ device: "mobile", os: "iOS", browser: "Safari" });
  });
  it("las otras combinaciones comunes", () => {
    expect(parseUserAgent(CHROME_WIN)).toEqual({ device: "desktop", os: "Windows", browser: "Chrome" });
    expect(parseUserAgent(CHROME_ANDROID)).toEqual({ device: "mobile", os: "Android", browser: "Chrome" });
    expect(parseUserAgent(IPAD)).toEqual({ device: "tablet", os: "iOS", browser: "Safari" });
    expect(parseUserAgent(SAFARI_MAC)).toEqual({ device: "desktop", os: "macOS", browser: "Safari" });
    expect(parseUserAgent(EDGE)).toEqual({ device: "desktop", os: "Windows", browser: "Edge" });
    expect(parseUserAgent(FIREFOX)).toEqual({ device: "desktop", os: "Linux", browser: "Firefox" });
    expect(parseUserAgent(CHROME_IOS)).toEqual({ device: "mobile", os: "iOS", browser: "Chrome" });
  });
  it("vacío o raro: desconocido, sin lanzar", () => {
    expect(parseUserAgent(null)).toEqual({ device: "unknown", os: "Desconocido", browser: "Desconocido" });
    expect(parseUserAgent("curl/8.0")).toEqual({ device: "desktop", os: "Desconocido", browser: "Desconocido" });
  });
});

describe("buildLegal", () => {
  it("la IP y el user agent son los del servidor; la zona y el idioma, declarados", () => {
    const legal = buildLegal({
      ip: "203.0.113.9",
      userAgent: IPHONE,
      timezone: "America/Costa_Rica",
      locale: "es-CR",
      attribution: { utm_source: "meta", utm_campaign: "octubre", referrer_url: "https://x.com/", landing_page: "https://app/f/c", fbclid: "no-va" },
      acceptedLabel: "Leí y acepto",
      signatureStrokes: 3,
    });
    expect(legal).toEqual({
      ip: "203.0.113.9",
      user_agent: IPHONE,
      device: "mobile",
      os: "iOS",
      browser: "Safari",
      timezone: "America/Costa_Rica",
      locale: "es-CR",
      utm: { utm_source: "meta", utm_campaign: "octubre" },
      referrer: "https://x.com/",
      landing: "https://app/f/c",
      accepted_label: "Leí y acepto",
      signature_strokes: 3,
    });
  });
  it("lo que falta queda en null y no inventa nada", () => {
    const legal = buildLegal({ ip: null, userAgent: null, acceptedLabel: "x", signatureStrokes: 0 });
    expect(legal).toMatchObject({ ip: null, user_agent: null, device: "unknown", timezone: null, locale: null, utm: {}, referrer: null, landing: null, signature_strokes: 0 });
  });
});
