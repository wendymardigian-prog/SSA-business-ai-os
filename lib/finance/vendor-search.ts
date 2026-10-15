/**
 * El buscador de proveedores del formulario de gasto (GF5, GF7): qué opciones aparecen al escribir y cuándo
 * se ofrece «+ Nuevo proveedor». Puro: el combobox solo lo compone.
 */
import { VENDOR_NAME_MAX, type VendorLite } from "./vendors";

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Los proveedores que contienen lo escrito (sin importar mayúsculas ni tildes). Los que empiezan igual van primero. */
export function searchVendors<T extends Pick<VendorLite, "name">>(vendors: readonly T[], query: string, limit = 50): T[] {
  const q = fold(query);
  const matches = q === "" ? [...vendors] : vendors.filter((v) => fold(v.name).includes(q));
  const starts = (v: T) => (q !== "" && fold(v.name).startsWith(q) ? 0 : 1);
  return matches.sort((a, b) => starts(a) - starts(b) || a.name.localeCompare(b.name, "es")).slice(0, limit);
}

/** ¿Se ofrece crear uno con este texto? Solo si hay texto, entra en el largo y no existe ya uno con ese nombre exacto. */
export function canCreateVendor(vendors: ReadonlyArray<Pick<VendorLite, "name" | "archived_at">>, query: string): boolean {
  const q = query.trim();
  if (q === "" || q.length > VENDOR_NAME_MAX) return false;
  return !vendors.some((v) => !v.archived_at && fold(v.name) === fold(q));
}
