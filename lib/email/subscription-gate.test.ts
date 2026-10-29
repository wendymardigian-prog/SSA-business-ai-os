/**
 * La puerta de suscripcion, de punta a punta, con un espia sobre la llamada a Resend.
 *
 * Las dos funciones que mandan un email a una persona (`sendTransactionalEmail` y
 * `sendEmailReply`) pasan por `canSendEmailTo`. Lo que este test fija:
 *  - un dado de baja (o con queja) NO llega a Resend en marketing y SI en transaccional;
 *  - uno que rebota no llega en ninguno;
 *  - un salto queda en email_log con su motivo, no como un fallo;
 *  - los emails al equipo o del sistema (sin categoria) no miran la suscripcion.
 * Y el control de la puerta unica: todo llamador de los dos emisores pasa la categoria,
 * salvo la lista explicita de emails al equipo (con el motivo de cada uno).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative, sep } from "node:path";
import { fakeDb } from "@/lib/testing/fake-db";
import { sendTransactionalEmail } from "./send";
import { sendEmailReply } from "./send-reply";
import type { EmailStatus } from "./subscription";

const WS = "11111111-1111-1111-1111-111111111111";
const CONTACT = "22222222-2222-2222-2222-222222222222";
const KEY = "re_key_de_prueba_que_no_sale";

function okFetch() {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify({ id: "re_1" }), { status: 200 }));
}

function world(status: EmailStatus, opts: { doNotContact?: boolean; token?: string | null } = {}) {
  return fakeDb(
    {
      "integration_configs:select": { data: { config: { from_email: "hola@negocio.test", from_name: "Negocio" }, is_active: true, vault_secret_name: null } },
      "messages:select": { data: null },
      "email_log:insert": { data: null },
    },
    {
      read_secret: { data: KEY },
      email_address_send_state: { data: { status, do_not_contact: opts.doNotContact ?? false, token: opts.token ?? "tok-1", matched: true } },
    },
  );
}

afterEach(() => vi.restoreAllMocks());

const STATUSES: EmailStatus[] = ["subscribed", "unsubscribed", "bounced", "complained"];
/** Lo que tiene que pasar: llega a Resend o no. */
const EXPECT: Record<EmailStatus, { marketing: boolean; transactional: boolean }> = {
  subscribed: { marketing: true, transactional: true },
  unsubscribed: { marketing: false, transactional: true },
  bounced: { marketing: false, transactional: false },
  complained: { marketing: false, transactional: true },
};

describe("sendTransactionalEmail: la puerta de suscripcion", () => {
  for (const status of STATUSES) {
    for (const category of ["marketing", "transactional"] as const) {
      const sends = EXPECT[status][category];
      it(`${status} + ${category}: ${sends ? "llega a Resend" : "NO llega a Resend y queda anotado"}`, async () => {
        const db = world(status);
        const fetchImpl = okFetch();
        const res = await sendTransactionalEmail({
          workspaceId: WS, to: "Ana@X.test", subject: "Hola", html: "<p>hola</p>", kind: "flow", contactId: CONTACT, category,
          deps: { supabase: db.client, fetchImpl: fetchImpl as unknown as typeof fetch },
        });
        expect(fetchImpl).toHaveBeenCalledTimes(sends ? 1 : 0);
        const logged = db.writesTo("email_log").map((w) => w.values as Record<string, unknown>);
        if (sends) {
          expect(res.ok).toBe(true);
          expect(logged[0]).toMatchObject({ status: "sent" });
        } else {
          expect(res).toMatchObject({ ok: false, reason: "skipped", skip: status });
          expect(logged[0]).toMatchObject({ status: `skipped_${status}`, contact_id: CONTACT, kind: "flow" });
        }
      });
    }
  }

  it("la puerta pregunta por la direccion normalizada y el contacto", async () => {
    const db = world("subscribed");
    await sendTransactionalEmail({
      workspaceId: WS, to: " Ana@X.test ", subject: "Hola", html: "<p>hola</p>", kind: "flow", contactId: CONTACT, category: "marketing",
      deps: { supabase: db.client, fetchImpl: okFetch() as unknown as typeof fetch },
    });
    expect(db.rpcCalls.find((c) => c.name === "email_address_send_state")?.args).toEqual({ p_workspace_id: WS, p_email: "ana@x.test", p_contact_id: CONTACT });
  });

  it("'no contactar' frena solo a quien lo pide (honorDoNotContact)", async () => {
    const fetchImpl = okFetch();
    const res = await sendTransactionalEmail({
      workspaceId: WS, to: "ana@x.test", subject: "x", html: "x", kind: "flow", category: "transactional", honorDoNotContact: true,
      deps: { supabase: world("subscribed", { doNotContact: true }).client, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(res).toMatchObject({ reason: "skipped", skip: "do_not_contact" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("un email al equipo o del sistema (sin categoria) no mira la suscripcion", async () => {
    const db = world("bounced");
    const fetchImpl = okFetch();
    const res = await sendTransactionalEmail({
      workspaceId: WS, to: "socio@negocio.test", subject: "Te invitaron", html: "x", kind: "team_invite",
      deps: { supabase: db.client, fetchImpl: fetchImpl as unknown as typeof fetch },
    });
    expect(res.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(db.rpcCalls.some((c) => c.name === "email_address_send_state")).toBe(false);
  });
});

describe("sendEmailReply: la puerta de suscripcion", () => {
  const channel = { platform: "email", is_active: true, email_address: "hola@negocio.test" };

  for (const status of STATUSES) {
    for (const category of ["marketing", "transactional"] as const) {
      const sends = EXPECT[status][category];
      it(`${status} + ${category}: ${sends ? "llega a Resend" : "NO llega a Resend"}`, async () => {
        const fetchImpl = okFetch();
        const db = world(status);
        const res = await sendEmailReply(db.client, {
          workspaceId: WS, conversationId: "cv-1", channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false,
          category, contactId: CONTACT, log: { kind: "sequence" }, fetchImpl: fetchImpl as unknown as typeof fetch,
        });
        expect(fetchImpl).toHaveBeenCalledTimes(sends ? 1 : 0);
        expect(res.ok).toBe(sends);
        if (!sends) {
          expect(res.skipped).toBe(status);
          expect(res.retryable).toBe(false);
          expect(db.writesTo("email_log")[0]?.values).toMatchObject({ status: `skipped_${status}`, kind: "sequence", contact_id: CONTACT });
        }
      });
    }
  }

  it("con `log`, un envio que sale queda en email_log con el id de Resend (asi el webhook ubica un rebote)", async () => {
    const db = world("subscribed");
    await sendEmailReply(db.client, {
      workspaceId: WS, conversationId: "cv-1", channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false,
      category: "marketing", contactId: CONTACT, log: { kind: "flow_message", relatedEntityType: "flow", relatedEntityId: "f-1" },
      fetchImpl: okFetch() as unknown as typeof fetch,
    });
    expect(db.writesTo("email_log")[0]?.values).toMatchObject({ status: "sent", provider_message_id: "re_1", kind: "flow_message", related_entity_id: "f-1" });
  });

  it("sin `log` (la bandeja), no se escribe email_log: la respuesta ya queda en el hilo", async () => {
    const db = world("subscribed");
    await sendEmailReply(db.client, {
      workspaceId: WS, conversationId: "cv-1", channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false,
      category: "transactional", fetchImpl: okFetch() as unknown as typeof fetch,
    });
    expect(db.writesTo("email_log")).toEqual([]);
  });

  it("la puerta usa el cliente de servicio (`secrets`), no el del usuario", async () => {
    const user = world("subscribed");
    const service = world("unsubscribed");
    const fetchImpl = okFetch();
    const res = await sendEmailReply(user.client, {
      workspaceId: WS, conversationId: "cv-1", channel, toAddress: "ana@x.test", text: "hola", contactOptedOut: false,
      category: "marketing", secrets: service.client, fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(res.skipped).toBe("unsubscribed");
    expect(user.rpcCalls.some((c) => c.name === "email_address_send_state")).toBe(false);
  });
});

// ------------------------------------------------------------
// La puerta unica: todo llamador pasa la categoria
// ------------------------------------------------------------

const ROOT = resolve(__dirname, "..", "..");

/**
 * Los emails que NO van a un contacto y por eso no llevan categoria (no miran la
 * suscripcion). Cada uno con su motivo; sumar uno aca tiene que ser una decision.
 */
const TEAM_ONLY: Record<string, string> = {
  [join("lib", "notifications.ts")]: "avisos de canal a Owner/Admin",
  [join("lib", "actions", "team.ts")]: "invitaciones al equipo",
  [join("lib", "actions", "forms", "flows.ts")]: "la prueba del editor de formularios: va a quien la pide",
  [join("lib", "actions", "scheduling", "event-flows.ts")]: "la prueba del editor de la agenda: va a quien la pide",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if ((entry.endsWith(".ts") || entry.endsWith(".tsx")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

/** Cada llamada: el texto desde el nombre hasta el cierre del objeto de parametros. */
function calls(source: string, fn: string): string[] {
  const out: string[] = [];
  const re = new RegExp(`\\b${fn}\\s*\\(`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // La declaracion de la funcion no es una llamada.
    if (/function\s+$/.test(source.slice(Math.max(0, m.index - 20), m.index))) continue;
    let depth = 0;
    let i = m.index + m[0].length - 1;
    for (; i < source.length; i++) {
      if (source[i] === "(") depth++;
      else if (source[i] === ")" && --depth === 0) break;
    }
    out.push(source.slice(m.index, i + 1));
  }
  return out;
}

describe("la puerta unica: todo email a un contacto lleva su categoria", () => {
  const files = ["lib", "app", "components"].flatMap((d) => walk(join(ROOT, d)));

  it("cada llamada a sendTransactionalEmail pasa `category`, salvo los emails al equipo (lista explicita)", () => {
    const offenders: string[] = [];
    const seenTeam = new Set<string>();
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (rel === join("lib", "email", "send.ts")) continue;
      for (const call of calls(readFileSync(file, "utf8"), "sendTransactionalEmail")) {
        if (/\bcategory\b/.test(call)) continue;
        if (TEAM_ONLY[rel]) {
          seenTeam.add(rel);
          continue;
        }
        offenders.push(`${rel}: ${call.slice(0, 80).replace(/\s+/g, " ")}`);
      }
    }
    expect(offenders).toEqual([]);
    // La lista no guarda excepciones viejas: cada una sigue siendo un llamador de verdad.
    expect([...seenTeam].sort()).toEqual(Object.keys(TEAM_ONLY).sort());
  });

  it("la copia del contrato firmado (que llama por `send`) le pone categoria al firmante", () => {
    const src = readFileSync(join(ROOT, "lib", "forms", "contract", "email-run.ts"), "utf8");
    expect(src).toMatch(/copy \? \{\} : \{ category: "transactional" as const \}/);
  });

  it("cada llamada a sendEmailReply pasa `category` (el tipo lo exige y este test lo deja escrito)", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = relative(ROOT, file);
      if (rel === join("lib", "email", "send-reply.ts")) continue;
      for (const call of calls(readFileSync(file, "utf8"), "sendEmailReply")) {
        if (!/\bcategory\b/.test(call)) offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
