"use client";

import { useEffect, useState } from "react";
import { loadTaskNodeOptions } from "@/lib/actions/tasks";
import { MAX_DUE_DAYS, type CreateTaskNodeData } from "@/lib/flow-engine/nodes/create-task";
import { PRIORITY_LABELS, TASK_LIMITS, TASK_PRIORITIES } from "@/lib/tasks/types";

const inputClass = "w-full rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-ring focus:outline-none focus:ring-1 focus:ring-ring";
const labelClass = "mb-2 block text-xs font-semibold text-foreground";

/**
 * El panel del nodo «Crear tarea» (F22): titulo con variables, responsable, seguidores, proyecto, prioridad y vencimiento.
 * Las personas salen del equipo del workspace; sin cargar todavia (o si falla), se pueden seguir editando los demas campos.
 */
export function CreateTaskPanel({ data: raw, onChange }: { data: Record<string, unknown>; onChange: (data: Record<string, unknown>) => void }) {
  const data = raw as CreateTaskNodeData & Record<string, unknown>;
  const [members, setMembers] = useState<Array<{ id: string; name: string }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadTaskNodeOptions()
      .then((o) => { if (!cancelled) setMembers(o.members); })
      .catch(() => { if (!cancelled) setMembers([]); });
    return () => { cancelled = true; };
  }, []);

  const set = (patch: Partial<CreateTaskNodeData>) => onChange({ ...data, ...patch });
  const owner = data.owner ?? "none";
  const dueMode = data.dueMode ?? "none";
  const followers = data.followerIds ?? [];

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="ct-title" className={labelClass}>Título</label>
        <input id="ct-title" type="text" maxLength={TASK_LIMITS.title} value={data.title ?? ""} onChange={(e) => set({ title: e.target.value })} placeholder="Llamar a {{contact.name}}" className={inputClass} />
        <p className="mt-1.5 text-xs text-muted-foreground">Podés usar variables como {"{{contact.name}}"}. Sin título no se crea nada.</p>
      </div>

      <div>
        <label htmlFor="ct-desc" className={labelClass}>Descripción (opcional)</label>
        <textarea id="ct-desc" rows={3} maxLength={TASK_LIMITS.description} value={data.description ?? ""} onChange={(e) => set({ description: e.target.value })} className={inputClass} />
      </div>

      <div>
        <label htmlFor="ct-owner" className={labelClass}>Responsable</label>
        <select id="ct-owner" value={owner} onChange={(e) => set({ owner: e.target.value as CreateTaskNodeData["owner"] })} className={inputClass}>
          <option value="none">Nadie</option>
          <option value="user">Una persona del equipo</option>
          <option value="member">Quien envió el reporte (flujos de fin de día)</option>
        </select>
        {owner === "user" && (
          <select aria-label="Persona responsable" value={data.ownerId ?? ""} onChange={(e) => set({ ownerId: e.target.value })} className={`${inputClass} mt-2`}>
            <option value="">{members === null ? "Cargando…" : "Elegí una persona"}</option>
            {(members ?? []).map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        )}
        <p className="mt-1.5 text-xs text-muted-foreground">Si la persona ya no es del equipo, la tarea queda sin responsable y se avisa a los Owner y Admin.</p>
      </div>

      <fieldset>
        <legend className={labelClass}>Seguidores (opcional)</legend>
        <div className="max-h-36 space-y-1 overflow-auto rounded-lg border border-border p-2">
          {members === null && <p className="text-xs text-muted-foreground">Cargando…</p>}
          {(members ?? []).map((m) => (
            <label key={m.id} className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={followers.includes(m.id)}
                disabled={!followers.includes(m.id) && followers.length >= TASK_LIMITS.followers}
                onChange={() => set({ followerIds: followers.includes(m.id) ? followers.filter((id) => id !== m.id) : [...followers, m.id] })}
              />
              {m.name}
            </label>
          ))}
          {members !== null && members.length === 0 && <p className="text-xs text-muted-foreground">No se pudo cargar el equipo.</p>}
        </div>
      </fieldset>

      <div>
        <label htmlFor="ct-project" className={labelClass}>Proyecto (opcional)</label>
        <input id="ct-project" type="text" maxLength={TASK_LIMITS.project} value={data.project ?? ""} onChange={(e) => set({ project: e.target.value })} placeholder="Lanzamiento Q4" className={inputClass} />
      </div>

      <div>
        <label htmlFor="ct-priority" className={labelClass}>Prioridad</label>
        <select id="ct-priority" value={data.priority ?? "normal"} onChange={(e) => set({ priority: e.target.value as CreateTaskNodeData["priority"] })} className={inputClass}>
          {TASK_PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>)}
        </select>
      </div>

      <div>
        <label htmlFor="ct-due" className={labelClass}>Vencimiento</label>
        <select id="ct-due" value={dueMode} onChange={(e) => set({ dueMode: e.target.value as CreateTaskNodeData["dueMode"] })} className={inputClass}>
          <option value="none">Sin fecha</option>
          <option value="days">Dentro de N días</option>
          <option value="date">Una fecha fija</option>
        </select>
        {dueMode === "days" && (
          <input aria-label="Días desde hoy" type="number" min={0} max={MAX_DUE_DAYS} value={typeof data.dueDays === "number" ? data.dueDays : ""} onChange={(e) => set({ dueDays: e.target.value === "" ? undefined : Number(e.target.value) })} placeholder="2" className={`${inputClass} mt-2`} />
        )}
        {dueMode === "date" && <input aria-label="Fecha de vencimiento" type="date" value={data.dueDate ?? ""} onChange={(e) => set({ dueDate: e.target.value })} className={`${inputClass} mt-2`} />}
        {dueMode === "days" && <p className="mt-1.5 text-xs text-muted-foreground">Cuenta desde el día en que corre el flujo, en la zona horaria del negocio.</p>}
      </div>
    </div>
  );
}
