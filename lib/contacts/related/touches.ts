/**
 * La lista de contactos: los toques de atribución (`contact_touches`).
 *
 * "Llegó por" mira TODOS los toques del contacto, no solo el primero: el canal
 * (orgánico, pago, referido, directo) lo calcula la base en cada toque
 * (`touch_channel`, Extra I). "Vino de un anuncio de Meta" = algún toque
 * vinculado a un anuncio del catálogo (00192), automático o a mano.
 *
 * Respeta la RLS de `contact_touches` (lo ve quien ve el contacto).
 */
import { CHANNEL_LABELS, TOUCH_CHANNELS } from "@/lib/attribution/channel";
import { hasRelatedFilter, relatedMultiFilter } from "../filters/catalog";
import type { ContactListModule, ListGroupDef } from "../filters/types";

export const TOUCHES_GROUP: ListGroupDef = { key: "toques", label: "Atribución · todos los toques", order: 62 };

export const touchesModule: ContactListModule = {
  key: "toques",
  filters: [
    relatedMultiFilter({
      param: "canal_origen",
      label: "Llegó por",
      chipLabel: "Llegó por (algún toque)",
      group: TOUCHES_GROUP,
      relation: "contact_touches",
      column: "channel",
      accepts: (v) => (TOUCH_CHANNELS as readonly string[]).includes(v),
      options: { static: TOUCH_CHANNELS.map((c) => ({ value: c, label: CHANNEL_LABELS[c] })) },
      keywords: "canal de origen organico pago referido directo",
      hint: "Alguno de sus toques fue por este canal.",
    }),
    hasRelatedFilter({
      param: "meta",
      label: "Vino de un anuncio de Meta",
      group: TOUCHES_GROUP,
      relation: "contact_touches",
      columns: ["meta_ad_id"],
      clauses: [{ op: "not_null", column: "meta_ad_id" }],
      keywords: "facebook instagram ads pauta publicidad",
      hint: "Algún toque quedó vinculado a un anuncio.",
    }),
  ],
  columns: [],
};
