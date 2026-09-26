"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { createRole, deleteRole, updateRole } from "@/lib/actions/roles";
import {
  PERMISSION_MODULES,
  permissionsOfModule,
  SCOPE_LABELS,
  type PermissionModule,
  type PermissionScope,
} from "@/lib/auth/permissions";
import { describeRole, moduleState, sortRoles, toggleModule, type RoleRow } from "@/lib/auth/roles-admin";

/**
 * La pantalla de roles (F71).
 *
 * Los tres de sistema se muestran arriba y no se editan: si alguien le saca
 * un permiso al rol Admin, la mitad del sistema deja de andar sin que quede
 * claro por qué. Para eso está "+ Nuevo rol".
 *
 * Los permisos se agrupan por módulo con un "todos" por grupo: la lista
 * tiene treinta y cinco claves y armar un rol tildando de a una es tedioso.
 */

const MODULE_LABELS: Record<PermissionModule, string> = {
  dashboards: "Dashboards",
  social: "Social",
  inbox: "Bandeja",
  contacts: "Contactos",
  flows: "Automatizaciones",
  sequences: "Secuencias",
  broadcasts: "Broadcasts",
  templates: "Plantillas",
  agents: "Agente de IA",
  knowledge: "Base de conocimiento",
  content: "Contenido",
  integrations: "Integraciones",
  team: "Equipo",
  settings: "Configuracion",
};

interface Draft {
  id: string | null;
  name: string;
  description: string;
  keys: string[];
  leadsScope: PermissionScope;
  conversationsScope: PermissionScope;
}

const emptyDraft = (): Draft => ({
  id: null,
  name: "",
  description: "",
  keys: [],
  leadsScope: "own",
  conversationsScope: "own",
});

export function RolesView({ roles: initial }: { roles: RoleRow[] }) {
  const [roles, setRoles] = useState(sortRoles(initial));
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);

  function openNew() {
    setDraft(emptyDraft());
    setError(null);
    setWarnings([]);
  }

  function openEdit(role: RoleRow) {
    setDraft({
      id: role.id,
      name: role.name,
      description: role.description ?? "",
      keys: [...role.permissions.keys],
      leadsScope: role.permissions.scopes.leads,
      conversationsScope: role.permissions.scopes.conversations,
    });
    setError(null);
    setWarnings([]);
  }

  function save() {
    if (!draft) return;
    setError(null);

    start(async () => {
      const input = {
        name: draft.name,
        description: draft.description,
        keys: draft.keys,
        leadsScope: draft.leadsScope,
        conversationsScope: draft.conversationsScope,
      };

      const result = draft.id ? await updateRole(draft.id, input) : await createRole(input);

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setWarnings(result.data.warnings);
      setDraft(null);
      // Se recarga para traer los roles con su cuenta de personas al dia.
      window.location.reload();
    });
  }

  function remove(roleId: string) {
    setError(null);
    start(async () => {
      const result = await deleteRole(roleId);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(null);
        return;
      }
      setRoles((current) => current.filter((r) => r.id !== roleId));
      setConfirmingDelete(null);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/settings/roles"
        right={
          <button
            type="button"
            onClick={openNew}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            Nuevo rol
          </button>
        }
      />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        {error && (
          <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {error}
          </p>
        )}

        {warnings.length > 0 && (
          <ul className="mb-4 space-y-1">
            {warnings.map((warning) => (
              <li key={warning} className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-2 text-sm">
                {warning}
              </li>
            ))}
          </ul>
        )}

        <ul className="space-y-2">
          {roles.map((role) => (
            <li key={role.id} className="rounded-xl border border-border p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">
                    {role.name}
                    {role.systemRole && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                        de sistema
                      </span>
                    )}
                  </p>
                  {role.description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">{describeRole(role)}</p>
                  {role.members > 0 && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                      <Users className="h-3 w-3" aria-hidden />
                      {role.members} {role.members === 1 ? "persona" : "personas"}
                    </p>
                  )}
                </div>

                {!role.systemRole && (
                  <div className="flex shrink-0 gap-1">
                    <button
                      type="button"
                      onClick={() => openEdit(role)}
                      aria-label={`Editar ${role.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg hover:bg-accent"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden />
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(role.id)}
                      aria-label={`Borrar ${role.name}`}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  </div>
                )}
              </div>

              {confirmingDelete === role.id && (
                <div className="mt-3 rounded-lg border border-border p-3">
                  <p className="text-sm">¿Borrar el rol &quot;{role.name}&quot;?</p>
                  <div className="mt-2 flex gap-2">
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => remove(role.id)}
                      className="rounded-lg bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-50"
                    >
                      Si, borrar
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmingDelete(null)}
                      className="rounded-lg border px-3 py-1.5 text-sm"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {draft && (
          <section className="mt-6 rounded-xl border border-border p-4">
            <h2 className="text-sm font-semibold">{draft.id ? "Editar rol" : "Nuevo rol"}</h2>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Nombre
                <input
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  placeholder="Setter senior"
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                />
              </label>
              <label className="text-sm">
                Descripcion
                <input
                  value={draft.description}
                  onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  placeholder="Atiende todos los leads y programa contenido"
                  className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
                />
              </label>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ScopeField
                label="Que leads ve"
                value={draft.leadsScope}
                onChange={(leadsScope) => setDraft({ ...draft, leadsScope })}
              />
              <ScopeField
                label="Que conversaciones ve"
                value={draft.conversationsScope}
                onChange={(conversationsScope) => setDraft({ ...draft, conversationsScope })}
              />
            </div>

            <div className="mt-4 space-y-3">
              {PERMISSION_MODULES.map((module) => {
                const permissions = permissionsOfModule(module);
                const state = moduleState(draft.keys, permissions.map((p) => p.key));

                return (
                  <fieldset key={module} className="rounded-lg border border-border p-3">
                    <legend className="flex items-center gap-2 px-1 text-xs font-semibold">
                      {MODULE_LABELS[module]}
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({
                            ...draft,
                            keys: toggleModule(
                              draft.keys,
                              permissions.map((p) => p.key),
                              state !== "all",
                            ),
                          })
                        }
                        className="rounded border border-border px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground"
                      >
                        {state === "all" ? "Ninguno" : "Todos"}
                      </button>
                    </legend>

                    <ul className="mt-1 space-y-1">
                      {permissions.map((permission) => (
                        <li key={permission.key}>
                          <label className="flex items-start gap-2 text-sm">
                            <input
                              type="checkbox"
                              checked={draft.keys.includes(permission.key)}
                              onChange={(e) =>
                                setDraft({
                                  ...draft,
                                  keys: e.target.checked
                                    ? [...draft.keys, permission.key]
                                    : draft.keys.filter((k) => k !== permission.key),
                                })
                              }
                              className="mt-0.5 h-4 w-4 rounded border-border"
                            />
                            <span>
                              {permission.label}
                              {permission.description && (
                                <span className="block text-[11px] text-muted-foreground">
                                  {permission.description}
                                </span>
                              )}
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  </fieldset>
                );
              })}
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={save}
                disabled={pending}
                className="inline-flex h-9 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                Guardar
              </button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="h-9 rounded-lg border border-border px-3 text-sm"
              >
                Cancelar
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function ScopeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: PermissionScope;
  onChange: (value: PermissionScope) => void;
}) {
  return (
    <label className="text-sm">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as PermissionScope)}
        className="mt-1 h-9 w-full rounded-lg border border-input bg-background px-3 text-sm"
      >
        {(["own", "all"] as const).map((scope) => (
          <option key={scope} value={scope}>
            {SCOPE_LABELS[scope]}
          </option>
        ))}
      </select>
    </label>
  );
}
