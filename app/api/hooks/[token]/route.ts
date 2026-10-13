/**
 * Receptor de webhooks entrantes: `POST /api/hooks/{token}`.
 *
 * Un formulario externo (Typeform, Tally, Framer…) manda un JSON o un formulario a esta URL.
 * Se guarda el envio, se responde 200 y DESPUES se procesa (`after()`): los emisores cortan a
 * los pocos segundos y reintentan, y procesar antes duplicaria. Todo el orden de validaciones
 * vive en `lib/webhooks/receive.ts`; esto es un envoltorio.
 *
 * Nunca devuelve datos de la base: solo `{ ok, id }`, `{ ok, duplicate }` o un codigo de error
 * sin detalle. Y nunca escribe el token, el secreto ni el payload en un log.
 */
import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { receiveWebhook } from "@/lib/webhooks/receive";
import { receiveDeps } from "@/lib/webhooks/server-ports";
import { processInbound } from "@/lib/webhooks/process";

export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const db = await createServiceClient();
    const result = await receiveWebhook(receiveDeps(db, request), {
      token,
      secretHeader: request.headers.get("x-webhook-secret"),
      contentType: request.headers.get("content-type"),
      searchParams: request.nextUrl.searchParams,
      ip: request.headers.get("x-forwarded-for") ?? request.headers.get("x-real-ip"),
      userAgent: request.headers.get("user-agent"),
    });

    if (result.process) {
      const { inboundId } = result.process;
      after(async () => {
        try {
          await processInbound(db, inboundId);
        } catch (err) {
          // Sin el token ni el payload: solo el id del envio y el mensaje.
          console.error(`[hooks] fallo procesando el envio ${inboundId}:`, err instanceof Error ? err.message : String(err));
        }
      });
    }

    return NextResponse.json(result.body, { status: result.status, headers: result.headers });
  } catch (err) {
    console.error("[hooks] error en el receptor:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
