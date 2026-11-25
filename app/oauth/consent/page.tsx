import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/brand-mark";
import { brandName } from "@/lib/brand";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createServiceClient } from "@/lib/supabase/server";
import { ConsentForm } from "./consent-form";

/**
 * El consentimiento del conector MCP (docs/mcp.md). Supabase (su servidor OAuth) manda acá a la persona con un
 * `authorization_id` cuando Claude u otra app pide conectarse. Sin sesión, al login y de vuelta. La persona elige el
 * negocio (solo los que tienen «Usar el MCP» en su rol) y permite o rechaza.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Conectar una app", robots: { index: false, follow: false } };

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center">
          <BrandMark size={48} className="mx-auto mb-3" />
          <h1 className="text-2xl font-bold">{brandName()}</h1>
        </div>
        {children}
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Shell>
      <div className="rounded-xl border border-border bg-card p-6 text-center">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      </div>
    </Shell>
  );
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ authorization_id?: string }> }) {
  const { authorization_id: authorizationId } = await searchParams;
  if (!authorizationId || authorizationId.length > 200 || !/^[A-Za-z0-9._\-]+$/.test(authorizationId)) {
    return <Message title="Falta la autorización" body="Esta página se abre sola cuando conectás Claude u otra app. Volvé a conectar desde la app." />;
  }

  const { supabase, user } = await getAuthUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/oauth/consent?authorization_id=${authorizationId}`)}`);

  const details = await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
  if (details.error || !details.data) {
    return <Message title="La autorización venció" body="Volvé a conectar desde la app: el pedido dura unos minutos." />;
  }

  // Los negocios donde la persona puede usar el MCP (la base decide, con su sesión).
  const { data: memberships } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(name)")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  const workspaces: { id: string; name: string }[] = [];
  for (const m of (memberships ?? []) as { workspace_id: string; workspaces: { name: string } | null }[]) {
    const { data: allowed } = await supabase.rpc("has_permission" as never, { p_workspace_id: m.workspace_id, p_key: "mcp.usar" } as never);
    if (allowed === true) workspaces.push({ id: m.workspace_id, name: m.workspaces?.name ?? "—" });
  }
  if (workspaces.length === 0) {
    return <Message title="Tu rol no puede usar el MCP" body="Pedile a un Owner o Admin que te dé el permiso «Usar el MCP» en Ajustes → Roles." />;
  }

  // Ya había dado su consentimiento a esta app: Supabase devuelve directo a dónde volver. La conexión ya existe o se
  // crea con su primer negocio al primer pedido; se cambia en Mi cuenta → Conexiones.
  if (!("authorization_id" in details.data)) {
    redirect(details.data.redirect_url);
  }

  const { client } = details.data;
  // ¿Ya estaba conectada esta app? Se preselecciona su negocio.
  const service = await createServiceClient();
  const { data: existing } = await service
    .from("mcp_connections" as never)
    .select("workspace_id")
    .eq("user_id", user.id)
    .eq("client_id", client.id)
    .maybeSingle();
  const current = (existing as { workspace_id: string } | null)?.workspace_id;

  return (
    <Shell>
      <ConsentForm
        authorizationId={authorizationId}
        clientName={client.name || "Una app"}
        clientUri={client.uri || null}
        email={details.data.user.email}
        workspaces={workspaces}
        defaultWorkspaceId={workspaces.some((w) => w.id === current) ? current! : workspaces[0].id}
      />
    </Shell>
  );
}
