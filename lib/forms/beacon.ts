/**
 * Vistas e inicios de un formulario (F14). SOLO servidor.
 *
 * `POST /api/public/forms/[slug]/beacon` con `{ kind: "view" | "start", sid }`.
 * Responde SIEMPRE 204 y no revela nada (ni si el formulario existe, ni si se
 * escribió el evento). Reglas:
 *  1. `sid` tiene que ser un UUID (el navegador lo genera una vez por pestaña).
 *  2. Tope de 60 beacons por IP por hora, en total.
 *  3. El formulario tiene que estar publicado.
 *  4. Deduplicado por sesión: una vista y un inicio por `sid` y formulario cada
 *     24 horas. El `sid` NO se guarda en claro en ningún lado: solo viaja hasheado
 *     en la clave del tope.
 *  5. El evento va a `analytics_events` con `contact_id` y `flow_id` null y una
 *     `metadata` de `{ form_id, version_id }`: nada personal, ni IP ni sid.
 */
import { z } from "zod";
import { isValidSessionId } from "@/lib/antispam/rate-limit";
import type { LimitResult, LimitSpec } from "@/lib/antispam/rate-limit";
import { FORM_LIMITS, HOUR_MS } from "./limits";

export interface BeaconForm {
  id: string;
  workspaceId: string;
  versionId: string;
}

export interface BeaconPorts {
  limit(spec: LimitSpec): Promise<LimitResult>;
  limitKeys: {
    beacon(ip: string): string;
    session(kind: "view" | "start", formId: string, sid: string): string;
  };
  loadPublishedForm(slug: string): Promise<BeaconForm | null>;
  insertEvent(input: { workspaceId: string; eventType: "form_view" | "form_start"; metadata: { form_id: string; version_id: string } }): Promise<void>;
}

const bodySchema = z.object({ kind: z.enum(["view", "start"]), sid: z.string() });

export interface BeaconOutcome {
  status: 204;
  wrote: boolean;
}

export async function handleBeacon(
  ports: BeaconPorts,
  input: { slug: string; ip: string; body: unknown },
): Promise<BeaconOutcome> {
  const nothing: BeaconOutcome = { status: 204, wrote: false };

  const parsed = bodySchema.safeParse(input.body);
  if (!parsed.success || !isValidSessionId(parsed.data.sid)) return nothing;
  const { kind, sid } = parsed.data;

  const ipLimit = await ports.limit({
    key: ports.limitKeys.beacon(input.ip),
    max: FORM_LIMITS.beaconPerIpPerHour,
    windowMs: HOUR_MS,
  });
  if (!ipLimit.allowed) return nothing;

  const form = await ports.loadPublishedForm(input.slug);
  if (!form) return nothing;

  const session = await ports.limit({
    key: ports.limitKeys.session(kind, form.id, sid),
    max: 1,
    windowMs: FORM_LIMITS.beaconSessionWindowHours * HOUR_MS,
  });
  if (!session.allowed) return nothing;

  await ports.insertEvent({
    workspaceId: form.workspaceId,
    eventType: kind === "view" ? "form_view" : "form_start",
    metadata: { form_id: form.id, version_id: form.versionId },
  });
  return { status: 204, wrote: true };
}
