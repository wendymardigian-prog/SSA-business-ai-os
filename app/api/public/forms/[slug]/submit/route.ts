import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/scheduling/antispam";
import { submitForm, bodyLimitBytes, type UploadedFile } from "@/lib/forms/submit";
import { createSubmitPorts, loadPublishedForm } from "@/lib/forms/server-ports";
import { FORM_LIMITS } from "@/lib/forms/limits";
import { appUrl } from "@/lib/app-url";
import { corsHeaders, decideOrigin, selfOrigins, withCors } from "@/lib/http/cors";
import { declaresMoreThan, readBytesCapped } from "@/lib/http/read-capped";
import { originsForWorkspace } from "@/lib/http/workspace-origins";
import { workspaceOfPublishedForm } from "@/lib/forms/site-origins";
import type { WebsiteSettings } from "@/lib/settings/website";

export const dynamic = "force-dynamic";

const METHODS = ["POST"];
const NO_ORIGINS: WebsiteSettings = { allowedOrigins: [] };

function json(body: Record<string, unknown>, status: number, headers: Record<string, string>) {
  return NextResponse.json(body, { status, headers: withCors(headers) });
}

/**
 * OPTIONS: el "¿puedo?" del navegador antes de un envío con `Content-Type: application/json`
 * desde la web de un cliente. 204 siempre; con los headers de CORS solo si el origen está en
 * la lista del workspace dueño del formulario.
 */
export async function OPTIONS(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const origin = request.headers.get("origin");
  let settings = NO_ORIGINS;
  try {
    const service = await createServiceClient();
    const workspaceId = await workspaceOfPublishedForm(service, slug);
    if (workspaceId) settings = await originsForWorkspace(service, workspaceId);
  } catch {
    settings = NO_ORIGINS;
  }
  const decision = decideOrigin(origin, selfOrigins(appUrl(), request.headers), settings);
  return new NextResponse(null, { status: 204, headers: withCors(corsHeaders(decision, origin, METHODS)) });
}

/**
 * POST /api/public/forms/[slug]/submit (F12): el envío de un formulario.
 *
 * Dos formas de mandarlo:
 *   - `multipart/form-data`: un campo `payload` (JSON) y los archivos en campos
 *     `file:<clave del campo>` (la página `/f/<slug>`, el embed y el sitio propio).
 *   - `application/json`: el `payload` directo, sin archivos (la web de un cliente).
 *
 * El orden de esta ruta:
 *   1. Un cuerpo que DECLARA más del tope grande → 413 sin leer nada.
 *   2. El formulario y los orígenes de su workspace. Un `Origin` que no es la app ni uno
 *      permitido → 403 `origin_not_allowed`, sin guardar (ver `lib/http/cors.ts`).
 *   3. El tope de ESTE formulario (64 KB sin archivos ni firma) → 413, cortando la lectura.
 *   4. `submitForm` (topes por IP, honeypot, idempotencia, validación: `lib/forms/submit.ts`).
 * Cada respuesta lleva los headers de CORS si el origen está permitido.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const origin = request.headers.get("origin");

  if (declaresMoreThan(request.headers, FORM_LIMITS.maxBodyMb * 1024 * 1024)) {
    return json(tooLarge(), 413, {});
  }

  const service = await createServiceClient();
  const ports = createSubmitPorts(service);
  const form = await loadPublishedForm(service, slug);
  const settings = form ? await originsForWorkspace(service, form.workspaceId) : NO_ORIGINS;
  const decision = decideOrigin(origin, selfOrigins(appUrl(), request.headers), settings);
  const cors = corsHeaders(decision, origin, METHODS);

  if (decision === "denied") {
    console.info(`[forms] submit form=${form?.id ?? "?"} result=origin_not_allowed`);
    return json({ ok: false, error: "origin_not_allowed" }, 403, {});
  }

  if (!form) {
    // Sin leer el cuerpo: `submitForm` aplica el tope por IP y responde 404.
    const outcome = await submitForm(ports, { slug, ip: clientIp(request.headers), userAgent: null, cookieHeader: null, payload: null, files: [] });
    return json(outcome.body, outcome.status, cors);
  }

  const read = await readBytesCapped(request, bodyLimitBytes(form));
  if (!read.ok) {
    console.info(`[forms] submit form=${form.id} result=payload_too_large`);
    return json(tooLarge(), 413, cors);
  }

  const parsed = await parseBody(read.bytes, request.headers.get("content-type") ?? "");
  if (!parsed) return json({ ok: false, error: "invalid_request" }, 400, cors);

  // El formulario ya está cargado: `submitForm` no lo vuelve a buscar.
  const outcome = await submitForm(
    { ...ports, loadForm: async () => form },
    {
      slug,
      ip: clientIp(request.headers),
      userAgent: request.headers.get("user-agent"),
      cookieHeader: request.headers.get("cookie"),
      payload: parsed.payload,
      files: parsed.files,
    },
  );
  return json(outcome.body, outcome.status, cors);
}

function tooLarge(): Record<string, unknown> {
  return { ok: false, error: "payload_too_large", message: "El envío es demasiado grande. Probá con archivos más livianos." };
}

/** El `payload` y los archivos, de un cuerpo JSON o multipart ya leído. `null` = ilegible (400). */
async function parseBody(bytes: Uint8Array, contentType: string): Promise<{ payload: unknown; files: UploadedFile[] } | null> {
  if (contentType.toLowerCase().startsWith("application/json")) {
    try {
      return { payload: JSON.parse(new TextDecoder().decode(bytes)), files: [] };
    } catch {
      return null;
    }
  }

  let form: FormData;
  try {
    form = await new Response(bytes as BodyInit, { headers: { "content-type": contentType } }).formData();
  } catch {
    return null;
  }

  let payload: unknown;
  try {
    const raw = form.get("payload");
    payload = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return null;
  }

  const files: UploadedFile[] = [];
  for (const [name, value] of form.entries()) {
    if (!name.startsWith("file:") || typeof value === "string") continue;
    files.push({
      fieldKey: name.slice("file:".length),
      name: value.name,
      declaredType: value.type,
      bytes: new Uint8Array(await value.arrayBuffer()),
    });
  }
  return { payload, files };
}
