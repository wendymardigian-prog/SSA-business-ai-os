// @plantilla-quitar(ventas)
/**
 * Los tres disparadores de afiliados en el registro (Servicios A1, F72/F74). Son de CONTACTO y viajan por la cola
 * `automation_events`: los emite la base (00343) y nunca hacen fallar lo que los origina. Las reglas viven puras en
 * `lib/affiliates/automation.ts`.
 */
import { registerTrigger } from "./registry";
import { AFFILIATE_TRIGGER_LABELS, AFFILIATE_TRIGGER_TYPES, affiliateDedupeKey, affiliateEventMatches, affiliateVariables } from "@/lib/affiliates/automation";

for (const type of AFFILIATE_TRIGGER_TYPES) {
  registerTrigger({
    type,
    label: AFFILIATE_TRIGGER_LABELS[type],
    scope: "event",
    // Debajo de `crm_event` (50), igual que ventas y servicios.
    priority: 45,
    sourceType: "contact",
    eventTypes: [type],
    eventMatches: (args) => affiliateEventMatches(args.config, args.event.payload),
    dedupeKeyFor: (args) => affiliateDedupeKey(type, args.event.id),
    variableSchema: () => [
      { path: "affiliate.type", label: "Tipo de afiliado (equipo o externo)", type: "text" as const, group: "Del afiliado" },
      { path: "affiliate.kind", label: "Tipo de asignación", type: "text" as const, group: "Del afiliado" },
      ...(type === "affiliate_sale_created" ? [{ path: "affiliate.sale_id", label: "Id de la venta", type: "text" as const, group: "Del afiliado" }] : []),
    ],
    variablesFor: async (args) => affiliateVariables(args.event.payload),
  });
}
