import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp } from "@/lib/scheduling/antispam";
import { submitForm, type UploadedFile } from "@/lib/forms/submit";
import { createSubmitPorts } from "@/lib/forms/server-ports";

export const dynamic = "force-dynamic";

/**
 * POST /api/public/forms/[slug]/submit (F12): el envío de un formulario.
 *
 * `multipart/form-data`: un campo `payload` (JSON) y los archivos en campos
 * `file:<clave del campo>`. Sin sesión: la defensa es el tope por IP, el
 * honeypot, Turnstile, la idempotencia y la validación total del servidor, todo
 * en `lib/forms/submit.ts`. Esta ruta solo lee el pedido y llama.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
  }

  let payload: unknown;
  try {
    const raw = form.get("payload");
    payload = typeof raw === "string" ? JSON.parse(raw) : null;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_request" }, { status: 400 });
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

  const service = await createServiceClient();
  const outcome = await submitForm(createSubmitPorts(service), {
    slug,
    ip: clientIp(request.headers),
    userAgent: request.headers.get("user-agent"),
    cookieHeader: request.headers.get("cookie"),
    payload,
    files,
  });

  return NextResponse.json(outcome.body, { status: outcome.status });
}
