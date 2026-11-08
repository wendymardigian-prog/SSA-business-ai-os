/**
 * verify-designer · bloque ds2 (F15, F27, F28, F48): lo que solo se prueba contra la base real.
 *
 * - Dos guardados con la MISMA `rev`: el segundo recibe `conflict` y no pisa nada (`UPDATE … WHERE rev = $rev`).
 * - Restaurar una versión NO borra versiones y deja una nueva.
 * - Una generación (fila con `template_id`) NUNCA aparece en la consulta de la lista de Diseños (con la RLS de una persona).
 * - Guardar y restaurar no encolan ningún render (`scheduled_jobs` no cambia).
 * - Archivar un diseño publicado lo despublica; borrar uno con generaciones se rechaza.
 *
 * Crea y limpia sus datos (prefijo `zz-test-`). NO se corre en simultáneo con los otros `verify-*`.
 */

import { archiveCore, deleteCore, restoreVersionCore, saveDocCore } from "../../lib/designer/designs-ops";
import type { CoreEnv } from "../../lib/designer/designs-core";
import { loadList } from "../../lib/designer/queries";
import { DEFAULT_LIST_FILTERS } from "../../lib/designer/screens/list";
import { check, makeWorkspace, minimalDoc, raw, svc, type BlockContext } from "./helpers";

function docWith(text: string, format = "v45") {
  const doc = minimalDoc(format);
  (doc.pages[0].elements as unknown[]).push({ id: "el_zztest01", type: "text", x: 50, y: 50, w: 60, text, font: { family: "Inter", weight: 700 }, size: 60, align: "center", color: "#111111" });
  return doc;
}

async function jobCount(workspaceId: string): Promise<number> {
  const { count } = await raw.from("scheduled_jobs").select("id", { count: "exact", head: true }).like("type", "design_%").contains("payload", { workspaceId });
  return count ?? 0;
}

export default async function ds2(_ctx: BlockContext): Promise<void> {
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds2");
  const env: CoreEnv = { service: svc, actor: { workspaceId: t.id, userId: t.owner.id } };

  const { data: tpl } = await raw.from("design_templates").insert({ workspace_id: t.id, name: "zz-test plantilla", format: "carta_h", doc: docWith("{{contact.display_name}}", "carta_h"), origin: "blank" }).select("id").single();
  const { data: own } = await raw.from("designs").insert({ workspace_id: t.id, name: "zz-test diseño propio", format: "v45", doc: docWith("uno"), origin: "blank" }).select("id, rev").single();
  const { data: gen } = await raw
    .from("designs")
    .insert({ workspace_id: t.id, name: "zz-test generación", format: "carta_h", doc: docWith("Ana", "carta_h"), origin: "template", template_id: tpl?.id, source: "manual", status: "ready" })
    .select("id")
    .single();
  check(!!tpl && !!own && !!gen, "se crearon una plantilla, un diseño propio y una generación");
  if (!tpl || !own || !gen) return;

  // ─── La lista (F15) ─────────────────────────────────────────────────────
  console.log("\n— La lista de Diseños —");
  const list = await loadList(t.owner.client, t.id, DEFAULT_LIST_FILTERS, {});
  const ids = list.items.map((i) => i.card.id);
  check(ids.includes(own.id), "el diseño propio aparece");
  check(!ids.includes(gen.id), "una generación NUNCA aparece en la lista de Diseños");
  const member = await loadList(t.member.client, t.id, DEFAULT_LIST_FILTERS, {});
  check(!member.items.some((i) => i.card.id === gen.id), "…tampoco para un Member");
  check(list.counts.designs === 1, "el contador de la pestaña cuenta solo los diseños propios", String(list.counts.designs));
  const templates = await loadList(t.owner.client, t.id, { ...DEFAULT_LIST_FILTERS, tab: "plantillas" }, {});
  check(templates.items[0]?.card.kind === "template" && templates.items[0].card.generated === 1, "la plantilla muestra su generación contada");
  const outsider = await loadList(t.outsider.client, t.id, DEFAULT_LIST_FILTERS, {}).catch(() => null);
  check(!outsider || outsider.items.length === 0, "un rol sin designer.view no ve ninguna");

  // ─── Guardar con rev (F27) ──────────────────────────────────────────────
  console.log("\n— Guardar con rev —");
  const jobsBefore = await jobCount(t.id);
  const first = await saveDocCore(env, { kind: "design", id: own.id, doc: docWith("desde la pestaña A"), rev: own.rev as number });
  check(first.ok, "el primer guardado entra", JSON.stringify(first));
  const second = await saveDocCore(env, { kind: "design", id: own.id, doc: docWith("desde la pestaña B"), rev: own.rev as number });
  check(!second.ok && "conflict" in second && second.conflict === true, "el segundo guardado con la misma rev recibe `conflict`", JSON.stringify(second));
  const { data: afterSaves } = await raw.from("designs").select("rev, doc").eq("id", own.id).single();
  check(JSON.stringify(afterSaves?.doc).includes("desde la pestaña A") && !JSON.stringify(afterSaves?.doc).includes("pestaña B"), "lo guardado sigue siendo lo de la pestaña A (no se pisó en silencio)");
  check((afterSaves?.rev as number) === (own.rev as number) + 1, "la rev subió una sola vez");
  check((await jobCount(t.id)) === jobsBefore, "guardar no encoló ningún job de render");

  // ─── Versiones (F27) ────────────────────────────────────────────────────
  console.log("\n— Versiones —");
  const { data: versions } = await raw.from("design_versions").select("id, reason").eq("design_id", own.id);
  check((versions ?? []).length === 1 && versions?.[0].reason === "manual", "el primer guardado dejó UNA versión manual");
  await saveDocCore(env, { kind: "design", id: own.id, doc: docWith("tercero"), rev: (afterSaves?.rev as number) ?? 0 });
  const { data: versions2 } = await raw.from("design_versions").select("id").eq("design_id", own.id);
  check((versions2 ?? []).length === 1, "otro guardado dentro de los 10 minutos NO deja otra versión");
  const before = (await raw.from("design_versions").select("id").eq("design_id", own.id)).data ?? [];
  const restored = await restoreVersionCore(env, { kind: "design", id: own.id }, before[0].id as string);
  check(restored.ok, "restaurar una versión funciona", JSON.stringify(restored));
  const after = (await raw.from("design_versions").select("id, reason").eq("design_id", own.id)).data ?? [];
  check(after.length > before.length && before.every((b) => after.some((a) => a.id === b.id)), "restaurar NO borra versiones y deja nuevas");
  check(after.some((a) => a.reason === "restore"), "queda una versión «Restaurada»");
  check((await jobCount(t.id)) === jobsBefore, "restaurar tampoco encoló ningún render");

  // ─── Archivar y borrar (F28) ────────────────────────────────────────────
  console.log("\n— Archivar y borrar —");
  await raw.from("designs").update({ published: true, status: "ready", published_at: new Date().toISOString() }).eq("id", own.id);
  const needs = await archiveCore(env, { kind: "design", id: own.id });
  check(needs.ok && needs.data.needsConfirm === true, "archivar un diseño publicado pide confirmación");
  const { data: stillPublished } = await raw.from("designs").select("published, archived_at").eq("id", own.id).single();
  check(stillPublished?.published === true && stillPublished.archived_at === null, "…y no cambió nada todavía");
  const done = await archiveCore(env, { kind: "design", id: own.id }, { confirmUnpublish: true });
  const { data: archived } = await raw.from("designs").select("published, archived_at").eq("id", own.id).single();
  check(done.ok && archived?.published === false && !!archived.archived_at, "confirmado, lo despublica y lo archiva");
  const genArchive = await archiveCore(env, { kind: "design", id: gen.id }, { confirmUnpublish: true });
  check(!genArchive.ok, "una pieza emitida no se archiva");
  const delTemplate = await deleteCore(env, { kind: "template", id: tpl.id }, true);
  check(!delTemplate.ok, "borrar una plantilla con generaciones se RECHAZA");
  const { count: stillThere } = await raw.from("design_templates").select("id", { count: "exact", head: true }).eq("id", tpl.id);
  check(stillThere === 1, "…y la plantilla sigue ahí");
  const delPublishedOnce = await deleteCore(env, { kind: "design", id: own.id }, true);
  check(!delPublishedOnce.ok, "borrar uno que se publicó alguna vez se rechaza");
  const { data: draft } = await raw.from("designs").insert({ workspace_id: t.id, name: "zz-test borrador sin uso", format: "sq", doc: docWith("x", "sq"), origin: "blank" }).select("id").single();
  check((await deleteCore(env, { kind: "design", id: draft!.id as string }, false)).ok === false, "sin designer.manage no se borra");
  check((await deleteCore(env, { kind: "design", id: draft!.id as string }, true)).ok === true, "un borrador sin uso se borra con designer.manage");
}
