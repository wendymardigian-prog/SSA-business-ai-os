/**
 * Receptor de los correos entrantes de Resend (F63).
 *
 * El tercer receptor del sistema, y sigue las mismas reglas que los otros
 * dos: firma validada antes de tocar nada, idempotencia por el id del
 * evento, 200 inmediato y procesamiento con `after()`.
 *
 * Suscripcion a emails (E4): tambien recibe `email.bounced` y `email.complained`
 * (lib/email/delivery-events.ts), con el MISMO secreto y las mismas reglas. Un
 * rebote duro deja la direccion en `bounced`; una queja, en `complained`.
 *
 * Conexion de Resend (R3/R4):
 * - La URL que registra SSA lleva `?w=<workspace>` (un webhook por negocio). El parametro solo elige con QUE secreto
 *   se verifica: la firma sigue siendo obligatoria, y un `w` que no es un id o no tiene secreto da 401. Sin el
 *   parametro, todo funciona como antes (compatibilidad con un webhook creado a mano).
 * - El secreto es el del webhook de Resend del negocio, este o no prendida la recepcion: rebotes y quejas no dependen
 *   de recibir emails.
 * - Un email entra si va a CUALQUIER direccion del dominio del canal (no solo a la exacta). Dos negocios con el mismo
 *   dominio y sin `?w=`: 401 y una linea en el log (no se adivina).
 * - Cada aviso valido anota `integration_configs.last_event_at` (a lo sumo una vez por minuto, nunca frena nada).
 *
 * Lo que hace distinto, y es lo importante de este archivo: **no llama a
 * `maybeScheduleAgentTurn`**. El agente esta hecho para chat —contesta
 * corto y en el momento— y un email contestado asi se lee mal. Ademas
 * nadie lo pidio. Hay un test con espia que lo verifica, porque es la clase
 * de cosa que alguien agrega "por consistencia" sin darse cuenta.
 */

import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { readSecret, SECRET_NAMES } from "@/lib/vault";
import { claimWebhookEvent, type ChannelRow } from "@/lib/inbound";
import { verifySvixSignature, REJECTION_REASONS } from "@/lib/email/svix";
import { inboundRecipients, pickOurAddress, domainOf, resolveInboundChannel, type InboundChannelRef } from "@/lib/email/inbound-address";
import { RESEND_WORKSPACE_PARAM } from "@/lib/webhook-url";
import { processInboundEmail, type InboundEmail } from "@/lib/email/inbound";
import { fetchReceivedEmail } from "@/lib/email/receiving";
import { runEmailTriggers } from "@/lib/email/triggers";
import { applyDeliveryEvent, candidateWorkspaces, isDeliveryEvent, type DeliveryEvent } from "@/lib/email/delivery-events";

interface ResendEvent {
  type?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[];
    cc?: string[];
    received_for?: string[];
    subject?: string;
    created_at?: string;
  };
}

export async function POST(request: NextRequest) {
  try {
    return await handle(request);
  } catch (err) {
    console.error("[resend-inbound] error procesando el correo:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

async function handle(request: NextRequest) {
  const body = await request.text();

  let event: ResendEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  // El negocio elegido por la URL (`?w=`), o null sin parametro. Un parametro que no es un id se rechaza: no se
  // cae a "probar con todos", que es justo lo que el parametro evita.
  const wParam = request.nextUrl.searchParams.get(RESEND_WORKSPACE_PARAM);
  if (wParam !== null && !UUID.test(wParam)) {
    console.error("[resend-inbound] rechazado: parametro de negocio invalido");
    return NextResponse.json({ error: "Firma invalida" }, { status: 401 });
  }

  if (isDeliveryEvent(event.type)) {
    return handleDeliveryEvent(request, body, event as DeliveryEvent, wParam);
  }

  if (event.type !== "email.received") {
    return NextResponse.json({ ok: true, skipped: event.type ?? "sin tipo" });
  }

  const to = event.data?.to ?? [];
  const cc = event.data?.cc ?? [];
  const recipients = inboundRecipients({ to, cc, receivedFor: event.data?.received_for });
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, skipped: "sin destinatario" });
  }

  const supabase = await createServiceClient();

  // De que canal es se sabe por la direccion (o el dominio) a la que llego, o por `?w=`. Leer el cuerpo antes de
  // validar la firma no abre nada: lo unico que se hace con el es buscar un canal, y sin firma valida no se procesa
  // ni se escribe nada.
  let channelQuery = supabase
    .from("channels")
    .select("id, workspace_id, email_address")
    .eq("platform", "email")
    .eq("is_active", true);
  if (wParam) channelQuery = channelQuery.eq("workspace_id", wParam);
  const { data: channelRows } = await channelQuery;
  const channels = ((channelRows ?? []) as InboundChannelRef[]).filter((c) => !wParam || c.workspace_id === wParam);

  let channelRef: InboundChannelRef | null = null;
  if (wParam) {
    // Con `?w=` el negocio ya se sabe: se verifica primero con SU secreto, y despues se mira que el correo sea de su
    // dominio.
    const verified = await verifyFor(supabase, wParam, request, body);
    if (verified) return verified;
    const own = channels[0] ?? null;
    if (own && pickOurAddress(recipients, domainOf(own.email_address))) channelRef = own;
    if (!channelRef) return NextResponse.json({ ok: true, skipped: "direccion desconocida" });
  } else {
    const resolved = resolveInboundChannel(recipients, channels);
    if (resolved.kind === "unknown") {
      // Un correo a una direccion que no es nuestra: se reconoce y se ignora.
      return NextResponse.json({ ok: true, skipped: "direccion desconocida" });
    }
    if (resolved.kind === "ambiguous") {
      console.error(
        `[resend-inbound] rechazado: el dominio es de ${resolved.workspaceIds.length} negocios y el webhook no dice cual (falta ?${RESEND_WORKSPACE_PARAM}=)`,
      );
      return NextResponse.json({ error: "Firma invalida" }, { status: 401 });
    }
    channelRef = resolved.channel;
    const verified = await verifyFor(supabase, channelRef.workspace_id, request, body);
    if (verified) return verified;
  }

  const eventId = request.headers.get("svix-id");
  if (!(await claimWebhookEvent(supabase, eventId ? `resend:${eventId}` : null))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const emailId = event.data?.email_id;
  if (!emailId) {
    return NextResponse.json({ ok: true, skipped: "sin id de correo" });
  }

  const { data: channel } = await supabase
    .from("channels")
    .select("*")
    .eq("id", channelRef.id)
    .maybeSingle();

  const workspaceId = channelRef.workspace_id;

  if (!channel) {
    return NextResponse.json({ ok: true, skipped: "canal desconocido" });
  }

  // 200 y despues se procesa: traer el contenido y copiar los adjuntos
  // puede tardar mas de lo que Resend espera.
  after(async () => {
    try {
      await touchLastEvent(supabase, workspaceId);
      const full = await fetchReceivedEmail(supabase, {
        workspaceId,
        emailId,
      });

      const email: InboundEmail = full ?? {
        // Sin el contenido completo se guarda lo que trajo el evento: es
        // menos, pero es mejor que perder el correo.
        emailId,
        from: event.data?.from ?? "",
        to,
        cc,
        subject: event.data?.subject ?? null,
        text: null,
        html: null,
        messageId: null,
        inReplyTo: null,
        references: null,
        receivedAt: event.data?.created_at ?? new Date().toISOString(),
      };

      const result = await processInboundEmail(supabase, {
        channel: channel as ChannelRow,
        email,
      });

      // Los flows corren despues de guardar, y nunca con un automatico.
      if (result.stored && !result.automatic && result.conversationId && result.contactId) {
        await runEmailTriggers(supabase, {
          channel: channel as ChannelRow,
          contactId: result.contactId,
          conversationId: result.conversationId,
          subject: email.subject,
          text: email.text ?? "",
          emailId,
        });
      }

      // Sin el asunto ni el cuerpo: el log no lleva el contenido.
      console.log(
        `[resend-inbound] ${emailId}: ${result.stored ? "guardado" : "no guardado"}` +
          `${result.automatic ? " (automatico)" : ""}${result.note ? ` — ${result.note}` : ""}`,
      );
    } catch (err) {
      console.error("[resend-inbound] error procesando el correo:", err);
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

/**
 * Un rebote o una queja (E4). Primero se averigua de que workspace es y se valida la firma con SU secreto; recien
 * despues se toca algo. 200 inmediato y el cambio de estado en `after()`.
 */
async function handleDeliveryEvent(request: NextRequest, body: string, event: DeliveryEvent, wParam: string | null) {
  const supabase = await createServiceClient();
  const headers = signatureHeaders(request);

  let workspaceId: string | null = null;
  let lastReason: string | null = null;
  // Con `?w=` se prueba SOLO el secreto de ese negocio; sin el, cada candidato (lo de antes).
  const candidates = wParam ? [wParam] : await candidateWorkspaces(supabase, event);
  for (const candidate of candidates) {
    const secret = await readSecret(supabase, candidate, SECRET_NAMES.resendWebhookSecret).catch(() => null);
    if (!secret) continue;
    const verification = verifySvixSignature({ secret, headers, body });
    if (verification.ok) {
      workspaceId = candidate;
      break;
    }
    lastReason = REJECTION_REASONS[verification.reason];
  }

  if (!workspaceId) {
    console.error(`[resend-eventos] rechazado: ${lastReason ?? "ningun workspace con secreto del webhook"}`);
    return NextResponse.json({ error: "Firma invalida" }, { status: 401 });
  }

  if (!(await claimWebhookEvent(supabase, headers.id ? `resend:${headers.id}` : null))) {
    return NextResponse.json({ ok: true, skipped: "evento repetido" });
  }

  const ws = workspaceId;
  after(async () => {
    try {
      await touchLastEvent(supabase, ws);
      const result = await applyDeliveryEvent(supabase, ws, event);
      // Sin la direccion: el log no lleva datos de la persona.
      console.log(`[resend-eventos] ${event.type} ${event.data?.email_id ?? "(sin id)"}: ${result.note}`);
    } catch (err) {
      console.error("[resend-eventos] error procesando el evento:", err instanceof Error ? err.message : "error");
    }
  });

  return NextResponse.json({ ok: true, queued: true });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function signatureHeaders(request: NextRequest) {
  return {
    id: request.headers.get("svix-id"),
    timestamp: request.headers.get("svix-timestamp"),
    signature: request.headers.get("svix-signature"),
  };
}

/**
 * Verifica la firma con el secreto del webhook de Resend del negocio. Devuelve la respuesta de rechazo, o null si la
 * firma es valida.
 */
async function verifyFor(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  workspaceId: string,
  request: NextRequest,
  body: string,
): Promise<NextResponse | null> {
  const secret = await readSecret(supabase, workspaceId, SECRET_NAMES.resendWebhookSecret);
  if (!secret) {
    console.error("[resend-inbound] no hay secreto guardado; rechazo el correo");
    return NextResponse.json({ error: "Webhook sin secreto configurado" }, { status: 401 });
  }

  const verification = verifySvixSignature({ secret, headers: signatureHeaders(request), body });
  if (!verification.ok) {
    // El motivo va al log, no a la respuesta: quien llama es publico.
    console.error(`[resend-inbound] rechazado: ${REJECTION_REASONS[verification.reason]}`);
    return NextResponse.json({ error: "Firma invalida" }, { status: 401 });
  }
  return null;
}

/**
 * "Ultimo aviso recibido" de la tarjeta Resend (00279): solo la columna, a lo sumo una vez por minuto, y nunca frena
 * nada. Sin fila `resend` (una instalacion vieja con solo recepcion) no escribe nada.
 */
async function touchLastEvent(supabase: Awaited<ReturnType<typeof createServiceClient>>, workspaceId: string): Promise<void> {
  try {
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60_000).toISOString();
    await supabase
      .from("integration_configs")
      .update({ last_event_at: now.toISOString() })
      .eq("workspace_id", workspaceId)
      .eq("type", "email_provider")
      .eq("provider", "resend")
      .or(`last_event_at.is.null,last_event_at.lt.${minuteAgo}`);
  } catch (err) {
    console.error("[resend-inbound] no pude anotar el ultimo aviso:", err instanceof Error ? err.message : "error");
  }
}
