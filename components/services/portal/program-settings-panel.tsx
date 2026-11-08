"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveProgramSettings } from "@/lib/actions/services";
import { AVAILABLE_SECTIONS, SECTION_LABELS } from "@/lib/services/availability";

/**
 * Portal › programa › Ajustes del programa (F35) y Afiliados (F106): qué secciones están prendidas en el programa
 * (vale para todas sus variantes; apagar no borra nada) y qué links del producto ven los estudiantes en Afiliados.
 * Guarda solo lo que cambia, con la revisión del producto.
 */
export function ProgramSettingsPanel({
  productId,
  mode,
  sections: initialSections,
  links,
  visibleLinkKeys: initialVisible,
  rev: initialRev,
  canEdit,
}: {
  productId: string;
  mode: "sections" | "affiliates";
  sections: Record<string, boolean>;
  links: Array<{ key: string; name: string; active: boolean }>;
  visibleLinkKeys: string[];
  rev: number;
  canEdit: boolean;
}) {
  const router = useRouter();
  const [sections, setSections] = useState(initialSections);
  const [visible, setVisible] = useState<Set<string>>(new Set(initialVisible));
  const [rev, setRev] = useState(initialRev);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [pending, start] = useTransition();

  function save(patch: Record<string, unknown>) {
    setMsg(null);
    start(async () => {
      const res = await saveProgramSettings(productId, patch, rev);
      if (!res.ok) return setMsg({ kind: "error", text: res.error.message });
      const d = res.data as { status: string; rev?: number; problems?: string[] };
      if (d.status === "ok") {
        setRev(d.rev ?? rev + 1);
        setMsg({ kind: "ok", text: "Guardado." });
        router.refresh();
      } else if (d.status === "conflict") setMsg({ kind: "error", text: "Alguien cambió el programa mientras lo editabas. Recargá la página." });
      else setMsg({ kind: "error", text: (d.problems ?? []).join(". ") });
    });
  }

  const status = msg && (
    <p role="status" className={msg.kind === "ok" ? "text-sm text-muted-foreground" : "text-sm text-destructive"}>
      {msg.text}
    </p>
  );

  if (mode === "sections") {
    return (
      <div className="max-w-2xl space-y-3">
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {AVAILABLE_SECTIONS.map((s) => (
            <li key={s} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-sm text-foreground">{SECTION_LABELS[s]}</span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={sections[s] !== false}
                  disabled={!canEdit || pending}
                  onChange={(e) => {
                    const next = { ...sections, [s]: e.target.checked };
                    setSections(next);
                    save({ sections: next });
                  }}
                />
                Prendida
              </label>
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">Apagar una sección no borra nada: sus accesos dejan de valer hasta que la vuelvas a prender.</p>
        {status}
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-3">
      {links.length === 0 ? (
        <p className="text-sm text-muted-foreground">El producto no tiene links. Se cargan en Ajustes › Productos › el producto › Links.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border bg-card">
          {links.map((l) => (
            <li key={l.key} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-sm text-foreground">
                {l.name}
                {!l.active && <span className="ml-2 text-xs text-muted-foreground">(inactivo)</span>}
              </span>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={visible.has(l.key)}
                  disabled={!canEdit || pending}
                  onChange={(e) => {
                    const n = new Set(visible);
                    if (e.target.checked) n.add(l.key);
                    else n.delete(l.key);
                    setVisible(n);
                    save({ affiliates: { visible_link_keys: [...n] } });
                  }}
                />
                Lo ven los estudiantes
              </label>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Cada estudiante que es afiliado comparte estos links con su código desde el portal. Las reglas de asignación están en Afiliados.</p>
      {status}
    </div>
  );
}
