/**
 * Caracterizacion del registro de jobs ANTES de la Etapa 4.
 *
 * Fija la lista exacta de tipos que `registerPublishing()` da de alta. B4a y
 * B7a suman `booking_google_sync`, `booking_ended` y
 * `booking_relative_trigger`; este test se extiende con ellos y nada mas.
 */
import { describe, expect, it } from "vitest";
import { registeredJobTypes, resetJobHandlers } from "./registry";
import { registerPublishing, resetPublishingBootstrap } from "@/lib/publishing/bootstrap";
import { isExcludedFromRunner, MAX_ATTEMPTS, retryDelayMs } from "./dispatch";

describe("registro de jobs (caracterizacion previa a la etapa 4)", () => {
  it("registerPublishing da de alta exactamente estos tipos", () => {
    resetJobHandlers();
    resetPublishingBootstrap();
    registerPublishing();
    // La Etapa 4 sumo los tres de agenda; Mejoras de Chat suma describe_media y
    // transcribe_audio; Llamadas suma fathom_sync (y despues call_*). Los ocho
    // originales no cambian.
    //
    // El valor de esta lista es que un handler nuevo NO se registre por
    // accidente: cada tipo que aparece aca tiene que ser uno que alguien quiso
    // dar de alta, y el que se olvida de llamar a su register* lo ve faltar.
    expect(registeredJobTypes()).toEqual([
      "bg_task",
      "booking_ended",
      "booking_google_sync",
      "booking_relative_trigger",
      "call_analyze",
      "call_classify",
      "call_index_knowledge",
      "call_summary",
      "content_copy",
      "content_provider_schedule",
      "content_publish",
      "content_publish_check",
      "content_upload",
      "contract_email",
      "contract_pdf",
      "describe_media",
      // Reporte de fin de día (E13): el recordatorio.
      "eod_reminder_sweep",
      "fathom_sync",
      // Catalogo de Meta (Extra L, AT2): las miniaturas de los anuncios.
      "meta_ad_thumbnails",
      "meta_ads_sync",
      "metrics_sync",
      // Ventas (B4): los recordatorios relativos al vencimiento de un pago y el barrido de mora.
      "payment_relative_trigger",
      "payments_overdue_sweep",
      // Ventas (B2): la asignacion automatica de un contacto.
      "sales_contact_eval",
      // Tareas (Extra A, F18): el barrido de vencimientos.
      "tasks_due_sweep",
      "transcribe_audio",
      // Atribucion (Extra L, Tiron 2, A1): el anuncio de origen de una conversacion de Instagram, desde Zernio.
      "zernio_ad_origin",
    ]);
  });

  it("la cola reintenta 3 veces con 10 s y 20 s, y no toma los turnos del agente", () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(retryDelayMs(0)).toBe(10_000);
    expect(retryDelayMs(1)).toBe(20_000);
    expect(isExcludedFromRunner("agent_burst")).toBe(true);
    expect(isExcludedFromRunner("booking_google_sync")).toBe(false);
  });
});
