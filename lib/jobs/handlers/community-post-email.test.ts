// @plantilla-quitar(servicios)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveBrand } from "@/lib/brand";
import {
  COMMUNITY_EMAIL_SPACING_MS,
  COMMUNITY_POST_EMAIL_SEND_JOB,
  communityEmailDedupe,
  parseCommunityEmailPayload,
  runCommunityPostEmail,
  runCommunityPostEmailSend,
  type CommunityEmailDeps,
  type CommunityEmailPost,
  type CommunityEmailTarget,
} from "./community-post-email";

const WS = "11111111-1111-4111-8111-111111111111";
const PROD = "22222222-2222-4222-8222-222222222222";
const POST = "33333333-3333-4333-8333-333333333333";
const C1 = "44444444-4444-4444-8444-444444444444";
const C2 = "55555555-5555-4555-8555-555555555555";

const basePost: CommunityEmailPost = {
  id: POST, workspace_id: WS, product_id: PROD, product_name: "Academia de prueba", community_key: "principal",
  title: "📣 Clase nueva", body: "Hola **a todos**.\n\n- uno\n- dos", photo_count: 2, live: true,
};
const targets: CommunityEmailTarget[] = [
  { contact_id: C1, email: "uno@example.test", display_name: "Uno" },
  { contact_id: C2, email: "dos@example.test", display_name: "Dos" },
];
const payload = { workspace_id: WS, product_id: PROD, post_id: POST, community_keys: ["principal", "lite"], author_label: "Negocio de prueba" };

let enqueued: Array<{ type: string; payload: unknown; run_at: string; dedupe_key: string }>;
let sent: Array<Record<string, unknown>>;
let post: CommunityEmailPost | null;
let list: CommunityEmailTarget[];
const loadTargets = vi.fn();

function deps(over: Partial<CommunityEmailDeps> = {}): CommunityEmailDeps {
  return {
    loadPost: async () => ({ ok: true, data: post }),
    loadTargets: async (...args) => (loadTargets(...args), { ok: true, data: list }),
    enqueue: async (_db, row) => {
      if (enqueued.some((e) => e.dedupe_key === row.dedupe_key)) return { code: "23505", message: "duplicate" };
      enqueued.push(row);
      return null;
    },
    look: async () => ({ brand: resolveBrand({ brand_name: "Negocio de prueba", brand_color: "#4f46e5" } as never), host: "portal.example.test", fromEmail: "hola@example.test" }),
    send: (async (params: Record<string, unknown>) => (sent.push(params), { ok: true, id: "re_1" })) as never,
    now: () => Date.parse("2026-11-18T12:00:00.000Z"),
    ...over,
  };
}
const ctx = (p: unknown, type = "community_post_email") => ({ supabase: {} as never, job: { id: "j", type, payload: p, attempts: 0 } });

beforeEach(() => {
  enqueued = [];
  sent = [];
  post = { ...basePost };
  list = [...targets];
  loadTargets.mockReset();
});

describe("parseCommunityEmailPayload", () => {
  it("descarta ids que no son uuid y claves raras", () => {
    expect(parseCommunityEmailPayload({ ...payload, post_id: "x" })).toBeNull();
    expect(parseCommunityEmailPayload({ ...payload, community_keys: ["ok_1", "MAL", "<x>"] })?.community_keys).toEqual(["ok_1"]);
  });
});

describe("reparto (community_post_email)", () => {
  it("encola un envío por persona, espaciados, con la clave por persona y post", async () => {
    await runCommunityPostEmail(ctx(payload), deps());
    expect(enqueued.map((e) => e.dedupe_key)).toEqual([communityEmailDedupe(POST, C1), communityEmailDedupe(POST, C2)]);
    expect(enqueued.every((e) => e.type === COMMUNITY_POST_EMAIL_SEND_JOB)).toBe(true);
    expect(Date.parse(enqueued[1].run_at) - Date.parse(enqueued[0].run_at)).toBe(COMMUNITY_EMAIL_SPACING_MS);
    expect(loadTargets).toHaveBeenCalledWith(expect.anything(), PROD, ["principal", "lite"]);
  });

  it("dos veces el mismo reparto no duplica a nadie", async () => {
    await runCommunityPostEmail(ctx(payload), deps());
    await runCommunityPostEmail(ctx(payload), deps());
    expect(enqueued).toHaveLength(2);
  });

  it("sin comunidades en el pedido, usa la del post", async () => {
    await runCommunityPostEmail(ctx({ ...payload, community_keys: [] }), deps());
    expect(loadTargets).toHaveBeenCalledWith(expect.anything(), PROD, ["principal"]);
  });

  it("un post borrado, oculto, de otro negocio o sin título no reparte nada", async () => {
    for (const p of [null, { ...basePost, live: false }, { ...basePost, workspace_id: PROD }, { ...basePost, title: null }]) {
      post = p;
      await runCommunityPostEmail(ctx(payload), deps());
    }
    expect(enqueued).toHaveLength(0);
  });

  it("si no pudo encolar a alguien, lanza para que la cola reintente", async () => {
    await expect(runCommunityPostEmail(ctx(payload), deps({ enqueue: async () => ({ code: "XX000", message: "caída" }) }))).rejects.toThrow(/no pude encolar 2/);
  });
});

describe("envío (community_post_email_send)", () => {
  const sendCtx = (contactId = C1) => ctx({ ...payload, contact_id: contactId }, COMMUNITY_POST_EMAIL_SEND_JOB);

  it("manda el correo: asunto = título, cajita, cuerpo con formato, fotos y botón al portal", async () => {
    await runCommunityPostEmailSend(sendCtx(), deps());
    expect(sent).toHaveLength(1);
    const s = sent[0];
    expect(s).toMatchObject({ to: "uno@example.test", subject: "📣 Clase nueva", category: "transactional", kind: "community_post", contactId: C1, fromOverride: "hola@example.test" });
    const html = String(s.html);
    expect(html).toContain("Negocio de prueba</strong> publicó en la comunidad:");
    expect(html).toContain("📣 Clase nueva");
    expect(html).toContain("<strong>a todos</strong>");
    expect(html).toContain("Esta publicación tiene 2 fotos.");
    expect(html).toContain(`https://portal.example.test/p/${PROD}/comunidad`);
    expect(html).toContain("Ver en la comunidad");
  });

  it("si la persona ya no está entre los destinatarios, no le manda", async () => {
    list = [targets[1]];
    expect(await runCommunityPostEmailSend(sendCtx(C1), deps())).toBeNull();
    expect(sent).toHaveLength(0);
  });

  it("si el post se borró antes de mandar, no sale", async () => {
    post = { ...basePost, live: false };
    await runCommunityPostEmailSend(sendCtx(), deps());
    expect(sent).toHaveLength(0);
  });

  it("sin dirección del portal, sale sin botón", async () => {
    await runCommunityPostEmailSend(sendCtx(), deps({ look: async () => ({ brand: resolveBrand(null), host: null, fromEmail: null }) }));
    expect(String(sent[0].html)).not.toContain("Ver en la comunidad");
  });

  it("sin Resend o con la dirección salteada no reintenta; un fallo real sí", async () => {
    await expect(runCommunityPostEmailSend(sendCtx(), deps({ send: (async () => ({ ok: false, reason: "not_configured", error: "x" })) as never }))).resolves.toBeTruthy();
    await expect(runCommunityPostEmailSend(sendCtx(), deps({ send: (async () => ({ ok: false, reason: "skipped", skip: "bounced", error: "x" })) as never }))).resolves.toBeTruthy();
    await expect(runCommunityPostEmailSend(sendCtx(), deps({ send: (async () => ({ ok: false, reason: "failed", error: "500" })) as never }))).rejects.toThrow(/community_post_email_send/);
  });
});
