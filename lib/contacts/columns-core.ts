/**
 * Las columnas de la lista de contactos que salen de la tabla `contacts`.
 * Las de cada área (agendas, ventas…) viven en `./related/*`.
 *
 * El orden de esta lista es el orden de la tabla. Las que existían antes del
 * catálogo arrancan visibles; las nuevas, ocultas.
 */
import { GROUPS } from "./filters/catalog";
import type { ContactColumnDef } from "./filters/types";

export const CORE_COLUMNS: readonly ContactColumnDef[] = [
  { key: "name", label: "Nombre", group: GROUPS.data, hideable: false, defaultVisible: true, source: "special" },
  { key: "status", label: "Último estado", group: GROUPS.pipeline, hideable: true, defaultVisible: true, source: "special", keywords: "estado" },
  { key: "contact", label: "Email y teléfono", group: GROUPS.data, hideable: true, defaultVisible: true, source: "special", keywords: "contacto" },
  { key: "setter", label: "Setter", group: GROUPS.assignment, hideable: true, defaultVisible: true, source: "special" },
  { key: "vendedor", label: "Vendedor", group: GROUPS.assignment, hideable: true, defaultVisible: true, source: "special", keywords: "closer" },
  { key: "product", label: "Producto de interés", group: GROUPS.pipeline, hideable: true, defaultVisible: true, source: "special" },
  { key: "email_status", label: "Estado de email", group: GROUPS.email, hideable: true, defaultVisible: false, source: "special", keywords: "suscripcion" },
  { key: "tags", label: "Etiquetas", group: GROUPS.tags, hideable: true, defaultVisible: true, source: "special", keywords: "tags" },
  { key: "last_interaction", label: "Última interacción", group: GROUPS.data, hideable: true, defaultVisible: true, source: "special", keywords: "ultima fecha" },
];

/** Antes de esta clave van los campos personalizados (como antes del catálogo). */
export const CUSTOM_COLUMNS_BEFORE = "tags";
