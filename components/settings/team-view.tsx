"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Users, Mail, Crown, Shield, User, Trash2, Clock, Plus, Loader2, Copy, Check, RefreshCw, CalendarPlus, XCircle, MoreHorizontal, History } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  copyInviteLink,
  inviteTeamMember,
  removeTeamMember,
  renewInvite,
  resendInvite,
  revokeInvite,
  setMemberRole,
  type InviteDelivery,
} from "@/lib/actions/team";
import { ROLE_LABELS } from "@/lib/auth/roles";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { TeamRolesSwitch } from "@/components/settings/team-roles-switch";
import { SettingsEmptyState } from "@/components/settings/settings-empty-state";
import { CloserControl } from "@/components/settings/closer-control"; // @plantilla-quitar(llamadas)
import { SETTINGS_EMPTY_STATES } from "@/lib/settings/empty-states";
import { memberRowControls, teamSections } from "@/lib/team/view-model";
import { deliveryChip, inviteState } from "@/lib/team/invite-state";
import { buildHistory, openInvites, type HistoryFilter } from "@/lib/team/invite-history";

interface MemberDetail {
  userId: string;
  role: string;
  /** El rol del workspace con los permisos finos (00088). */
  roleId: string | null;
  joinedAt: string;
  email: string;
  name: string;
  /** Graba llamadas de venta (Llamadas, 00145). */
  isCloser?: boolean;
  closerEmails?: string[];
}

/** Un rol del workspace, para el selector. */
interface WorkspaceRoleOption {
  id: string;
  name: string;
  systemRole: "owner" | "admin" | "member" | null;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: string;
  role_id: string | null;
  invited_by: string;
  status: string;
  created_at: string;
  expires_at: string;
  delivery: string;
  email_status: string | null;
  last_sent_at: string | null;
  send_count: number;
  accepted_at: string | null;
  accepted_by: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
}

const roleIcons: Record<string, React.ReactNode> = {
  owner: <Crown className="h-3 w-3" />,
  admin: <Shield className="h-3 w-3" />,
  member: <User className="h-3 w-3" />,
};

const roleStyles: Record<string, string> = {
  owner: "bg-amber-100 text-amber-700",
  admin: "bg-blue-100 text-blue-700",
  member: "bg-gray-100 text-gray-600",
};

const chipTone = { ok: "bg-green-100 text-green-700", warn: "bg-amber-100 text-amber-700", neutral: "bg-gray-100 text-gray-600" } as const;

const fmtDate = (iso: string | null, withYear = false) =>
  iso ? new Date(iso).toLocaleDateString("es-AR", { month: "short", day: "numeric", ...(withYear ? { year: "numeric" } : {}) }) : "—";

export function TeamView({
  workspaceId,
  currentUserId,
  viewerKeys,
  members: initialMembers,
  invites: initialInvites,
  workspaceRoles,
  grantableRoleIds,
  emailConfigured,
  personNames,
}: {
  workspaceId: string;
  currentUserId: string;
  /** Las claves de quien mira: de ahi sale que controles ve (lib/team/view-model.ts). */
  viewerKeys: string[];
  members: MemberDetail[];
  invites: TeamInvite[];
  workspaceRoles: WorkspaceRoleOption[];
  /** Los roles que quien mira puede dar (invitar y asignar): `assertCanGrant`, calculado en el servidor. */
  grantableRoleIds: string[];
  emailConfigured: boolean;
  /** user_id -> nombre, para "Invitó X" y "Aceptada por X". */
  personNames: Record<string, string>;
}) {
  const router = useRouter();
  const viewer = useMemo(() => ({ userId: currentUserId, can: (key: string) => viewerKeys.includes(key) }), [currentUserId, viewerKeys]);
  const sections = teamSections(viewer);

  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);
  const inviteEmailRef = useRef<HTMLInputElement>(null);

  const memberRoleId = workspaceRoles.find((r) => r.systemRole === "member")?.id ?? "";
  const grantable = new Set(grantableRoleIds);
  const inviteRoles = workspaceRoles.filter((r) => r.systemRole !== "owner" && grantable.has(r.id));

  // Formulario de invitar
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState(grantable.has(memberRoleId) ? memberRoleId : (inviteRoles[0]?.id ?? ""));
  const [delivery, setDelivery] = useState<InviteDelivery>(emailConfigured ? "email" : "link");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<{ message: string; existingUrl?: string } | null>(null);
  const [lastInvite, setLastInvite] = useState<{ url: string; emailStatus: string | null; email: string } | null>(null);

  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Historial
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>("all");
  const [historyPage, setHistoryPage] = useState(1);

  const roleName = (invite: TeamInvite) =>
    workspaceRoles.find((r) => r.id === invite.role_id)?.name ?? ROLE_LABELS[invite.role as keyof typeof ROLE_LABELS] ?? invite.role;

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;
    setInviting(true);
    setInviteError(null);
    setLastInvite(null);
    setNotice(null);

    const result = await inviteTeamMember({ email: inviteEmail, roleId: inviteRoleId, delivery });
    if (!result.ok) {
      setInviteError({ message: result.error, existingUrl: result.existingInviteUrl });
    } else {
      setLastInvite({ url: result.inviteUrl, emailStatus: result.emailStatus, email: result.invite.email });
      setInviteEmail("");
      router.refresh();
    }
    setInviting(false);
  }

  async function copyLink(key: string, url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? null : c)), 2000);
    } catch {
      // Sin permiso de portapapeles el link igual esta visible para copiarlo a mano.
      setCopied(null);
    }
  }

  async function handleCopyPending(inviteId: string) {
    setBusy(inviteId);
    setActionError(null);
    const result = await copyInviteLink(inviteId);
    if (!result.ok) setActionError(result.error);
    else await copyLink(inviteId, result.inviteUrl);
    setBusy(null);
  }

  async function handleResend(inviteId: string) {
    setBusy(inviteId);
    setActionError(null);
    setNotice(null);
    const result = await resendInvite(inviteId);
    if (!result.ok) setActionError(result.error);
    else {
      setNotice(result.emailStatus === "sent" ? "Email enviado." : "No se pudo mandar el email. Pasale el link a mano.");
      router.refresh();
    }
    setBusy(null);
  }

  async function handleRenew(inviteId: string) {
    setBusy(inviteId);
    setActionError(null);
    const result = await renewInvite(inviteId);
    if (!result.ok) setActionError(result.error);
    else {
      setInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, expires_at: result.expiresAt } : i)));
      setNotice("Invitación renovada por 7 días.");
    }
    setBusy(null);
  }

  async function handleRevoke(inviteId: string) {
    setBusy(inviteId);
    setActionError(null);
    const result = await revokeInvite(inviteId);
    if (!result.ok) setActionError(result.error);
    else {
      setInvites((prev) => prev.map((i) => (i.id === inviteId ? { ...i, status: "revoked", revoked_at: new Date().toISOString(), revoked_by: currentUserId } : i)));
    }
    setBusy(null);
  }

  async function handleRemove(userId: string) {
    setBusy(userId);
    setActionError(null);
    const result = await removeTeamMember(workspaceId, userId);
    if (!result.ok) setActionError(result.error);
    else setMembers((prev) => prev.filter((m) => m.userId !== userId));
    setBusy(null);
  }

  /** Asignar un rol del workspace: `role` queda owner/admin/member y `role_id` apunta al rol con los permisos finos. */
  async function handleRoleChange(userId: string, roleId: string) {
    setChangingRoleFor(userId);
    setActionError(null);
    const previous = members;
    const role = workspaceRoles.find((r) => r.id === roleId);
    setMembers((prev) => prev.map((m) => (m.userId === userId ? { ...m, roleId, role: role?.systemRole ?? "member" } : m)));
    const result = await setMemberRole({ userId, roleId });
    if (!result.ok) {
      setMembers(previous);
      setActionError(result.error);
    }
    setChangingRoleFor(null);
  }

  const open = openInvites(invites);
  const history = buildHistory(invites, { filter: historyFilter, page: historyPage });
  const canInvite = sections.invite && inviteRoles.length > 0;

  return (
    <div className="flex h-full flex-col">
      {/* Sin flecha de "volver a Ajustes": las pestañas de abajo ya cumplen esa función (S3). */}
      <PageHeader route="/dashboard/settings/team" />
      <SettingsTabs />
      <TeamRolesSwitch />

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-4 py-8 sm:px-8">
          {/* Miembros */}
          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">Miembros ({members.length})</h2>
            </div>

            {members.length === 0 ? (
              <SettingsEmptyState
                description={SETTINGS_EMPTY_STATES.team}
                action={
                  canInvite && (
                    <button type="button" onClick={() => inviteEmailRef.current?.focus()} className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
                      Invitar a alguien
                    </button>
                  )
                }
              />
            ) : (
              <div className="mt-4 space-y-2">
                {members.map((member) => {
                  const controls = memberRowControls(viewer, member);
                  return (
                    <div key={member.userId} className="rounded-xl border border-border bg-card p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                            {member.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <p className="truncate text-sm font-medium">{member.name}</p>
                              {member.userId === currentUserId && <span className="shrink-0 text-[10px] text-muted-foreground">(vos)</span>}
                            </div>
                            <p className="truncate text-xs text-muted-foreground">{member.email}</p>
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {controls.roleSelect ? (
                            <label className="flex items-center gap-1">
                              <span className="sr-only">Rol de {member.name}</span>
                              <select
                                value={member.roleId ?? ""}
                                onChange={(e) => handleRoleChange(member.userId, e.target.value)}
                                disabled={changingRoleFor === member.userId}
                                className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] disabled:opacity-50"
                              >
                                {member.roleId === null && <option value="">Sin rol</option>}
                                {workspaceRoles
                                  .filter((r) => r.systemRole !== "owner")
                                  .map((r) => (
                                    <option key={r.id} value={r.id} disabled={!grantable.has(r.id) && r.id !== member.roleId}>
                                      {r.name}
                                    </option>
                                  ))}
                              </select>
                              {changingRoleFor === member.userId && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                            </label>
                          ) : (
                            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", roleStyles[member.role] ?? roleStyles.member)}>
                              {roleIcons[member.role] ?? roleIcons.member}
                              {workspaceRoles.find((r) => r.id === member.roleId)?.name ?? ROLE_LABELS[member.role as keyof typeof ROLE_LABELS] ?? member.role}
                            </span>
                          )}

                          <span className="whitespace-nowrap text-[10px] text-muted-foreground">Desde el {fmtDate(member.joinedAt, true)}</span>

                          {controls.remove && (
                            <button
                              onClick={() => setConfirmRemove({ userId: member.userId, name: member.name })}
                              disabled={busy === member.userId}
                              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                              title="Quitar del equipo"
                              aria-label={`Quitar a ${member.name} del equipo`}
                            >
                              {busy === member.userId ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      </div>
                      {/* @plantilla-desde(llamadas) */}
                      {controls.closer && (
                        <CloserControl userId={member.userId} name={member.name} initialIsCloser={member.isCloser ?? false} initialEmails={member.closerEmails ?? []} />
                      )}
                      {/* @plantilla-hasta(llamadas) */}
                    </div>
                  );
                })}
              </div>
            )}

            {actionError && (
              <p role="alert" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {actionError}
              </p>
            )}
            {notice && (
              <p role="status" className="mt-3 rounded-lg bg-muted px-3 py-2 text-xs text-foreground">
                {notice}
              </p>
            )}
          </section>

          {/* Invitar */}
          {sections.invite && (
            <>
              <hr className="border-border" />
              <section>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Invitar a alguien</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">La invitación vence en 7 días. Podés mandarla por email o solo generar el link.</p>

                {inviteRoles.length === 0 ? (
                  <p className="mt-4 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">No tenés ningún rol que puedas dar. Pedile a un Admin que invite.</p>
                ) : (
                  <form onSubmit={handleInvite} className="mt-4 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <input
                        ref={inviteEmailRef}
                        type="email"
                        aria-label="Email de la persona a invitar"
                        value={inviteEmail}
                        onChange={(e) => {
                          setInviteEmail(e.target.value);
                          setInviteError(null);
                        }}
                        placeholder="colega@ejemplo.com"
                        required
                        className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                      <select
                        aria-label="Rol con el que entra"
                        value={inviteRoleId}
                        onChange={(e) => setInviteRoleId(e.target.value)}
                        className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                      >
                        {inviteRoles.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <div role="radiogroup" aria-label="Cómo mandar la invitación" className="inline-flex rounded-lg border border-border bg-muted p-0.5 text-xs">
                        <button
                          type="button"
                          role="radio"
                          aria-checked={delivery === "email"}
                          disabled={!emailConfigured}
                          onClick={() => setDelivery("email")}
                          className={cn("rounded-md px-3 py-1.5 font-medium disabled:cursor-not-allowed disabled:opacity-50", delivery === "email" ? "bg-card shadow-sm" : "text-muted-foreground")}
                        >
                          Enviar por email
                        </button>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={delivery === "link"}
                          onClick={() => setDelivery("link")}
                          className={cn("rounded-md px-3 py-1.5 font-medium", delivery === "link" ? "bg-card shadow-sm" : "text-muted-foreground")}
                        >
                          Solo generar link
                        </button>
                      </div>
                      <button
                        type="submit"
                        disabled={!inviteEmail.trim() || inviting}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                        {inviting ? "Invitando..." : delivery === "email" ? "Enviar invitación" : "Generar link"}
                      </button>
                    </div>
                    {!emailConfigured && (
                      <p className="text-xs text-muted-foreground">
                        El email todavía no está conectado.{" "}
                        <Link href="/dashboard/settings/integrations" className="text-primary underline underline-offset-2 hover:opacity-80">
                          Conectá el email en Integraciones
                        </Link>{" "}
                        para que las invitaciones salgan solas.
                      </p>
                    )}
                  </form>
                )}

                {inviteError && (
                  <div role="alert" className="mt-3 text-xs text-destructive">
                    <p>{inviteError.message}</p>
                    {inviteError.existingUrl && (
                      <button type="button" onClick={() => copyLink("existing", inviteError.existingUrl!)} className="mt-1 inline-flex items-center gap-1 text-primary underline underline-offset-2">
                        {copied === "existing" ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                        {copied === "existing" ? "Link copiado" : "Copiar el link de esa invitación"}
                      </button>
                    )}
                  </div>
                )}

                {lastInvite && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-xs font-medium">
                      {lastInvite.emailStatus === "sent"
                        ? `Invitación enviada a ${lastInvite.email}.`
                        : lastInvite.emailStatus === null
                          ? `Invitación creada para ${lastInvite.email}. Pasale este link.`
                          : lastInvite.emailStatus === "not_configured"
                            ? "El email todavía no está conectado: pasale vos este link."
                            : "No se pudo mandar el email. Pasale este link."}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">{lastInvite.url}</code>
                      <button
                        type="button"
                        onClick={() => copyLink("last", lastInvite.url)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        {copied === "last" ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied === "last" ? "Copiado" : "Copiar link"}
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}

          {/* Pendientes: siempre visible para quien invita */}
          {sections.pending && (
            <>
              <hr className="border-border" />
              <section>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Invitaciones pendientes ({open.length})</h2>
                </div>

                {open.length === 0 ? (
                  <p className="mt-4 text-xs text-muted-foreground">No hay invitaciones pendientes.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {open.map((invite) => {
                      const expired = inviteState(invite) === "expired";
                      const chip = deliveryChip(invite);
                      const working = busy === invite.id;
                      const actions = [
                        { id: "copy", label: "Copiar link", icon: copied === invite.id ? Check : Copy, run: () => handleCopyPending(invite.id), hide: expired },
                        { id: "resend", label: "Reenviar email", icon: RefreshCw, run: () => handleResend(invite.id), hide: false },
                        { id: "renew", label: "Renovar 7 días", icon: CalendarPlus, run: () => handleRenew(invite.id), hide: false },
                        { id: "revoke", label: "Anular", icon: XCircle, run: () => setConfirmRevoke(invite.id), hide: false, destructive: true },
                      ].filter((a) => !a.hide);
                      return (
                        <div key={invite.id} className={cn("flex items-center justify-between gap-2 rounded-xl border border-border bg-card p-4", expired && "opacity-70")}>
                          <div className="flex min-w-0 items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                              <Mail className="h-4 w-4 text-muted-foreground" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-medium">{invite.email}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium", roleStyles[invite.role] ?? roleStyles.member)}>
                                  {roleIcons[invite.role] ?? roleIcons.member}
                                  {roleName(invite)}
                                </span>
                                <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-medium", chipTone[chip.tone])}>{chip.label}</span>
                                <span className="text-[10px] text-muted-foreground">Invitó {personNames[invite.invited_by] ?? "alguien del equipo"}</span>
                                {expired ? <span className="text-[10px] text-destructive">Vencida</span> : <span className="text-[10px] text-muted-foreground">Vence el {fmtDate(invite.expires_at)}</span>}
                              </div>
                            </div>
                          </div>

                          {/* En escritorio, íconos con tooltip; en el celular, un menú «⋯» por fila. */}
                          <div className="hidden shrink-0 items-center gap-0.5 sm:flex">
                            {actions.map((a) => (
                              <button
                                key={a.id}
                                type="button"
                                onClick={a.run}
                                disabled={working}
                                title={a.label}
                                aria-label={a.label}
                                className={cn("rounded-lg p-1.5 text-muted-foreground transition-colors disabled:opacity-50", a.destructive ? "hover:bg-destructive/10 hover:text-destructive" : "hover:bg-muted hover:text-foreground")}
                              >
                                {working && a.id !== "revoke" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <a.icon className="h-3.5 w-3.5" />}
                              </button>
                            ))}
                          </div>
                          <details className="relative shrink-0 sm:hidden">
                            <summary className="flex cursor-pointer list-none rounded-lg p-1.5 text-muted-foreground hover:bg-muted" aria-label={`Acciones de la invitación a ${invite.email}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </summary>
                            <div className="absolute right-0 z-10 mt-1 w-44 rounded-lg border border-border bg-card p-1 shadow-lg">
                              {actions.map((a) => (
                                <button key={a.id} type="button" onClick={a.run} disabled={working} className={cn("flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-muted", a.destructive && "text-destructive")}>
                                  <a.icon className="h-3.5 w-3.5" />
                                  {a.label}
                                </button>
                              ))}
                            </div>
                          </details>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>

              {/* Historial, plegado */}
              <details className="group rounded-xl border border-border">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-sm font-semibold">
                  <History className="h-4 w-4 text-muted-foreground" />
                  Historial de invitaciones
                </summary>
                <div className="border-t border-border px-4 py-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    Mostrar
                    <select
                      value={historyFilter}
                      onChange={(e) => {
                        setHistoryFilter(e.target.value as HistoryFilter);
                        setHistoryPage(1);
                      }}
                      className="rounded-lg border border-border bg-card px-2 py-1 text-xs text-foreground"
                    >
                      <option value="all">Todas</option>
                      <option value="accepted">Aceptadas</option>
                      <option value="revoked">Anuladas</option>
                      <option value="expired">Vencidas</option>
                    </select>
                  </label>

                  {history.total === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">Todavía no hay invitaciones en el historial.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {history.entries.map(({ invite, state, at }) => (
                        <li key={invite.id} className="flex items-start justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{invite.email}</p>
                            <p className="text-muted-foreground">
                              {roleName(invite as TeamInvite)} ·{" "}
                              {state === "accepted"
                                ? `Aceptada por ${personNames[invite.accepted_by ?? ""] ?? "una cuenta"} el ${fmtDate(at, true)}`
                                : state === "revoked"
                                  ? `Anulada${invite.revoked_by ? ` por ${personNames[invite.revoked_by] ?? "alguien del equipo"}` : ""} el ${fmtDate(at, true)}`
                                  : `Venció el ${fmtDate(at, true)} sin usarse`}
                            </p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  {history.page < history.pages && (
                    <button type="button" onClick={() => setHistoryPage(history.page + 1)} className="mt-3 text-xs font-medium text-primary underline underline-offset-2">
                      Ver más
                    </button>
                  )}
                </div>
              </details>
            </>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!confirmRemove}
        title="Quitar del equipo"
        message={`¿Seguro que querés quitar a ${confirmRemove?.name ?? "esta persona"} del workspace?`}
        confirmLabel="Quitar"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          if (confirmRemove) handleRemove(confirmRemove.userId);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={!!confirmRevoke}
        title="Anular invitación"
        message="¿Seguro que querés anular esta invitación? Queda en el historial como anulada."
        confirmLabel="Anular"
        cancelLabel="Cancelar"
        destructive
        onConfirm={() => {
          if (confirmRevoke) handleRevoke(confirmRevoke);
          setConfirmRevoke(null);
        }}
        onCancel={() => setConfirmRevoke(null)}
      />
    </div>
  );
}
