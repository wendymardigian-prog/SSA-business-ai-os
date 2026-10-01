/**
 * El grabador de audios (F18) y el chequeo de formato de Instagram (F19).
 */

import { describe, it, expect } from "vitest";
import {
  pickRecordingMime,
  extensionForRecordingMime,
  formatRecordingDuration,
  microphoneErrorMessage,
  instagramAcceptsAudio,
} from "./recording";

describe("pickRecordingMime", () => {
  it("prefiere audio/mp4: es el unico que Instagram acepta", () => {
    const supported = new Set(["audio/mp4", "audio/webm;codecs=opus", "audio/webm"]);
    expect(pickRecordingMime((m) => supported.has(m))).toBe("audio/mp4");
  });

  it("sin mp4 (Chrome, Firefox), cae a webm con opus", () => {
    const supported = new Set(["audio/webm;codecs=opus", "audio/webm"]);
    expect(pickRecordingMime((m) => supported.has(m))).toBe("audio/webm;codecs=opus");
  });

  it("sin ninguno soportado, devuelve null", () => {
    expect(pickRecordingMime(() => false)).toBeNull();
  });
});

describe("extensionForRecordingMime", () => {
  it("mp4 da m4a", () => {
    expect(extensionForRecordingMime("audio/mp4")).toBe("m4a");
  });
  it("webm con o sin codec da webm", () => {
    expect(extensionForRecordingMime("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionForRecordingMime("audio/webm")).toBe("webm");
  });
});

describe("formatRecordingDuration", () => {
  it("formatea m:ss con el segundo relleno", () => {
    expect(formatRecordingDuration(5)).toBe("0:05");
    expect(formatRecordingDuration(65)).toBe("1:05");
    expect(formatRecordingDuration(0)).toBe("0:00");
  });

  it("nunca da negativo", () => {
    expect(formatRecordingDuration(-5)).toBe("0:00");
  });
});

describe("microphoneErrorMessage", () => {
  it("traduce los tres casos conocidos", () => {
    expect(microphoneErrorMessage({ name: "NotAllowedError" })).toBe("Habilitá el micrófono para este sitio");
    expect(microphoneErrorMessage({ name: "NotFoundError" })).toBe("No encontramos ningún micrófono conectado");
    expect(microphoneErrorMessage({ name: "NotReadableError" })).toBe("Otra aplicación está usando el micrófono");
  });

  it("cualquier otra cosa da un mensaje generico, nunca el error crudo", () => {
    expect(microphoneErrorMessage(new Error("boom"))).toBe("No pudimos acceder al micrófono");
    expect(microphoneErrorMessage(null)).toBe("No pudimos acceder al micrófono");
  });
});

describe("instagramAcceptsAudio (§10.1)", () => {
  it("acepta mp4/aac/m4a y wav", () => {
    expect(instagramAcceptsAudio("audio/mp4")).toBe(true);
    expect(instagramAcceptsAudio("audio/aac")).toBe(true);
    expect(instagramAcceptsAudio("audio/x-m4a")).toBe(true);
    expect(instagramAcceptsAudio("audio/wav")).toBe(true);
  });

  it("rechaza ogg/opus, webm y mp3", () => {
    expect(instagramAcceptsAudio("audio/ogg")).toBe(false);
    expect(instagramAcceptsAudio("audio/webm;codecs=opus")).toBe(false);
    expect(instagramAcceptsAudio("audio/mpeg")).toBe(false);
  });

  it("sin mime, no se arriesga: false", () => {
    expect(instagramAcceptsAudio(null)).toBe(false);
    expect(instagramAcceptsAudio(undefined)).toBe(false);
  });
});
