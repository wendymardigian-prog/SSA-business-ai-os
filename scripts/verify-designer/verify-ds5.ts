/**
 * verify-designer · bloque ds5 (F43–F48b): publicar, leer el link público sin sesión, descargar, exportar, anular,
 * despublicar y el juego único de archivos. Contra la base real y el Storage real, con el render SIEMPRE simulado
 * (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-designer.mjs`): nunca llama al servicio de render real.
 *
 * - Publicar: el link ya no es 404, `design_public_get` lo devuelve sin datos de más y encola el render.
 * - Leer sin sesión: `anon` lee con la función pública; la página decide "preparando" o la pieza, y la imagen y la
 *   descarga salen del bucket PRIVADO por la ruta del servidor (con un 404 que tarda parecido si no existe).
 * - Descarga apagada: 404. Un ZIP con una imagen por página.
 * - F48b: después de volver a renderizar, en el bucket quedan SOLO los archivos nuevos de ese diseño (la exportación
 *   suelta y los demás diseños no se tocan); una generación nunca borra.
 * - Exportar: PDF/ZIP/PNG, "Exportar prueba" de una plantilla (sin crear una generación), el motivo si el job falla.
 * - Anular: sin motivo se rechaza; con motivo el link muestra "anulado" y no deja descargar; nunca se borra.
 * - Despublicar: el siguiente pedido es 404 y el código se conserva.
 *
 * Las Server Actions (permiso adentro, negocio de la sesión) se prueban con Vitest (`publish-actions.test.ts`):
 * acá se llama a la misma lógica (`lib/designer/publishing.ts`, `exporting.ts`) con el cliente de servicio.
 *
 * No se corre en paralelo con otro verify-*: lo corre la sesión principal, de a uno, con el candado.
 */

import { unzipSync } from "fflate";
import { exportStatusCore, requestExportCore } from "../../lib/designer/exporting";
import { runDesignRender, type DesignRenderPayload, type RenderSet } from "../../lib/designer/jobs/render";
import { RenderNotConfigured } from "../../lib/designer/render-client";
import { loadPublicDesign } from "../../lib/designer/public/load";
import { decidePublicView } from "../../lib/designer/public/model";
import { NOT_FOUND_MIN_MS, withinPublicLimit } from "../../lib/designer/public/guard";
import { serveDownload, servePageImage, servePreview } from "../../lib/designer/public/serve";
import { publishDesignCore, setPublicOptionsCore, unpublishDesignCore, voidDesignCore } from "../../lib/designer/publishing";
import { anon, check, makeWorkspace, minimalDoc, raw, sql, svc, SUPABASE_URL, type BlockContext } from "./helpers";

process.env.NEXT_PUBLIC_APP_URL ||= "https://app.zz-test.example";
const MAIN_URL = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

const BUCKET = "design-renders";
const IP = "198.51.100.77";
const request = (path: string) => new Request(`https://links.zz-test.example${path}`, { headers: { "x-real-ip": IP } });
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Todos los archivos de una carpeta del bucket, con sus subcarpetas. */
async function listAll(prefix: string): Promise<string[]> {
  const { data, error } = await raw.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error) throw new Error(`no pude listar ${prefix}: ${error.message}`);
  const out: string[] = [];
  for (const entry of data ?? []) {
    const path = `${prefix}/${entry.name}`;
    if (entry.id === null) out.push(...(await listAll(path)));
    else out.push(path);
  }
  return out;
}

/** Un documento de carta horizontal con dos páginas. */
function twoPageDoc(format = "carta_h") {
  const doc = minimalDoc(format);
  return { ...doc, pages: [doc.pages[0], { ...doc.pages[0], id: "pg_test0002" }] };
}

export default async function ds5(ctx: BlockContext): Promise<void> {
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds5");
  const actor = { workspaceId: t.id, userId: t.owner.id };

  // Lo que se encola se junta acá (nada llega a la cola real): se corre el job a mano, con el render simulado.
  const queue: DesignRenderPayload[] = [];
  const enqueue = async (_db: unknown, payload: DesignRenderPayload) => void queue.push(payload);
  const runLast = () => runDesignRender(svc, queue[queue.length - 1]);
  const exportDeps = { enqueue: enqueue as never, renderConfigured: () => true };

  try {
    const { data: design, error: designError } = await raw
      .from("designs")
      .insert({ workspace_id: t.id, name: "zz-test diseño de Ana Pérez", format: "carta_h", doc: twoPageDoc(), origin: "blank" })
      .select("id, code")
      .single();
    check(!designError && !!design, "el servidor crea un diseño propio de dos páginas", designError?.message);
    const code = design!.code as string;
    const designId = design!.id as string;
    const notFoundDelay = async (fn: () => Promise<Response>) => {
      const started = Date.now();
      const res = await fn();
      return { status: res.status, ms: Date.now() - started };
    };

    // ─── Antes de publicar ──────────────────────────────────────────────
    console.log("\n— Un borrador no se ve —");
    check((await anon.rpc("design_public_get", { p_code: code })).data === null, "un borrador no se lee sin sesión (el link es 404)");
    const draftResponse = await notFoundDelay(() => servePageImage(svc, request(`/d/${code}/p/1`), code, "1"));
    const ghostResponse = await notFoundDelay(() => servePageImage(svc, request(`/d/AAAA-BBBB-CCCC/p/1`), "AAAA-BBBB-CCCC", "1"));
    check(draftResponse.status === 404 && ghostResponse.status === 404, "la imagen de un borrador y la de un código que no existe dan 404");
    check(draftResponse.ms >= NOT_FOUND_MIN_MS - 10 && ghostResponse.ms >= NOT_FOUND_MIN_MS - 10, `los dos 404 tardan al menos ${NOT_FOUND_MIN_MS} ms (no se distinguen por el tiempo)`, `${draftResponse.ms} ms y ${ghostResponse.ms} ms`);
    check(await withinPublicLimit(svc, new Headers({ "x-real-ip": IP }), "page"), "el tope por IP cuenta contra la base y deja pasar el primer pedido");

    // ─── Publicar (F45) ─────────────────────────────────────────────────
    console.log("\n— Publicar —");
    const published = await publishDesignCore(svc, actor, { designId }, { enqueue: enqueue as never });
    check(published.ok && published.data.link === `${MAIN_URL}/d/${code}`, "publicar devuelve el link con el dominio del negocio (el principal, si no tiene propio)", JSON.stringify(published));
    const { data: afterPublish } = await raw.from("designs").select("published, status, published_at, allow_download").eq("id", designId).single();
    check(afterPublish?.published === true && afterPublish?.status === "ready" && !!afterPublish?.published_at, "el diseño queda publicado, listo y con su fecha");
    const { data: versions } = await raw.from("design_versions").select("reason, doc").eq("design_id", designId);
    check((versions ?? []).length === 1 && versions?.[0].reason === "publish", "se guarda UNA versión de motivo «publish» (solo el documento)");
    check(queue.length === 1 && queue[0].designId === designId && queue[0].purpose === "publish", "se encola el render de todas las páginas (purpose publish)");
    const { data: audit } = await raw.from("audit_log").select("entity_type, metadata").eq("entity_id", designId);
    check((audit ?? []).some((a) => a.entity_type === "design" && (a.metadata as { event?: string } | null)?.event === "design.published"), "queda en audit_log (entityType design)");

    // ─── Leer el link sin sesión (F43) ──────────────────────────────────
    console.log("\n— El link público —");
    const publicRow = (await anon.rpc("design_public_get", { p_code: code })).data as Record<string, unknown> | null;
    check(!!publicRow && publicRow.code === code && publicRow.published === true, "publicado, se lee sin sesión");
    check(!!publicRow && !JSON.stringify(publicRow).includes(t.id) && !("workspace_id" in publicRow), "sin el workspace ni datos del negocio de más");
    const before = await loadPublicDesign(svc, code);
    const beforeView = before ? decidePublicView(before.pub) : null;
    check(beforeView?.screen === "preparing", "sin archivos todavía, la página dice «Se está preparando»");
    check(beforeView?.download.allowed === true && beforeView?.download.ready === false, "…y la descarga está permitida pero todavía no se ofrece");
    const early = await serveDownload(svc, request(`/d/${code}/descargar?formato=pdf`), code, { enqueue: enqueue as never });
    check(early.status === 202, "pedir la descarga antes de que esté responde 202 «Se está preparando»");
    check(queue.length === 2 && queue[1].designId === designId && queue[1].purpose === "publish", "…y vuelve a encolar el render del diseño");

    const rendered = await runLast();
    check(rendered.status === "rendered", "el job renderiza el juego (PNG por página y PDF, simulado)", JSON.stringify(rendered));
    const firstSet = (rendered as { set: RenderSet }).set;
    const record = await loadPublicDesign(svc, code);
    const view = record ? decidePublicView(record.pub) : null;
    check(view?.screen === "pieces" && record?.renders?.pages.length === 2, "con los archivos, la página muestra la pieza (2 páginas)");
    check(view?.download.ready === true && view?.download.option?.formato === "pdf", "el botón Descargar ofrece el PDF");

    const image = await servePageImage(svc, request(`/d/${code}/p/2`), code, "2");
    check(image.status === 200 && image.headers.get("content-type") === "image/png", "la página 2 sale por la ruta del servidor como PNG");
    check((await servePageImage(svc, request(`/d/${code}/p/3`), code, "3", { notFound: async () => new Response(null, { status: 404 }) })).status === 404, "una página que no existe, 404");
    const pdf = await serveDownload(svc, request(`/d/${code}/descargar?formato=pdf`), code);
    const pdfBytes = new Uint8Array(await pdf.arrayBuffer());
    check(pdf.status === 200 && pdf.headers.get("content-type") === "application/pdf" && String.fromCharCode(...pdfBytes.slice(0, 4)) === "%PDF", "la descarga del PDF sale por streaming");
    check((pdf.headers.get("content-disposition") ?? "").includes('filename="zz-test-diseno-de-ana-perez.pdf"'), "con un nombre legible");
    check(!/supabase|token|design-renders/i.test(JSON.stringify([...pdf.headers.entries()])), "sin exponer el bucket ni un link firmado");
    const zip = await serveDownload(svc, request(`/d/${code}/descargar?formato=zip`), code);
    check(zip.status === 200 && Object.keys(unzipSync(new Uint8Array(await zip.arrayBuffer()))).sort().join() === "01.png,02.png", "el ZIP trae una imagen por página (01.png, 02.png)");
    const png2 = await serveDownload(svc, request(`/d/${code}/descargar?formato=png&pagina=2`), code);
    check(png2.status === 200 && (png2.headers.get("content-disposition") ?? "").includes("-pagina-2.png"), "un PNG de la página 2");
    const preview = await servePreview(svc, request(`/d/${code}/preview.png`), code);
    check(preview.status === 200 && preview.headers.get("content-type") === "image/png", "la tarjeta de Open Graph sale con la página 1");

    console.log("\n— Descarga apagada —");
    check((await setPublicOptionsCore(svc, actor, { designId, allowDownload: false })).ok, "apagar «Permitir descargar»");
    check(((await anon.rpc("design_public_get", { p_code: code })).data as { allow_download?: boolean } | null)?.allow_download === false, "la función pública lo refleja");
    check((await serveDownload(svc, request(`/d/${code}/descargar?formato=pdf`), code, { notFound: async () => new Response(null, { status: 404 }) })).status === 404, "con la descarga apagada, 404");
    check(decidePublicView((await loadPublicDesign(svc, code))!.pub).download.option === null, "y el botón no se dibuja");
    await setPublicOptionsCore(svc, actor, { designId, allowDownload: true });

    // ─── Exportar (F46) ─────────────────────────────────────────────────
    console.log("\n— Exportar —");
    const asked = await requestExportCore(svc, actor, { kind: "design", id: designId, exportKind: "zip" }, exportDeps);
    const stamp = asked.ok && asked.data.status === "preparing" ? asked.data.stamp : "";
    check(asked.ok && !!stamp, "pedir un ZIP responde «preparando» con su marca", JSON.stringify(asked));
    check(queue.at(-1)?.purpose === "export" && queue.at(-1)?.exportKind === "zip" && queue.at(-1)?.stamp === stamp, "encola un design_render de exportación con esa marca");
    const waiting = await exportStatusCore(svc, actor, { kind: "design", id: designId, exportKind: "zip", stamp });
    check(waiting.ok && waiting.data.status === "preparing", "mientras no está, sigue «preparando»");
    check((await runLast()).status === "exported", "el job exporta");
    const done = await exportStatusCore(svc, actor, { kind: "design", id: designId, exportKind: "zip", stamp });
    check(done.ok && done.data.status === "ready" && done.data.url.startsWith(SUPABASE_URL) && done.data.fileName === "zz-test-diseno-de-ana-perez-imagenes.zip", "el estado devuelve un link firmado y un nombre legible", JSON.stringify(done));
    if (done.ok && done.data.status === "ready") {
      const res = await fetch(done.data.url);
      check(res.status === 200 && Object.keys(unzipSync(new Uint8Array(await res.arrayBuffer()))).length === 2, "el link firmado baja el ZIP con las dos imágenes");
    }
    const webDoc = minimalDoc("web");
    const { data: webDesign } = await raw.from("designs").insert({ workspace_id: t.id, name: "zz-test web", format: "web", doc: webDoc, origin: "blank" }).select("id, code").single();
    const webExport = await requestExportCore(svc, actor, { kind: "design", id: webDesign!.id, exportKind: "pdf" }, exportDeps);
    check(!webExport.ok && /página web/.test(webExport.error), "una página web no se exporta");
    check(!(await requestExportCore(svc, actor, { kind: "design", id: designId, exportKind: "pdf" }, { ...exportDeps, renderConfigured: () => false }) as { ok: boolean }).ok, "sin el servicio de render: «Falta conectar el servicio de render»");

    const failed = await requestExportCore(svc, actor, { kind: "design", id: designId, exportKind: "pdf" }, exportDeps);
    const failedStamp = failed.ok && failed.data.status === "preparing" ? failed.data.stamp : "";
    await runDesignRender(svc, queue[queue.length - 1], { render: async () => Promise.reject(new RenderNotConfigured()) });
    const failedStatus = await exportStatusCore(svc, actor, { kind: "design", id: designId, exportKind: "pdf", stamp: failedStamp });
    check(!failedStatus.ok && /servicio de render/.test(failedStatus.error), "si el job falla del todo, el estado devuelve el motivo (no queda «preparando» para siempre)", JSON.stringify(failedStatus));

    // «Exportar prueba» de una plantilla: datos de ejemplo, sin crear una generación ni un link.
    const { data: tpl } = await raw
      .from("design_templates")
      .insert({ workspace_id: t.id, name: "zz-test plantilla de constancia", format: "carta_h", doc: minimalDoc("carta_h"), origin: "blank", verify: true, doc_type: "constancia" })
      .select("id")
      .single();
    const { count: designsBefore } = await raw.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", t.id);
    const trial = await requestExportCore(svc, actor, { kind: "template", id: tpl!.id, exportKind: "pdf" }, exportDeps);
    const trialStamp = trial.ok && trial.data.status === "preparing" ? trial.data.stamp : "";
    await runLast();
    const trialDone = await exportStatusCore(svc, actor, { kind: "template", id: tpl!.id, exportKind: "pdf", stamp: trialStamp });
    check(trialDone.ok && trialDone.data.status === "ready" && trialDone.data.fileName === "zz-test-plantilla-de-constancia.pdf", "«Exportar prueba» de una plantilla deja el PDF", JSON.stringify(trialDone));
    const { count: designsAfter } = await raw.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", t.id);
    check(designsBefore === designsAfter, "y no crea ninguna generación");

    // ─── F48b: un solo juego de archivos ────────────────────────────────
    console.log("\n— F48b: un solo juego de archivos —");
    const { data: other } = await raw.from("designs").insert({ workspace_id: t.id, name: "zz-test otro", format: "v45", doc: minimalDoc("v45"), origin: "blank" }).select("id").single();
    await runDesignRender(svc, { designId: other!.id as string, purpose: "publish" });
    const otherFiles = await listAll(`${t.id}/${other!.id}`);
    const exportsBefore = (await listAll(`${t.id}/${designId}`)).filter((p) => p.includes("/exports/"));
    check(exportsBefore.length >= 2, "hay exportaciones sueltas del diseño antes de volver a renderizar", String(exportsBefore.length));

    check((await publishDesignCore(svc, actor, { designId }, { enqueue: enqueue as never })).ok, "publicar de nuevo (publicar los cambios) vuelve a encolar el render");
    await wait(25);
    const second = await runLast();
    const secondSet = (second as { set: RenderSet }).set;
    check(second.status === "rendered" && secondSet.version !== firstSet.version, "el segundo render deja un juego nuevo");
    const mine = (await listAll(`${t.id}/${designId}`)).filter((p) => !p.includes("/exports/"));
    check(mine.length === 3 && mine.every((p) => p.startsWith(`${t.id}/${designId}/${secondSet.version}/`)), "en el bucket quedan SOLO los archivos nuevos de ese diseño (2 páginas y el PDF)", mine.join("\n        "));
    // Se mira la tabla de objetos y no una descarga: el almacenamiento de Supabase sigue sirviendo un archivo borrado
    // hasta ~1 minuto desde su caché (comprobado el 7/11/2026), así que una descarga no prueba nada.
    const oldPdf = String(firstSet.pdf_path ?? "").replace(/'/g, "''");
    const stillThere = sql(`select count(*)::int as n from storage.objects where bucket_id = '${BUCKET}' and name = '${oldPdf}'`)[0]?.n;
    check(!mine.includes(firstSet.pdf_path as string) && Number(stillThere) === 0, "el PDF del juego anterior ya no está", String(stillThere));
    check((await listAll(`${t.id}/${designId}`)).filter((p) => p.includes("/exports/")).length === exportsBefore.length, "las exportaciones sueltas no se tocan (las limpia la limpieza diaria)");
    check((await listAll(`${t.id}/${other!.id}`)).length === otherFiles.length, "los archivos de otro diseño tampoco");
    const { data: rendersNow } = await raw.from("designs").select("renders").eq("id", designId).single();
    check(JSON.stringify((rendersNow?.renders as RenderSet | null)?.pages) === JSON.stringify(secondSet.pages), "`renders` lista exactamente los archivos que hay");
    const afterReRender = await servePageImage(svc, request(`/d/${code}/p/1`), code, "1");
    check(afterReRender.status === 200, "el link sigue mostrando la pieza con el juego nuevo");

    // ─── Anular (F47) ───────────────────────────────────────────────────
    console.log("\n— Anular —");
    const { data: genTpl } = await raw
      .from("design_templates")
      .insert({ workspace_id: t.id, name: "zz-test plantilla certificado", format: "carta_h", doc: minimalDoc("carta_h"), origin: "blank", verify: true, doc_type: "certificado" })
      .select("id")
      .single();
    const { data: contact } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: "zz-test Persona", email: `zz-test-sujeto-${Date.now()}@example.test`, phone: "+5491100000001" }).select("id, email").single();
    const { data: gen } = await raw
      .from("designs")
      .insert({ workspace_id: t.id, name: "zz-test Certificado · Ana Pérez", format: "carta_h", doc: minimalDoc("carta_h"), origin: "template", template_id: genTpl!.id, subject_contact_id: contact!.id, values: { "contact.display_name": "zz-test Persona" }, status: "ready", source: "manual" })
      .select("id, code")
      .single();
    await runDesignRender(svc, { designId: gen!.id as string, purpose: "generation" });
    const genRecord = await loadPublicDesign(svc, gen!.code as string);
    const genView = genRecord ? decidePublicView(genRecord.pub) : null;
    check(genView?.verification?.status === "valid" && /^✅ Certificado válido · emitido por .+ · Código /.test(genView?.verification?.text ?? ""), "una generación con verificación se ve «válida» con el texto de su tipo", genView?.verification?.text);
    const publicJson = JSON.stringify([genRecord?.pub, genView]);
    check(!publicJson.includes(contact!.email as string) && !publicJson.includes("5491100000001") && !publicJson.includes(contact!.id as string), "la página nunca lleva el email, el teléfono ni el id del sujeto");

    check(!(await voidDesignCore(svc, actor, { designId: gen!.id as string, reason: "   " })).ok, "anular sin motivo se rechaza");
    check(((await raw.from("designs").select("status").eq("id", gen!.id).single()).data as { status: string }).status === "ready", "…y no cambia nada");
    check((await voidDesignCore(svc, actor, { designId: designId, reason: "no es una generación" })).ok === false, "un diseño propio no se anula");
    const voided = await voidDesignCore(svc, actor, { designId: gen!.id as string, reason: "zz-test nombre mal escrito" });
    check(voided.ok, "anular con motivo", JSON.stringify(voided));
    const voidRow = (await anon.rpc("design_public_get", { p_code: gen!.code as string })).data as { status?: string; void_reason?: string } | null;
    check(voidRow?.status === "void" && voidRow?.void_reason === "zz-test nombre mal escrito", "el link sigue funcionando y la función pública devuelve «anulado» con su motivo");
    const voidView = decidePublicView((await loadPublicDesign(svc, gen!.code as string))!.pub);
    check(voidView.verification?.text === "⛔ Certificado anulado · Motivo: zz-test nombre mal escrito" && voidView.download.allowed === false && voidView.voidStamp, "la página dice «anulado» con el motivo, con el sello y sin Descargar");
    check((await serveDownload(svc, request(`/d/${gen!.code}/descargar?formato=pdf`), gen!.code as string, { notFound: async () => new Response(null, { status: 404 }) })).status === 404, "y la ruta de descarga tampoco la entrega");
    check(((await raw.from("designs").select("id", { count: "exact", head: true }).eq("id", gen!.id)).count ?? 0) === 1, "nunca se borra");
    const { data: voidAudit } = await raw.from("audit_log").select("metadata").eq("entity_id", gen!.id);
    check((voidAudit ?? []).some((a) => (a.metadata as { event?: string } | null)?.event === "design.voided"), "queda en audit_log");

    // Mientras se genera o falla, el link no cuenta nada ni deja descargar.
    for (const status of ["queued", "rendering", "failed"] as const) {
      const { data: pending } = await raw
        .from("designs")
        .insert({ workspace_id: t.id, name: "zz-test pendiente", format: "carta_h", doc: minimalDoc("carta_h"), origin: "template", template_id: genTpl!.id, status, source: "manual" })
        .select("code")
        .single();
      const pendingView = decidePublicView((await loadPublicDesign(svc, pending!.code as string))!.pub);
      check(pendingView.screen === "preparing" && pendingView.verification === null && !pendingView.download.allowed, `una generación «${status}» muestra «Se está preparando», sin datos y sin Descargar`);
    }

    // ─── Despublicar (F45) ──────────────────────────────────────────────
    console.log("\n— Despublicar —");
    check((await unpublishDesignCore(svc, actor, { designId })).ok, "despublicar");
    check((await anon.rpc("design_public_get", { p_code: code })).data === null, "el link responde 404 en el SIGUIENTE pedido (la función pública ya no lo devuelve)");
    const gone = await notFoundDelay(() => servePageImage(svc, request(`/d/${code}/p/1`), code, "1"));
    check(gone.status === 404, "y la imagen también");
    check((await serveDownload(svc, request(`/d/${code}/descargar?formato=pdf`), code, { notFound: async () => new Response(null, { status: 404 }) })).status === 404, "y la descarga");
    const { data: afterUnpublish } = await raw.from("designs").select("code, published, status").eq("id", designId).single();
    check(afterUnpublish?.code === code && afterUnpublish?.published === false && afterUnpublish?.status === "draft", "el código se conserva y el diseño vuelve a borrador");
    check((await publishDesignCore(svc, actor, { designId }, { enqueue: enqueue as never })).ok, "se puede volver a publicar");
    check((await anon.rpc("design_public_get", { p_code: code })).data !== null, "y el mismo link vuelve a funcionar");

    // ─── 00325: el link de una web muestra lo PUBLICADO, no lo que se está editando ─────
    console.log("\n— Web publicada: lo que se ve es lo publicado —");
    const webPublished = await publishDesignCore(svc, actor, { designId: webDesign!.id as string }, { enqueue: enqueue as never });
    check(webPublished.ok, "publicar la página web", JSON.stringify(webPublished));
    const edited = structuredClone(webDoc) as { pages: Array<{ background: { type: string; color?: string } }> };
    edited.pages[0].background = { type: "color", color: "#123456" };
    await raw.from("designs").update({ doc: edited }).eq("id", webDesign!.id);
    const webPub = (await anon.rpc("design_public_get", { p_code: webDesign!.code })).data as { doc?: { pages: Array<{ background: { color?: string } }> } } | null;
    check(!!webPub?.doc && webPub.doc.pages[0].background.color !== "#123456", "guardar un cambio después de publicar NO cambia lo que ve el público", JSON.stringify(webPub?.doc?.pages?.[0]?.background));
    check((await publishDesignCore(svc, actor, { designId: webDesign!.id as string }, { enqueue: enqueue as never })).ok, "«Publicar cambios»");
    const webPub2 = (await anon.rpc("design_public_get", { p_code: webDesign!.code })).data as { doc?: { pages: Array<{ background: { color?: string } }> } } | null;
    check(webPub2?.doc?.pages[0].background.color === "#123456", "…y recién ahí el público ve el cambio", JSON.stringify(webPub2?.doc?.pages?.[0]?.background));

    // ─── Un diseño de otro negocio no se toca ───────────────────────────
    console.log("\n— Aislamiento entre negocios —");
    const stranger = await makeWorkspace("ds5-ajeno");
    const strangerActor = { workspaceId: stranger.id, userId: stranger.owner.id };
    check(!(await publishDesignCore(svc, strangerActor, { designId })).ok && !(await unpublishDesignCore(svc, strangerActor, { designId })).ok && !(await voidDesignCore(svc, strangerActor, { designId: gen!.id as string, reason: "x" })).ok, "publicar, despublicar o anular con el negocio de otro no encuentra nada");
    check(!(await requestExportCore(svc, strangerActor, { kind: "design", id: designId, exportKind: "pdf" }, exportDeps)).ok, "exportar con el negocio de otro tampoco");
    check(!(await exportStatusCore(svc, strangerActor, { kind: "design", id: designId, exportKind: "zip", stamp })).ok, "ni mirar el estado de una exportación ajena");
  } finally {
    // Los archivos del Storage no los alcanza la limpieza general (borra el negocio, no el bucket): se anotan para borrarlos.
    try {
      for (const path of await listAll(t.id)) ctx.storagePaths.push({ bucket: BUCKET, path });
    } catch (error) {
      console.error("  (no pude listar los archivos de prueba para limpiarlos)", error instanceof Error ? error.message : error);
    }
  }
}
