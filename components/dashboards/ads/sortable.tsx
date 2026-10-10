"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { sortRows, type SortDir } from "@/lib/dashboards/ads-view";

/**
 * Ordenar una tabla por cualquier columna. Una columna nueva ordena de mayor
 * a menor primero (lo que se busca casi siempre: "lo que mas gasto"); volver
 * a tocarla invierte. Lo que no tiene valor queda siempre al final.
 */
export function useSortable<T extends object>(rows: T[], initialKey: keyof T, initialDir: SortDir = "desc") {
  const [sortKey, setSortKey] = useState<keyof T>(initialKey);
  const [sortDir, setSortDir] = useState<SortDir>(initialDir);

  const handleSort = (key: keyof T) => {
    if (key === sortKey) setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
    else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const sorted = useMemo(() => sortRows(rows, sortKey, sortDir), [rows, sortKey, sortDir]);
  return { sorted, sortKey, sortDir, handleSort };
}

export function SortableTh<T>({
  label,
  sortKey,
  activeKey,
  dir,
  onSort,
  right = true,
}: {
  label: string;
  sortKey: keyof T;
  activeKey: keyof T;
  dir: SortDir;
  onSort: (key: keyof T) => void;
  right?: boolean;
}) {
  const active = activeKey === sortKey;
  const Icon = !active ? ArrowUpDown : dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th
      scope="col"
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className={`px-2 py-2 text-xs font-medium uppercase tracking-wider ${right ? "text-right" : "text-left"}`}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 uppercase transition-colors ${right ? "justify-end" : ""} ${
          active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {label}
        <Icon className={`h-3 w-3 ${active ? "opacity-100" : "opacity-40"}`} aria-hidden />
      </button>
    </th>
  );
}
