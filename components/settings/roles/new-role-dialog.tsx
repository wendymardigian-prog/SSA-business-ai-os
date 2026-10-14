"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { createRole } from "@/lib/actions/roles";
import type { RoleRow } from "@/lib/auth/roles-admin";
import { applyTemplate, ROLE_TEMPLATES, type RoleTemplate } from "@/lib/roles/templates";
import type { GrantActor } from "@/lib/team/grant";

/**
 * «Nuevo rol»: el nombre y desde dónde empezar (en blanco, una plantilla o duplicando otro rol,
 * incluidos los de sistema). Crea el rol en el acto y lo abre para editarlo (F14). Lo que se copia
 * se filtra con la regla de «no podés dar lo que no tenés»: el servidor la repite.
 */
export function NewRoleDialog({
  roles,
  viewer,
  onClose,
  onCreated,
}: {
  roles: RoleRow[];
  viewer: GrantActor;
  onClose: () => void;
  onCreated: (role: RoleRow) => void;
}) {
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string>("blank");
  const [duplicateId, setDuplicateId] = useState(roles.find((r) => r.systemRole === "member")?.id ?? roles[0]?.id ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    let template: RoleTemplate | undefined;
    let description: string | undefined;
    if (from === "duplicate") {
      const source = roles.find((r) => r.id === duplicateId);
      if (source) {
        template = { id: "blank", name: source.name, description: "", keys: source.permissions.keys, scopes: source.permissions.scopes };
        description = source.description ?? undefined;
      }
    } else {
      template = ROLE_TEMPLATES.find((t) => t.id === from);
      description = template && template.id !== "blank" ? template.description : undefined;
    }
    const { permissions, dropped } = template ? applyTemplate(template, viewer) : { permissions: { keys: [], scopes: undefined }, dropped: 0 };
    const scopes = permissions.scopes;

    const result = await createRole({
      name,
      description,
      keys: permissions.keys,
      leadsScope: scopes?.leads,
      conversationsScope: scopes?.conversations,
      bookingsScope: scopes?.bookings,
      callsScope: scopes?.calls,
      salesScope: scopes?.sales,
      tasksScope: scopes?.tasks,
    });
    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (dropped > 0) result.data.role.description = result.data.role.description ?? null;
    onCreated(result.data.role);
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="new-role-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="w-full max-w-md space-y-4 rounded-xl border border-border bg-card p-5 shadow-xl">
        <h2 id="new-role-title" className="text-base font-semibold">Nuevo rol</h2>

        <label className="block text-xs font-medium">
          Nombre
          <input
            autoFocus
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder="Por ejemplo, Closer senior"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
          />
        </label>

        <label className="block text-xs font-medium">
          Empezar desde
          <select value={from} onChange={(e) => setFrom(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
            {ROLE_TEMPLATES.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
            <option value="duplicate">Duplicar un rol existente…</option>
          </select>
        </label>

        {from === "duplicate" ? (
          <label className="block text-xs font-medium">
            Rol a duplicar
            <select value={duplicateId} onChange={(e) => setDuplicateId(e.target.value)} className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm">
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{r.name}{r.systemRole ? " (de sistema)" : ""}</option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-muted-foreground">{ROLE_TEMPLATES.find((t) => t.id === from)?.description}</p>
        )}
        <p className="text-[11px] text-muted-foreground">Solo se copian los permisos que vos mismo tenés. Después los ajustás a gusto: todo se guarda solo.</p>

        {error && <p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted">Cancelar</button>
          <button type="submit" disabled={name.trim().length < 2 || pending} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50">
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
            Crear rol
          </button>
        </div>
      </form>
    </div>
  );
}
