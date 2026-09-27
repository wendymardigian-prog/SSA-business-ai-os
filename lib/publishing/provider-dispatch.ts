/**
 * Agendar del lado del proveedor (D1 a D4).
 *
 * El equivalente de `dispatcher.ts` para los publicadores que programan
 * ellos: en vez de esperar la hora y publicar, se le entrega el post con su
 * fecha y se guarda la referencia. Despues no hay nada que correr; el estado
 * vuelve por webhook.
 *
 * Todo el trabajo esta aca porque **puede tardar**: subir un video a Zernio
 * es la parte lenta. Por eso corre en un job, en su propia ruta, y la fila
 * queda en `uploading` mientras tanto en vez de bloquear la pantalla.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database";
import { PublishError, classifyPublishError } from "@/lib/jobs/errors";
import { getPublisher } from "./registry";
import { buildInput, type PublishDeps } from "./dispatcher";
import { ensureMediaInZernio } from "./zernio-media";
import { onPublicationSettled, refreshPostStatus } from "./settled";
import { createZernioClient } from "@/lib/zernio-client";

type Db = SupabaseClient<Database>;

export interface ProviderScheduleOutcome {
  kind: "scheduled" | "skipped" | "failed";
  detail?: string;
}

/**
 * Un id de pedido estable para esta fila y este intento (A15, D7).
 *
 * Estable dentro del intento: si la red se corta despues de que Zernio
 * acepto, el reintento manda el mismo y recibe el post original. Distinto
 * entre intentos: un reintento deliberado horas despues si tiene que crear
 * uno nuevo, porque la ventana de Zernio son ~5 minutos.
 */
export function scheduleRequestId(socialPostId: string, attempt: number): string {
  return `${socialPostId}:${attempt}`;
}

export interface ProviderScheduleDeps extends PublishDeps {
  /** Inyectable para la verificacion: el cliente que sube la media. */
  zernioClientFor?: (token: string) => Parameters<typeof ensureMediaInZernio>[1]["client"];
  /** Inyectable para la verificacion: nunca se llama a nadie de verdad. */
  fetchImpl?: typeof fetch;
}

/**
 * Agenda (o reagenda) UNA fila en el proveedor.
 *
 * Idempotente por el id de pedido: correrlo dos veces con el mismo intento
 * no crea dos posts.
 */
export async function runProviderSchedule(
  supabase: Db,
  socialPostId: string,
  deps: ProviderScheduleDeps,
): Promise<ProviderScheduleOutcome> {
  const { data: row } = await supabase
    .from("social_posts")
    .select(
      "id, workspace_id, content_post_id, platform, publisher, publisher_ref, status, scheduled_at, attempts, requested_visibility, social_account_id, publish_progress",
    )
    .eq("id", socialPostId)
    .maybeSingle();

  if (!row) return { kind: "skipped", detail: "la publicacion ya no existe" };

  // Solo se agenda lo que esta esperando que se lo agende. Si alguien la
  // desprogramo mientras el job hacia cola, no hay nada que hacer.
  if (row.status !== "uploading" && row.status !== "scheduled") {
    return { kind: "skipped", detail: `la publicacion esta en "${row.status}"` };
  }

  const attempts = (row.attempts ?? 0) + 1;
  await supabase.from("social_posts").update({ attempts }).eq("id", socialPostId);

  try {
    const publisher = getPublisher(row.publisher ?? "");
    if (!publisher.scheduler) {
      throw new PublishError(`"${row.publisher}" no agenda del lado del proveedor`, "permanent");
    }

    const accountRef = await accountRefFor(supabase, row.social_account_id, row.publisher ?? "");
    const input = await buildInput(supabase, { ...row, accountRef }, deps);
    const credentials = await deps.credentialsFor({
      publisherId: row.publisher ?? "",
      workspaceId: row.workspace_id,
      platform: row.platform,
    });

    // La media tiene que estar del lado del proveedor: nuestros links
    // firmados vencen en 24 horas y el post puede salir la semana que viene.
    if (publisher.uploadsMedia && input.media.length > 0) {
      const client = (deps.zernioClientFor ?? createZernioClient)(credentials.token);
      input.mediaUrls = await ensureMediaInZernio(supabase, {
        workspaceId: row.workspace_id,
        client: client as never,
        media: input.media,
        signedUrls: input.mediaUrls,
        fetchImpl: deps.fetchImpl,
      });
    }

    const timezone = await workspaceTimezone(supabase, row.workspace_id);
    const request = {
      input,
      credentials,
      at: row.scheduled_at ?? new Date().toISOString(),
      timezone,
      requestId: scheduleRequestId(row.id, attempts),
      now: !row.scheduled_at,
    };

    // Ya estaba agendado alla: esto es un cambio de fecha o de contenido.
    if (row.publisher_ref) {
      await publisher.scheduler.update({ ...request, ref: row.publisher_ref });
      await supabase
        .from("social_posts")
        .update({ status: "scheduled", last_error: null, last_error_kind: null })
        .eq("id", row.id);
    } else {
      const { ref } = await publisher.scheduler.create(request);
      await supabase
        .from("social_posts")
        .update({
          status: "scheduled",
          publisher_ref: ref,
          last_error: null,
          last_error_kind: null,
        })
        .eq("id", row.id);
    }

    await refreshPostStatus(supabase, row.content_post_id);
    return { kind: "scheduled" };
  } catch (err) {
    const error = classifyPublishError(err);
    await supabase
      .from("social_posts")
      .update({
        status: "failed",
        last_error: error.message,
        last_error_kind: error.kind,
      })
      .eq("id", socialPostId);

    await onPublicationSettled(supabase, socialPostId);
    return { kind: "failed", detail: error.message };
  }
}

/**
 * Saca la publicacion de la agenda del proveedor (D4).
 *
 * Nunca lanza: si el proveedor no contesta, la fila igual queda cancelada de
 * este lado y se anota el motivo. Dejarla "programada" porque no pudimos
 * avisarle a Zernio seria peor: la persona la desprogramo.
 */
export async function cancelOnProvider(
  supabase: Db,
  row: { id: string; workspace_id: string; platform: string; publisher: string | null; publisher_ref: string | null },
  deps: Pick<PublishDeps, "credentialsFor">,
): Promise<{ ok: boolean; detail?: string }> {
  if (!row.publisher_ref) return { ok: true };

  try {
    const publisher = getPublisher(row.publisher ?? "");
    if (!publisher.scheduler) return { ok: true };

    const credentials = await deps.credentialsFor({
      publisherId: row.publisher ?? "",
      workspaceId: row.workspace_id,
      platform: row.platform,
    });
    await publisher.scheduler.cancel({ ref: row.publisher_ref, credentials });
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error("[publishing] no pude cancelar en el proveedor:", detail);
    return { ok: false, detail };
  }
}

/** Reintenta del lado del proveedor una que fallo alla (D4). */
export async function retryOnProvider(
  supabase: Db,
  row: { id: string; workspace_id: string; platform: string; publisher: string | null; publisher_ref: string | null },
  deps: Pick<PublishDeps, "credentialsFor">,
): Promise<{ ok: boolean; detail?: string }> {
  if (!row.publisher_ref) return { ok: false, detail: "esa publicacion no llego al proveedor" };

  try {
    const publisher = getPublisher(row.publisher ?? "");
    if (!publisher.scheduler) return { ok: false, detail: "ese camino no reintenta del lado del proveedor" };

    const credentials = await deps.credentialsFor({
      publisherId: row.publisher ?? "",
      workspaceId: row.workspace_id,
      platform: row.platform,
    });
    await publisher.scheduler.retry({ ref: row.publisher_ref, credentials });

    await supabase
      .from("social_posts")
      .update({ status: "scheduled", last_error: null, last_error_kind: null })
      .eq("id", row.id);
    return { ok: true };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return { ok: false, detail };
  }
}

/** La zona del workspace: Zernio interpreta la fecha con ella. */
async function workspaceTimezone(supabase: Db, workspaceId: string): Promise<string> {
  const { data } = await supabase
    .from("workspaces")
    .select("timezone")
    .eq("id", workspaceId)
    .maybeSingle();
  return data?.timezone || "America/Argentina/Buenos_Aires";
}

/** El mismo criterio que el despachador: cada publicador tiene su cuenta. */
async function accountRefFor(
  supabase: Db,
  socialAccountId: string | null,
  publisherId: string,
): Promise<string | null> {
  if (!socialAccountId) return null;
  const { data } = await supabase
    .from("social_accounts")
    .select("external_id, publishers")
    .eq("id", socialAccountId)
    .maybeSingle();

  if (!data) return null;
  const publishers = (Array.isArray(data.publishers) ? data.publishers : []) as Array<{
    publisher?: string;
    account_ref?: string | null;
  }>;
  return publishers.find((p) => p.publisher === publisherId)?.account_ref ?? data.external_id ?? null;
}
