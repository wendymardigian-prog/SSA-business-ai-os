import { createClient, createServiceClient } from "@/lib/supabase/server";
import { AcceptInviteView } from "./accept-invite-view";
import { BrandMark } from "@/components/brand-mark";
import { inviteState, invalidInviteMessage } from "@/lib/team/invite-state";

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
        title="Esta invitación ya no es válida"
        body="El link puede estar mal copiado, o la invitación fue anulada."
        cta="Ir al login"
        href="/login"
      />
    );
  }

  // Anulada, aceptada o vencida: "Esta invitación ya no es válida"; la vencida agrega que pidan una renovacion.
  const state = inviteState(invite);
  if (state !== "pending") {
    const message = invalidInviteMessage(state);
    return (
      <InviteMessage
        title={message.title}
        body={message.hint ?? "Si creés que es un error, pedile a quien te invitó que te mande una nueva."}
        cta={state === "accepted" ? "Ir al dashboard" : "Ir al login"}
        href={state === "accepted" ? "/dashboard" : "/login"}
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

  // El nombre del rol con el que entra (el de la invitacion, o el rol de sistema que dice `role`).
  const { data: roleRow } = invite.role_id
    ? await serviceClient.from("workspace_roles").select("name").eq("id", invite.role_id).maybeSingle()
    : { data: null };

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
      roleName={roleRow?.name ?? null}
      email={invite.email}
      isLoggedIn={!!user}
      currentUserEmail={user?.email ?? null}
    />
  );
}
