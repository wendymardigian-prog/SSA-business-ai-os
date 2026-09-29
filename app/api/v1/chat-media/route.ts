/**
 * Bajar un adjunto del chat (F2).
 *
 * El bucket `chat-media` es privado, asi que el link que pinta la burbuja no es
 * el del archivo: es esta ruta. Se firma al hacer clic o al reproducir, nunca
 * al pintar el hilo, por dos razones: una URL firmada vence, y firmar veinte
 * links que nadie va a abrir es gastar de gusto.
 *
 * La autorizacion la decide la BASE, no este archivo: se usa el cliente del
 * USUARIO, y la policy del bucket exige ser miembro del workspace del primer
 * segmento del path. Con el service role habria que reimplementar el scope acá,
 * y una sola rama mal escrita dejaria escuchar los audios de otro negocio.
 *
 * Es la misma ruta que la de los adjuntos de email (que no se toca), con el
 * bucket parametrizado y la descarga aparte.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  CHAT_MEDIA_BUCKET,
  DOWNLOAD_URL_SECONDS,
  SIGNED_URL_SECONDS,
  isSafeStoragePath,
  safeFilename,
} from "@/lib/chat-media/bucket";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }

  // Se valida ANTES de tocar Storage: un `..` en el path saldria de la carpeta
  // del workspace, que es justo lo que mira la policy.
  if (!isSafeStoragePath(path)) {
    return NextResponse.json({ error: "Ruta invalida" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const wantsDownload = request.nextUrl.searchParams.get("download") === "1";
  const downloadName = safeFilename(request.nextUrl.searchParams.get("name"), "adjunto");

  const { data, error } = await supabase.storage
    .from(CHAT_MEDIA_BUCKET)
    .createSignedUrl(
      path,
      wantsDownload ? DOWNLOAD_URL_SECONDS : SIGNED_URL_SECONDS,
      wantsDownload ? { download: downloadName } : undefined,
    );

  if (error || !data?.signedUrl) {
    // 404 y no 403: si la RLS no deja firmar, no se confirma que el archivo
    // exista. El motivo no se loguea con el path completo.
    return NextResponse.json({ error: "No encontre ese adjunto" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
