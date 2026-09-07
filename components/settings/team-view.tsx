"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Mail,
  Crown,
  Shield,
  User,
  Trash2,
  X,
  Clock,
  Plus,
  Loader2,
  ArrowLeft,
  Copy,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  changeMemberRole,
  inviteTeamMember,
  removeTeamMember,
  revokeInvite,
} from "@/lib/actions/team";
import { ASSIGNABLE_ROLES, isAdminRole, ROLE_LABELS } from "@/lib/auth/roles";
import Link from "next/link";
import { ConfirmDialog } from "@/components/confirm-dialog";

interface MemberDetail {
  userId: string;
  role: string;
  joinedAt: string;
  email: string;
  name: string;
}

interface PendingInvite {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  invited_by: string;
  status: string;
  created_at: string;
  expires_at: string;
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

export function TeamView({
  workspaceId,
  workspaceName,
  currentUserId,
  currentUserRole,
  members: initialMembers,
  pendingInvites: initialInvites,
}: {
  workspaceId: string;
  workspaceName: string;
  currentUserId: string;
  currentUserRole: string;
  members: MemberDetail[];
  pendingInvites: PendingInvite[];
}) {
  const router = useRouter();
  const isOwner = currentUserRole === "owner";
  // Owner y Admin gestionan el equipo; remover miembros queda solo en Owner.
  const canManageTeam = isAdminRole(currentUserRole);

  const [members, setMembers] = useState(initialMembers);
  const [invites, setInvites] = useState(initialInvites);

  // Invite form
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState<string | null>(null);
  // Resultado del ultimo invite: el link siempre, y como termino el email.
  const [lastInvite, setLastInvite] = useState<{
    url: string;
    emailStatus: "sent" | "not_configured" | "failed";
    email: string;
  } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  // Remove member
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ userId: string; name: string } | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<string | null>(null);

  // Cambio de rol
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);
  const [roleError, setRoleError] = useState<string | null>(null);

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault();
    if (!inviteEmail.trim() || inviting) return;

    setInviting(true);
    setInviteError(null);
    setLastInvite(null);
    setCopiedInvite(false);

    const result = await inviteTeamMember(workspaceId, inviteEmail, inviteRole);

    if (result.error) {
      setInviteError(result.error);
    } else if (result.invite) {
      setInvites((prev) => [result.invite as PendingInvite, ...prev]);
      // El link se muestra siempre, mande o no el email: es lo que garantiza
      // que la invitacion llegue aunque Resend no este conectado.
      setLastInvite({
        url: result.inviteUrl ?? "",
        emailStatus: result.emailStatus ?? "not_configured",
        email: inviteEmail.trim().toLowerCase(),
      });
      setInviteEmail("");
      setInviteRole("member");
    }

    setInviting(false);
  }

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedInvite(true);
      setTimeout(() => setCopiedInvite(false), 2000);
    } catch {
      // Sin permiso de portapapeles el link igual esta visible para copiarlo a mano.
      setCopiedInvite(false);
    }
  }

  async function handleRemove(userId: string) {
    setRemovingId(userId);

    const result = await removeTeamMember(workspaceId, userId);

    if (!result.error) {
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    }

    setRemovingId(null);
  }

  async function handleRoleChange(userId: string, newRole: string) {
    setChangingRoleFor(userId);
    setRoleError(null);

    const previous = members;
    setMembers((prev) =>
      prev.map((m) => (m.userId === userId ? { ...m, role: newRole } : m))
    );

    const result = await changeMemberRole(workspaceId, userId, newRole);

    if (result.error) {
      setMembers(previous);
      setRoleError(result.error);
    }

    setChangingRoleFor(null);
  }

  async function handleRevoke(inviteId: string) {
    setRevokingId(inviteId);

    const result = await revokeInvite(inviteId);

    if (!result.error) {
      setInvites((prev) => prev.filter((i) => i.id !== inviteId));
    }

    setRevokingId(null);
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-8 py-6">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/settings"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold">Team</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage members and invitations for {workspaceName}
            </p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl space-y-8 px-8 py-8">
          {/* Members list */}
          <section>
            <div className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">
                Members ({members.length})
              </h2>
            </div>

            <div className="mt-4 space-y-2">
              {members.map((member) => (
                <div
                  key={member.userId}
                  className="flex items-center justify-between rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-medium text-muted-foreground">
                      {member.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate">
                          {member.name}
                        </p>
                        {member.userId === currentUserId && (
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            (you)
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {member.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 ml-4">
                    {canManageTeam &&
                    member.role !== "owner" &&
                    member.userId !== currentUserId ? (
                      <label className="flex items-center gap-1">
                        <span className="sr-only">
                          Rol de {member.name}
                        </span>
                        <select
                          value={member.role}
                          onChange={(e) =>
                            handleRoleChange(member.userId, e.target.value)
                          }
                          disabled={changingRoleFor === member.userId}
                          className="rounded-lg border border-border bg-card px-2 py-1 text-[11px] capitalize disabled:opacity-50"
                        >
                          {ASSIGNABLE_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </option>
                          ))}
                        </select>
                        {changingRoleFor === member.userId && (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        )}
                      </label>
                    ) : (
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                          roleStyles[member.role] ?? roleStyles.member
                        )}
                      >
                        {roleIcons[member.role] ?? roleIcons.member}
                        {member.role}
                      </span>
                    )}

                    <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                      Joined{" "}
                      {new Date(member.joinedAt).toLocaleDateString([], {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>

                    {isOwner && member.userId !== currentUserId && (
                      <button
                        onClick={() =>
                          setConfirmRemove({ userId: member.userId, name: member.name })
                        }
                        disabled={removingId === member.userId}
                        className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                        title="Remove member"
                      >
                        {removingId === member.userId ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {roleError && (
              <p
                role="alert"
                className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive"
              >
                {roleError}
              </p>
            )}
          </section>

          {/* Invitaciones: Owner y Admin */}
          {canManageTeam && (
            <>
              <hr className="border-border" />

              <section>
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">Invite a Member</h2>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Send an invitation link. The invite expires in 7 days.
                </p>

                <form onSubmit={handleInvite} className="mt-4 flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => {
                      setInviteEmail(e.target.value);
                      setInviteError(null);
                    }}
                    placeholder="colleague@example.com"
                    required
                    className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value)}
                    className="rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                  >
                    <option value="member">Member</option>
                    <option value="admin">Admin</option>
                  </select>
                  <button
                    type="submit"
                    disabled={!inviteEmail.trim() || inviting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {inviting ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}
                    {inviting ? "Inviting..." : "Invite"}
                  </button>
                </form>

                {inviteError && (
                  <p className="mt-2 text-xs text-destructive">{inviteError}</p>
                )}

                {lastInvite && (
                  <div className="mt-4 rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-xs font-medium">
                      {lastInvite.emailStatus === "sent"
                        ? `Invitacion enviada por email a ${lastInvite.email}.`
                        : lastInvite.emailStatus === "not_configured"
                          ? "El email todavia no esta conectado: pasale vos este link."
                          : "No se pudo mandar el email. Pasale vos este link."}
                    </p>

                    <div className="mt-2 flex items-center gap-2">
                      <code className="flex-1 truncate rounded-md border border-border bg-background px-2 py-1.5 text-xs">
                        {lastInvite.url}
                      </code>
                      <button
                        type="button"
                        onClick={() => copyInviteLink(lastInvite.url)}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                      >
                        {copiedInvite ? (
                          <Check className="h-3.5 w-3.5 text-green-600" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                        {copiedInvite ? "Copiado" : "Copiar link"}
                      </button>
                    </div>

                    {lastInvite.emailStatus !== "sent" && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        Para que las invitaciones salgan solas,{" "}
                        <Link
                          href="/dashboard/settings/integrations"
                          className="text-primary underline underline-offset-2 hover:opacity-80"
                        >
                          conecta el email en Integraciones
                        </Link>
                        .
                      </p>
                    )}
                  </div>
                )}
              </section>
            </>
          )}

          {/* Pending invites */}
          {invites.length > 0 && (
            <>
              <hr className="border-border" />

              <section>
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-sm font-semibold">
                    Pending Invites ({invites.length})
                  </h2>
                </div>

                <div className="mt-4 space-y-2">
                  {invites.map((invite) => {
                    const isExpired =
                      new Date(invite.expires_at) < new Date();
                    return (
                      <div
                        key={invite.id}
                        className={cn(
                          "flex items-center justify-between rounded-xl border border-border bg-card p-4",
                          isExpired && "opacity-60"
                        )}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                            <Mail className="h-4 w-4 text-muted-foreground" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-sm font-medium truncate">
                              {invite.email}
                            </p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                                  roleStyles[invite.role] ?? roleStyles.member
                                )}
                              >
                                {roleIcons[invite.role] ?? roleIcons.member}
                                {invite.role}
                              </span>
                              {isExpired ? (
                                <span className="text-[10px] text-destructive">
                                  Expired
                                </span>
                              ) : (
                                <span className="text-[10px] text-muted-foreground">
                                  Expires{" "}
                                  {new Date(
                                    invite.expires_at
                                  ).toLocaleDateString([], {
                                    month: "short",
                                    day: "numeric",
                                  })}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {canManageTeam && (
                          <button
                            onClick={() => setConfirmRevoke(invite.id)}
                            disabled={revokingId === invite.id}
                            className="shrink-0 ml-4 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                            title="Revoke invite"
                          >
                            {revokingId === invite.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <X className="h-3.5 w-3.5" />
                            )}
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </section>
            </>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={!!confirmRemove}
        title="Remove member"
        message={`Are you sure you want to remove ${confirmRemove?.name ?? "this member"} from the workspace?`}
        confirmLabel="Remove"
        destructive
        onConfirm={() => {
          if (confirmRemove) handleRemove(confirmRemove.userId);
          setConfirmRemove(null);
        }}
        onCancel={() => setConfirmRemove(null)}
      />
      <ConfirmDialog
        open={!!confirmRevoke}
        title="Revoke invite"
        message="Are you sure you want to revoke this invitation?"
        confirmLabel="Revoke"
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
