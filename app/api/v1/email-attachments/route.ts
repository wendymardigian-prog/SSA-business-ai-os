/**
 * Descargar un adjunto de email (F64).
 *
 * Firma el link al momento y redirige. El link vence en 15 minutos, asi que
 * no se puede guardar ni compartir por accidente.
 *
 * Quien decide si se puede es la RLS del bucket: el path empieza con el
 * workspace, y Storage no firma un archivo de un workspace del que la
 * persona no es miembro. Por eso se usa el cliente del USUARIO y no el
 * service role, que pasaria por encima de la policy.
 */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ATTACHMENTS_BUCKET } from "@/lib/email/buckets";
import { SIGNED_URL_SECONDS } from "@/lib/email/attachments";

export async function GET(request: NextRequest) {
  const path = request.nextUrl.searchParams.get("path");
  if (!path) {
    return NextResponse.json({ error: "Falta el archivo" }, { status: 400 });
  }

  // Un path con `..` podria apuntar a otra carpeta. La policy igual lo
  // frenaria, pero rechazarlo aca es mas claro que un 400 de Storage.
  if (path.includes("..") || path.startsWith("/")) {
    return NextResponse.json({ error: "Ruta invalida" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  }

  const { data, error } = await supabase.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_SECONDS);

  if (error || !data?.signedUrl) {
    // Puede ser que el archivo no exista o que no sea de su workspace: no se
    // distingue a proposito, para no confirmar que existe.
    return NextResponse.json({ error: "No encontre ese adjunto" }, { status: 404 });
  }

  return NextResponse.redirect(data.signedUrl);
}
