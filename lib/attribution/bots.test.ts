import { describe, expect, it } from "vitest";
import { isLinkPreviewBot } from "./bots";

describe("isLinkPreviewBot: previsualizadores", () => {
  it.each([
    ["facebookexternalhit", "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)"],
    ["Facebot", "Mozilla/5.0 (compatible; Facebot 1.0)"],
    ["WhatsApp", "WhatsApp/2.23.20.0 A"],
    ["WhatsApp (iOS)", "WhatsApp/2.23.20.79 i"],
    ["Instagram sin navegador (Android)", "Instagram 300.0.0.29.110 Android (33/13; 420dpi; 1080x2400; samsung; SM-S908B; b0q; qcom; es_AR; 500000000)"],
    ["TelegramBot", "TelegramBot (like TwitterBot)"],
    ["Slackbot", "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)"],
    ["Twitterbot", "Twitterbot/1.0"],
    ["LinkedInBot", "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)"],
    ["Discordbot", "Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)"],
    ["Googlebot", "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)"],
    ["Meta externalagent", "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)"],
    ["en mayusculas", "FACEBOOKEXTERNALHIT/1.1"],
  ])("%s", (_name, ua) => {
    expect(isLinkPreviewBot(ua)).toBe(true);
  });

  it("un User-Agent vacio, en blanco o ausente es un bot", () => {
    for (const ua of ["", "   ", null, undefined]) {
      expect(isLinkPreviewBot(ua), String(ua)).toBe(true);
    }
  });
});

describe("isLinkPreviewBot: personas", () => {
  it.each([
    ["Chrome de escritorio", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36"],
    ["Safari de iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"],
    ["Chrome de Android", "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36"],
    ["navegador interno de Instagram (iOS)", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.29.110 (iPhone14,5; iOS 17_0; es_AR; es-AR; scale=3.00; 1170x2532; 500000000)"],
    ["navegador interno de Instagram (Android)", "Mozilla/5.0 (Linux; Android 13; SM-S908B) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/118.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.29.110 Android (33/13; 420dpi)"],
    ["navegador interno de Facebook", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.0;FBBV/1;FBDV/iPhone14,5]"],
    ["Firefox", "Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/118.0"],
    ["un telefono Cubot (no es un bot)", "Mozilla/5.0 (Linux; Android 12; CUBOT_X30) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Mobile Safari/537.36"],
  ])("%s", (_name, ua) => {
    expect(isLinkPreviewBot(ua)).toBe(false);
  });
});
