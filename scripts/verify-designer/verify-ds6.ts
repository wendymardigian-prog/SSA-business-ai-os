/**
 * verify-designer · bloque ds6 (F49–F56): plantillas y generaciones, contra la base real y el Storage real, con el render
 * SIEMPRE simulado (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-designer.mjs`): nunca llama al servicio de render real ni a
 * Resend.
 *
 * - F51 «Generar para varios»: con 3 contactos, uno con una pieza válida y «saltear» prendida, se generan 2; la audiencia
 *   se lee con la sesión de la PERSONA (la RLS decide); volver a correr el mismo lote no duplica nada.
 * - F52 copia congelada: cambiar el texto de la plantilla NO cambia el documento ni el link de una generación vieja; el
 *   render usa el documento de la pieza, no el de la plantilla.
 * - F56 código y fecha: el código que aparece en el HTML que va al render es el mismo del link; la fecha de emisión es la
 *   del negocio.
 * - F50 emitir para uno: «ya tiene uno válido» avisa; con «reemplazarlo» queda una sola válida y la anterior dice
 *   «Reemplazado por <código>»; publicar con link la deja visible sin sesión por el único camino (publishDesignCore).
 * - F55 si falta un dato: «No generar y avisarme» deja la pieza fallida con «Falta: …» y avisa en la campana; «Dejarlo
 *   vacío» y «Usar el valor de la plantilla» generan igual.
 * - F54 reintentar: una falla de datos sigue pidiendo el dato y no cambia nada hasta completarlo; una de render vuelve a
 *   la cola; reintentar nunca encola nada más que el render de esa pieza.
 * - Permisos: la RLS deja leer las generaciones con `designer.view` y a quien no lo tiene no; nadie escribe `designs`
 *   desde el navegador; un contacto o una plantilla de otro negocio no existen.
 * - El email: sale por `sendTransactionalEmail` (simulado acá) como transaccional y con el link del dominio del negocio.
 *
 * Las Server Actions (permiso adentro, negocio de la sesión, forma de lo que manda el navegador) se prueban con Vitest
 * (`lib/actions/designer/generate.test.ts`): acá se llama a la misma lógica con el cliente de servicio.
 *
 * No se corre en paralelo con otro verify-*: lo corre la sesión principal, de a uno, con el candado.
 */

import { countGenerationAudienceCore, resolveContactAudience, type BulkEnv } from "../../lib/designer/bulk-core";
import { createGeneration, findValidForContacts, type GenerationDeps } from "../../lib/designer/generate-core";
import { generateOneCore, previewGenerationCore, retryFailedGenerationsCore, retryGenerationCore, type OpsEnv } from "../../lib/designer/generate-ops";
import { sendGenerationEmailCore } from "../../lib/designer/generation-email";
import { generationDetailCore, listGenerationsCore } from "../../lib/designer/generations-query";
import { runGenerateMany } from "../../lib/designer/jobs/generate-many";
import { runDesignRender, type DesignRenderPayload, type RenderSet } from "../../lib/designer/jobs/render";
import { designPublicUrl } from "../../lib/designer/public-links";
import { renderDesign, type RenderRequest } from "../../lib/designer/render-client";
import { formatDesignDate } from "../../lib/designer/variables/catalog";
import { anon, check, makeWorkspace, raw, svc, type BlockContext } from "./helpers";

process.env.NEXT_PUBLIC_APP_URL ||= "https://app.zz-test.example";
const MAIN_URL = process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
const BUCKET = "design-renders";

/** Una carta apaisada con el nombre del contacto, la fecha de emisión y el código. */
function certificateDoc(text = "Se otorga el presente a {{contact.display_name}} · {{design.issued_on}} · {{design.code}}") {
  return {
    v: 1,
    format: "carta_h",
    pages: [
      {
        id: "pg_test0001",
        background: { type: "color", color: "#ffffff" },
        elements: [{ id: "el_test0001", type: "text", x: 50, y: 50, w: 80, text, font: { family: "Inter", weight: 400 }, size: 40, align: "center", color: "#111111" }],
      },
    ],
  };
}

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

export default async function ds6(ctx: BlockContext): Promise<void> {
  if (process.env.DESIGNER_FAKE_RENDER !== "1") {
    check(false, "este bloque corre con DESIGNER_FAKE_RENDER=1 (nunca contra el render real)");
    return;
  }
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds6");
  const stamp = Date.now();
  const contact = async (name: string, email: string | null) => {
    const { data, error } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: `zz-test ${name}`, email }).select("id").single();
    if (error || !data) throw new Error(`no pude crear el contacto ${name}: ${error?.message}`);
    return data.id as string;
  };
  const a = await contact("Ana Pérez", `zz-test-ds6-a-${stamp}@example.test`);
  const b = await contact("Beto Gómez", `zz-test-ds6-b-${stamp}@example.test`);
  const c = await contact("Carla Díaz", null);

  const template = async (name: string, extra: Record<string, unknown> = {}) => {
    const { data, error } = await raw
      .from("design_templates")
      .insert({ workspace_id: t.id, name, format: "carta_h", doc: certificateDoc(), origin: "blank", verify: true, doc_type: "certificado", custom_vars: [], ...extra })
      .select("id")
      .single();
    if (error || !data) throw new Error(`no pude crear la plantilla ${name}: ${error?.message}`);
    return data.id as string;
  };
  const T1 = await template("zz-test Certificado del programa");
  const T2 = await template("zz-test Certificado con nombre propio", {
    doc: certificateDoc("Se otorga a {{nombre_en_el_certificado}} · {{design.code}}"),
    custom_vars: [{ key: "nombre_en_el_certificado", label: "Nombre como lo quiere en el certificado", sample: "Ana Pérez" }],
  });
  const { data: strangerWs } = await raw.from("workspaces").insert({ name: "zz-test-designer-ds6-ajeno", slug: `zz-test-designer-ds6-ajeno-${stamp}`, timezone: "UTC" }).select("id").single();
  const { data: strangerContact } = await raw.from("contacts").insert({ workspace_id: strangerWs!.id, display_name: "zz-test Persona ajena" }).select("id").single();
  const { data: strangerTemplate } = await raw
    .from("design_templates")
    .insert({ workspace_id: strangerWs!.id, name: "zz-test plantilla ajena", format: "carta_h", doc: certificateDoc(), origin: "blank" })
    .select("id")
    .single();

  // Lo que se encola se junta acá (nada llega a la cola real). Los avisos y el historial sí van a la base.
  const queue: DesignRenderPayload[] = [];
  const deps: GenerationDeps = { enqueue: (async (_db: unknown, payload: DesignRenderPayload) => void queue.push(payload)) as never };
  const env: OpsEnv = { service: svc, workspaceId: t.id, userId: t.owner.id };
  const bulkEnv: BulkEnv = { service: svc, user: t.owner.client, workspaceId: t.id, userId: t.owner.id, timeZone: "UTC" };
  const row = async (id: string) => (await raw.from("designs").select("*").eq("id", id).single()).data as Record<string, unknown>;
  const valid = async (templateId: string, contactId: string) =>
    ((await raw.from("designs").select("id").eq("template_id", templateId).eq("subject_contact_id", contactId).neq("status", "void").neq("status", "failed")).data ?? []).length;

  try {
    // ─── F51: para varios ─────────────────────────────────────────────
    console.log("\n— F51: generar para varios —");
    const first = await createGeneration(svc, { workspaceId: t.id, templateId: T1, contactId: a, overrides: {}, policy: "fail", publish: false, source: "manual", sourceRef: { kind: "user", user_id: t.owner.id }, actorUserId: t.owner.id }, deps);
    check(first.ok && first.status === "queued", "Ana ya tiene una pieza (la primera generación)", JSON.stringify(first));
    if (!first.ok) throw new Error("no se pudo crear la primera generación");
    await raw.from("designs").update({ status: "ready" }).eq("id", first.designId);

    const audience = await resolveContactAudience(bulkEnv, {}, new Date());
    check([a, b, c].every((id) => audience.ids.includes(id)) && audience.total === 3, "la audiencia sin filtros trae los 3 contactos, leídos con la sesión de la persona (la RLS decide)", JSON.stringify(audience));
    const counted = await countGenerationAudienceCore(bulkEnv, { templateId: T1, audienceParams: "", skipExisting: true });
    check(counted.ok && counted.data.total === 3 && counted.data.existing === 1 && counted.data.willGenerate === 2, "«3 cumplen · 1 ya tiene uno válido (se saltea)» → 2 para generar", JSON.stringify(counted));

    const batchId = "bbbbbbbb-6666-4666-8666-bbbbbbbbbbbb";
    const payload = { workspaceId: t.id, templateId: T1, batchId, userId: t.owner.id, contactIds: [a, b, c], skipExisting: true, publish: false, email: null, offset: 0, attempt: 0 };
    queue.length = 0;
    const ran = await runGenerateMany(svc, payload, deps);
    check(ran.status === "done" && ran.created === 2 && ran.skipped === 1, "con 3 contactos, uno con pieza válida y «saltear» prendida, se generan 2", JSON.stringify(ran));
    const { data: bulkRows } = await raw.from("designs").select("id, subject_contact_id, status, source, source_ref").eq("template_id", T1).eq("source", "bulk");
    check((bulkRows ?? []).length === 2 && (bulkRows ?? []).every((r) => r.status === "queued" && (r.source_ref as { batch_id?: string }).batch_id === batchId), "las dos quedan en cola («En proceso») con el lote de origen");
    check(queue.length === 2 && queue.every((p) => p.purpose === "generation"), "cada una encola su render (purpose generation)");
    check((await valid(T1, a)) === 1 && (await valid(T1, b)) === 1 && (await valid(T1, c)) === 1, "y cada persona queda con UNA sola pieza válida");
    const again = await runGenerateMany(svc, payload, deps);
    const { count: bulkCount } = await raw.from("designs").select("id", { count: "exact", head: true }).eq("template_id", T1).eq("source", "bulk");
    check(again.status === "done" && again.created === 0 && bulkCount === 2, "si la cola corre el mismo lote dos veces, no genera dos certificados", JSON.stringify(again));
    const existingMap = await findValidForContacts(svc, t.id, T1, [a, b, c]);
    check(existingMap.size === 3, "findValidForContacts ve a las tres personas con una pieza válida");

    // ─── F52 + F56: copia congelada, código y fecha ───────────────────
    console.log("\n— F52 y F56: copia congelada, código y fecha —");
    const bRow = bulkRows!.find((r) => r.subject_contact_id === b)!;
    const before = await row(bRow.id as string);
    const frozen = JSON.stringify(before.doc);
    const { error: editError } = await raw.from("design_templates").update({ doc: certificateDoc("TEXTO NUEVO de la plantilla · {{contact.display_name}}") }).eq("id", T1);
    check(!editError, "se edita el texto de la plantilla", editError?.message);
    const after = await row(bRow.id as string);
    check(JSON.stringify(after.doc) === frozen && after.code === before.code, "cambiar el texto de la plantilla NO cambia el documento ni el código/link de una generación vieja");

    const captured: RenderRequest[] = [];
    const out = await runDesignRender(svc, { designId: bRow.id as string, purpose: "generation" }, { render: async (req) => (captured.push(req), renderDesign(req)) });
    check(out.status === "rendered", "el render simulado deja la pieza lista", JSON.stringify(out));
    const sent = captured.find((r) => r.format === "pdf");
    const html = (sent?.pages ?? []).map((p) => p.html).join("\n") + (sent?.html ?? "");
    const done = await row(bRow.id as string);
    check(done.status === "ready", "la generación pasa a `ready`");
    check(html.includes("zz-test Beto Gómez") && !html.includes("TEXTO NUEVO"), "el render usa el documento DE LA PIEZA (con el nombre de Beto), no el texto nuevo de la plantilla");
    check(html.includes(done.code as string), "el código que aparece en el PDF es el de la fila");
    check(designPublicUrl(MAIN_URL, done.code as string) === `${MAIN_URL}/d/${done.code}`, "…y es el mismo del link público");
    check((done.values as Record<string, string>)["design.code"] === done.code, "el código también quedó en los valores guardados");
    const today = formatDesignDate(new Date(), "long", "UTC");
    const yesterday = formatDesignDate(new Date(Date.now() - 86_400_000), "long", "UTC");
    check([today, yesterday].includes((done.values as Record<string, string>)["design.issued_on"]), "la fecha de emisión es la de creación en la zona del negocio, con el formato de la plantilla", (done.values as Record<string, string>)["design.issued_on"]);
    const set = done.renders as RenderSet;
    for (const path of [...(set.pages ?? []), ...(set.pdf_path ? [set.pdf_path] : [])]) ctx.storagePaths.push({ bucket: BUCKET, path });

    // ─── F50: emitir para uno ─────────────────────────────────────────
    console.log("\n— F50: emitir para uno —");
    const preview = await previewGenerationCore(env, { templateId: T1, contactId: b, overrides: {} });
    check(preview.ok && preview.data.existingValid?.designId === bRow.id && preview.data.missing.length === 0, "la vista previa avisa que Beto ya tiene uno válido", JSON.stringify(preview));
    const already = await generateOneCore(env, { templateId: T1, contactId: b, overrides: {}, publish: true }, deps);
    check(!already.ok && /Ya tiene un certificado válido \(código /.test(already.error), "emitir de nuevo avisa «Ya tiene un certificado válido (código …): ¿reemplazarlo?»", JSON.stringify(already));
    check((await valid(T1, b)) === 1, "y no crea otro");
    const replaced = await generateOneCore(env, { templateId: T1, contactId: b, overrides: {}, publish: true, replaceExisting: true }, deps);
    check(replaced.ok && replaced.data.link === `${MAIN_URL}/d/${replaced.data.code}`, "con «reemplazarlo» confirmado, emite y devuelve el link con el dominio del negocio", JSON.stringify(replaced));
    if (replaced.ok) {
      const old = await row(bRow.id as string);
      check(old.status === "void" && old.void_reason === `Reemplazado por ${replaced.data.code}`, "la anterior queda anulada con «Reemplazado por <código nuevo>»", JSON.stringify([old.status, old.void_reason]));
      check((await valid(T1, b)) === 1, "queda una sola pieza válida por persona y plantilla");
      const fresh = await row(replaced.data.designId);
      check(fresh.published === true && !!fresh.published_at, "publicar con link la deja publicada (por publishDesignCore)");
      const publicRow = (await anon.rpc("design_public_get", { p_code: replaced.data.code })).data as { kind?: string; status?: string } | null;
      check(publicRow?.kind === "generation", "sin sesión, el link público devuelve la generación", JSON.stringify(publicRow));
      const { data: audit } = await raw.from("audit_log").select("action, metadata").eq("entity_id", replaced.data.designId);
      check((audit ?? []).some((e) => e.action === "design.generated") && (audit ?? []).some((e) => e.action === "design.published"), "quedan en el historial «design.generated» y «design.published»");
    }

    // ─── F55: si falta un dato ────────────────────────────────────────
    console.log("\n— F55: si falta un dato —");
    queue.length = 0;
    const missing = await createGeneration(svc, { workspaceId: t.id, templateId: T2, contactId: c, overrides: {}, policy: "fail", publish: false, source: "automation", sourceRef: { kind: "automation", flow_id: "00000000-0000-4000-8000-000000000000", session_id: "s", node_id: "n" }, actorUserId: null }, deps);
    check(missing.ok && missing.status === "failed" && missing.missing[0]?.key === "nombre_en_el_certificado", "«No generar y avisarme»: queda fallida y dice qué falta", JSON.stringify(missing));
    if (!missing.ok) throw new Error("no se creó la pieza fallida");
    const failedRow = await row(missing.designId);
    check(failedRow.status === "failed" && failedRow.error === "Falta: Nombre como lo quiere en el certificado" && queue.length === 0, "con «Falta: Nombre como lo quiere en el certificado», sin encolar ningún render");
    const { data: notices } = await raw.from("notifications").select("type, entity_type, entity_id").eq("workspace_id", t.id).eq("type", "design_generation_failed");
    check((notices ?? []).length >= 1 && (notices ?? []).every((n) => n.entity_type === "design_template" && n.entity_id === T2), "avisa en la campana (design_generation_failed, de la plantilla)");
    for (const policy of ["empty", "template_default"] as const) {
      const out2 = await createGeneration(svc, { workspaceId: t.id, templateId: T2, contactId: a, overrides: {}, policy, publish: false, source: "manual", sourceRef: { kind: "user", user_id: t.owner.id }, actorUserId: t.owner.id }, deps);
      check(out2.ok && out2.status === "queued", `con «${policy === "empty" ? "Dejarlo vacío" : "Usar el valor de la plantilla"}» genera igual`, JSON.stringify(out2));
      if (out2.ok) await raw.from("designs").update({ status: "void", void_reason: "zz-test" }).eq("id", out2.designId);
    }

    // ─── F54: reintentar ──────────────────────────────────────────────
    console.log("\n— F54: reintentar —");
    queue.length = 0;
    const needs = await retryGenerationCore(env, { designId: missing.designId }, deps);
    check(needs.ok && needs.data.needs?.[0]?.key === "nombre_en_el_certificado", "reintentar una falla de datos sin completarlos SIGUE pidiendo el dato", JSON.stringify(needs));
    const unchanged = await row(missing.designId);
    check(unchanged.status === "failed" && queue.length === 0, "y no cambia nada ni encola nada");
    const completed = await retryGenerationCore(env, { designId: missing.designId, values: { nombre_en_el_certificado: "Carla Díaz de Soto" } }, deps);
    const requeued = await row(missing.designId);
    check(completed.ok && !completed.data.needs && requeued.status === "queued" && (requeued.values as Record<string, string>).nombre_en_el_certificado === "Carla Díaz de Soto", "completado el dato, la pieza vuelve a la cola con ese valor", JSON.stringify(completed));
    check(requeued.code === failedRow.code && JSON.stringify(requeued.doc) === JSON.stringify(failedRow.doc), "con el mismo código y el mismo documento");
    check(queue.length === 1 && queue[0].designId === missing.designId && queue[0].purpose === "generation", "reintentar encola solo el render de esa pieza (nada de automatizaciones ni emails)");

    await raw.from("designs").update({ status: "failed", error: "No se pudo armar el PDF (tiempo agotado).", attempts: 4 }).eq("id", missing.designId);
    queue.length = 0;
    const all = await retryFailedGenerationsCore(env, { templateId: T2 }, deps);
    const retried = await row(missing.designId);
    check(all.ok && all.data.retried === 1 && all.data.needData === 0 && retried.status === "queued" && retried.attempts === 0, "«Reintentar las fallidas» reencola las de render", JSON.stringify(all));

    // ─── Lista y detalle con la sesión de la persona ──────────────────
    console.log("\n— Permisos: quién ve las generaciones —");
    const listArgs = { workspaceId: t.id, templateId: T1, filters: { estado: "todas" as const, q: "", page: 1 }, can: { generate: true }, timeZone: "UTC", linkFor: (code: string) => designPublicUrl(MAIN_URL, code) };
    const ownerList = await listGenerationsCore(t.owner.client, listArgs);
    check((ownerList?.rows.length ?? 0) >= 3 && ownerList?.counts.todas === ownerList?.rows.length, "el Owner ve las generaciones de la plantilla, con sus contadores", JSON.stringify(ownerList?.counts));
    const viewerList = await listGenerationsCore(t.viewer.client, listArgs);
    check((viewerList?.rows.length ?? 0) === (ownerList?.rows.length ?? -1), "un rol con SOLO designer.view también las ve (la RLS lee por designer.view)");
    const outsiderList = await listGenerationsCore(t.outsider.client, listArgs).catch(() => null);
    check(outsiderList === null, "quien no tiene ninguna clave del Diseñador no ve ni la plantilla (404)");
    const anyRow = ownerList!.rows[0];
    const detail = await generationDetailCore(t.viewer.client, { workspaceId: t.id, designId: anyRow.id, can: { generate: false }, timeZone: "UTC", linkFor: listArgs.linkFor });
    check(!!detail && detail.values.length > 0 && detail.canSendEmail === false, "el detalle muestra los valores usados y, sin designer.generate, no ofrece mandar el email");
    const { error: insertError } = await t.owner.client.from("designs").insert({ workspace_id: t.id, name: "zz-test directo", format: "carta_h", doc: certificateDoc(), origin: "blank" } as never);
    check(!!insertError, "nadie escribe `designs` desde el navegador (ni el Owner): las escribe el servidor", insertError?.message);
    await t.owner.client.from("designs").update({ status: "void", void_reason: "directo" }).eq("id", anyRow.id);
    check((await row(anyRow.id)).status !== "void" || anyRow.state.key === "void", "…ni cambia el estado de una pieza desde el navegador");

    console.log("\n— Aislamiento entre negocios —");
    const foreignContact = await createGeneration(svc, { workspaceId: t.id, templateId: T1, contactId: strangerContact!.id as string, overrides: {}, policy: "fail", publish: false, source: "manual", sourceRef: null, actorUserId: t.owner.id }, deps);
    check(!foreignContact.ok && foreignContact.reason === "error" && foreignContact.error === "El contacto ya no existe.", "un contacto de otro negocio no existe", JSON.stringify(foreignContact));
    const foreignTemplate = await createGeneration(svc, { workspaceId: t.id, templateId: strangerTemplate!.id as string, contactId: a, overrides: {}, policy: "fail", publish: false, source: "manual", sourceRef: null, actorUserId: t.owner.id }, deps);
    check(!foreignTemplate.ok && foreignTemplate.reason === "error", "una plantilla de otro negocio no existe", JSON.stringify(foreignTemplate));
    const { count: strangerRows } = await raw.from("designs").select("id", { count: "exact", head: true }).eq("workspace_id", strangerWs!.id);
    check(strangerRows === 0, "y no se crea nada en el otro negocio");

    // ─── El email ─────────────────────────────────────────────────────
    console.log("\n— El email de la pieza —");
    const sentMail: Record<string, unknown>[] = [];
    const sendSpy = (async (params: Record<string, unknown>) => (sentMail.push(params), { ok: true as const, id: "re_zz" })) as never;
    await raw.from("designs").update({ status: "ready" }).eq("id", missing.designId);
    await raw.from("designs").update({ subject_contact_id: a }).eq("id", missing.designId);
    const mail = await sendGenerationEmailCore(svc, { workspaceId: t.id, designId: missing.designId, userId: t.owner.id, subject: "Tu certificado, {{contact.first_name}}", body: "Acá: {{design.link}}" }, { send: sendSpy });
    check(mail.ok, "«Mandar el email ahora» sale por el envío transaccional", JSON.stringify(mail));
    const mailed = sentMail[0] as { category?: string; html?: string; to?: string; kind?: string } | undefined;
    check(mailed?.category === "transactional" && mailed?.kind === "design_generated", "con la categoría transaccional");
    check((mailed?.html ?? "").includes(`${MAIN_URL}/d/${requeued.code}`), "y el link es el del dominio del negocio (nunca el del navegador)", mailed?.html);
    check((await row(missing.designId)).email_status === "sent", "el estado del email queda en `sent`");
    const noEmail = await createGeneration(svc, { workspaceId: t.id, templateId: T1, contactId: c, overrides: {}, policy: "fail", publish: false, source: "manual", sourceRef: { kind: "user", user_id: t.owner.id }, actorUserId: t.owner.id, replaceExisting: true }, deps);
    if (noEmail.ok) {
      await raw.from("designs").update({ status: "ready" }).eq("id", noEmail.designId);
      const skipped = await sendGenerationEmailCore(svc, { workspaceId: t.id, designId: noEmail.designId, userId: t.owner.id, subject: "x", body: "y" }, { send: sendSpy });
      check(!skipped.ok && (await row(noEmail.designId)).email_status === "skipped", "un contacto sin email: no sale nada y queda «skipped»");
    }
  } finally {
    for (const path of await listAll(t.id).catch(() => [] as string[])) ctx.storagePaths.push({ bucket: BUCKET, path });
  }
}
