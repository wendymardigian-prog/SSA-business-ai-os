import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("broadcasts.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
  const active = await getActiveWorkspace();
  const membership = active ? { workspace_id: active.workspace.id } : null;

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const { data: broadcasts, error } = await supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", membership.workspace_id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(broadcasts);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Permiso (Equipo y roles, F22): la RLS tambien lo repite.
  if (!(await getPermissionAction("broadcasts.manage"))) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  // El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
  const active = await getActiveWorkspace();
  const membership = active ? { workspace_id: active.workspace.id } : null;

  if (!membership) return NextResponse.json({ error: "No workspace" }, { status: 404 });

  const body = await request.json();

  const { data: broadcast, error } = await supabase
    .from("broadcasts")
    .insert({
      workspace_id: membership.workspace_id,
      name: body.name || "Untitled Broadcast",
      message_content: body.messageContent || {},
      segment_filter: body.segmentFilter || null,
      scheduled_for: body.scheduledFor || null,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(broadcast, { status: 201 });
}
