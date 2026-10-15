/**
 * Las opciones de los campos del formulario de reglas (F57). Puro: de lo que trae `RulesScreenData.editor` arma
 * las listas, sin perder nunca lo que la regla ya tenía elegido (un producto archivado o un método desactivado
 * se sigue viendo, con su aviso, hasta que alguien lo quite).
 */
import { FINANCING_TYPE_LABELS } from "@/lib/sales/labels";
import type { RulesScreenData } from "./list-load";

export interface Option {
  value: string;
  label: string;
}
export interface OptionGroup {
  label: string;
  options: Option[];
}

type Editor = RulesScreenData["editor"];

export const FINANCING_OPTIONS: Option[] = Object.entries(FINANCING_TYPE_LABELS).map(([value, label]) => ({ value, label }));

export const PAYMENT_TYPE_OPTIONS: Option[] = [
  { value: "full", label: "Pago completo" },
  { value: "reservation", label: "Reserva" },
  { value: "installment", label: "Cuota" },
];

export const CHANNEL_OPTIONS: Option[] = [
  { value: "organic", label: "Orgánico" },
  { value: "paid", label: "Pautado" },
  { value: "referral", label: "Referido" },
  { value: "direct", label: "Directo (sin atribución)" },
];

/** Las redes de las que puede venir una venta (la fuente del toque). */
export const PLATFORM_OPTIONS: Option[] = [
  { value: "instagram", label: "Instagram" },
  { value: "tiktok", label: "TikTok" },
  { value: "youtube", label: "YouTube" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "facebook", label: "Facebook" },
  { value: "threads", label: "Threads" },
  { value: "x", label: "X" },
];

const single = (options: Option[]): OptionGroup[] => [{ label: "", options }];

export const FINANCING_GROUPS = single(FINANCING_OPTIONS);
export const PAYMENT_TYPE_GROUPS = single(PAYMENT_TYPE_OPTIONS);
export const CHANNEL_GROUPS = single(CHANNEL_OPTIONS);
export const PLATFORM_GROUPS = single(PLATFORM_OPTIONS);

export function labelFrom(options: readonly Option[], value: string): string {
  return options.find((o) => o.value === value)?.label ?? value;
}

/** Una red que no está en la lista fija se muestra con la primera mayúscula. */
export function platformLabel(value: string): string {
  return PLATFORM_OPTIONS.find((o) => o.value === value)?.label ?? (value ? value[0].toUpperCase() + value.slice(1) : value);
}

/** Los productos: los activos y los que la regla ya tiene elegidos (archivados incluidos, avisando). */
export function productOptions(editor: Editor, selected: readonly string[]): Option[] {
  return editor.products
    .filter((p) => !p.archived || selected.includes(p.id))
    .map((p) => ({ value: p.id, label: p.archived ? `${p.name} (archivado)` : p.name }));
}

export function productLabel(editor: Editor, id: string): string {
  const p = editor.products.find((x) => x.id === id);
  return p ? (p.archived ? `${p.name} (archivado)` : p.name) : "Un producto que ya no existe";
}

/** Las variantes, agrupadas por producto. Si ya se eligieron productos, solo las de esos productos (más las ya elegidas). */
export function variantGroups(editor: Editor, selectedProducts: readonly string[], selectedVariants: readonly string[]): OptionGroup[] {
  const productName = new Map(editor.products.map((p) => [p.id, p.name]));
  const groups = new Map<string, Option[]>();
  for (const v of editor.variants) {
    const keep = selectedVariants.includes(v.id) || (!v.archived && (selectedProducts.length === 0 || selectedProducts.includes(v.productId)));
    if (!keep) continue;
    const list = groups.get(v.productId) ?? [];
    list.push({ value: v.id, label: v.archived ? `${v.name} (archivada)` : v.name });
    groups.set(v.productId, list);
  }
  return [...groups].map(([productId, options]) => ({ label: productName.get(productId) ?? "Otro producto", options }));
}

export function variantLabel(editor: Editor, id: string): string {
  const v = editor.variants.find((x) => x.id === id);
  if (!v) return "Una variante que ya no existe";
  const product = editor.products.find((p) => p.id === v.productId)?.name;
  return `${product ? `${product} · ` : ""}${v.name}${v.archived ? " (archivada)" : ""}`;
}

export function memberOptions(editor: Editor): Option[] {
  return editor.members.map((m) => ({ value: m.id, label: m.name }));
}

export function memberLabel(editor: Editor, id: string): string {
  return editor.members.find((m) => m.id === id)?.name ?? "Alguien que ya no está en el equipo";
}

/** Los métodos de pago activos y los que la regla ya tenía elegidos. */
export function methodOptions(editor: Editor, selected: readonly string[]): Option[] {
  return editor.methods.filter((m) => m.active || selected.includes(m.key)).map((m) => ({ value: m.key, label: m.active ? m.name : `${m.name} (desactivado)` }));
}

export function methodLabel(editor: Editor, key: string): string {
  const m = editor.methods.find((x) => x.key === key);
  return m ? (m.active ? m.name : `${m.name} (desactivado)`) : key;
}

/** Quién puede ser la persona fija: el equipo, y si la regla ya tenía a alguien que salió, también esa persona (para poder editar el resto). */
export function personChoices(editor: Editor, current: string): Option[] {
  const options = memberOptions(editor);
  if (current && !editor.members.some((m) => m.id === current)) options.push({ value: current, label: "Alguien que ya no está en el equipo" });
  return options;
}
