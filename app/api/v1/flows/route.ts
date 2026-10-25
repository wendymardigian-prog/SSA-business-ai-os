import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";
import { MAX_FLOW_NAME_LENGTH, NEW_FLOW_NAME, newTriggerNode, normalizeCategories, normalizeDescription } from "@/lib/flows/categories";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.view"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  // El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
  const active = await getActiveWorkspace();
  const membership = active ? { workspace_id: active.workspace.id } : null;

  if (!membership) return NextResponse.json({ error: "No encontré tu negocio." }, { status: 404 });

  const { data: flows, error } = await supabase
    .from("flows")
    .select("id, name, description, categories, status, version, published_at, created_at, updated_at")
    .eq("workspace_id", membership.workspace_id)
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(flows);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Tenés que iniciar sesión." }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("flows.edit"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  // El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
  const active = await getActiveWorkspace();
  const membership = active ? { workspace_id: active.workspace.id } : null;

  if (!membership) return NextResponse.json({ error: "No encontré tu negocio." }, { status: 404 });

  const body = await request.json();

  // Una automatizacion nueva nace con su disparador en el lienzo, SIN elegir: al abrirla se elige como arranca
  // (auditoria de automatizaciones). Las plantillas y lo importado traen sus propios pasos.
  const nodes = Array.isArray(body.nodes) && body.nodes.length > 0 ? body.nodes : [newTriggerNode()];

  const { data: flow, error } = await supabase
    .from("flows")
    .insert({
      workspace_id: membership.workspace_id,
      name: typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, MAX_FLOW_NAME_LENGTH) : NEW_FLOW_NAME,
      description: normalizeDescription(body.description),
      categories: normalizeCategories(body.categories),
      nodes,
      edges: Array.isArray(body.edges) ? body.edges : [],
    })
    .select("id, name, status")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(flow, { status: 201 });
}
