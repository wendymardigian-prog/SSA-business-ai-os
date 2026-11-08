/**
 * verify-designer · bloque ds8 (F61–F66): Contenido. Contra la base real y el Storage real, con el render SIEMPRE
 * simulado (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-designer.mjs`): nunca llama al servicio de render real.
 *
 * - Crear una pieza nueva desde un diseño la deja en BORRADOR, con las redes y su formato, y encola la sincronización
 *   (lo encolado se junta acá: nada llega a la cola real; el job se corre a mano).
 * - El job deja los archivos en la biblioteca de la pieza (bucket `content-media`, `<negocio>/<pieza>/<archivo>`) con ids
 *   estables y `design_id`/`design_version`/`design_page`, y ELEGIDOS EN ORDEN en cada red (PNG por página; un PDF en LinkedIn).
 * - Volver a sincronizar conserva los ids y no deja archivos de más.
 * - Una red publicada no se toca; una programada solo avisa (y con «Actualizar los archivos» se actualiza).
 * - Desvincular no borra ningún archivo; archivar el diseño deja de sincronizar y tampoco borra.
 * - Quien no puede ver diseños no ve ni los vínculos; y el vínculo no se escribe con la sesión de una persona.
 *
 * Las Server Actions (permiso adentro, negocio de la sesión, poder escribir la pieza) se prueban con Vitest
 * (`lib/actions/designer/content.test.ts`): acá se llama a la misma lógica (`lib/designer/content-link.ts` y el job) con el
 * cliente de servicio. `verify-content.mjs` lo corre la sesión principal aparte.
 *
 * No se corre en paralelo con otro verify-*: lo corre la sesión principal, de a uno, con el candado.
 */

import { linkToContentCore, unlinkCore, type LinkEnv } from "../../lib/designer/content-link";
import { runContentSync, type ContentSyncOutcome } from "../../lib/designer/jobs/content-sync";
import type { ContentSyncPayload } from "../../lib/designer/content-sync";
import { check, makeWorkspace, minimalDoc, raw, svc, type BlockContext } from "./helpers";

const BUCKET = "content-media";

/** Un documento de `pages` páginas del formato. */
function docWithPages(format: string, pages: number) {
  const doc = minimalDoc(format);
  return { ...doc, pages: Array.from({ length: pages }, (_, i) => ({ ...doc.pages[0], id: `pg_test${String(i + 1).padStart(4, "0")}` })) };
}

type Entry = { id: string; storage_path: string; kind: string; mime_type: string; design_id?: string; design_version?: number; design_page?: number | null; deleted_at?: string | null };
type Network = { platform: string; format?: string; files?: string[]; planned_at?: string | null };

export default async function ds8(ctx: BlockContext): Promise<void> {
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds8");
  const env: LinkEnv = { service: svc, actor: { workspaceId: t.id, userId: t.owner.id }, canWritePiece: () => true, canUseAi: false };

  // Lo que se encola se junta acá y el job se corre a mano, con el render simulado.
  const queue: ContentSyncPayload[] = [];
  const enqueue = async (_db: unknown, payload: ContentSyncPayload) => {
    queue.push(payload);
    return { queued: true };
  };
  const noSchedule = (async () => ({ id: "x" })) as never;
  const sync = (payload: ContentSyncPayload): Promise<ContentSyncOutcome> => runContentSync(svc, { ...payload }, { schedule: noSchedule });

  const readPost = async (id: string) => {
    const { data, error } = await raw.from("content_posts").select("id, status, title, caption, media, networks").eq("id", id).single();
    if (error) throw new Error(`no pude leer la pieza: ${error.message}`);
    return data as { id: string; status: string; title: string; caption: string | null; media: Entry[]; networks: Network[] };
  };
  const listBucket = async (prefix: string): Promise<string[]> => {
    const { data, error } = await raw.storage.from(BUCKET).list(prefix, { limit: 1000 });
    if (error) throw new Error(`no pude listar ${prefix}: ${error.message}`);
    return (data ?? []).map((o) => `${prefix}/${o.name}`).sort();
  };

  try {
    const { data: design, error: designError } = await raw
      .from("designs")
      .insert({ workspace_id: t.id, name: "zz-test carrusel de Ana Pérez", format: "v45", doc: docWithPages("v45", 3), origin: "blank", created_by: t.owner.id })
      .select("id")
      .single();
    check(!designError && !!design, "el servidor crea un diseño propio de tres páginas (v45)", designError?.message);
    const designId = design!.id as string;
    const png = (n: number) => `design-${designId}-${n}`;
    const PDF = `design-${designId}-pdf`;

    // ─── F63: crear una pieza nueva ─────────────────────────────────────
    console.log("\n— «Usar en contenido» → crear una pieza nueva (F63) —");
    const created = await linkToContentCore(
      env,
      { designId, mode: "new", title: "zz-test pieza de Ana Pérez", networks: [{ platform: "instagram", format: "carousel" }, { platform: "linkedin", format: "pdf" }], proposeCaption: false },
      { enqueue: enqueue as never },
    );
    check(created.ok, "crear una pieza nueva desde el diseño funciona", JSON.stringify(created));
    const postId = created.ok ? created.data.postId : "";
    const fresh = await readPost(postId);
    check(fresh.status === "draft", "CRITERIO: la pieza nace en Borrador", fresh.status);
    check(fresh.title === "zz-test pieza de Ana Pérez" && fresh.networks.map((n) => `${n.platform}:${n.format}`).join() === "instagram:carousel,linkedin:pdf", "con sus dos redes, cada una con su formato de Contenido");
    check(fresh.networks.every((n) => (n.files ?? []).length === 0 && !n.planned_at), "las redes entran sin fecha y todavía sin archivos");
    const { data: linked } = await raw.from("designs").select("content_post_id, content_network").eq("id", designId).single();
    check(linked?.content_post_id === postId && linked?.content_network === "instagram", "el diseño queda vinculado (content_post_id y content_network)");
    check(queue.length === 1 && queue[0].designId === designId && (queue[0].networks ?? []).join() === "linkedin", "se encola design_content_sync con la otra red");
    const { data: audit } = await raw.from("audit_log").select("action, entity_type").eq("entity_id", designId);
    check((audit ?? []).some((a) => a.action === "design.content_linked" && a.entity_type === "design"), "queda en el historial (design.content_linked)");

    // ─── F64: el job ────────────────────────────────────────────────────
    console.log("\n— design_content_sync: los archivos llegan a la pieza (F64) —");
    const first = await sync(queue[0]);
    check(first.status === "synced" && first.networks.join() === "instagram,linkedin", "el job sincroniza las dos redes (render simulado)", JSON.stringify(first));
    for (const n of [1, 2, 3]) ctx.storagePaths.push({ bucket: BUCKET, path: `${t.id}/${postId}/${png(n)}.png` });
    ctx.storagePaths.push({ bucket: BUCKET, path: `${t.id}/${postId}/${PDF}.pdf` });
    const synced = await readPost(postId);
    const byId = new Map(synced.media.map((m) => [m.id, m]));
    check(synced.media.map((m) => m.id).join() === [png(1), png(2), png(3), PDF].join(), "CRITERIO: los archivos quedan en la biblioteca de la pieza con sus ids estables", synced.media.map((m) => m.id).join());
    check(synced.media.every((m) => m.design_id === designId && typeof m.design_version === "number"), "cada archivo lleva design_id y design_version");
    check([1, 2, 3].every((n) => byId.get(png(n))?.design_page === n && byId.get(png(n))?.mime_type === "image/png" && byId.get(png(n))?.kind === "image"), "las páginas son PNG y llevan su número (design_page)");
    check(byId.get(PDF)?.kind === "document" && byId.get(PDF)?.mime_type === "application/pdf" && byId.get(PDF)?.design_page === null, "el carrusel de LinkedIn es UN PDF (document, sin página)");
    check(synced.networks[0].files?.join() === [png(1), png(2), png(3)].join(), "CRITERIO: Instagram queda con los PNG elegidos EN ORDEN");
    check(synced.networks[1].files?.join() === PDF, "LinkedIn queda con el PDF");
    check(synced.status === "draft" && synced.caption === fresh.caption, "sincronizar no cambia el estado de la pieza ni su caption");
    check((await listBucket(`${t.id}/${postId}`)).length === 4, "en el bucket de Contenido hay exactamente los cuatro archivos, en `<negocio>/<pieza>/`");
    const { data: ok1 } = await raw.storage.from(BUCKET).createSignedUrl(`${t.id}/${postId}/${png(1)}.png`, 60);
    check(!!ok1?.signedUrl, "los archivos son del bucket privado y se firman como cualquier media de Contenido");
    const { data: postRow } = await raw.from("social_posts").select("id").eq("content_post_id", postId);
    check((postRow ?? []).length === 0, "sincronizar nunca crea ni toca publicaciones");

    // ─── Volver a sincronizar conserva los ids ──────────────────────────
    console.log("\n— Volver a sincronizar conserva los ids —");
    await raw.from("designs").update({ rev: 7 }).eq("id", designId);
    const second = await sync({ designId });
    check(second.status === "synced", "el job vuelve a correr con el diseño más nuevo", JSON.stringify(second));
    const again = await readPost(postId);
    check(again.media.map((m) => m.id).join() === synced.media.map((m) => m.id).join(), "CRITERIO: los ids no cambian entre sincronizaciones");
    check(again.networks[0].files?.join() === synced.networks[0].files?.join() && again.networks[1].files?.join() === synced.networks[1].files?.join(), "las redes siguen apuntando a los mismos archivos");
    check(again.media.every((m) => m.design_version === 7), "lo que cambia es la versión del diseño con la que se armaron");
    check((await listBucket(`${t.id}/${postId}`)).length === 4, "sin archivos de más en el bucket");

    // ─── Menos páginas ──────────────────────────────────────────────────
    await raw.from("designs").update({ doc: docWithPages("v45", 2), rev: 8 }).eq("id", designId);
    await sync({ designId });
    const fewer = await readPost(postId);
    check(fewer.media.filter((m) => m.design_page).length === 2 && fewer.networks[0].files?.join() === [png(1), png(2)].join(), "si el diseño pierde una página, sale de la biblioteca y de la red");
    check((await listBucket(`${t.id}/${postId}`)).length === 3, "y se borra del bucket (la pieza no se publicó)");

    // ─── Una red publicada no se toca ───────────────────────────────────
    console.log("\n— Según el estado de cada red (F64) —");
    const { error: pubError } = await raw.from("social_posts").insert({ workspace_id: t.id, content_post_id: postId, platform: "linkedin", status: "published", published_at: new Date().toISOString(), origin: "manual" });
    check(!pubError, "se marca LinkedIn como publicada a mano", pubError?.message);
    await raw.from("designs").update({ rev: 9 }).eq("id", designId);
    const beforePublished = await readPost(postId);
    const afterPublished = await sync({ designId });
    const published = await readPost(postId);
    check(afterPublished.status === "synced" && afterPublished.networks.join() === "instagram", "CRITERIO: una red publicada no se actualiza (solo Instagram)", JSON.stringify(afterPublished));
    check(JSON.stringify(published.networks[1]) === JSON.stringify(beforePublished.networks[1]), "la red publicada queda idéntica");
    check(published.media.find((m) => m.id === PDF)?.design_version === 8, "su archivo (el PDF) conserva la versión con la que se publicó");

    // ─── Programada: solo avisa ─────────────────────────────────────────
    const { error: accountError } = await raw.from("social_accounts").insert({ workspace_id: t.id, platform: "instagram", username: "zz-test-ana", is_active: true, default_publisher: "zernio", publishers: [{ publisher: "zernio", status: "available" }] });
    check(!accountError, "se conecta una cuenta de Instagram de prueba", accountError?.message);
    const { data: scheduledRow, error: scheduledError } = await raw
      .from("social_posts")
      .insert({ workspace_id: t.id, content_post_id: postId, platform: "instagram", status: "scheduled", scheduled_at: new Date(Date.now() + 86_400_000).toISOString(), origin: "system" })
      .select("id")
      .single();
    check(!scheduledError && !!scheduledRow, "Instagram queda programada", scheduledError?.message);
    await raw.from("designs").update({ rev: 10 }).eq("id", designId);
    const beforeScheduled = await readPost(postId);
    const held = await sync({ designId });
    check(held.status === "noop" && held.held.some((h) => h.platform === "instagram" && h.action === "notify"), "una red programada NO se toca: el job solo avisa", JSON.stringify(held));
    check(JSON.stringify(await readPost(postId)) === JSON.stringify(beforeScheduled), "la pieza queda exactamente igual");

    // ─── Desvincular y archivar ─────────────────────────────────────────
    console.log("\n— Desvincular y archivar no borran archivos (F66) —");
    const filesBefore = await listBucket(`${t.id}/${postId}`);
    const mediaBefore = (await readPost(postId)).media.map((m) => m.id).join();
    const unlinked = await unlinkCore(env, { designId });
    check(unlinked.ok, "desvincular funciona", JSON.stringify(unlinked));
    const { data: after } = await raw.from("designs").select("content_post_id, content_network").eq("id", designId).single();
    check(after?.content_post_id === null && after?.content_network === null, "el diseño ya no está vinculado");
    check((await readPost(postId)).media.map((m) => m.id).join() === mediaBefore && (await listBucket(`${t.id}/${postId}`)).join() === filesBefore.join(), "CRITERIO: los archivos que ya estaban quedan en la pieza (biblioteca y bucket)");
    const archivedRun = await (async () => {
      await raw.from("designs").update({ content_post_id: postId, content_network: "instagram", archived_at: new Date().toISOString() }).eq("id", designId);
      return sync({ designId });
    })();
    check(archivedRun.status === "skipped" && archivedRun.reason === "archived", "un diseño archivado deja de sincronizar", JSON.stringify(archivedRun));
    check((await listBucket(`${t.id}/${postId}`)).join() === filesBefore.join(), "y tampoco borra nada");

    // ─── Permisos y RLS ─────────────────────────────────────────────────
    console.log("\n— Quién ve el vínculo —");
    await raw.from("designs").update({ archived_at: null }).eq("id", designId);
    const sees = async (client: typeof t.owner.client) => ((await client.from("designs").select("id, content_post_id").eq("id", designId)).data ?? []).length;
    check((await sees(t.member.client)) === 1 && (await sees(t.viewer.client)) === 1, "el Member y quien solo puede ver diseños leen el diseño y su vínculo");
    check((await sees(t.outsider.client)) === 0, "quien no puede ver diseños no lo ve (ni el vínculo)");
    const { data: writable } = await t.member.client.from("designs").update({ content_post_id: null }).eq("id", designId).select("id");
    check((writable ?? []).length === 0, "el vínculo no se escribe con la sesión de una persona: solo el servidor");
    const { data: stillThere } = await raw.from("designs").select("content_post_id").eq("id", designId).single();
    check(stillThere?.content_post_id === postId, "y sigue como estaba");
  } finally {
    // El workspace de prueba (y sus piezas y diseños) se borra en la limpieza general; los archivos, en `ctx.storagePaths`.
  }
}
