import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AcceptInviteView } from "./accept-invite-view";
import { BrandMark } from "@/components/brand-mark";

function InviteMessage({ title, body, cta, href }: { title: string; body: string; cta: string; href: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm text-center space-y-4">
        <BrandMark size={40} className="mx-auto" />
        <h1 className="text-2xl font-bold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
        <a
          href={href}
          className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          {cta}
        </a>
      </div>
    </div>
  );
}

export default async function InvitePage({
  params,
}: {
  params: Promise<{ inviteId: string }>;
}) {
  const { inviteId } = await params;
  const supabase = await createClient();
  const serviceClient = await createServiceClient();

  // Fetch the invite using service client (public page, user may not be logged in)
  const { data: invite, error } = await serviceClient
    .from("workspace_invites")
    .select("*")
    .eq("id", inviteId)
    .single();

  if (error || !invite) {
    return (
      <InviteMessage
        title="Invitación no encontrada"
        body="Este link puede ser invalido o la invitación fue revocada."
        cta="Ir al login"
        href="/login"
      />
    );
  }

  const isExpired = new Date(invite.expires_at) < new Date();
  const isAlreadyAccepted = invite.status !== "pending";

  if (isExpired) {
    return (
      <InviteMessage
        title="Invitación vencida"
        body="Pedile a quien te invitó que te mande una nueva."
        cta="Ir al login"
        href="/login"
      />
    );
  }

  if (isAlreadyAccepted) {
    return (
      <InviteMessage
        title="Invitación ya usada"
        body="Esta invitación ya fue aceptada."
        cta="Ir al dashboard"
        href="/dashboard"
      />
    );
  }

  // Get workspace name
  const { data: workspace } = await serviceClient
    .from("workspaces")
    .select("name")
    .eq("id", invite.workspace_id)
    .single();

  // Get inviter name
  const {
    data: { user: inviter },
  } = await serviceClient.auth.admin.getUserById(invite.invited_by);

  const inviterName =
    inviter?.user_metadata?.full_name ??
    inviter?.user_metadata?.name ??
    inviter?.email ??
    "Alguien";

  // Check if current user is logged in
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <AcceptInviteView
      inviteId={invite.id}
      workspaceName={workspace?.name ?? "un workspace"}
      inviterName={inviterName}
      role={invite.role}
      email={invite.email}
      isLoggedIn={!!user}
      currentUserEmail={user?.email ?? null}
    />
  );
}
