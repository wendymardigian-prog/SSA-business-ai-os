/**
 * Lo que responden las rutas del link público de un diseño (F43, F44): la imagen de cada página, la descarga y
 * la imagen de la tarjeta. Solo servidor. Las rutas de `app/d/[code]/…` son un envoltorio fino de estas
 * funciones, que reciben el cliente de servicio por parámetro y se prueban sin red.
 *
 * Reglas de todas:
 * - sin sesión; el código decide;
 * - tope por IP (429) y un 404 con el tiempo emparejado para lo que no existe o no se puede ver;
 * - lo que se muestra o se baja sale de `design_public_get` (`decidePublicView`): un borrador, una pieza que se
 *   prepara o una anulada no entregan archivos; la descarga además pide que esté permitida;
 * - los archivos viven en el bucket PRIVADO `design-renders` y salen por streaming desde acá: nunca se expone el
 *   bucket ni un link firmado que se pueda reusar.
 */

import { zipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveBrand } from "@/lib/brand";
import { renderShareImage } from "@/lib/og/image";
import { truncateText } from "@/lib/og/text";
import type { Database } from "@/lib/types/database";
import { FORMATS } from "../formats";
import { enqueueDesignRender } from "../jobs/render";
import { DESIGN_RENDERS_BUCKET } from "../storage";
import { attachmentHeader, contentTypeOf, parseDownloadQuery, publicDownloadName, type DownloadFormat } from "./download";
import { downscalePng, needsDownscale, parseVariant, SHARE_IMAGE_WIDTH } from "./image";
import { loadPublicDesign, type PublicRecord } from "./load";
import { decidePublicView } from "./model";
import { notFoundResponse, tooManyResponse, withinPublicLimit } from "./guard";
import { designShare, previewSource } from "./share";

type Service = SupabaseClient<Database>;

export interface ServeDeps {
  enqueue?: typeof enqueueDesignRender;
  /** El 404 con el tiempo emparejado (los tests lo pasan sin espera). */
  notFound?: (startedAt: number) => Promise<Response>;
  /** La imagen generada con la marca (los tests no dibujan de verdad). */
  renderImage?: typeof renderShareImage;
}

const PREPARING_BODY = "Se está preparando, probá en unos segundos";

async function readFile(service: Service, path: string): Promise<Blob | null> {
  const { data, error } = await service.storage.from(DESIGN_RENDERS_BUCKET).download(path);
  if (error || !data) return null;
  return data;
}

/** Una página como PNG: `/d/<código>/p/<n>` (n desde 1), a ×1 o ×2 según `?x=`. */
export async function servePageImage(service: Service, request: Request, code: string, pageParam: string, deps: ServeDeps = {}): Promise<Response> {
  const startedAt = Date.now();
  const notFound = deps.notFound ?? notFoundResponse;
  if (!(await withinPublicLimit(service, request.headers, "image"))) return tooManyResponse();

  const record = await loadPublicDesign(service, code);
  if (!record) return notFound(startedAt);
  const view = decidePublicView(record.pub);
  if (view.screen !== "pieces") return notFound(startedAt);
  if (!/^\d{1,3}$/.test(pageParam)) return notFound(startedAt);
  const page = Number(pageParam);
  const path = record.renders?.pages[page - 1];
  if (page < 1 || page > record.pub.pageCount || !path) return notFound(startedAt);

  const file = await readFile(service, path);
  if (!file) return notFound(startedAt);

  const headers = { "Content-Type": "image/png", "Cache-Control": "private, max-age=600", "X-Content-Type-Options": "nosniff" };
  const variant = parseVariant(new URL(request.url).searchParams.get("x"));
  if (needsDownscale(record.pub.format, variant)) {
    const bytes = await downscalePng(new Uint8Array(await file.arrayBuffer()), FORMATS[record.pub.format].width);
    return new Response(Buffer.from(bytes), { headers });
  }
  return new Response(file.stream(), { headers: { ...headers, "Content-Length": String(file.size) } });
}

/** Qué archivos hacen falta para lo que se pidió, o null si el juego todavía no los tiene. */
export function filesFor(record: Pick<PublicRecord, "renders" | "pub">, formato: DownloadFormat, pagina: number): string[] | null {
  const renders = record.renders;
  if (!renders) return null;
  if (formato === "pdf") return renders.pdfPath ? [renders.pdfPath] : null;
  if (formato === "png") return renders.pages[pagina - 1] ? [renders.pages[pagina - 1]] : null;
  return renders.pages.length === record.pub.pageCount ? renders.pages : null;
}

/** La descarga: `/d/<código>/descargar?formato=pdf|zip|png&pagina=N`. */
export async function serveDownload(service: Service, request: Request, code: string, deps: ServeDeps = {}): Promise<Response> {
  const startedAt = Date.now();
  const notFound = deps.notFound ?? notFoundResponse;
  const enqueue = deps.enqueue ?? enqueueDesignRender;
  if (!(await withinPublicLimit(service, request.headers, "download"))) return tooManyResponse();

  const record = await loadPublicDesign(service, code);
  if (!record) return notFound(startedAt);
  const { pub } = record;
  const view = decidePublicView(pub);
  // Con la descarga apagada, anulada o sin permiso: 404, como si no existiera.
  if (!view.download.allowed) return notFound(startedAt);
  const query = parseDownloadQuery(new URL(request.url).searchParams, pub.format, pub.pageCount);
  if (!query.ok) return notFound(startedAt);

  const paths = view.download.ready ? filesFor(record, query.formato, query.pagina) : null;
  const blobs: Blob[] = [];
  if (paths) {
    for (const path of paths) {
      const blob = await readFile(service, path);
      if (!blob) break;
      blobs.push(blob);
    }
  }

  if (!paths || blobs.length !== paths.length) {
    // Todavía no está el archivo: se pide el render del diseño (una generación nunca se re-renderiza desde acá,
    // porque volvería a avisar a los módulos que la emitieron) y se pide volver a probar.
    if (pub.kind === "design") {
      try {
        await enqueue(service, { designId: record.designId, purpose: "publish" });
      } catch (error) {
        console.error("[disenos] no pude encolar el render:", error instanceof Error ? error.message : "error");
      }
    }
    return new Response(PREPARING_BODY, { status: 202, headers: { "Retry-After": "5", "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" } });
  }

  const fileName = publicDownloadName(pub.name, query.formato, query.pagina, pub.pageCount);
  const headers = {
    "Content-Type": contentTypeOf(query.formato),
    "Content-Disposition": attachmentHeader(fileName),
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (query.formato === "zip") {
    const entries: Record<string, Uint8Array> = {};
    for (let i = 0; i < blobs.length; i++) entries[`${String(i + 1).padStart(2, "0")}.png`] = new Uint8Array(await blobs[i].arrayBuffer());
    return new Response(Buffer.from(zipSync(entries, { level: 0 })), { headers });
  }
  return new Response(blobs[0].stream(), { headers: { ...headers, "Content-Length": String(blobs[0].size) } });
}

/** La imagen de la tarjeta: la página 1 de los archivos de publicar o, si no hay, la generada con la marca del negocio. */
export async function servePreview(service: Service, request: Request, code: string, deps: ServeDeps = {}): Promise<Response> {
  const startedAt = Date.now();
  const notFound = deps.notFound ?? notFoundResponse;
  const renderImage = deps.renderImage ?? renderShareImage;
  if (!(await withinPublicLimit(service, request.headers, "preview"))) return tooManyResponse();

  const record = await loadPublicDesign(service, code);
  if (!record) return notFound(startedAt);
  const view = decidePublicView(record.pub);
  const source = previewSource(record, view);
  const headers = { "Content-Type": "image/png", "Cache-Control": "public, max-age=3600", "X-Content-Type-Options": "nosniff" };

  if (source.kind === "page") {
    const file = await readFile(service, source.path);
    if (file) {
      const bytes = await downscalePng(new Uint8Array(await file.arrayBuffer()), SHARE_IMAGE_WIDTH);
      return new Response(Buffer.from(bytes), { headers });
    }
  }
  try {
    const share = designShare(record, view);
    const image = await renderImage({ brand: resolveBrand(record.workspace), title: share.imageTitle, subtitle: truncateText(share.imageSubtitle, 90) });
    return new Response(Buffer.from(image), { headers });
  } catch (error) {
    console.error("[disenos] no pude armar la imagen de la tarjeta:", error instanceof Error ? error.message : "error");
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
