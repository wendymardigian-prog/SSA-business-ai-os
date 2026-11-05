import { NextRequest, NextResponse } from "next/server";
import { getPermissionAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { createBroadcastDraft, saveBroadcastDraft } from "@/lib/broadcasts/core";

/**
 * Broadcasts por la API (docs/broadcasts.md). Mismo núcleo que la pantalla
 * (`lib/broadcasts/core.ts`): el workspace sale de la sesión, escribe el
 * servidor y la audiencia son los parámetros de la lista de Contactos.
 */

export async function GET() {
  // Permiso (Equipo y roles, F22): desde la 00285 la RLS tambien lo repite.
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { data: broadcasts, error } = await ctx.supabase
    .from("broadcasts")
    .select("*")
    .eq("workspace_id", ctx.workspace.id)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: "No pude leer los broadcasts" }, { status: 500 });
  return NextResponse.json(broadcasts);
}

/**
 * Crea un borrador. Cuerpo: `{ name, channelId?, audienceParams?, variants?, emailSubject?, emailPreheader?,
 * includePhoneOnly?, pace?, scheduledFor? }`. Se manda con POST /:id/send.
 */
export async function POST(request: NextRequest) {
  const ctx = await getPermissionAction("broadcasts.manage");
  if (!ctx) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const service = await createServiceClient();
  const created = await createBroadcastDraft(service, {
    workspaceId: ctx.workspace.id,
    userId: ctx.user.id,
    name: typeof body.name === "string" ? body.name : undefined,
    audienceParams: body.audienceParams,
    channelId: typeof body.channelId === "string" ? body.channelId : null,
  });
  if (!created.ok) return NextResponse.json({ error: created.error }, { status: 500 });

  const saved = await saveBroadcastDraft(service, ctx.workspace.id, created.value.id, {
    ...(body.variants !== undefined ? { variants: body.variants } : {}),
    ...(typeof body.emailSubject === "string" ? { emailSubject: body.emailSubject } : {}),
    ...(typeof body.emailPreheader === "string" ? { emailPreheader: body.emailPreheader } : {}),
    ...(typeof body.includePhoneOnly === "boolean" ? { includePhoneOnly: body.includePhoneOnly } : {}),
    ...(body.pace !== undefined ? { pace: body.pace } : {}),
    ...(typeof body.scheduledFor === "string" ? { scheduledFor: body.scheduledFor } : {}),
  });
  if (!saved.ok) return NextResponse.json({ error: saved.error, id: created.value.id }, { status: 400 });

  const { data } = await service.from("broadcasts").select("*").eq("id", created.value.id).single();
  return NextResponse.json(data, { status: 201 });
}
