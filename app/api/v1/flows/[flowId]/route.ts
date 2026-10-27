import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";
import { checkMemberFlow } from "@/lib/flow-engine/member-flow-db";
import { normalizeCategories, normalizeDescription } from "@/lib/flows/categories";

// El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
async function getWorkspaceId() {
  const active = await getActiveWorkspace();
  return active?.workspace.id ?? null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();
  const workspaceId = await getWorkspaceId();
  if (!workspaceId)
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.view"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  const { data: flow, error } = await supabase
    .from("flows")
    .select("*, triggers(*)")
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !flow)
    return NextResponse.json({ error: "No encontré esa automatización." }, { status: 404 });

  return NextResponse.json(flow);
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();
  const workspaceId = await getWorkspaceId();
  if (!workspaceId)
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.edit"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  const body = await request.json();

  let published = false;
  // Un flujo sin contacto no puede tener pasos que necesiten uno.
  if (Array.isArray(body.nodes) || Array.isArray(body.edges)) {
    // Un flujo PUBLICADO se valida igual que al publicar (Tirón 2, D5): el motor lee `flows.nodes` en vivo, así que guardar
    // sobre uno publicado sin esa regla lo dejaba corriendo con pasos que no pueden funcionar (un envío sin contacto, por
    // ejemplo). Necesita las aristas (el contacto tiene que llegar por todos los caminos), que salen del cuerpo o, si
    // no vienen, de lo guardado. Un borrador sí se puede guardar a medias: su regla frena la publicación.
    const { data: current } = await supabase
      .from("flows")
      .select("status, nodes, edges")
      .eq("id", flowId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (!current) return NextResponse.json({ error: "No encontré esa automatización." }, { status: 404 });
    published = current.status === "published";

    // Los pasos de una automatizacion PUBLICADA van al borrador (00254): lo que corre no cambia hasta publicar, y
    // publicar valida todo. Un borrador se puede guardar a medias.
    const nodes = Array.isArray(body.nodes) ? body.nodes : Array.isArray(current.nodes) ? (current.nodes as unknown[]) : [];
    const edges = Array.isArray(body.edges) ? body.edges : Array.isArray(current.edges) ? (current.edges as unknown[]) : [];
    const problems = await checkMemberFlow(supabase, workspaceId, nodes, edges, { publishing: false });
    if (problems.length > 0) return NextResponse.json({ error: problems[0], problems }, { status: 400 });
  }

  const update: Record<string, unknown> = {};
  if (body.name !== undefined) update.name = body.name;
  if (body.description !== undefined) update.description = normalizeDescription(body.description);
  if (body.categories !== undefined) update.categories = normalizeCategories(body.categories);
  if (published) {
    if (body.nodes !== undefined) update.draft_nodes = body.nodes;
    if (body.edges !== undefined) update.draft_edges = body.edges;
    if (body.nodes !== undefined || body.edges !== undefined) update.draft_updated_at = new Date().toISOString();
  } else {
    if (body.nodes !== undefined) update.nodes = body.nodes;
    if (body.edges !== undefined) update.edges = body.edges;
  }
  if (body.viewport !== undefined) update.viewport = body.viewport;

  const { data: flow, error } = await supabase
    .from("flows")
    .update(update)
    .eq("id", flowId)
    .eq("workspace_id", workspaceId)
    .select("id, name, status, updated_at")
    .single();

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(flow);
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ flowId: string }> }
) {
  const { flowId } = await params;
  const supabase = await createClient();
  const workspaceId = await getWorkspaceId();
  if (!workspaceId)
    return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.edit"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  const { error } = await supabase
    .from("flows")
    .delete()
    .eq("id", flowId)
    .eq("workspace_id", workspaceId);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
