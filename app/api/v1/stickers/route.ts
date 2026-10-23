import { NextRequest, NextResponse } from "next/server";
import { getMemberAction } from "@/lib/auth/guards";
import { createServiceClient } from "@/lib/supabase/server";
import { MAX_STICKER_INPUT_BYTES, STICKER_TOO_LARGE_INPUT } from "@/lib/stickers/format";
import { normalizeSticker } from "@/lib/stickers/normalize";
import { upsertSticker } from "@/lib/stickers/library";

/**
 * POST /api/v1/stickers — sube una imagen o un GIF a la biblioteca de stickers
 * (00257). Cualquier miembro, como la banca de recursos.
 *
 * Va por una ruta y no por una Server Action porque una accion corta el cuerpo
 * en 1 MB y un GIF lo pasa facil. El archivo se lleva a sticker de WhatsApp en
 * el servidor (webp 512 x 512, animado si era un GIF) y se valida por bytes.
 */
export async function POST(request: NextRequest) {
  const ctx = await getMemberAction();
  if (!ctx) return NextResponse.json({ error: "Tu sesión venció. Volvé a entrar." }, { status: 401 });

  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_STICKER_INPUT_BYTES + 64 * 1024) return NextResponse.json({ error: STICKER_TOO_LARGE_INPUT }, { status: 413 });

  let file: File | null = null;
  try {
    const form = await request.formData();
    const value = form.get("file");
    file = value instanceof File ? value : null;
  } catch {
    return NextResponse.json({ error: "No pude leer el archivo." }, { status: 400 });
  }
  if (!file) return NextResponse.json({ error: "Falta el archivo." }, { status: 400 });
  if (file.size > MAX_STICKER_INPUT_BYTES) return NextResponse.json({ error: STICKER_TOO_LARGE_INPUT }, { status: 413 });

  const normalized = await normalizeSticker(new Uint8Array(await file.arrayBuffer()));
  if (!normalized.ok) return NextResponse.json({ error: normalized.error }, { status: 400 });

  const service = await createServiceClient();
  const result = await upsertSticker(service, {
    workspaceId: ctx.workspace.id,
    bytes: normalized.bytes,
    source: "uploaded",
    createdBy: ctx.user.id,
    animated: normalized.animated,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
  return NextResponse.json({ id: result.id, created: result.created }, { status: result.created ? 201 : 200 });
}
