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
    // transcribe_audio. Los ocho originales no cambian.
    //
    // El valor de esta lista es que un handler nuevo NO se registre por
    // accidente: cada tipo que aparece aca tiene que ser uno que alguien quiso
    // dar de alta, y el que se olvida de llamar a su register* lo ve faltar.
    expect(registeredJobTypes()).toEqual([
      "bg_task",
      "booking_ended",
      "booking_google_sync",
      "booking_relative_trigger",
      "content_copy",
      "content_provider_schedule",
      "content_publish",
      "content_publish_check",
      "content_upload",
      "describe_media",
      "meta_ads_sync",
      "metrics_sync",
      "transcribe_audio",
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
