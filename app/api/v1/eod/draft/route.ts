/**
 * Guardar el borrador de un reporte de fin de día al cerrar u ocultar la pestaña (E7).
 *
 * Existe porque una Server Action no se puede llamar desde `pagehide` con
 * `fetch(..., { keepalive: true })`: esta ruta hace lo mismo que `saveEodDraft` (el mismo
 * núcleo) y la cookie de sesión viaja igual. La persona y el workspace salen de la sesión.
 */
import { NextRequest, NextResponse } from "next/server";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { eodPorts } from "@/lib/eod/server-ports";
import { saveDraftCore } from "@/lib/eod/submit";
import { MAX_DRAFT_BYTES } from "@/lib/eod/draft-shape";

const STATUS: Record<string, number> = { invalid: 400, not_available: 403, date: 400, already_submitted: 409, conflict: 409, failed: 500 };

export async function POST(request: NextRequest) {
  const ctx = await getMemberAction();
  if (!ctx) return NextResponse.json({ ok: false, error: "Sin sesión" }, { status: 401 });

  const text = await request.text();
  if (text.length > MAX_DRAFT_BYTES + 2_000) return NextResponse.json({ ok: false, error: "Demasiado grande" }, { status: 413 });
  let body: { formId?: unknown; reportDate?: unknown; rev?: unknown; data?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, error: "JSON inválido" }, { status: 400 });
  }

  const service = await createServiceClient();
  const result = await saveDraftCore(eodPorts(service), {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    formId: String(body.formId ?? ""),
    reportDate: body.reportDate,
    rev: body.rev,
    data: body.data,
  });
  return NextResponse.json(result, { status: result.ok ? 200 : (STATUS[result.code] ?? 400) });
}
