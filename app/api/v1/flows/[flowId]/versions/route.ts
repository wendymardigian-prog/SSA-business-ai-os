import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";
import { getWorkspaceMembers } from "@/lib/workspace-members";

export async function GET(
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
  if (!(await getPermissionAction("flows.view"))) return NextResponse.json({ error: "No tenés permiso para hacer esto." }, { status: 403 });

  // Con la nota de cada version (00508). Antes de la migracion la columna no existe: se pide sin ella.
  let result = await supabase
    .from("flow_versions")
    .select("id, version, name, published_by, created_at, note")
    .eq("flow_id", flowId)
    .order("version", { ascending: false });
  if (result.error) {
    result = (await supabase
      .from("flow_versions")
      .select("id, version, name, published_by, created_at")
      .eq("flow_id", flowId)
      .order("version", { ascending: false })) as typeof result;
  }
  const { data: versions, error } = result;

  if (error)
    return NextResponse.json({ error: "No pude leer las versiones." }, { status: 500 });

  // El nombre de quien publico cada una (la gente del mismo negocio: el mismo dato que ya ven los selectores de personas).
  const active = await getActiveWorkspace();
  const names = new Map<string, string>();
  if (active) {
    try {
      for (const m of await getWorkspaceMembers(active.workspace.id)) names.set(m.userId, m.name);
    } catch {
      // Sin nombres, la lista se ve igual.
    }
  }
  return NextResponse.json(
    (versions ?? []).map((v) => ({ ...v, published_by_name: v.published_by ? names.get(v.published_by) ?? null : null })),
  );
}
