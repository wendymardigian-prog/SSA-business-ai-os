"use server";

/**
 * Vínculo con Contenido (DS8, F61–F66). Piden `designer.edit` y `content.create`; el negocio y la persona salen de la
 * SESIÓN (nunca del navegador) y se escribe con el cliente de servicio. Vincular una pieza existente además exige poder
 * escribirla (la misma regla del drawer de la pieza). Nunca lanzan hacia la pantalla: devuelven `{ ok: false, error }`.
 *
 * Contrato de la Ola 1: firmas definitivas de `useInContent`, `designFromPiece`, `syncToPiece` y `unlinkFromPiece`.
 * Las demás (`loadUseInContent`, `searchPieces`, `keepPieceFiles`) son de este bloque: las lee el modal y el drawer.
 * La lógica está en `lib/designer/content-link.ts`, que se prueba sin la base.
 *
 * En un archivo "use server" todo lo exportado es una función asincrónica: los tipos viven en
 * `lib/designer/content-link-types.ts`.
 */

import { revalidatePath } from "next/cache";
import { getPermissionAction, getPermissionContext, type PermissionContext } from "@/lib/auth/guards";
import { resolveBrand } from "@/lib/brand";
import { isAuthorOrAssignee } from "@/lib/content/assignee";
import { canWritePost } from "@/lib/content/piece-drawer";
import { createServiceClient } from "@/lib/supabase/server";
import { startAiDesign } from "@/lib/actions/designer/ai";
import { pieceChoices, type PieceChoice, type PieceRow } from "@/lib/designer/content-pieces";
import { describeLink, designFromPieceCore, keepPieceFilesCore, loadModalData, syncToPieceCore, unlinkCore, linkToContentCore, type LinkEnv } from "@/lib/designer/content-link";
import type { ContentLinkInfo, DesignFromPieceData, SyncToPieceData, UseInContentData, UseInContentModalData } from "@/lib/designer/content-link-types";
import type { ActionResult, UseInContentInput } from "@/lib/designer/contracts";
import { parseDesignSettings } from "@/lib/designer/settings-schema";

const NO_PERMISSION = "No tenés permiso para usar diseños en contenido.";
const GENERIC = "No pude hacerlo ahora. Probá de nuevo.";
const CONTENT_PATH = "/dashboard/content";

type Ctx = PermissionContext;

/** Las dos claves a la vez (cada una se pregunta por separado): el Member tiene las dos. */
async function scope(): Promise<{ ctx: Ctx; env: LinkEnv } | null> {
  const ctx = await getPermissionContext();
  if (!ctx.can("designer.edit") || !ctx.can("content.create")) return null;
  const env: LinkEnv = {
    service: await createServiceClient(),
    actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id },
    canWritePiece: (piece) => canWritePost({ role: ctx.role, isAuthor: isAuthorOrAssignee(ctx.user.id, piece) }),
    canUseAi: ctx.can("content.ai"),
  };
  return { ctx, env };
}

async function guarded<T>(run: (s: { ctx: Ctx; env: LinkEnv }) => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    const s = await scope();
    if (!s) return { ok: false, error: NO_PERMISSION };
    return await run(s);
  } catch (error) {
    console.error("[designer-content] la acción falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: GENERIC };
  }
}

/** «Usar en contenido» (F63): crea una pieza nueva en Borrador o vincula una existente, y encola `design_content_sync`. */
export async function useInContent(input: UseInContentInput): Promise<ActionResult<UseInContentData>> {
  return guarded(async ({ env }) => {
    const result = await linkToContentCore(env, input);
    if (result.ok) {
      revalidatePath(CONTENT_PATH);
      revalidatePath("/dashboard/disenos");
    }
    return result;
  });
}

/** «✦ Diseñar con el Diseñador IA» desde la pieza (F62): crea el diseño vinculado, arma el pedido a la IA y devuelve el editor. */
export async function designFromPiece(input: { postId: string; platform: string }): Promise<ActionResult<DesignFromPieceData>> {
  return guarded(async ({ ctx, env }) => {
    const settings = parseDesignSettings(ctx.workspace.design_settings, ctx.workspace.id);
    const result = await designFromPieceCore(
      env,
      { brandColor: resolveBrand(ctx.workspace).colorHex, customStyles: settings.ok ? settings.settings.styles : [] },
      input,
      { startAi: (ask) => startAiDesign(ask) },
    );
    if (result.ok) {
      revalidatePath(CONTENT_PATH);
      revalidatePath("/dashboard/disenos");
    }
    return result;
  });
}

/** «Enviar los cambios a la pieza» / «Actualizar los archivos» (F64). */
export async function syncToPiece(input: { designId: string; force?: boolean }): Promise<ActionResult<SyncToPieceData>> {
  return guarded(async ({ env }) => syncToPieceCore(env, input));
}

/** Desvincular: los archivos que ya estaban quedan en la pieza (F66). */
export async function unlinkFromPiece(input: { designId: string }): Promise<ActionResult> {
  return guarded(async ({ env }) => {
    const result = await unlinkCore(env, input);
    if (result.ok) {
      revalidatePath(CONTENT_PATH);
      revalidatePath("/dashboard/disenos");
    }
    return result;
  });
}

/** «Dejar como está» (F64): la pieza conserva sus archivos y el aviso «El diseño cambió» se va hasta el próximo cambio. */
export async function keepPieceFiles(input: { designId: string }): Promise<ActionResult> {
  return guarded(async ({ env }) => {
    const result = await keepPieceFilesCore(env, input);
    if (result.ok) revalidatePath(CONTENT_PATH);
    return result;
  });
}

/** Lo que dibuja el modal «Usar en contenido»: las publicaciones donde sirve el diseño y, si ya está vinculado, a qué pieza. */
export async function loadUseInContent(input: { designId: string }): Promise<ActionResult<UseInContentModalData>> {
  return guarded(async ({ env }) => loadModalData(env, input.designId));
}

/** El menú «En contenido ▾»: la pieza (estado y redes). Se lee con el permiso de ver diseños. */
export async function loadContentLink(input: { designId: string }): Promise<ActionResult<ContentLinkInfo | null>> {
  try {
    const ctx = await getPermissionAction("designer.view");
    if (!ctx) return { ok: false, error: "No tenés permiso para ver diseños." };
    const env: LinkEnv = { service: await createServiceClient(), actor: { workspaceId: ctx.workspace.id, userId: ctx.user.id }, canWritePiece: () => false, canUseAi: false };
    return { ok: true, data: await describeLink(env, input.designId) };
  } catch (error) {
    console.error("[designer-content] loadContentLink falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: GENERIC };
  }
}

/**
 * El buscador de «Vincular a una pieza existente»: las piezas del negocio que la persona puede escribir, las más nuevas
 * primero. Se leen con la sesión (la RLS decide qué ve) y después se filtran por la regla de escritura de la pieza.
 */
export async function searchPieces(input: { query?: string }): Promise<ActionResult<PieceChoice[]>> {
  try {
    const s = await scope();
    if (!s) return { ok: false, error: NO_PERMISSION };
    const { ctx } = s;
    const term = (input.query ?? "").replace(/[%_,()\\]/g, " ").trim().slice(0, 80);
    let query = ctx.supabase
      .from("content_posts")
      .select("id, title, status, networks, media, created_by, assigned_to")
      .eq("workspace_id", ctx.workspace.id)
      .is("archived_at", null)
      .order("updated_at", { ascending: false })
      .limit(40);
    if (term) query = query.ilike("title", `%${term}%`);
    const { data, error } = await query;
    if (error) {
      console.error("[designer-content] searchPieces falló:", error.code ?? "error");
      return { ok: false, error: "No pude buscar las piezas. Probá de nuevo." };
    }
    const rows = (data ?? []) as unknown as PieceRow[];
    let designed = new Set<string>();
    if (rows.length > 0) {
      const { data: linked } = await s.env.service.from("designs").select("content_post_id").eq("workspace_id", ctx.workspace.id).in("content_post_id", rows.map((r) => r.id));
      designed = new Set(((linked ?? []) as Array<{ content_post_id: string | null }>).flatMap((r) => (r.content_post_id ? [r.content_post_id] : [])));
    }
    return { ok: true, data: pieceChoices(rows, { viewer: { id: ctx.user.id, role: ctx.role }, designedPostIds: designed }) };
  } catch (error) {
    console.error("[designer-content] searchPieces falló:", error instanceof Error ? error.message : "error");
    return { ok: false, error: GENERIC };
  }
}
