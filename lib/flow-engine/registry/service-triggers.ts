// @plantilla-quitar(servicios)
/**
 * Los 26 disparadores del modulo de Servicios en el registro (F25). Todos son de CONTACTO (el estudiante
 * o cliente del servicio) y viajan por la cola `automation_events`: los emite la base
 * (`app_servicio.emit`) y nunca hacen fallar lo que los origina. Con el modulo apagado en el negocio no
 * se emiten.
 *
 * Aca solo se declaran: que evento atiende cada uno, como se filtra (producto, variante, fase, paso) y su
 * clave de idempotencia. Las reglas viven puras en `lib/services/automation.ts`. Los eventos llevan solo
 * escalares y nunca `booking_id`.
 */
import { registerTrigger } from "./registry";
import { svcSchema } from "@/lib/services/db";
import {
  SERVICE_TRIGGER_LABELS,
  SERVICE_TRIGGER_TYPES,
  SERVICE_VARIABLE_FIELDS,
  serviceDedupeKey,
  serviceEventMatches,
  nestServiceVariables,
  serviceVariables,
  type ServiceForVariables,
} from "@/lib/services/automation";

for (const type of SERVICE_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: SERVICE_TRIGGER_LABELS[type].label,
    scope: "event",
    // Debajo de `crm_event` (50), igual que agenda, formularios, ventas y tareas.
    priority: 45,
    sourceType: "contact",
    eventTypes: [type],

    eventMatches: (args) => serviceEventMatches(args.config, args.event.payload),

    dedupeKeyFor: (args) => serviceDedupeKey(type, args.event.id),

    variableSchema: () => SERVICE_VARIABLE_FIELDS.map((f) => ({ path: f.path, label: f.label, type: "text" as const, group: "Del servicio" })),

    variablesFor: async (args) => {
      const serviceId = (args.event.payload as { service_id?: unknown } | null)?.service_id;
      if (typeof serviceId !== "string") return {};
      try {
        const { data } = await svcSchema(args.supabase)
          .from("services")
          .select("id, status, product_snapshot, starts_on, ends_on, light, sale_id")
          .eq("id", serviceId)
          .maybeSingle();
        if (!data) return {};
        const { data: phase } = await svcSchema(args.supabase)
          .from("service_phases")
          .select("name")
          .eq("service_id", serviceId)
          .eq("status", "in_progress")
          .maybeSingle();
        const saleId = (data as { sale_id?: string | null }).sale_id ?? null;
        return nestServiceVariables(
          serviceVariables({ ...(data as ServiceForVariables), phase_name: (phase as { name?: string } | null)?.name ?? null }),
          saleId,
        );
      } catch (error) {
        console.error("[servicios] no pude leer el servicio para las variables:", error instanceof Error ? error.message : "error");
        return {};
      }
    },
  });
}
