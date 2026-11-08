// @plantilla-quitar(servicios)
/**
 * verify-program · bloque ce (Certificados, F66-F69), contra la base real con el render SIMULADO
 * (`DESIGNER_FAKE_RENDER=1`, lo pone `verify-program.mjs`). Emitir, completar el paso cuando el Diseñador termina
 * (venga de donde venga: la ficha o una automatización), anular y volver a emitir, y un servicio cancelado (CE001).
 * Crea todo con prefijo `zz-test-` y lo borra al terminar.
 */
import { readFileSync } from "node:fs";

// `createServiceClient` lee el entorno: se carga el .env antes de importar el resto.
for (const l of readFileSync(".env", "utf8").split("\n")) {
  if (!l.trim() || l.startsWith("#") || !l.includes("=")) continue;
  const k = l.slice(0, l.indexOf("=")).trim();
  if (!process.env[k]) process.env[k] = l.slice(l.indexOf("=") + 1).trim();
}

const { runCleanup } = await import("../test-cleanup.mjs");
const { checkProtectedFunctions } = await import("../protected-functions.mjs");
const { check, counters, makeUser, minimalDoc, raw, sql: sqlOnce, svc } = await import("../verify-designer/helpers");
/** La CLI a veces no conecta (rol temporal): se reintenta hasta 5 veces antes de dar la consulta por fallida. */
const sql = (query: string): Array<Record<string, unknown>> => {
  for (let i = 0; ; i++) {
    try {
      return sqlOnce(query);
    } catch (error) {
      if (i >= 4) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 3000 * (i + 1));
    }
  }
};
const { runDesignRender } = await import("../../lib/designer/jobs/render");
const { createGeneration } = await import("../../lib/designer/generate-core");
const { registerServiceDesignExtensions } = await import("../../lib/services/certificate-extension");
const { issueCertificateCore, voidCertificateCore, serviceCertificates } = await import("../../lib/services/certificate-core");
const { certificateState, serviceSubjectRef } = await import("../../lib/services/certificate");

const lit = (v: string | null) => (v === null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

try {
  registerServiceDesignExtensions();
  const owner = await makeUser("ce-owner");
  const { data: ws } = await raw.from("workspaces").insert({ name: "zz-test-certificados", slug: `zz-test-certificados-${Date.now()}`, timezone: "UTC" }).select("id").single();
  const wsId = ws!.id as string;
  await raw.from("workspace_members").insert({ workspace_id: wsId, user_id: owner.id, role: "owner" });
  sql(`SELECT app_servicio.set_module_enabled(${lit(wsId)}, true)`);
  const { data: tpl } = await raw
    .from("design_templates")
    .insert({ workspace_id: wsId, name: "zz-test certificado", format: "carta_h", doc: minimalDoc("carta_h"), origin: "blank", verify: true, doc_type: "certificado" })
    .select("id")
    .single();
  const { data: prod } = await raw.from("products").insert({ workspace_id: wsId, name: "zz-test Programa", product_type: "programa" }).select("id").single();
  const { data: variant } = await raw.from("product_variants").insert({ workspace_id: wsId, product_id: prod!.id, name: "zz-test Completa", price: 1000, duration_type: "months", duration_value: 3 }).select("id").single();
  const journey = { v: 1, phases: [{ key: "ph_cierr1", name: "Cierre", advance: "manual", items: [{ key: "it_certi1", kind: "certificate", name: "Certificado", ref: { template_id: tpl!.id, auto_issue: false } }] }] };
  sql(`UPDATE public.product_variants SET journey_template = '${JSON.stringify(journey).replace(/'/g, "''")}'::jsonb, journey_template_rev = journey_template_rev + 1 WHERE id = ${lit(variant!.id as string)}`);
  const mkContact = async (t: string) => (await raw.from("contacts").insert({ workspace_id: wsId, display_name: `zz-test ${t}`, email: `zz-test-ce-${t}-${Date.now()}@example.test` }).select("id").single()).data!.id as string;
  const mkService = (contactId: string) =>
    sql(`SELECT app_servicio.svc_create_service(jsonb_build_object('contact_id', ${lit(contactId)}, 'variant_id', ${lit(variant!.id as string)}, 'origin', 'manual', 'origin_reason', 'zz-test', 'owner_user_id', ${lit(owner.id)})) id`)[0]?.id as string;
  const itemStatus = (serviceId: string) => sql(`SELECT status FROM app_servicio.service_items WHERE service_id = ${lit(serviceId)} AND kind = 'certificate'`)[0]?.status;

  console.log("\nce · Emitir (F67)");
  const s1 = mkService(await mkContact("a"));
  const first = await issueCertificateCore(svc, { workspaceId: wsId, serviceId: s1, actorUserId: owner.id });
  const second = await issueCertificateCore(svc, { workspaceId: wsId, serviceId: s1, actorUserId: owner.id });
  check(first.ok && !first.existing, "emite el certificado con la plantilla del paso", JSON.stringify(first));
  check(second.ok && second.existing && first.ok && second.designId === first.designId, "emitir dos veces devuelve el existente (uno vigente por servicio)", JSON.stringify(second));
  const { data: gen } = await raw.from("designs").select("values, subject_ref, source").eq("id", first.ok ? first.designId : "").single();
  const values = (gen?.values ?? {}) as Record<string, string>;
  check(values["service.product"] === "zz-test Programa" && values["service.variant"] === "zz-test Completa", "las variables del grupo Servicio se resuelven con el servicio", JSON.stringify(values));
  check((gen?.subject_ref as { id?: string } | null)?.id === s1, "el sujeto de la generación es el servicio");
  check(itemStatus(s1) === "pending", "el paso sigue pendiente hasta que el Diseñador termina");

  console.log("\nce · El paso se completa solo (F68)");
  await runDesignRender(svc, { designId: first.ok ? first.designId : "", purpose: "generation" });
  check(itemStatus(s1) === "completed", "al quedar listo, el paso Certificado se completa");
  check(Number(sql(`SELECT count(*)::int n FROM public.automation_events WHERE event_type = 'certificate_issued' AND (payload->>'service_id') = ${lit(s1)}`)[0]?.n) === 1, "y emite certificate_issued");

  const s2 = mkService(await mkContact("b"));
  const fromFlow = await createGeneration(svc, {
    workspaceId: wsId,
    templateId: tpl!.id as string,
    contactId: null,
    subjectRef: serviceSubjectRef(s2, "zz-test Programa"),
    overrides: {},
    policy: "template_default",
    publish: true,
    source: "automation",
    sourceRef: { kind: "automation", flow_id: "00000000-0000-4000-8000-000000000001", session_id: "00000000-0000-4000-8000-000000000002", node_id: "n1" },
    actorUserId: null,
  });
  check(fromFlow.ok, "una automatización genera el certificado (no el paso)", JSON.stringify(fromFlow));
  if (fromFlow.ok) await runDesignRender(svc, { designId: fromFlow.designId, purpose: "generation" });
  check(itemStatus(s2) === "completed", "generarlo desde una automatización también completa el paso");

  console.log("\nce · Anular y volver a emitir (F69)");
  const voided = await voidCertificateCore(svc, { workspaceId: wsId, serviceId: s1, userId: owner.id, reason: "zz-test nombre mal escrito" });
  const before = await serviceCertificates(svc, wsId, s1);
  check(voided.ok, "anular con motivo", `${JSON.stringify(voided)} · ${JSON.stringify(before.map((d) => [d.id === (first.ok ? first.designId : ""), d.status]))}`);
  check(certificateState(await serviceCertificates(svc, wsId, s1)).current === null, "anulado, no queda ninguno vigente");
  const again = await issueCertificateCore(svc, { workspaceId: wsId, serviceId: s1, actorUserId: owner.id });
  const list = await serviceCertificates(svc, wsId, s1);
  check(again.ok && !again.existing && list.filter((d) => ["queued", "rendering", "ready"].includes(d.status)).length === 1 && list.some((d) => d.status === "void"), "volver a emitir deja uno solo vigente y el anterior anulado", JSON.stringify(list.map((d) => d.status)));

  console.log("\nce · Un servicio cancelado no emite (CE001)");
  const s3 = mkService(await mkContact("c"));
  sql(`SELECT app_servicio.svc_cancel(${lit(s3)}, 'zz-test')`);
  const cancelled = await issueCertificateCore(svc, { workspaceId: wsId, serviceId: s3, actorUserId: owner.id });
  check(!cancelled.ok && cancelled.code === "CE001", "un servicio cancelado no puede emitir (CE001)", JSON.stringify(cancelled));

  console.log("\nHuellas de las funciones protegidas");
  checkProtectedFunctions(sql, check);
} catch (error) {
  counters.failures++;
  console.error("  FALLA el bloque ce se cortó", error instanceof Error ? error.stack?.split("\n").slice(0, 3).join(" | ") : String(error));
} finally {
  if (!(await runCleanup(svc))) counters.failures++;
  console.log(`\n${counters.oks}/${counters.oks + counters.failures} ok`);
  process.exitCode = counters.failures > 0 ? 1 : 0;
}
