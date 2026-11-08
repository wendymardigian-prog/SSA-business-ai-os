/**
 * El cliente del servicio de render (`ssa-render`, F5 y §9.2).
 *
 * SSA le manda el HTML ya armado por `renderPageHTML` y recibe PNG o PDF. El
 * servicio no tiene credenciales de Supabase: las imágenes van como links
 * firmados de corta duración dentro del HTML.
 *
 * - Sin `RENDER_SERVICE_URL` / `RENDER_SERVICE_SECRET` lanza `RenderNotConfigured`
 *   ("Falta conectar el servicio de render"): exportar y generar quedan para
 *   reintentar, el resto del Diseñador funciona.
 * - Con `DESIGNER_FAKE_RENDER=1` devuelve archivos de 1×1 sin llamar a nadie
 *   (desarrollo, tests y `verify-designer`). Los tests NUNCA llaman al servicio real.
 * - El servicio DUERME sin uso (Serverless de Railway): el primer pedido puede
 *   tardar unos segundos. Se espera hasta 60 s y se reintenta UNA vez ante un
 *   error de conexión o un 502/503/504; lo que siga fallando lo reagenda el job
 *   a 1, 5 y 15 minutos.
 *
 * Solo servidor (usa `node:crypto` y el secreto).
 */

import { renderSignatureHeader } from "./render-sign";

export const RENDER_NOT_CONFIGURED_MESSAGE = "Falta conectar el servicio de render";

export class RenderNotConfigured extends Error {
  constructor() {
    super(RENDER_NOT_CONFIGURED_MESSAGE);
    this.name = "RenderNotConfigured";
  }
}

export class RenderFailed extends Error {
  /** Si conviene reintentar más tarde (red, servicio dormido u ocupado). */
  readonly retryable: boolean;
  readonly status: number | null;
  /** Lo que se le muestra a la persona, si el motivo no es el servicio (por ejemplo, las imágenes). */
  readonly userMessage: string | null;
  constructor(message: string, opts: { retryable: boolean; status?: number | null; userMessage?: string | null }) {
    super(message);
    this.name = "RenderFailed";
    this.retryable = opts.retryable;
    this.status = opts.status ?? null;
    this.userMessage = opts.userMessage ?? null;
  }
}

export interface RenderRequest {
  /** Un solo documento (una página). */
  html?: string;
  /** Varios documentos (un PDF con una hoja por cada uno, o un PNG por cada uno). */
  pages?: { html: string }[];
  width: number;
  height: number;
  format: "png" | "pdf";
  scale?: 0.5 | 1 | 2;
  /** Medir los elementos (`data-el`): caja, desborde y luminancia del fondo (F36). Solo PNG. */
  measure?: boolean;
}

export interface MeasuredElement {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  overflow: boolean;
  bgLuminance: number | null;
}

export interface MeasuredPage {
  page: number;
  elements: MeasuredElement[];
}

export interface RenderFile {
  page: number;
  contentType: "image/png" | "application/pdf";
  bytes: Uint8Array;
}

export interface RenderResult {
  files: RenderFile[];
  measure?: MeasuredPage[];
  version: string;
}

export interface RenderDeps {
  fetchImpl?: typeof fetch;
  env?: Record<string, string | undefined>;
  nowSeconds?: () => number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Un PNG transparente de 1×1. */
const FAKE_PNG = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=", "base64"));

/** Un PDF mínimo válido de una hoja de 1×1. */
const FAKE_PDF = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 1 1]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n",
);

export const FAKE_RENDER_FILES = { png: FAKE_PNG, pdf: FAKE_PDF };

/** Si el render está simulado (`DESIGNER_FAKE_RENDER=1`). */
export function isFakeRender(env: Record<string, string | undefined> = process.env): boolean {
  return env.DESIGNER_FAKE_RENDER === "1";
}

/** Si el servicio está configurado (o simulado). */
export function isRenderConfigured(env: Record<string, string | undefined> = process.env): boolean {
  return isFakeRender(env) || (!!env.RENDER_SERVICE_URL && !!env.RENDER_SERVICE_SECRET);
}

function documentCount(req: RenderRequest): number {
  return req.pages ? req.pages.length : 1;
}

function fakeResult(req: RenderRequest): RenderResult {
  if (req.format === "pdf") return { files: [{ page: 0, contentType: "application/pdf", bytes: FAKE_PDF }], version: "fake" };
  const count = documentCount(req);
  return {
    files: Array.from({ length: count }, (_, page) => ({ page, contentType: "image/png" as const, bytes: FAKE_PNG })),
    measure: req.measure ? Array.from({ length: count }, (_, page) => ({ page, elements: [] })) : undefined,
    version: "fake",
  };
}

function validate(req: RenderRequest): void {
  if (!!req.html === !!req.pages) throw new RenderFailed("El pedido de render tiene que traer una página o varias, no las dos.", { retryable: false });
  if (req.pages && (req.pages.length === 0 || req.pages.length > 35)) throw new RenderFailed("El pedido de render tiene que traer entre 1 y 35 páginas.", { retryable: false });
  if (req.measure && req.format !== "png") throw new RenderFailed("Medir solo se puede con PNG.", { retryable: false });
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);

/**
 * Pide un render al servicio. Lanza `RenderNotConfigured` si falta la
 * configuración y `RenderFailed` si el servicio falla (con `retryable`).
 */
export async function renderDesign(req: RenderRequest, deps: RenderDeps = {}): Promise<RenderResult> {
  const env = deps.env ?? process.env;
  validate(req);
  if (isFakeRender(env)) return fakeResult(req);
  const url = env.RENDER_SERVICE_URL;
  const secret = env.RENDER_SERVICE_SECRET;
  if (!url || !secret) throw new RenderNotConfigured();

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = deps.nowSeconds ?? (() => Math.floor(Date.now() / 1000));
  const body = JSON.stringify(req);
  const endpoint = `${url.replace(/\/+$/, "")}/render`;

  let lastError: RenderFailed | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) await sleep(2000);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 60_000);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-render-signature": renderSignatureHeader(body, secret, now()) },
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        const retryable = RETRYABLE_STATUS.has(res.status) || res.status === 429;
        lastError = new RenderFailed(`El servicio de render respondió ${res.status}.`, { retryable, status: res.status });
        if (retryable && attempt === 0) continue;
        throw lastError;
      }
      const json = (await res.json()) as { ok?: boolean; version?: string; files?: { page: number; contentType: RenderFile["contentType"]; base64: string }[]; measure?: MeasuredPage[] };
      if (!json.ok || !Array.isArray(json.files)) throw new RenderFailed("El servicio de render devolvió una respuesta inválida.", { retryable: true });
      return {
        files: json.files.map((f) => ({ page: f.page, contentType: f.contentType, bytes: Uint8Array.from(Buffer.from(f.base64, "base64")) })),
        measure: json.measure,
        version: json.version ?? "",
      };
    } catch (error) {
      if (error instanceof RenderFailed) {
        if (error.retryable && attempt === 0) {
          lastError = error;
          continue;
        }
        throw error;
      }
      lastError = new RenderFailed("No se pudo conectar con el servicio de render.", { retryable: true });
      if (attempt === 0) continue;
      throw lastError;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError ?? new RenderFailed("El servicio de render no respondió.", { retryable: true });
}

/** El mensaje para la persona de cualquier error del render (sin detalles técnicos). */
export function renderErrorMessage(error: unknown): string {
  if (error instanceof RenderNotConfigured) return RENDER_NOT_CONFIGURED_MESSAGE;
  if (error instanceof RenderFailed) {
    if (error.userMessage) return error.userMessage;
    return error.retryable ? "El servicio de render no respondió. Se vuelve a intentar solo." : "No se pudo armar el archivo.";
  }
  return "No se pudo armar el archivo.";
}
