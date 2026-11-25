/**
 * Aviso de «Fallos del sistema» cuando un trabajo de la cola (`scheduled_jobs`) se da por perdido después de todos sus
 * intentos (25/11/2026, traído de RER). Antes quedaba en `failed` y nadie se enteraba.
 *
 * - El negocio sale del payload (`workspaceId` o `workspace_id`): la tabla no tiene `workspace_id` a propósito (00046).
 *   Sin negocio, no se avisa (se loguea).
 * - Los tipos que ya avisan solos, o cuyo aviso formaría un bucle, quedan fuera (`JOB_TYPES_WITH_OWN_ALERT`).
 * - Un aviso por tipo de trabajo y negocio; no se repite en 7 días (`notifySystemFailure`).
 * - Nunca lanza: lo llama el runner justo después de marcar el job como fallido.
 */

import { notifySystemFailure } from "@/lib/notifications/system-alerts";

/** Los que no avisan desde acá. */
export const JOB_TYPES_WITH_OWN_ALERT: ReadonlySet<string> = new Set([
  // El job que manda los avisos: si avisara de su propio fallo, podría formar un bucle.
  "notification_deliver",
  // Ya tienen su aviso propio («Una publicación no salió», «El copywriter terminó», «Un chat necesita una persona»).
  "content_publish",
  "content_publish_check",
  "content_copy",
  "agent_burst",
]);

/** El nombre del trabajo, para leerlo sin saber de código. Un trabajo nuevo suma su nombre acá. */
export const JOB_LABELS: Readonly<Record<string, string>> = {
  svc_daily: "El barrido diario de Servicios (semáforo, renovaciones, hitos)",
  svc_certificate_issue: "La emisión de un certificado",
  portal_digest: "El resumen del portal para los estudiantes",
  portal_due_today: "El aviso de entregas del día en el portal",
  community_post_email: "El correo de un post nuevo de la comunidad",
  community_post_email_send: "El correo de un post nuevo de la comunidad",
  meta_ads_sync: "La sincronización de anuncios de Meta",
  meta_ad_thumbnails: "Las miniaturas de los anuncios de Meta",
  meta_capi_send: "El envío de eventos a Meta (API de Conversiones)",
  metrics_sync: "La sincronización de métricas de redes",
  google_calendar_inbound: "La lectura de Google Calendar",
  booking_google_sync: "El paso de una reunión a Google Calendar",
  booking_ended: "Lo que pasa al terminar una reunión",
  booking_relative_trigger: "Un recordatorio relativo a una reunión",
  payment_relative_trigger: "Un recordatorio relativo a un pago",
  fathom_sync: "La sincronización con Fathom",
  fathom_history_import: "La importación del historial de Fathom",
  call_summary: "El resumen de una grabación",
  call_analyze: "El análisis de una grabación",
  call_classify: "La clasificación de una grabación",
  call_index_knowledge: "El paso de una grabación a Conocimiento",
  call_missing_recording_sweep: "La búsqueda de grabaciones que faltan",
  finance_daily: "El cálculo diario de Finanzas",
  commissions_payment: "El cálculo de comisiones de un pago",
  payments_overdue_sweep: "La revisión de pagos vencidos",
  tasks_due_sweep: "La revisión de tareas que vencen",
  eod_reminder_sweep: "El recordatorio del reporte de fin de día",
  flow_scheduled_run: "Una automatización programada («En una fecha y hora»)",
  flow_wait_timeout: "Una espera de una automatización",
  resume_flow: "La continuación de una automatización",
  sales_contact_eval: "La asignación automática de un lead",
  contract_email: "El correo con la copia de un contrato",
  contract_pdf: "El PDF de un contrato",
  inbox_import: "La importación de conversaciones de Instagram",
  inbox_import_pass: "Una pasada de la importación de Instagram",
  whatsapp_history_import: "La importación del historial de WhatsApp",
  whatsapp_group_import: "La importación de miembros de un grupo de WhatsApp",
  whatsapp_media_retry: "La descarga de un archivo de WhatsApp",
  transcribe_audio: "La transcripción de un audio",
  describe_media: "La descripción de una imagen",
  design_render: "La generación de un archivo del Diseñador IA",
  design_ai_generate: "Un diseño con IA",
  design_generate_many: "Una generación masiva del Diseñador IA",
  design_content_sync: "El paso de un diseño a Contenido",
  design_cleanup: "La limpieza del Diseñador IA",
  content_upload: "La subida de un archivo de Contenido",
  content_provider_schedule: "La programación de una pieza en la red",
  comment_backfill: "El vínculo de comentarios con contactos",
  comment_backfill_workspace: "El vínculo de comentarios con contactos",
  zernio_ad_origin: "La búsqueda del anuncio de origen de un chat",
  bg_task: "Una tarea de IA en segundo plano",
  index_document: "La indexación de un documento de Conocimiento",
  conversation_close: "El cierre de una conversación",
};

export function jobLabel(type: string): string {
  return JOB_LABELS[type] ?? `Un trabajo automático (${type})`;
}

/** El negocio del trabajo, si viene en el payload. */
export function jobWorkspaceId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const id = typeof p.workspaceId === "string" ? p.workspaceId : typeof p.workspace_id === "string" ? p.workspace_id : null;
  return id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

/** Deja el aviso de un trabajo perdido. Nunca lanza. */
export async function notifyJobFailure(
  supabase: unknown,
  job: { type: string; payload: unknown },
  errorMessage: string,
): Promise<boolean> {
  try {
    if (JOB_TYPES_WITH_OWN_ALERT.has(job.type)) return false;
    const workspaceId = jobWorkspaceId(job.payload);
    if (!workspaceId) {
      console.warn(`[cron/jobs] el trabajo ${job.type} falló sin negocio en el payload: no se avisa.`);
      return false;
    }
    return await notifySystemFailure({
      supabase,
      workspaceId,
      type: "system_job_failed",
      key: `job:${job.type}`,
      title: `Falló: ${jobLabel(job.type)}`,
      body: `No se pudo hacer después de sus intentos. Motivo: ${errorMessage || "sin detalle"}. Si vuelve a pasar, revisalo con soporte técnico.`,
      area: "integrations",
      metadata: { job_type: job.type },
    });
  } catch (err) {
    console.error("[cron/jobs] no pude avisar del trabajo fallido:", err instanceof Error ? err.message : String(err));
    return false;
  }
}
