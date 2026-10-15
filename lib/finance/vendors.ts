/**
 * Proveedores (GF5). Puro: validación del alta/edición y las reglas de nombre. Un proveedor no se borra, se
 * archiva (RLS sin DELETE). Un proveedor con `user_id` es una persona del equipo (liquidaciones de comisiones):
 * su nombre sale del miembro, no se edita a mano.
 */
import { z } from "zod";

export const VENDOR_NAME_MAX = 120;
export const VENDOR_PAYMENT_DETAILS_MAX = 1000;
export const VENDOR_TERMS_MAX = 200;
export const VENDOR_NOTES_MAX = 2000;

/** Un texto opcional: vacío o solo espacios es «sin dato» (null). */
const optionalText = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), schema.nullable().optional());

export const vendorInputSchema = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(VENDOR_NAME_MAX, `El nombre puede tener hasta ${VENDOR_NAME_MAX} caracteres`),
  country: optionalText(z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/, "El país va con dos letras (CR, AR…)")),
  email: optionalText(z.string().trim().max(200).email("El email no tiene forma de email")),
  paymentDetails: optionalText(z.string().trim().max(VENDOR_PAYMENT_DETAILS_MAX)),
  terms: optionalText(z.string().trim().max(VENDOR_TERMS_MAX)),
  notes: optionalText(z.string().trim().max(VENDOR_NOTES_MAX)),
});

export type VendorInput = z.output<typeof vendorInputSchema>;

export interface VendorLite {
  id: string;
  name: string;
  archived_at: string | null;
  user_id?: string | null;
}

/** Busca un proveedor ACTIVO con ese nombre (sin importar mayúsculas ni espacios de más), salvo `exceptId`. */
export function findActiveVendorByName(vendors: readonly VendorLite[], name: string, exceptId?: string): VendorLite | null {
  const n = name.trim().toLowerCase();
  return vendors.find((v) => !v.archived_at && v.id !== exceptId && v.name.trim().toLowerCase() === n) ?? null;
}

export function vendorLabel(vendors: readonly VendorLite[], id: string | null | undefined): string {
  if (!id) return "Sin proveedor";
  const v = vendors.find((x) => x.id === id);
  if (!v) return "Proveedor";
  return v.archived_at ? `${v.name} (archivado)` : v.name;
}

/** Proveedores que se ofrecen en un gasto nuevo: los activos, más el que ya tiene el gasto que se edita. */
export function selectableVendors(vendors: readonly VendorLite[], keepId?: string | null): VendorLite[] {
  return vendors.filter((v) => !v.archived_at || v.id === keepId);
}

/** Un proveedor que es una persona del equipo no se renombra a mano. */
export function isTeamVendor(v: Pick<VendorLite, "user_id">): boolean {
  return !!v.user_id;
}

/** Países para el selector (los que usa el negocio primero; el resto lo escribe a mano). */
export const COMMON_COUNTRIES: ReadonlyArray<{ code: string; name: string }> = [
  { code: "CR", name: "Costa Rica" },
  { code: "AR", name: "Argentina" },
  { code: "US", name: "Estados Unidos" },
  { code: "MX", name: "México" },
  { code: "CO", name: "Colombia" },
  { code: "CL", name: "Chile" },
  { code: "PE", name: "Perú" },
  { code: "ES", name: "España" },
  { code: "UY", name: "Uruguay" },
  { code: "PA", name: "Panamá" },
  { code: "GT", name: "Guatemala" },
  { code: "DO", name: "República Dominicana" },
];
