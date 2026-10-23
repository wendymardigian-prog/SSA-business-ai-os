import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";

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

  const { data: versions, error } = await supabase
    .from("flow_versions")
    .select("id, version, name, published_by, created_at")
    .eq("flow_id", flowId)
    .order("version", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(versions || []);
}
