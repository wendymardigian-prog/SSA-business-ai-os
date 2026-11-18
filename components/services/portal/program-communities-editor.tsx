"use client";
// @plantilla-quitar(servicios)

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from "lucide-react";
import { fieldInput } from "@/components/content/dialog";
import { cn } from "@/lib/utils";
import { saveProgramSettings } from "@/lib/actions/services";
import {
  DEFAULT_SPACES,
  communitiesIssues,
  communitySettingsPatch,
  programCommunities,
  spaceKeyFor,
  type CommunitySpace,
  type ProgramCommunity,
} from "@/lib/program/community";

/**
 * Las comunidades del programa y sus espacios (00402, R1). Una sola comunidad = lo de siempre: la principal con sus
 * espacios. «Agregar comunidad» suma otra con Anuncios (solo el equipo), General y Victorias; cada variante elige la
 * suya en Productos › variante › Portal. Una comunidad no se borra: se archiva, y solo si ninguna variante la usa.
 */
export function ProgramCommunitiesEditor({
  productId,
  settings,
  rev,
  usedBy,
  canEdit,
  initialOpen,
  onSaved,
  footer,
}: {
  productId: string;
  /** `products.portal_settings`. */
  settings: unknown;
  rev: number;
  /** Clave de cada comunidad → los nombres de las variantes que la eligieron. */
  usedBy: Record<string, string[]>;
  canEdit: boolean;
  /** La comunidad que arranca abierta (la del selector de la pestaña Comunidad). */
  initialOpen?: string | null;
  onSaved?: () => void;
  /** Dónde van los botones (en un panel lateral, su pie). */
  footer?: (buttons: React.ReactNode) => React.ReactNode;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [list, setList] = useState<ProgramCommunity[]>(() => programCommunities(settings));
  const [lessonComments, setLc] = useState(() => {
    const c = settings && typeof settings === "object" ? (settings as { community?: { lesson_comments?: unknown } }).community : null;
    return c?.lesson_comments !== false;
  });
  const [open, setOpen] = useState<string | null>(initialOpen ?? (list.length === 1 ? list[0].key : null));
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const issues = communitiesIssues(list, usedBy);
  const single = list.length === 1;

  const update = (next: ProgramCommunity[]) => {
    setList(next);
    setDirty(true);
    setSaved(false);
  };
  const patch = (key: string, p: Partial<ProgramCommunity>) => update(list.map((c) => (c.key === key ? { ...c, ...p } : c)));
  const setMain = (key: string) => update(list.map((c) => ({ ...c, main: c.key === key })));
  const add = () => {
    const name = newName.trim();
    if (!name) return;
    const key = spaceKeyFor(name, list.map((c) => c.key));
    update([...list, { key, name, main: false, archived: false, spaces: DEFAULT_SPACES.map((s) => ({ ...s })) }]);
    setOpen(key);
    setNewName("");
  };
  const save = () =>
    start(async () => {
      setError(null);
      const r = await saveProgramSettings(productId, { community: communitySettingsPatch(list, lessonComments) }, rev);
      if (!r.ok) return setError(r.error.message);
      const d = r.data as { status?: string; problems?: string[] };
      if (d.status === "invalid") return setError((d.problems ?? []).join(". "));
      if (d.status === "conflict") return setError("Alguien cambió el programa mientras tanto. Recargá la página para ver lo último.");
      setDirty(false);
      setSaved(true);
      router.refresh();
      onSaved?.();
    });

  const buttons = (
    <>
      {(error || issues[0]) && (
        <p role="alert" className="w-full text-xs text-destructive">
          {error ?? issues[0]}
        </p>
      )}
      {canEdit && (
        <button type="button" disabled={pending || issues.length > 0 || !dirty} onClick={save} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50">
          Guardar
        </button>
      )}
      {saved && <span className="text-xs text-good">Guardado.</span>}
    </>
  );

  return (
    <div className="space-y-4">
      <ul className="space-y-2">
        {list.map((c) => (
          <li key={c.key} className={cn("rounded-xl border border-border", c.archived && "opacity-60")}>
            <div className="flex flex-wrap items-center gap-2 p-2">
              <button type="button" aria-label={open === c.key ? `Cerrar ${c.name}` : `Abrir los espacios de ${c.name}`} onClick={() => setOpen(open === c.key ? null : c.key)} className="rounded-md p-1 hover:bg-accent">
                {open === c.key ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              </button>
              {single ? (
                <span className="flex-1 text-sm font-medium">Espacios de la comunidad</span>
              ) : (
                <input value={c.name} disabled={!canEdit} onChange={(e) => patch(c.key, { name: e.target.value })} className={cn(fieldInput, "w-40 flex-1")} aria-label={`Nombre de la comunidad ${c.key}`} maxLength={60} />
              )}
              {!single && (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="radio" name={`main-${productId}`} checked={c.main} disabled={!canEdit || c.archived} onChange={() => setMain(c.key)} /> Principal
                </label>
              )}
              {!single && usedBy[c.key]?.length ? <span className="text-xs text-muted-foreground">{usedBy[c.key].join(", ")}</span> : null}
              {!single && canEdit && !c.main && (
                <button type="button" onClick={() => patch(c.key, { archived: !c.archived })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">
                  {c.archived ? "Volver a usar" : "Archivar"}
                </button>
              )}
            </div>
            {open === c.key && <SpacesList spaces={c.spaces} canEdit={canEdit} onChange={(spaces) => patch(c.key, { spaces })} />}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), add())} placeholder="Nombre de la comunidad nueva" className={fieldInput} maxLength={60} />
          <button type="button" disabled={!newName.trim()} onClick={add} className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50">
            Agregar comunidad
          </button>
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        {single
          ? "Con una sola comunidad, todos los estudiantes del programa comparten el muro y los comentarios de las clases. Si agregás otra, cada variante elige la suya en Productos › variante › Portal (sin elegir, la principal)."
          : "Cada estudiante ve y publica solo en la comunidad de sus servicios activos. Lo que ya existía quedó en la principal. Una comunidad no se borra: se archiva, y solo si ninguna variante la usa."}
      </p>
      <section className="space-y-1 rounded-lg border border-border p-3">
        <p className="text-sm font-medium">Clases</p>
        <p className="text-xs text-muted-foreground">Los comentarios de las clases también son de cada comunidad. Apagados, los que había quedan guardados y no se ven.</p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={lessonComments}
            disabled={!canEdit}
            onChange={(e) => {
              setLc(e.target.checked);
              setDirty(true);
              setSaved(false);
            }}
          />{" "}
          Permitir comentarios en las clases
        </label>
      </section>
      {footer ? footer(buttons) : <div className="flex flex-wrap items-center gap-3">{buttons}</div>}
    </div>
  );
}

function SpacesList({ spaces, canEdit, onChange }: { spaces: CommunitySpace[]; canEdit: boolean; onChange: (s: CommunitySpace[]) => void }) {
  const [newName, setNewName] = useState("");
  const move = (i: number, d: number) => {
    const j = i + d;
    if (j < 0 || j >= spaces.length) return;
    const next = [...spaces];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const patch = (i: number, p: Partial<CommunitySpace>) => onChange(spaces.map((s, k) => (k === i ? { ...s, ...p } : s)));
  return (
    <div className="space-y-2 border-t border-border p-2">
      <ul className="space-y-2">
        {spaces.map((s, i) => (
          <li
            key={s.key}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.altKey && e.key === "ArrowUp") { e.preventDefault(); move(i, -1); }
              if (e.altKey && e.key === "ArrowDown") { e.preventDefault(); move(i, 1); }
            }}
            className={cn("flex flex-wrap items-center gap-2 rounded-lg border border-border p-2", s.archived && "opacity-60")}
          >
            <input value={s.name} disabled={!canEdit} onChange={(e) => patch(i, { name: e.target.value })} className={cn(fieldInput, "w-40 flex-1")} aria-label={`Nombre del espacio ${s.key}`} maxLength={40} />
            <select value={s.team_only ? "team" : "all"} disabled={!canEdit} onChange={(e) => patch(i, { team_only: e.target.value === "team" })} className={cn(fieldInput, "w-auto")} aria-label="Quién publica">
              <option value="all">Publican todos</option>
              <option value="team">Solo el equipo</option>
            </select>
            {canEdit && (
              <>
                <button type="button" onClick={() => patch(i, { archived: !s.archived })} className="rounded-md px-2 py-1 text-xs hover:bg-accent">{s.archived ? "Volver a usar" : "Archivar"}</button>
                <button type="button" aria-label="Subir" onClick={() => move(i, -1)} className="rounded-md p-1 hover:bg-accent"><ArrowUp className="h-3.5 w-3.5" /></button>
                <button type="button" aria-label="Bajar" onClick={() => move(i, 1)} className="rounded-md p-1 hover:bg-accent"><ArrowDown className="h-3.5 w-3.5" /></button>
              </>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex gap-2">
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nombre del espacio nuevo" className={fieldInput} maxLength={40} />
          <button
            type="button"
            disabled={!newName.trim()}
            onClick={() => {
              onChange([...spaces, { key: spaceKeyFor(newName, spaces.map((s) => s.key)), name: newName.trim() }]);
              setNewName("");
            }}
            className="shrink-0 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
          >
            Agregar espacio
          </button>
        </div>
      )}
    </div>
  );
}
