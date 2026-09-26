/**
 * Receptor de los avisos de Postproxy (F35).
 *
 * **Advertencia sobre este archivo.** La documentacion publica de Postproxy
 * (api.postproxy.dev) NO documenta webhooks. El plano los daba por hechos;
 * gana la documentacion, asi que el camino real para saber como quedo una
 * publicacion por Postproxy es el job de revision
 * (`content_publish_check`), que pregunta por el estado.
 *
 * Este receptor queda igual, y es util aunque nunca se use: si Postproxy
 * suma avisos, alcanza con pegar la URL y guardar el secreto. Mientras
 * tanto no acepta nada, porque sin secreto guardado rechaza todo.
 *
 * El formato que interpreta es una suposicion razonable
 * (`lib/publishing/inbound.ts`): cuando se confirme, se ajusta ahi y este
 * archivo no cambia.
 */

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { constantTimeEquals } from "@/lib/crypto";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { claimWebhookEvent } from "@/lib/inbound";
import { fromPostproxyEvent, settlePublication } from "@/lib/publishing/inbound";

export async function POST(request: NextRequest) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[postproxy] error procesando el aviso:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handle(request: NextRequest) {
  const body = await request.text();

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const event = fromPostproxyEvent(payload);
  if (!event) {
    return NextResponse.json({ ok: true, skipped: "evento que no cambia nada" });
  }

  const supabase = await createServiceClient();

  // De que workspace es se deduce de la publicacion que estaba esperando esa
  // referencia. Como la URL es publica, sin publicacion no se valida nada:
  // no hay contra que secreto comparar y no hay nada que escribir.
  const { data: publication } = await supabase
    .from("social_posts")
    .select("workspace_id")
    .eq("publisher_ref", event.ref)
    .is("deleted_at", null)
    .limit(1)
    .maybeSingle();

  if (!publication) {
    return NextResponse.json({ ok: true, skipped: "publicacion desconocida" });
  }

  const expected = await readSecret(
    supabase,
    publication.workspace_id,
    SECRET_NAMES.postproxyWebhookSecret,
  );
  if (!expected) {
    // Sin secreto no se acepta: la URL es publica y cualquiera podria marcar
    // una publicacion como salida.
    console.error("[postproxy] no hay secreto guardado; rechazo el aviso");
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }

  const provided = request.headers.get("x-postproxy-signature") ?? request.headers.get("x-webhook-token");
  if (!provided || !constantTimeEquals(provided, expected)) {
    return NextResponse.json({ error: "Token invalido" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, `postproxy:${event.ref}:${event.result.status}`))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const settled = await settlePublication(supabase, event);
  return NextResponse.json({ ok: true, settled });
}
