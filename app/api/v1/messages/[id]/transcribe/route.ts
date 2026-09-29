/**
 * Pedir la transcripcion de un audio a mano (F13).
 *
 * La usan dos botones de la burbuja: "Transcribir" (nunca se intento) y
 * "Reintentar transcripción" (fallo).
 *
 * La autorizacion la decide la RLS, no este archivo: primero se LEE el mensaje
 * con el cliente del USUARIO, asi el scope de leads aplica y un Member no puede
 * pedir la transcripcion de una conversacion que no le corresponde. Recien
 * despues se encola con service role, porque `scheduled_jobs` es una cola
 * interna sin policy de escritura.
 *
 * Si la RLS no deja ver el mensaje se responde 404 y no 403: confirmar que
 * existe ya seria decir algo.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { scheduleJob } from "@/lib/scheduler";
import {
  TRANSCRIBE_AUDIO_JOB,
  transcribeDedupeKey,
  type TranscribeAudioPayload,
} from "@/lib/jobs/handlers/transcribe-audio";
import { canTranscribe } from "@/lib/inbox/transcript-state";

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!id) return NextResponse.json({ error: "Falta el mensaje" }, { status: 400 });

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  // Con el cliente del usuario: la RLS y el scope de leads deciden.
  const { data: message } = await supabase
    .from("messages")
    .select("id, transcript_status, attachments")
    .eq("id", id)
    .maybeSingle();

  if (!message) {
    return NextResponse.json({ error: "No encontre ese mensaje" }, { status: 404 });
  }

  if (message.transcript_status === "pending") {
    // Ya esta corriendo. No es un error: el resultado es el que se pedia.
    return NextResponse.json({ ok: true, status: "already_running" });
  }

  if (!canTranscribe(message)) {
    return NextResponse.json(
      { error: "Este mensaje no tiene un audio disponible para transcribir" },
      { status: 409 },
    );
  }

  const service = await createServiceClient();

  // El claim del job pide `none` o `failed`, y las dos son estados desde los que
  // se puede retomar, asi que no hace falta tocar la fila aca.
  try {
    await scheduleJob(
      service,
      TRANSCRIBE_AUDIO_JOB,
      { messageId: id } satisfies TranscribeAudioPayload,
      new Date(),
      transcribeDedupeKey(id),
    );
  } catch (err) {
    // 23505: ya hay un job pendiente para este mensaje. Tampoco es un error.
    if ((err as { code?: string } | null)?.code === "23505") {
      return NextResponse.json({ ok: true, status: "already_running" });
    }
    console.error("[transcribe-retry] no pude encolar:", err instanceof Error ? err.message : "desconocido");
    return NextResponse.json({ error: "No pude encolar la transcripcion" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, status: "queued" });
}
