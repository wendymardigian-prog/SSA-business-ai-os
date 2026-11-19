import { NextResponse, type NextRequest } from "next/server";
import { assistantActor } from "@/lib/assistant/actor";
import { encodeSse } from "@/lib/assistant/sse";
import { continueAssistantTurn, runAssistantTurn, type AssistantEvent } from "@/lib/assistant/turn";

/**
 * El asistente a pantalla completa en directo: eventos del servidor al navegador mientras trabaja.
 *
 * POST { text } empieza una respuesta; POST { continueId } reanuda la que estaba pausada o cortada. La sesión es la
 * de las cookies (el negocio y la persona nunca salen del cuerpo) y solo se acepta desde el mismo origen. Si quien mira
 * cierra la pestaña, la ejecución SIGUE en el servidor y cada paso queda guardado: al volver, la pantalla se dibuja
 * desde ahí.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    return new URL(origin).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host"));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Origen no permitido." }, { status: 403 });
  const a = await assistantActor();
  if (!a) return NextResponse.json({ error: "Tu sesión terminó. Volvé a entrar." }, { status: 401 });
  if (!a.ctx.can("assistant.use")) return NextResponse.json({ error: "Tu rol no tiene el permiso «Usar el asistente»." }, { status: 403 });

  let body: { text?: unknown; continueId?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Pedido no válido." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  let open = true;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: string, data: unknown) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(encodeSse(event, data)));
        } catch {
          open = false; // se cerró la pestaña: se sigue guardando, ya no se avisa
        }
      };
      const onEvent = (e: AssistantEvent) => send(e.type, e);
      const work = typeof body.continueId === "string" ? continueAssistantTurn(a.tool, body.continueId, { onEvent }) : runAssistantTurn(a.tool, body.text, { onEvent });
      work
        .then((r) => send("end", r.ok ? { ok: true } : { ok: false, code: r.code, message: r.message }))
        .catch((err) => {
          console.error("[assistant] la ruta en directo falló:", err instanceof Error ? err.message : String(err));
          send("end", { ok: false, code: "failed", message: "No pude responder ahora. Probá otra vez en un momento." });
        })
        .finally(() => {
          if (!open) return;
          open = false;
          try {
            controller.close();
          } catch {
            /* ya cerrado */
          }
        });
    },
    cancel() {
      open = false;
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
