import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActiveWorkspace } from "@/lib/workspace";

// El workspace ACTIVO (el elegido en el selector), nunca "el primero": ver lib/workspace.ts.
async function getWorkspace() {
  const active = await getActiveWorkspace();
  return active?.workspace ?? null;
}

export async function GET() {
  const supabase = await createClient();
  const workspace = await getWorkspace();
  if (!workspace)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: channels, error } = await supabase
    .from("channels")
    .select("*")
    .eq("workspace_id", workspace.id)
    .order("created_at", { ascending: false });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json(channels);
}
