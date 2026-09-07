import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import {
  deleteInstance,
  getEvolutionConfig,
  logoutInstance,
} from "@/lib/evolution-client";

async function getWorkspace(supabase: Awaited<ReturnType<typeof createClient>>) {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("workspace_members")
    .select("workspace_id, workspaces(*)")
    .eq("user_id", user.id)
    .limit(1)
    .single();

  if (!membership?.workspaces) return null;
  return membership.workspaces;
}

/**
 * DELETE /api/v1/channels/[channelId]
 *
 * Borra el canal para siempre. Antes lo desconecta en el proveedor que
 * corresponda, si no el siguiente sync lo volveria a crear:
 * - Zernio: deleteAccount.
 * - Evolution: cierra la sesion de WhatsApp y borra la instancia. deleteInstance
 *   se niega a tocar instancias sin nuestro prefijo, porque ese Evolution puede
 *   estar compartido con otro sistema.
 *
 * Despues borra la fila local, que arrastra conversaciones y vinculos de
 * contacto en cascada.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ channelId: string }> }
) {
  const { channelId } = await params;
  const supabase = await createClient();
  const workspace = await getWorkspace(supabase);
  if (!workspace)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: channel } = await supabase
    .from("channels")
    .select("id, late_account_id, provider, evolution_instance")
    .eq("id", channelId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!channel)
    return NextResponse.json({ error: "Channel not found" }, { status: 404 });

  // Los canales de Zernio se desconectan tambien del lado de Zernio; para eso
  // hace falta la key. Si no hay, se borra igual localmente.
  const zernioApiKey =
    channel.provider === "evolution" ? null : await getZernioApiKey(workspace.id);

  if (channel.provider === "evolution") {
    const config = getEvolutionConfig();
    if (config && channel.evolution_instance) {
      try {
        await logoutInstance(config, channel.evolution_instance);
        await deleteInstance(config, channel.evolution_instance);
      } catch (error) {
        console.error("Failed to remove Evolution instance:", error);
        return NextResponse.json(
          {
            error: `No pude desconectar WhatsApp en Evolution: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
          { status: 502 }
        );
      }
    }
  } else if (zernioApiKey) {
    const zernio = createZernioClient(zernioApiKey);
    try {
      const res = await zernio.accounts.deleteAccount({
        path: { accountId: channel.late_account_id },
      });
      // A 404 means the account is already gone from Zernio; that's fine.
      if (res.error && res.response?.status !== 404) {
        return NextResponse.json(
          { error: `Failed to disconnect on Zernio: ${JSON.stringify(res.error)}` },
          { status: 502 }
        );
      }
    } catch (error) {
      console.error("Failed to disconnect Zernio account:", error);
      return NextResponse.json(
        { error: `Failed to disconnect on Zernio: ${error instanceof Error ? error.message : String(error)}` },
        { status: 502 }
      );
    }
  }

  const { error } = await supabase
    .from("channels")
    .delete()
    .eq("id", channelId)
    .eq("workspace_id", workspace.id);

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
