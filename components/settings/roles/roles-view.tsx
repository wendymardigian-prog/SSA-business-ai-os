"use client";

import { useState, useTransition } from "react";
import { ChevronDown, Copy, Eye, Pencil, Plus, Shield, Trash2, User, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { deleteRole } from "@/lib/actions/roles";
import { describeRole, sortRoles, type RoleRow } from "@/lib/auth/roles-admin";
import type { GrantActor } from "@/lib/team/grant";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { TeamRolesSwitch } from "@/components/settings/team-roles-switch";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { RoleEditor } from "./role-editor";
import { NewRoleDialog } from "./new-role-dialog";

/**
 * La pantalla de roles (F71, B3).
 *
 * Los de sistema se muestran arriba con «Ver permisos» y «Duplicar» (no se editan). Los personalizados
 * se editan EN EL LUGAR, debajo de su tarjeta, con guardado automático. Quien solo tiene `roles.view`
 * ve todo en solo lectura.
 */

const systemIcon: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3 w-3" aria-hidden />,
  admin: <Shield className="h-3 w-3" aria-hidden />,
  member: <User className="h-3 w-3" aria-hidden />,
};

export function RolesView({
  roles: initial,
  canSeeMembers,
  canManage,
  viewer,
}: {
  roles: RoleRow[];
  /** Si puede ver también Equipo: oculta «Miembros» del segmented si esa pantalla lo rebotaría. */
  canSeeMembers?: boolean;
  /** `roles.manage`: puede crear, editar y borrar. Sin esto, solo ve. */
  canManage: boolean;
  /** Quien mira, para saber qué permisos puede dar. */
  viewer: GrantActor;
}) {
  const [roles, setRoles] = useState(sortRoles(initial));
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<RoleRow | null>(null);
  const [, start] = useTransition();

  function replaceRole(updated: RoleRow) {
    setRoles((current) => sortRoles(current.map((r) => (r.id === updated.id ? { ...updated, members: updated.members } : r))));
  }

  function remove(role: RoleRow) {
    setError(null);
    start(async () => {
      const result = await deleteRole(role.id);
      if (!result.ok) {
        setError(result.error);
        setConfirmingDelete(null);
        return;
      }
      setRoles((current) => current.filter((r) => r.id !== role.id));
      setConfirmingDelete(null);
      if (open === role.id) setOpen(null);
    });
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        route="/dashboard/settings/roles"
        right={
          canManage ? (
            <button type="button" onClick={() => setCreating(true)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Nuevo rol
            </button>
          ) : undefined
        }
      />
      <SettingsTabs />
      <TeamRolesSwitch canSeeMembers={canSeeMembers} />

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <p className="mb-4 text-sm text-muted-foreground">
          {canManage
            ? "Owner, Admin y Member vienen con el sistema y no se editan: podés ver sus permisos y duplicarlos. Los roles que armes se guardan solos a medida que los cambiás."
            : "Acá ves qué puede cada rol. Para cambiarlos hace falta el permiso «Administrar roles»."}
        </p>

        {error && <p role="alert" className="mb-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

        {roles.length === 0 ? (
          <SettingsEmptyState
            description={SETTINGS_EMPTY_STATES.roles}
            action={canManage ? <button type="button" onClick={() => setCreating(true)} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Nuevo rol</button> : undefined}
          />
        ) : (
          <ul className="space-y-2">
            {roles.map((role) => {
              const expanded = open === role.id;
              const editable = canManage && !role.systemRole;
              const summary = !role.systemRole || role.systemRole === "member" ? describeRole(role) : null;
              return (
                <li key={role.id} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="flex flex-wrap items-center justify-between gap-2 p-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">{role.name}</h2>
                        {role.systemRole && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {systemIcon[role.systemRole]} de sistema
                          </span>
                        )}
                      </div>
                      {role.description && <p className="mt-0.5 text-xs text-muted-foreground">{role.description}</p>}
                      {summary && <p className="mt-0.5 text-xs text-muted-foreground">{summary}</p>}
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {role.members === 0 ? "Sin personas" : role.members === 1 ? "1 persona" : `${role.members} personas`}
                      </p>
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setOpen(expanded ? null : role.id)}
                        aria-expanded={expanded}
                        className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        {editable ? <Pencil className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
                        {editable ? "Editar" : "Ver permisos"}
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-180")} aria-hidden />
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => setCreating(true)}
                          title="Duplicar este rol"
                          aria-label={`Duplicar el rol ${role.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                        >
                          <Copy className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                      {editable && (
                        <button
                          type="button"
                          onClick={() => setConfirmingDelete(role)}
                          title="Borrar el rol"
                          aria-label={`Borrar el rol ${role.name}`}
                          className="rounded-lg p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>

                  {expanded && <RoleEditor role={role} viewer={viewer} readOnly={!editable} onRoleChange={replaceRole} />}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {creating && (
        <NewRoleDialog
          roles={roles}
          viewer={viewer}
          onClose={() => setCreating(false)}
          onCreated={(role) => {
            setRoles((current) => sortRoles([...current, role]));
            setOpen(role.id);
            setCreating(false);
          }}
        />
      )}

      <ConfirmDialog
        open={!!confirmingDelete}
        title="Borrar el rol"
        message={confirmingDelete ? `¿Seguro que querés borrar el rol «${confirmingDelete.name}»? Si tiene personas asignadas, primero hay que cambiarles el rol.` : ""}
        confirmLabel="Borrar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => confirmingDelete && remove(confirmingDelete)}
        onCancel={() => setConfirmingDelete(null)}
      />
    </div>
  );
}
