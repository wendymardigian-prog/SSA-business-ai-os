"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listGroupsForFlowEditor } from "@/lib/actions/whatsapp-group-flow-editor";
import type { EditorGroup } from "@/lib/whatsapp-groups/editor-types";
import { editorGroupSections } from "@/lib/whatsapp-groups/editor-groups";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";

/**
 * Elegir un grupo de WhatsApp activado en un paso de automatización (00344): los grupos de cada comunidad juntos,
 * con «Avisos» para el grupo de avisos, y después los grupos sueltos.
 */
export function GroupSelect({ id, value, onChange }: { id: string; value: string | undefined; onChange: (groupId: string | undefined) => void }) {
  const [groups, setGroups] = useState<EditorGroup[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    listGroupsForFlowEditor().then((res) => {
      if (!alive) return;
      if (res.ok) setGroups(res.groups);
      else setError(res.error);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (error) return <p className="text-xs text-red-700 dark:text-red-300">{error}</p>;
  if (groups && groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Todavía no hay grupos. Aparecen solos cuando llega un mensaje, o al abrir{" "}
        <Link href="/dashboard/settings/integrations/evolution" className="text-primary-ink underline">
          Ajustes → Integraciones → WhatsApp → Grupos
        </Link>
        .
      </p>
    );
  }
  return (
    <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || undefined)} className={inputClass}>
      <option value="">{groups === null ? "Cargando…" : "Elegí un grupo…"}</option>
      {editorGroupSections(groups ?? []).map((section) => (
        <optgroup key={section.label} label={section.label}>
          {section.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
