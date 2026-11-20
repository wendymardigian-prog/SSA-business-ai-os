// @plantilla-quitar(formularios)
"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useActiveWorkspaceId } from "@/components/dashboard-chrome";
import { parseEodTriggerConfig } from "@/lib/eod/automation/trigger-config";
import { MultiPick } from "./multi-pick";

/**
 * «Se envió un reporte de fin de día» en el lienzo: qué reportes y si corre solo con el primer envío del día o también
 * con cada corrección. Antes solo se configuraba desde Formularios; abierto en el lienzo no mostraba nada.
 */
export function EodTriggerPanel({ data, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const workspaceId = useActiveWorkspaceId();
  const [forms, setForms] = useState<Array<{ value: string; label: string }> | null>(null);
  const config = parseEodTriggerConfig(data);

  useEffect(() => {
    let alive = true;
    let query = createClient().from("forms").select("id, name").eq("type", "eod").neq("status", "archived");
    if (workspaceId) query = query.eq("workspace_id", workspaceId);
    query.order("name", { ascending: true }).then(({ data: rows }) => {
      if (alive) setForms((rows ?? []).map((r) => ({ value: r.id, label: r.name })));
    });
    return () => {
      alive = false;
    };
  }, [workspaceId]);

  return (
    <div className="space-y-3">
      <MultiPick label="Qué reportes" value={config.form_ids} options={forms ?? []} loaded={forms !== null} onChange={(form_ids) => onChange({ ...data, form_ids: form_ids.length ? form_ids : undefined })} hint="Sin elegir nada, vale para cualquier reporte de fin de día." />
      <div>
        <label htmlFor="eod-on" className="mb-1.5 block text-xs font-semibold text-foreground">Cuándo corre</label>
        <select id="eod-on" value={config.on} onChange={(e) => onChange({ ...data, on: e.target.value })} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring">
          <option value="first">Solo con el primer envío del día</option>
          <option value="every">Con cada envío y cada corrección</option>
        </select>
      </div>
    </div>
  );
}
