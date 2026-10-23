import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string; versionId: string }> }
) {
  const { flowId, versionId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.publish"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // Verify user has access
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership)
    return NextResponse.json({ error: "No workspace" }, { status: 404 });

  // Get the version
  const { data: version, error: vErr } = await supabase
    .from("flow_versions")
    .select("nodes, edges, viewport")
    .eq("id", versionId)
    .eq("flow_id", flowId)
    .single();

  if (vErr || !version)
    return NextResponse.json({ error: "No encontré esa versión." }, { status: 404 });

  const { data: current } = await supabase
    .from("flows")
    .select("status")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "No encontré esa automatización." }, { status: 404 });

  // Restaurar deja esa version como BORRADOR (auditoria de automatizaciones): en una automatizacion publicada va a los
  // cambios sin publicar y lo que corre sigue igual hasta "Publicar cambios". Antes la pasaba a borrador y dejaba de
  // correr sin avisar.
  const { error } = await supabase
    .from("flows")
    .update(
      current.status === "published"
        ? { draft_nodes: version.nodes, draft_edges: version.edges, draft_updated_at: new Date().toISOString(), viewport: version.viewport }
        : { nodes: version.nodes, edges: version.edges, viewport: version.viewport, updated_at: new Date().toISOString() },
    )
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
