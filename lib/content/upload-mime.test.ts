import { describe, it, expect } from "vitest";
import { sniffMime, sniffUploadMime } from "./media";

/** 16 bytes de cabecera, como los que manda headBase64Of. */
function bytes(...parts: (number[] | string)[]): Uint8Array {
  const out: number[] = [];
  for (const part of parts) {
    if (typeof part === "string") for (const ch of part) out.push(ch.charCodeAt(0));
    else out.push(...part);
  }
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
}

const ZIP = bytes([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const OLE = bytes([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
const EBML = bytes([0x1a, 0x45, 0xdf, 0xa3]);
const ftyp = (brand: string) => bytes([0x00, 0x00, 0x00, 0x18], "ftyp", brand);

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

describe("sniffUploadMime", () => {
  it("un Office moderno: el ZIP lo prueban los bytes, el subtipo lo dice quien sube", () => {
    expect(sniffUploadMime(ZIP, DOCX)).toBe(DOCX);
    expect(sniffUploadMime(ZIP, XLSX)).toBe(XLSX);
  });

  it("un ZIP que no dice ser Office no entra", () => {
    expect(sniffUploadMime(ZIP, "application/zip")).toBeNull();
    expect(sniffUploadMime(ZIP, "")).toBeNull();
    expect(sniffUploadMime(ZIP, "application/pdf")).toBeNull();
  });

  it("un Office 97-2003 (OLE)", () => {
    expect(sniffUploadMime(OLE, "application/msword")).toBe("application/msword");
    expect(sniffUploadMime(OLE, "application/vnd.ms-excel")).toBe("application/vnd.ms-excel");
    expect(sniffUploadMime(OLE, DOCX)).toBeNull();
  });

  it("un .exe renombrado a .docx no pasa: no es un ZIP", () => {
    expect(sniffUploadMime(bytes("MZ"), DOCX)).toBeNull();
  });

  it("WebM: audio salvo que quien sube diga que es un video", () => {
    expect(sniffUploadMime(EBML, "video/webm")).toBe("video/webm");
    expect(sniffUploadMime(EBML, "audio/webm")).toBe("audio/webm");
    expect(sniffUploadMime(EBML, null)).toBe("audio/webm");
  });

  it("una foto HEIC de iPhone no es un video (sniffMime la llamaba video/mp4)", () => {
    expect(sniffMime(ftyp("heic"))).toBe("video/mp4");
    expect(sniffUploadMime(ftyp("heic"), "image/heic")).toBe("image/heic");
    expect(sniffUploadMime(ftyp("mif1"), "")).toBe("image/heic");
  });

  it("un 3GP es video/3gpp, no mp4", () => {
    expect(sniffUploadMime(ftyp("3gp4"), "video/3gpp")).toBe("video/3gpp");
  });

  it("lo demas queda igual que sniffMime", () => {
    expect(sniffUploadMime(ftyp("isom"), "video/mp4")).toBe("video/mp4");
    expect(sniffUploadMime(ftyp("qt  "), "video/quicktime")).toBe("video/quicktime");
    expect(sniffUploadMime(bytes("%PDF-1.7"), "application/pdf")).toBe("application/pdf");
    expect(sniffUploadMime(bytes([0xff, 0xd8, 0xff, 0xe0]), "image/jpeg")).toBe("image/jpeg");
    expect(sniffUploadMime(bytes("hola mundo, esto es texto"), "text/plain")).toBeNull();
  });

  it("menos de 12 bytes: no se decide", () => {
    expect(sniffUploadMime(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), DOCX)).toBeNull();
  });
});
