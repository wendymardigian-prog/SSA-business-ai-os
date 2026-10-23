import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { publishFlow } from "@/lib/flow-engine/publish";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.publish"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "No encontré tu negocio." }, { status: 404 });

  // Los pasos de publicar viven en `lib/flow-engine/publish.ts` (los usa tambien el interruptor de cobranza de Ajustes).
  const result = await publishFlow({
    db: supabase,
    userId: user.id,
    workspaceId: membership.workspace_id,
    flowId,
    getServiceClient: () => createServiceClient(),
  });
  if (!result.ok) {
    return NextResponse.json(result.problems ? { error: result.error, problems: result.problems } : { error: result.error }, { status: result.status });
  }

  return NextResponse.json({ ...result.flow, version: result.version });
}
