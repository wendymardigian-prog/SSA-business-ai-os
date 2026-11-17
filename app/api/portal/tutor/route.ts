// @plantilla-quitar(servicios)
/**
 * El Asistente IA del portal (F230). El portal no tiene keys de IA: pide, firmado con PORTAL_SHARED_SECRET, que el tutor
 * del programa responda una pregunta del estudiante. La base valida la sesión, la sección, los créditos y los topes
 * (`portal_tutor_begin`); acá se corre el modelo y se guarda la respuesta (lib/portal-tutor/answer.ts).
 */
import { NextResponse, type NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyPortalRequest } from "@/lib/portal-admin/portal-signature";
import { askPortalTutor } from "@/lib/portal-tutor/answer";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: NextRequest) {
  const body = await request.text();
  if (body.length > 10_000) return NextResponse.json({ ok: false }, { status: 413 });
  const okSig = verifyPortalRequest({
    secret: process.env.PORTAL_SHARED_SECRET,
    timestamp: request.headers.get("x-portal-timestamp"),
    signature: request.headers.get("x-portal-signature"),
    body,
    nowMs: Date.now(),
  });
  if (!okSig) return NextResponse.json({ ok: false }, { status: 401 });
  let input: { session?: unknown; product_id?: unknown; thread_id?: unknown; question?: unknown };
  try {
    input = JSON.parse(body);
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  const threadId = input.thread_id ?? null;
  if (
    typeof input.session !== "string" ||
    typeof input.product_id !== "string" ||
    !UUID.test(input.product_id) ||
    (threadId !== null && (typeof threadId !== "string" || !UUID.test(threadId))) ||
    typeof input.question !== "string"
  ) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const service = await createServiceClient();
  const out = await askPortalTutor(service, { session: input.session, productId: input.product_id, threadId: threadId as string | null, question: input.question });
  return NextResponse.json(out, { status: out.ok ? 200 : out.code ? 403 : 502 });
}
