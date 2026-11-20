import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";

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
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.publish"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  // Verify user has access
  // El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
  const active = await getActiveWorkspace();
  const membership = active ? { workspace_id: active.workspace.id } : null;

  if (!membership)
    return NextResponse.json({ error: "No encontré tu negocio." }, { status: 404 });

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
    .select("*")
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "No encontré esa automatización." }, { status: 404 });

  // Restaurar deja esa version como BORRADOR (auditoria de automatizaciones): en una automatizacion publicada va a los
  // cambios sin publicar y lo que corre sigue igual hasta "Publicar cambios". Antes la pasaba a borrador y dejaba de
  // correr sin avisar.
  // Tambien cuenta como una escritura del borrador (00508): quien lo dejo y la revision suben, asi un lienzo abierto en
  // otra pestaña no lo pisa sin enterarse.
  const rev = typeof (current as { draft_rev?: unknown }).draft_rev === "number" ? (current as { draft_rev: number }).draft_rev : null;
  const meta = rev === null ? {} : { draft_updated_by: user.id, draft_rev: rev + 1 };
  const { error } = await supabase
    .from("flows")
    .update(
      current.status === "published"
        ? { draft_nodes: version.nodes, draft_edges: version.edges, draft_updated_at: new Date().toISOString(), viewport: version.viewport, ...meta }
        : { nodes: version.nodes, edges: version.edges, viewport: version.viewport, updated_at: new Date().toISOString(), ...meta },
    )
    .eq("id", flowId)
    .eq("workspace_id", membership.workspace_id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
