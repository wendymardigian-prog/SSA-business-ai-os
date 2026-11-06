"use client";

import { useEffect, useState } from "react";
import { useActiveWorkspaceId } from "@/components/dashboard-chrome";
import { categoryGroups, type CategoryGroup } from "@/lib/calls/catalog";
import { callTypeLabel } from "@/lib/calls/list";
import type { CategoryRow } from "@/lib/scheduling/categories";
import { createClient } from "@/lib/supabase/client";

/**
 * Filtrar un disparador de grabaciones por area y tipo de reunion, con la misma lista que la
 * agenda. Vacio = cualquiera. Un flujo viejo con `call_types` lo sigue respetando el motor:
 * aca se muestra para poder sacarlo.
 */
export function CallCategoryFilter({ data, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const workspaceId = useActiveWorkspaceId();
  const [groups, setGroups] = useState<CategoryGroup[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    createClient()
      .from("booking_categories")
      .select("id, parent_id, name, color, position, is_system, archived_at")
      .eq("workspace_id", workspaceId)
      .then(({ data: rows }) => {
        if (!cancelled) setGroups(categoryGroups((rows ?? []) as CategoryRow[]));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const list = (key: string) => (data[key] as string[] | undefined) ?? [];
  const toggle = (key: string, value: string) => {
    const current = list(key);
    onChange({ ...data, [key]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value] });
  };

  const chip = (key: string, value: string, label: string) => {
    const on = list(key).includes(value);
    return (
      <button
        key={value}
        type="button"
        aria-pressed={on}
        onClick={() => toggle(key, value)}
        className={
          on
            ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-600 dark:text-emerald-300"
            : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted"
        }
      >
        {label}
      </button>
    );
  };

  const areaIds = list("area_ids");
  const visibleTypes = groups.filter((g) => areaIds.length === 0 || areaIds.includes(g.areaId));

  return (
    <>
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Solo estas áreas</label>
        <div className="flex flex-wrap gap-2">{groups.map((g) => chip("area_ids", g.areaId, g.areaName))}</div>
      </div>
      <div>
        <label className="mb-2 block text-xs font-semibold text-foreground">Solo estos tipos de reunión</label>
        <div className="flex flex-wrap gap-2">
          {visibleTypes.flatMap((g) => g.types.map((t) => chip("category_ids", t.id, `${g.areaName} · ${t.name}`)))}
        </div>
      </div>
      {list("call_types").length > 0 && (
        <div>
          <label className="mb-2 block text-xs font-semibold text-foreground">Filtro anterior (tocá para sacarlo)</label>
          <div className="flex flex-wrap gap-2">{list("call_types").map((t) => chip("call_types", t, callTypeLabel(t)))}</div>
        </div>
      )}
    </>
  );
}
