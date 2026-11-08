/**
 * verify-designer · bloque ds0 (F1, F2, F3, F6 limpieza, V1–V5): lo que solo se prueba contra la base real.
 *
 * - Buckets privados: sin sesión no se baja nada; con sesión, solo quien tiene `designer.view`; nadie sube con la sesión.
 * - Permisos: el Member de sistema tiene `designer.view` y `designer.edit` y NO `designer.publish` (M12).
 * - RLS de las tablas con Owner, Member, un rol con solo `designer.view` y uno sin nada del Diseñador; sin escritura con la sesión.
 * - 2000 códigos únicos y con el formato.
 * - Gemelas SQL↔TS: `validate_design_doc`, `validate_design_settings` y los CHECK de verificación (V1, V2).
 * - `design_public_get`: vacío si no existe o es borrador; nunca devuelve el workspace, emails, teléfonos ni ids del sujeto.
 * - `ai_threads` por canal (V5) y su único parcial; la fusión de contactos; la limpieza diaria; el CHECK de `agent_runs.source`.
 */

import docCases from "../../lib/designer/doc/doc.cases.json";
import settingsCases from "../../lib/designer/settings.cases.json";
import verificationCases from "../../lib/designer/verification.cases.json";
import { parseDesignDoc } from "../../lib/designer/doc/schema";
import { parseDesignSettings } from "../../lib/designer/settings-schema";
import { validateTemplateVerification } from "../../lib/designer/verification";
import { anon, check, makeUser, makeWorkspace, minimalDoc, raw, sql, svc, type BlockContext } from "./helpers";

const CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

export default async function ds0(ctx: BlockContext): Promise<void> {
  console.log("\n— Preparación —");
  const t = await makeWorkspace("ds0");

  // ─── Permisos (F1, M12) ─────────────────────────────────────────────────
  console.log("\n— Permisos del Member (cambio aprobado M12) —");
  const keys = sql(`select private.member_permission_keys() as k`)[0]?.k as string[] | string;
  const keyList = Array.isArray(keys) ? keys : String(keys).replace(/[{}]/g, "").split(",");
  check(keyList.includes("designer.view") && keyList.includes("designer.edit"), "member_permission_keys() incluye designer.view y designer.edit");
  check(!keyList.includes("designer.publish") && !keyList.includes("designer.generate") && !keyList.includes("designer.manage"), "…y no publish, generate ni manage");
  const can = async (u: typeof t.owner, key: string) => ((await (u.client as unknown as typeof raw).rpc("has_permission", { p_workspace_id: t.id, p_key: key })).data as unknown) === true;
  check(await can(t.member, "designer.view"), "un Member tiene designer.view");
  check(await can(t.member, "designer.edit"), "un Member tiene designer.edit");
  check(!(await can(t.member, "designer.publish")), "un Member NO tiene designer.publish");
  check(await can(t.owner, "designer.manage"), "el Owner tiene designer.manage");
  check(!(await can(t.outsider, "designer.view")), "un rol sin claves del Diseñador no tiene designer.view");

  // ─── Buckets privados (F1) ──────────────────────────────────────────────
  console.log("\n— Buckets privados —");
  const buckets = sql(`select id, public from storage.buckets where id in ('design-assets','design-renders') order by id`);
  check(buckets.length === 2 && buckets.every((b) => b.public === false), "design-assets y design-renders existen y son privados", JSON.stringify(buckets));
  const renderPath = `${t.id}/zz-test-design/1/page-01.png`;
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const up = await raw.storage.from("design-renders").upload(renderPath, png, { contentType: "image/png", upsert: true });
  check(!up.error, "el servidor sube a design-renders", up.error?.message);
  ctx.storagePaths.push({ bucket: "design-renders", path: renderPath });
  const anonDownload = await anon.storage.from("design-renders").download(renderPath);
  check(!!anonDownload.error, "sin sesión, la API de Storage NO devuelve un objeto de design-renders");
  const anonSigned = await anon.storage.from("design-renders").createSignedUrl(renderPath, 60);
  check(!!anonSigned.error, "sin sesión, tampoco se puede firmar un link");
  check(!(await t.member.client.storage.from("design-renders").createSignedUrl(renderPath, 60)).error, "un Member (designer.view) lo puede leer");
  check(!!(await t.outsider.client.storage.from("design-renders").createSignedUrl(renderPath, 60)).error, "un rol sin designer.view NO lo puede leer");
  const ownerUpload = await t.owner.client.storage.from("design-assets").upload(`${t.id}/images/zz-test.png`, png, { contentType: "image/png" });
  check(!!ownerUpload.error, "nadie sube con la sesión (ni el Owner): sube solo el servidor");

  // ─── Tablas y RLS (F2) ──────────────────────────────────────────────────
  console.log("\n— Tablas y RLS —");
  const { data: tpl, error: tplError } = await raw
    .from("design_templates")
    .insert({ workspace_id: t.id, name: "zz-test plantilla", format: "carta_h", doc: minimalDoc("carta_h"), origin: "blank", verify: true, doc_type: "certificado" })
    .select("id")
    .single();
  check(!tplError, "el servidor crea una plantilla con verificación", tplError?.message);
  const { data: design, error: designError } = await raw.from("designs").insert({ workspace_id: t.id, name: "zz-test diseño", format: "v45", doc: minimalDoc(), origin: "blank" }).select("id, code, status").single();
  check(!designError, "el servidor crea un diseño", designError?.message);
  check(CODE_RE.test(design?.code ?? ""), "el diseño nace con un código de 12 caracteres en tres grupos", design?.code);
  check(design?.status === "draft", "y en borrador");
  const sees = async (u: typeof t.owner, table: "designs" | "design_templates") => ((await u.client.from(table).select("id").eq("workspace_id", t.id)).data ?? []).length;
  check((await sees(t.owner, "designs")) === 1 && (await sees(t.owner, "design_templates")) === 1, "el Owner ve el diseño y la plantilla");
  check((await sees(t.member, "designs")) === 1, "el Member ve el diseño (designer.view)");
  check((await sees(t.viewer, "design_templates")) === 1, "un rol con solo designer.view ve la plantilla");
  check((await sees(t.outsider, "designs")) === 0 && (await sees(t.outsider, "design_templates")) === 0, "un rol sin designer.view no ve nada");
  const stranger = await makeUser("ds0-ajeno");
  check(((await stranger.client.from("designs").select("id").eq("workspace_id", t.id)).data ?? []).length === 0, "alguien de otro negocio no ve nada");
  const ownerInsert = await t.owner.client.from("designs").insert({ workspace_id: t.id, name: "x", format: "v45", doc: minimalDoc(), origin: "blank" });
  check(!!ownerInsert.error, "nadie escribe con la sesión (ni el Owner): escriben las Server Actions con el cliente de servicio");
  const badDoc = await raw.from("designs").insert({ workspace_id: t.id, name: "x", format: "v45", doc: { v: 1, format: "v45", pages: [] }, origin: "blank" });
  check(!!badDoc.error, "un documento sin páginas se rechaza en la base");
  const wrongFormat = await raw.from("designs").insert({ workspace_id: t.id, name: "x", format: "sq", doc: minimalDoc("v45"), origin: "blank" });
  check(!!wrongFormat.error, "un documento con otro formato que la fila se rechaza");

  // ─── Códigos (F2) ───────────────────────────────────────────────────────
  console.log("\n— 2000 códigos —");
  const codes = sql(`select array_agg(c) as codes from (select private.design_new_code() as c from generate_series(1, 2000)) s`)[0]?.codes as string[] | string;
  const codeList = Array.isArray(codes) ? codes : String(codes).replace(/[{}]/g, "").split(",");
  check(codeList.length === 2000, "se generaron 2000");
  check(new Set(codeList).size === 2000, "los 2000 son únicos");
  check(codeList.every((c) => CODE_RE.test(c)), "todos respetan el formato (Crockford base32, tres grupos)");

  // ─── Gemelas SQL ↔ TS ───────────────────────────────────────────────────
  console.log("\n— Gemelas SQL ↔ TS —");
  let docMismatch = 0;
  for (const c of docCases) {
    const { data } = await svc.rpc("validate_design_doc", { p: c.doc as never });
    if (data !== c.sql) {
      docMismatch++;
      console.error(`        doc «${c.name}»: base ${data} / esperado ${c.sql}`);
    }
    if (parseDesignDoc(c.doc).ok !== c.valid) docMismatch++;
  }
  check(docMismatch === 0, `validate_design_doc da lo esperado en los ${docCases.length} casos de doc.cases.json`);
  let settingsMismatch = 0;
  for (const c of settingsCases) {
    const { data } = await svc.rpc("validate_design_settings", { p: c.settings as never });
    if (data !== c.sql) {
      settingsMismatch++;
      console.error(`        ajustes «${c.name}»: base ${data} / esperado ${c.sql}`);
    }
    if (parseDesignSettings(c.settings).ok !== c.valid) settingsMismatch++;
  }
  check(settingsMismatch === 0, `validate_design_settings da lo esperado en los ${settingsCases.length} casos de settings.cases.json`);
  const badSettings = await raw.from("workspaces").update({ design_settings: { palette: ["rojo"] } }).eq("id", t.id);
  check(!!badSettings.error, "el trigger rechaza ajustes mal formados");
  let verifyMismatch = 0;
  for (const c of verificationCases) {
    const format = c.input.format;
    const docFormat = format === "web" ? "web" : format;
    const { error } = await raw
      .from("design_templates")
      .insert({ workspace_id: t.id, name: `zz-test ${c.name}`, format, doc: minimalDoc(docFormat), origin: "blank", verify: c.input.verify, doc_type: c.input.doc_type, doc_type_label: c.input.doc_type_label });
    const dbValid = !error;
    const tsValid = validateTemplateVerification(c.input).length === 0;
    if (dbValid !== c.valid || tsValid !== c.valid) {
      verifyMismatch++;
      console.error(`        verificación «${c.name}»: base ${dbValid} / ts ${tsValid} / esperado ${c.valid}`);
    }
  }
  check(verifyMismatch === 0, `los CHECK de verificación (V1, V2) y validateTemplateVerification coinciden en los ${verificationCases.length} casos`);

  // ─── Lectura pública (F2, F43) ──────────────────────────────────────────
  console.log("\n— design_public_get —");
  check((await anon.rpc("design_public_get", { p_code: "AAAA-BBBB-CCCC" })).data === null, "un código inexistente devuelve vacío");
  check((await anon.rpc("design_public_get", { p_code: design!.code })).data === null, "un borrador devuelve vacío");
  await raw.from("designs").update({ published: true, status: "ready", published_at: new Date().toISOString() }).eq("id", design!.id);
  const pub = (await anon.rpc("design_public_get", { p_code: design!.code.toLowerCase() })).data as Record<string, unknown> | null;
  check(!!pub && pub.code === design!.code, "un diseño publicado se lee sin sesión (el código no distingue mayúsculas)");
  check(!!pub && !("workspace_id" in pub) && !JSON.stringify(pub).includes(t.id), "nunca devuelve el workspace");

  const { data: contact } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: "zz-test Persona", email: `zz-test-sujeto-${Date.now()}@example.test`, phone: "+5491100000000" }).select("id, email").single();
  const { data: gen } = await raw
    .from("designs")
    .insert({ workspace_id: t.id, name: "zz-test generación", format: "carta_h", doc: minimalDoc("carta_h"), origin: "template", template_id: tpl!.id, subject_contact_id: contact!.id, values: { "contact.display_name": "zz-test Persona" }, status: "ready", source: "manual" })
    .select("id, code")
    .single();
  const genPub = (await anon.rpc("design_public_get", { p_code: gen!.code })).data as Record<string, unknown> | null;
  const genJson = JSON.stringify(genPub);
  check(!!genPub && genPub.verify === true && genPub.doc_type === "certificado", "una generación de una plantilla que verifica se lee aunque no esté publicada, con su tipo");
  check(!genJson.includes(contact!.email as string) && !genJson.includes("5491100000000") && !genJson.includes(contact!.id) && !genJson.includes(t.id), "nunca devuelve el email, el teléfono, el id del sujeto ni el workspace");
  await raw.from("designs").update({ status: "void", void_reason: "zz-test motivo", voided_at: new Date().toISOString() }).eq("id", gen!.id);
  const voided = (await anon.rpc("design_public_get", { p_code: gen!.code })).data as Record<string, unknown> | null;
  check(voided?.status === "void" && voided?.void_reason === "zz-test motivo", "una generación anulada muestra «anulado» y su motivo");
  const noReason = await raw.from("designs").update({ status: "void", void_reason: null }).eq("id", gen!.id);
  check(!!noReason.error, "anular sin motivo se rechaza en la base");

  // ─── ai_threads por canal (V5) ──────────────────────────────────────────
  console.log("\n— ai_threads / ai_messages por canal —");
  const { data: otherWs } = await raw.from("workspaces").insert({ name: "zz-test-designer-otro", slug: `zz-test-designer-otro-${Date.now()}`, timezone: "UTC" }).select("id").single();
  const threads = await raw
    .from("ai_threads")
    .insert([
      { workspace_id: t.id, channel: "designer", subject_type: "design", subject_id: design!.id },
      { workspace_id: t.id, channel: "assistant", user_id: t.member.id },
      { workspace_id: t.id, channel: "assistant", user_id: t.owner.id },
      { workspace_id: t.id, channel: "portal", contact_id: contact!.id },
      { workspace_id: otherWs!.id, channel: "assistant", user_id: t.member.id },
    ])
    .select("id, channel, user_id, workspace_id");
  check(!threads.error && threads.data?.length === 5, "el servidor crea hilos de los tres canales", threads.error?.message);
  const [designerT, memberAssistant, ownerAssistant, portalT, foreignAssistant] = threads.data ?? [];
  await raw.from("ai_messages").insert([
    { workspace_id: t.id, thread_id: designerT.id, role: "user", content: "zz-test pedido" },
    { workspace_id: t.id, thread_id: ownerAssistant.id, role: "user", content: "zz-test del owner" },
  ]);
  const visible = async (u: typeof t.owner) => new Set(((await u.client.from("ai_threads").select("id")).data ?? []).map((r) => r.id as string));
  const memberSees = await visible(t.member);
  check(memberSees.has(designerT.id), "un Member con designer.view ve el hilo del Diseñador IA");
  check(memberSees.has(memberAssistant.id), "…y su propio hilo del asistente");
  check(!memberSees.has(ownerAssistant.id), "…pero NO el hilo del asistente de otra persona");
  check(!memberSees.has(portalT.id), "nadie ve un hilo del portal (todavía sin política)");
  check(!memberSees.has(foreignAssistant.id), "un hilo del asistente suyo pero de un negocio del que no es miembro NO se ve");
  check(!(await visible(t.outsider)).has(designerT.id), "un rol sin designer.view no ve el hilo del Diseñador IA");
  const memberMessages = ((await t.member.client.from("ai_messages").select("id, content")).data ?? []).map((m) => m.content);
  check(memberMessages.includes("zz-test pedido") && !memberMessages.includes("zz-test del owner"), "los mensajes siguen la regla de su hilo");
  const dupThread = await raw.from("ai_threads").insert({ workspace_id: t.id, channel: "designer", subject_type: "design", subject_id: design!.id });
  check(dupThread.error?.code === "23505", "un segundo hilo del Diseñador para el mismo diseño se rechaza (único parcial)");
  check(!!(await t.owner.client.from("ai_messages").insert({ workspace_id: t.id, thread_id: designerT.id, role: "user", content: "x" })).error, "nadie escribe mensajes con la sesión");

  // ─── Fusión de contactos ────────────────────────────────────────────────
  console.log("\n— Fusión de contactos —");
  const { data: main } = await raw.from("contacts").insert({ workspace_id: t.id, display_name: "zz-test Principal", email: `zz-test-principal-${Date.now()}@example.test` }).select("id").single();
  await raw.from("contacts").update({ deleted_at: new Date().toISOString(), metadata: { merged_into: main!.id } }).eq("id", contact!.id);
  const { data: moved } = await raw.from("designs").select("subject_contact_id").eq("id", gen!.id).single();
  const { data: movedThread } = await raw.from("ai_threads").select("contact_id").eq("id", portalT.id).single();
  check(moved?.subject_contact_id === main!.id, "al fusionar, la generación pasa al contacto principal");
  check(movedThread?.contact_id === main!.id, "…y el hilo del contacto también");

  // ─── Limpieza diaria (F48b) y origen de corridas (F3) ───────────────────
  console.log("\n— Limpieza diaria y agent_runs —");
  const oldAt = new Date(Date.now() - 40 * 86_400_000).toISOString();
  const jobsFor = () => Number(sql(`select count(*)::int as n from public.scheduled_jobs where type = 'design_cleanup' and payload->>'workspace_id' = '${t.id}'`)[0]?.n ?? 0);
  sql(`select private.enqueue_design_cleanup(now())`);
  check(jobsFor() === 0, "sin candidatas, no encola nada para ese negocio");
  const v1 = await raw.from("design_versions").insert({ workspace_id: t.id, design_id: design!.id, doc: minimalDoc(), reason: "manual", author_kind: "user", created_at: oldAt });
  check(!v1.error, "se guarda una versión (el trigger del documento no rompe en design_versions)", v1.error?.message);
  sql(`select private.enqueue_design_cleanup(now())`);
  check(jobsFor() === 0, "una versión vieja que es la ACTUAL de su pieza no cuenta como candidata (00322)");
  await raw.from("design_versions").insert({ workspace_id: t.id, design_id: design!.id, doc: minimalDoc(), reason: "manual", author_kind: "user" });
  const enqueued = Number(sql(`select private.enqueue_design_cleanup(now()) as n`)[0]?.n ?? 0);
  check(enqueued >= 1 && jobsFor() === 1, "con una versión vieja que ya no es la actual, encola un design_cleanup para ese negocio");
  check(Number(sql(`select private.enqueue_design_cleanup(now()) as n`)[0]?.n ?? -1) === 0, "el mismo día no lo encola dos veces");
  sql(`delete from public.scheduled_jobs where type = 'design_cleanup' and payload->>'workspace_id' = '${t.id}'`);
  check(sql(`select count(*)::int as n from cron.job where jobname = 'design-cleanup'`)[0]?.n === 1, "el cron diario design-cleanup está programado");
  const checkDef = String(sql(`select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'agent_runs_source_check'`)[0]?.d ?? "");
  check(checkDef.includes("'designer'") && checkDef.includes("'call_prompt_test'"), "el CHECK de agent_runs.source suma 'designer' y conserva los demás");
}
