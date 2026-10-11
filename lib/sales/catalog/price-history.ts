/** Historial de precios de una variante (plano F6): las versiones con su número, precio, estado y ventas. */
import { formatMoney } from "../format";
import { canDeleteVersion, type VersionLike } from "./versions";

export interface HistoryVersion extends VersionLike {
  published_at: string | null;
  published_by: string | null;
  deprecated_at?: string | null;
}

export interface PriceHistoryRow {
  id: string;
  number: number;
  priceLabel: string;
  status: string;
  statusLabel: string;
  publishedAt: string | null;
  publishedBy: string | null;
  notes: string;
  sales: number;
  canDelete: boolean;
}

const STATUS_LABELS: Record<string, string> = { draft: "Borrador", active: "Activa", deprecated: "Reemplazada" };

/** Las más nuevas primero. `salesByVersion`: ventas hechas con cada versión (0 hasta que exista `sales`). */
export function priceHistory(
  versions: readonly HistoryVersion[],
  salesByVersion: ReadonlyMap<string, number> | Record<string, number> = {},
  userNames: Record<string, string> = {},
): PriceHistoryRow[] {
  const count = (id: string) => (salesByVersion instanceof Map ? salesByVersion.get(id) : (salesByVersion as Record<string, number>)[id]) ?? 0;
  return [...versions]
    .sort((a, b) => b.version_number - a.version_number)
    .map((v) => {
      const sales = count(v.id);
      return {
        id: v.id,
        number: v.version_number,
        priceLabel: formatMoney(v.price),
        status: String(v.status),
        statusLabel: STATUS_LABELS[String(v.status)] ?? String(v.status),
        publishedAt: v.published_at,
        publishedBy: v.published_by ? (userNames[v.published_by] ?? null) : null,
        notes: v.change_notes ?? "",
        sales,
        canDelete: canDeleteVersion(v, sales).ok,
      };
    });
}

/** "Nueva versión" arranca de una copia de la activa (o de la última, si no hay activa). */
export function newVersionDraftFrom(versions: readonly HistoryVersion[]): { price: number; change_notes: string } | null {
  const active = versions.find((v) => v.status === "active");
  const base = active ?? [...versions].sort((a, b) => b.version_number - a.version_number)[0];
  if (!base) return null;
  return { price: Number(base.price) || 0, change_notes: "" };
}
