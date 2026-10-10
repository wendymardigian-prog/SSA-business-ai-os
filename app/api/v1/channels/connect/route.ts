import { NextRequest, NextResponse } from "next/server";
import { getAdminContext } from "@/lib/auth/guards";
import { createZernioClient } from "@/lib/zernio-client";
import { getZernioApiKey } from "@/lib/integrations/zernio-key";
import { PLATFORMS, isSupportedPlatform } from "@/lib/platforms";

/**
 * POST /api/v1/channels/connect
 *
 * Returns Zernio's OAuth/connect URL for the given platform.
 * Zernio handles the entire connection flow (OAuth, page selection, etc.)
 * and redirects back to our callback URL when done.
 */
export async function POST(request: NextRequest) {
  // Conectar una cuenta es cosa de Owner y Admin, igual que en las otras
  // rutas de canales: la key de Zernio se lee con el service role, asi que la
  // RLS no frenaria a un Member.
  const ctx = await getAdminContext();
  if (!ctx) {
    return NextResponse.json(
      { error: "Solo Owner y Admin pueden conectar canales" },
      { status: 403 },
    );
  }
  const { workspace } = ctx;

  const apiKey = await getZernioApiKey(workspace.id);
  if (!apiKey) {
    return NextResponse.json(
      { error: "Falta la API key de Zernio. Cargala en Integraciones." },
      { status: 400 }
    );
  }

  const { platform } = await request.json();

  if (!isSupportedPlatform(platform)) {
    return NextResponse.json(
      { error: `Plataforma no soportada. Tiene que ser una de: ${PLATFORMS.join(", ")}` },
      { status: 400 }
    );
  }

  const zernio = createZernioClient(apiKey);

  try {
    // Get profile ID (required by Zernio's connect endpoint)
    const profilesRes = await zernio.profiles.listProfiles();
    const profiles = profilesRes.data?.profiles ?? [];
    if (profiles.length === 0) {
      return NextResponse.json(
        { error: "No encontré perfiles de Zernio. Creá uno primero en tu panel de Zernio." },
        { status: 400 }
      );
    }

    const profileId = profiles[0]._id!;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
    const callbackUrl = `${appUrl}/dashboard/channels/callback`;

    // Zernio handles everything: OAuth, page selection, Bluesky credentials, Telegram code
    const res = await zernio.connect.getConnectUrl({
      path: { platform },
      query: { profileId, redirect_url: callbackUrl },
    });

    if (!res.data?.authUrl) {
      return NextResponse.json({ error: "No pude obtener la URL de conexión" }, { status: 500 });
    }

    return NextResponse.json({ authUrl: res.data.authUrl });
  } catch (error) {
    console.error("Failed to get connect URL:", error);
    return NextResponse.json(
      { error: `Falló la conexión: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
