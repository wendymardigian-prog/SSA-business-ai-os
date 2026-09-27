/**
 * Que un post programado se publique, contra la base real (A, D11).
 *
 * Esto es lo que ningun test con vitest podia probar: que la fila, el job,
 * el estado de la pieza y la automatizacion se muevan juntos. Cuando la
 * Etapa 2 cerro, los 237 tests de publicacion estaban en verde y **no se
 * publicaba nada**.
 *
 * Base real, proveedores simulados: no se llama a Zernio, no se conecta
 * ninguna cuenta y no se publica nada en ningun lado. El publicador se
 * registra a mano con una version de mentira que anota lo que le piden.
 *
 * Crea todo con prefijo `zz-test-` y lo borra al terminar. Una limpieza que
 * falla es un test fallido.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { runCleanup } from "./test-cleanup.mjs";
import type { Database } from "../lib/types/database";
import { registerPublisher, resetPublishers } from "../lib/publishing/registry";
import { runScheduleNetworks, runUnscheduleNetwork } from "../lib/publishing/schedule-core";
import { runProviderSchedule } from "../lib/publishing/provider-dispatch";
import { runPublication } from "../lib/publishing/dispatcher";
import { settlePublication } from "../lib/publishing/inbound";
import { reconcileProviderSchedules } from "../lib/publishing/reconcile";
import type { Publisher, ProviderScheduler } from "../lib/publishing/types";

const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.startsWith("#") && l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
);

const svc = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
}) as SupabaseClient<Database>;

let failures = 0;
const ok = (m: string) => console.log("  ok  ", m);
const fail = (m: string, extra?: string) => {
  console.error("  FALLA", m, extra ? `\n        ${extra}` : "");
  failures++;
};
const check = (cond: unknown, m: string, extra?: string) => (cond ? ok(m) : fail(m, extra));

// ── El proveedor simulado ─────────────────────────────────────────────────

interface FakeCalls {
  create: Array<{ at: string; timezone: string; requestId: string; now?: boolean }>;
  update: Array<{ ref: string; at: string }>;
  cancel: string[];
  retry: string[];
  publish: number;
}

function fakeZernio(calls: FakeCalls, refs: string[]): Publisher {
  let next = 0;
  const scheduler: ProviderScheduler = {
    async create(request) {
      calls.create.push({
        at: request.at,
        timezone: request.timezone,
        requestId: request.requestId,
        now: request.now,
      });
      return { ref: refs[next++] ?? `zp-${next}` };
    },
    async update(request) {
      calls.update.push({ ref: request.ref, at: request.at });
    },
    async cancel({ ref }) {
      calls.cancel.push(ref);
    },
    async retry({ ref }) {
      calls.retry.push(ref);
    },
  };

  return {
    id: "zernio" as Publisher["id"],
    platforms: ["instagram", "tiktok"],
    async publish() {
      calls.publish++;
      return { status: "processing", ref: "zp-inmediato" };
    },
    async getStatus({ ref }) {
      return { status: "published", externalId: `ig-${ref}`, externalUrl: `https://ig.test/${ref}`, ref };
    },
    scheduler,
    uploadsMedia: true,
  };
}

/** Un publicador de los que SI pasan por el despachador (D10). */
function fakeLinkedin(published: { count: number }): Publisher {
  return {
    id: "linkedin_api" as Publisher["id"],
    platforms: ["linkedin"],
    async publish() {
      published.count++;
      return {
        status: "published",
        externalId: "li-1",
        externalUrl: "https://linkedin.test/li-1",
        ref: "li-1",
      };
    },
  };
}

/** Nunca sale a la red: devuelve bytes de mentira. */
const fakeFetch = (async (_url: unknown, init?: RequestInit) => ({
  ok: true,
  status: 200,
  arrayBuffer: async () => new ArrayBuffer(4),
  json: async () => ({}),
  text: async () => "",
  _init: init,
})) as unknown as typeof fetch;

const zernioMediaClient = () => ({
  media: {
    async getMediaPresignedUrl() {
      return {
        data: {
          uploadUrl: "https://up.zernio.test/x",
          publicUrl: "https://cdn.zernio.test/x.mp4",
        },
      };
    },
  },
});

const deps = {
  signMedia: async (paths: string[]) => paths.map((p) => `https://storage.test/${p}`),
  credentialsFor: async () => ({ token: "clave-de-mentira" }),
  zernioClientFor: () => zernioMediaClient(),
  fetchImpl: fakeFetch,
};

// ── Datos de prueba ───────────────────────────────────────────────────────

const enUnaHora = () => new Date(Date.now() + 60 * 60_000).toISOString();

/** Un insert de preparacion que falla deja el test sin sentido: se corta. */
async function must(
  query: PromiseLike<{ data: unknown; error: { message: string } | null }>,
  what: string,
): Promise<{ id: string }> {
  const { data, error } = await query;
  if (error || !data) throw new Error(`no pude crear ${what}: ${error?.message ?? "sin datos"}`);
  return data as { id: string };
}

const MEDIA = [
  { storage_path: "zz/p/video.mp4", mime_type: "video/mp4", kind: "video", size_bytes: 1024 },
];

const TIKTOK_OPTIONS = {
  mode: "public",
  privacyLevel: "PUBLIC_TO_EVERYONE",
  contentPreviewConfirmed: true,
  expressConsentGiven: true,
};

async function makeUser(tag: string) {
  const email = `zz-test-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.test`;
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password: randomUUID(),
    email_confirm: true,
  });
  if (error) throw new Error(`no pude crear usuario ${tag}: ${error.message}`);
  return data.user.id;
}

async function seedWorkspace() {
  const { data, error } = await svc
    .from("workspaces")
    .insert({
      name: "zz-test-publicacion",
      slug: `zz-test-pub-${Date.now()}`,
      timezone: "America/Costa_Rica",
    })
    .select("id")
    .single();
  if (error) throw new Error(`no pude crear el workspace: ${error.message}`);
  return data.id;
}

async function seedAccount(
  workspaceId: string,
  platform: Database["public"]["Tables"]["social_accounts"]["Insert"]["platform"],
  externalId: string,
  publisher: string,
) {
  const { data, error } = await svc
    .from("social_accounts")
    .insert({
      workspace_id: workspaceId,
      platform,
      external_id: externalId,
      is_active: true,
      default_publisher: publisher,
      publishers: [{ publisher, account_ref: externalId, status: "available" }] as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(`no pude crear la cuenta de ${platform}: ${error.message}`);
  return data.id;
}

async function seedPost(
  workspaceId: string,
  userId: string,
  networks: unknown[],
  title = "zz-test pieza",
) {
  const { data, error } = await svc
    .from("content_posts")
    .insert({
      workspace_id: workspaceId,
      created_by: userId,
      title,
      status: "approved",
      caption: "Un caption de prueba",
      media: MEDIA as never,
      networks: networks as never,
    })
    .select("id")
    .single();
  if (error) throw new Error(`no pude crear la pieza: ${error.message}`);
  return data.id;
}

const rowsOf = async (postId: string) =>
  (
    await svc
      .from("social_posts")
      .select("id, platform, status, publisher, publisher_ref, external_post_id, url, scheduled_at")
      .eq("content_post_id", postId)
  ).data ?? [];

const postStatus = async (postId: string) =>
  (await svc.from("content_posts").select("status").eq("id", postId).maybeSingle()).data?.status;

/** La base devuelve "+00:00" y nosotros mandamos "Z": es el mismo instante. */
const mismoInstante = (a: string | null | undefined, b: string) =>
  Boolean(a) && new Date(a!).getTime() === new Date(b).getTime();

const pendingJobs = async (socialPostId: string) =>
  (
    await svc
      .from("scheduled_jobs")
      .select("id, type, run_at, status")
      .eq("status", "pending")
      .contains("payload", { socialPostId })
  ).data ?? [];

// ── La corrida ────────────────────────────────────────────────────────────

const calls: FakeCalls = { create: [], update: [], cancel: [], retry: [], publish: 0 };
const linkedinPublished = { count: 0 };

try {
  resetPublishers();
  registerPublisher(fakeZernio(calls, ["zp-ig", "zp-tt"]));
  registerPublisher(fakeLinkedin(linkedinPublished));

  const ws = await seedWorkspace();
  const owner = await makeUser("owner");
  await svc.from("workspace_members").insert({ workspace_id: ws, user_id: owner.valueOf(), role: "owner" });

  const igAccount = await seedAccount(ws, "instagram", "zz-ig-acc", "zernio");
  await seedAccount(ws, "tiktok", "zz-tt-acc", "zernio");

  // Una automatizacion por comentario limitada a posts puntuales: es la que
  // tiene que quedar completa al publicar (F39, A6).
  const flow = await must(
    svc
      .from("flows")
      .insert({ workspace_id: ws, name: "zz-test flow", nodes: [] as never, edges: [] as never })
      .select("id")
      .single(),
    "flow",
  );

  const channel = await must(
    svc
    .from("channels")
    .insert({
      workspace_id: ws,
      platform: "instagram",
      provider: "zernio",
      late_account_id: "zz-ig-acc",
      username: "zz-test",
    })
    .select("id")
    .single(),
    "canal",
  );

  await svc.from("social_accounts").update({ channel_id: channel.id }).eq("id", igAccount);

  const trigger = await must(
    svc
    .from("triggers")
    .insert({
      workspace_id: ws,
      flow_id: flow.id,
      type: "comment_keyword",
      is_active: true,
      channel_id: channel.id,
      config: { keywords: [{ value: "SISTEMA" }], postIds: ["zz-anterior"] } as never,
    })
    .select("id")
    .single(),
    "trigger",
  );

  const ctx = {
    workspaceId: ws,
    userId: owner,
    supabase: svc,
    service: svc,
    canPublish: true,
    credentialsFor: deps.credentialsFor,
  };

  // ── 1. Programar Instagram y TikTok ────────────────────────────────────
  console.log("\n— Programar (A1, A16, A20, D1) —");

  const at = enUnaHora();
  const post = await seedPost(ws, owner, [
    {
      platform: "instagram",
      planned_at: at,
      options: { contentType: "reel" },
      cta: { type: "comment", keyword: "SISTEMA" },
    },
    { platform: "tiktok", planned_at: at, options: TIKTOK_OPTIONS },
  ]);

  const scheduled = await runScheduleNetworks(ctx, { postId: post });
  check(scheduled.ok, "programar las dos redes sale bien", !scheduled.ok ? scheduled.error : undefined);

  const filas = await rowsOf(post);
  check(filas.length === 2, "hay una fila por red", `hay ${filas.length}`);
  check(
    filas.every((f) => f.publisher === "zernio"),
    "A1 · la fila toma el publicador de la cuenta, aunque la red no lo traiga",
    JSON.stringify(filas.map((f) => f.publisher)),
  );
  check(
    filas.every((f) => f.status === "uploading"),
    "D1 · quedan esperando que se les suba la media, no 'programadas'",
    JSON.stringify(filas.map((f) => f.status)),
  );

  const jobsIg = await pendingJobs(filas.find((f) => f.platform === "instagram")!.id);
  check(
    jobsIg.length === 1 && jobsIg[0].type === "content_provider_schedule",
    "D1 · el job es el que le entrega el post a Zernio, no el que publica",
    JSON.stringify(jobsIg.map((j) => j.type)),
  );

  // ── 2. Correr el job, como lo haria el cron ────────────────────────────
  console.log("\n— Entregarle el post a Zernio (D1, D5, D7) —");

  for (const fila of filas) {
    const outcome = await runProviderSchedule(svc, fila.id, deps as never);
    check(outcome.kind === "scheduled", `${fila.platform}: queda agendado en Zernio`, outcome.detail);
  }

  const agendadas = await rowsOf(post);
  check(
    agendadas.every((f) => f.status === "scheduled" && f.publisher_ref),
    "las filas quedan programadas con la referencia de Zernio",
    JSON.stringify(agendadas.map((f) => [f.status, f.publisher_ref])),
  );
  check(
    calls.create.length === 2 && calls.create.every((c) => c.timezone === "America/Costa_Rica"),
    "D1 · se le manda la fecha con la zona del workspace",
    JSON.stringify(calls.create),
  );
  check(
    calls.create.every((c) => mismoInstante(c.at, at)),
    "D1 · y la fecha que se eligio, no la de ahora",
    JSON.stringify(calls.create.map((c) => c.at)),
  );
  check(
    new Set(calls.create.map((c) => c.requestId)).size === 2,
    "D7 · cada red va con su propio id de pedido",
    JSON.stringify(calls.create.map((c) => c.requestId)),
  );
  check(calls.publish === 0, "nadie le pidio a Zernio que publique en el momento");

  const { data: mediaCache } = await svc
    .from("provider_media")
    .select("storage_path, provider_url")
    .eq("workspace_id", ws);
  check(
    (mediaCache ?? []).length === 1,
    "D5 · el video se sube UNA vez y queda anotado para la otra red",
    `hay ${(mediaCache ?? []).length} filas`,
  );

  const jobsDePublicacion = (await pendingJobs(filas[0].id)).filter((j) =>
    ["content_publish", "content_upload"].includes(j.type),
  );
  check(
    jobsDePublicacion.length === 0,
    "D1 · no queda ningun job de publicacion: la hora la maneja Zernio",
    JSON.stringify(jobsDePublicacion.map((j) => j.type)),
  );
  check((await postStatus(post)) === "scheduled", "la pieza figura programada");

  // ── 3. El webhook de Zernio ────────────────────────────────────────────
  console.log("\n— El aviso de que salio (A6, A7, A13, D6) —");

  const igRow = agendadas.find((f) => f.platform === "instagram")!;
  const settled = await settlePublication(svc, {
    ref: igRow.publisher_ref!,
    platform: "instagram",
    result: {
      status: "published",
      externalId: "ig-real-1",
      externalUrl: "https://instagram.test/ig-real-1",
    },
  });
  check(settled, "D6 · el aviso cierra una fila AGENDADA (antes se descartaba)");

  const publicada = (await rowsOf(post)).find((f) => f.platform === "instagram")!;
  check(publicada.status === "published", "la fila queda publicada", publicada.status ?? "");
  check(publicada.url === "https://instagram.test/ig-real-1", "con su link", publicada.url ?? "");
  check(
    (await postStatus(post)) === "partially_published",
    "A13 · la pieza pasa a parcialmente publicada: TikTok sigue pendiente",
    (await postStatus(post)) ?? "",
  );

  const { data: triggerAfter } = await svc
    .from("triggers")
    .select("config")
    .eq("id", trigger.id)
    .maybeSingle();
  const postIds = (triggerAfter?.config as { postIds?: string[] })?.postIds ?? [];
  check(
    postIds.includes("ig-real-1") && postIds.includes("zz-anterior"),
    "A6 · la automatizacion 'solo este post' recibe el id, sin perder los que tenia",
    JSON.stringify(postIds),
  );

  // ── 4. Conciliacion ────────────────────────────────────────────────────
  console.log("\n— La red de seguridad (D6) —");

  const ttRow = (await rowsOf(post)).find((f) => f.platform === "tiktok")!;
  await svc
    .from("social_posts")
    .update({ scheduled_at: new Date(Date.now() - 60 * 60_000).toISOString() })
    .eq("id", ttRow.id);

  const conciliado = await reconcileProviderSchedules(svc, { credentialsFor: deps.credentialsFor });
  check(conciliado.updated === 1, "una publicacion sin aviso se pone al dia preguntando", JSON.stringify(conciliado));
  check((await postStatus(post)) === "published", "y ahi si la pieza queda publicada");

  // ── 5. Reprogramar y desprogramar ──────────────────────────────────────
  console.log("\n— Reprogramar, desprogramar y reintentar (A4, D3, D4) —");

  const otroAt = new Date(Date.now() + 5 * 60 * 60_000).toISOString();
  const post2 = await seedPost(
    ws,
    owner,
    [{ platform: "instagram", planned_at: otroAt, options: { contentType: "reel" } }],
    "zz-test pieza 2",
  );
  await runScheduleNetworks(ctx, { postId: post2 });
  const [fila2] = await rowsOf(post2);
  await runProviderSchedule(svc, fila2.id, deps as never);

  const nuevoAt = new Date(Date.now() + 8 * 60 * 60_000).toISOString();
  await svc
    .from("content_posts")
    .update({ networks: [{ platform: "instagram", planned_at: nuevoAt, options: {} }] as never })
    .eq("id", post2);
  await runScheduleNetworks(ctx, { postId: post2 });
  await runProviderSchedule(svc, (await rowsOf(post2))[0].id, deps as never);

  check(
    calls.update.length === 1 && mismoInstante(calls.update[0].at, nuevoAt),
    "D3 · reprogramar edita el post en Zernio en vez de crear otro",
    JSON.stringify(calls.update),
  );
  const jobsDuplicados = await pendingJobs(fila2.id);
  check(
    jobsDuplicados.length === 1,
    "A4 · reprogramar deja UN solo job pendiente, no dos",
    JSON.stringify(jobsDuplicados.map((j) => j.type)),
  );

  const desprogramado = await runUnscheduleNetwork(ctx, { postId: post2, platform: "instagram" });
  check(desprogramado.ok, "desprogramar sale bien", !desprogramado.ok ? desprogramado.error : undefined);
  check(calls.cancel.length === 1, "D4 · y lo saca de la agenda de Zernio", JSON.stringify(calls.cancel));
  check(
    (await rowsOf(post2))[0].status === "cancelled",
    "la fila queda cancelada",
    (await rowsOf(post2))[0].status ?? "",
  );

  // ── 6. Publicar ahora ──────────────────────────────────────────────────
  console.log("\n— Publicar ahora (A3) —");

  const post3 = await seedPost(
    ws,
    owner,
    [{ platform: "instagram", planned_at: null, options: { contentType: "reel" } }],
    "zz-test pieza 3",
  );
  const ahora = await runScheduleNetworks(ctx, { postId: post3, platform: "instagram", now: true });
  check(ahora.ok, "A3 · publicar ahora YA NO falla por 'falta muy poco'", !ahora.ok ? ahora.error : undefined);

  const [fila3] = await rowsOf(post3);
  await runProviderSchedule(svc, fila3.id, deps as never);
  check(
    calls.create.some((c) => c.now === true),
    "y se le pide a Zernio que publique en el momento",
    JSON.stringify(calls.create.map((c) => c.now)),
  );

  // ── 7. El despachador propio sigue andando (D10) ───────────────────────
  console.log("\n— El camino de las APIs directas (D10) —");

  await seedAccount(ws, "linkedin", "zz-li-acc", "linkedin_api");
  const post4 = await seedPost(
    ws,
    owner,
    [{ platform: "linkedin", planned_at: enUnaHora(), options: {} }],
    "zz-test pieza 4",
  );
  const liScheduled = await runScheduleNetworks(ctx, { postId: post4 });
  check(liScheduled.ok, "LinkedIn se programa", !liScheduled.ok ? liScheduled.error : undefined);

  const [filaLi] = await rowsOf(post4);
  check(filaLi.status === "scheduled", "y queda en la cola nuestra, no en la de Zernio", filaLi.status ?? "");
  const jobsLi = await pendingJobs(filaLi.id);
  check(
    jobsLi.length === 1 && jobsLi[0].type === "content_publish",
    "con su job de publicacion a la hora elegida",
    JSON.stringify(jobsLi.map((j) => j.type)),
  );

  const liOutcome = await runPublication(svc, filaLi.id, deps as never);
  check(liOutcome.kind === "published", "y el despachador la publica", liOutcome.detail);
  check(linkedinPublished.count === 1, "una sola vez");
  check((await postStatus(post4)) === "published", "la pieza queda publicada");
} catch (err) {
  fail(`error inesperado: ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
} finally {
  console.log("\n— Limpieza —");
  if (!(await runCleanup(svc as never))) failures++;
}

console.log(failures ? `\n${failures} FALLAS` : "\nTodo verde");
process.exitCode = failures ? 1 : 0;
