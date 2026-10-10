import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import {
  deleteInstance,
  logoutInstance,
} from "@/lib/evolution-client";
import { getEvolutionConfig } from "@/lib/evolution-config";

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
  // Solo Owner y Admin. Antes un Member pasaba: la cuenta se desconectaba en
  // Zernio o Evolution, la RLS despues rechazaba el borrado sin dar error, y
  // la ruta respondia ok con el canal muerto pero todavia en la lista.
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden borrar canales" },
      { status: 403 },
    );
  }
  const { workspace, supabase } = ctx;

  const { data: channel } = await supabase
    .from("channels")
    .select("id, late_account_id, provider, evolution_instance")
    .eq("id", channelId)
    .eq("workspace_id", workspace.id)
    .single();

  if (!channel)
    return NextResponse.json({ error: "No encontré ese canal" }, { status: 404 });

  // Los canales de Zernio se desconectan tambien del lado de Zernio; para eso
  // hace falta la key. Si no hay, se borra igual localmente.
  const zernioApiKey =
    channel.provider === "evolution" ? null : await getZernioApiKey(workspace.id);

  if (channel.provider === "evolution") {
    const config = await getEvolutionConfig(supabase, workspace.id);
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
          { error: `No pude desconectar en Zernio: ${JSON.stringify(res.error)}` },
          { status: 502 }
        );
      }
    } catch (error) {
      console.error("Failed to disconnect Zernio account:", error);
      return NextResponse.json(
        { error: `No pude desconectar en Zernio: ${error instanceof Error ? error.message : String(error)}` },
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
