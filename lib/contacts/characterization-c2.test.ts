/**
 * Contactos: regla unica (C2) — tests de CARACTERIZACION de los caminos que crean contactos.
 *
 * Se escribieron ANTES de pasar los caminos por la regla central (commit `test: contactos - caracterizacion`)
 * y fijaban lo que hacian entonces. Los casos marcados `CAMBIA EN C2` son los cambios que el plan aprobo
 * (docs/PROGRESS-contactos.md, seccion 6): su expectativa se invirtio en el mismo commit que el cambio.
 * Todo lo demas sigue exactamente igual que antes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";

const WS = "ws-1";
const USER = "user-1";

let db: MemoryDb;
let serviceDb: MemoryDb | null = null;
let role = "owner";
const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = [];
let centralError: { message: string } | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: vi.fn(() => ({})) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "UTC", enabled_payment_methods: [], max_discount_percent: null },
    role,
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: (t: string) => ((serviceDb ?? db).client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args });
      if (name === "record_contact_touch") return { data: { inserted: true }, error: null };
      if (name === "find_or_create_contact") return centralError ? { data: null, error: centralError } : { data: memoryCentralRpc(args, serviceDb ?? db), error: null };
      return { data: null, error: null };
    },
  }),
}));
vi.mock("@/lib/auth/guards", () => ({
  getAdminContext: async () => null,
  getPermissionAction: async () => ({
    supabase: db.client, workspace: { id: WS, timezone: "UTC" }, user: { id: USER }, role, scope: () => "all",
  }),
}));
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));
const { createContact } = await import("@/lib/actions/contacts");
const { importBatch } = await import("@/lib/actions/csv-import");
const { createContactForSale } = await import("@/lib/actions/sales");
const { attributeComment } = await import("@/lib/comments/attribution");

beforeEach(() => {
  role = "owner";
  rpcCalls.length = 0;
  centralError = null;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db = memoryDb({
    contacts: [],
    csv_imports: [{ id: "imp-1", workspace_id: WS, imported: 0, updated: 0, errors: 0, error_details: [] }],
    contact_tags: [],
    tags: [],
    workspace_members: [{ workspace_id: WS, user_id: USER }],
    social_post_comments: [{ id: "row-1", workspace_id: WS, platform: "tiktok", external_comment_id: "c-1", contact_id: null }],
    social_posts: [],
    content_posts: [],
  }, { rpc: { find_or_create_contact: memoryCentralRpc, record_contact_touch: () => ({ inserted: true }) } });
});
afterEach(() => vi.restoreAllMocks());

describe("alta manual (createContact)", () => {
  const seed = (row: Record<string, unknown>) => db.rows("contacts").push({ workspace_id: WS, deleted_at: null, ...row });

  it("un duplicado por telefono o email devuelve el id del existente y el texto de siempre", async () => {
    seed({ id: "existente-1", email: "ana@x.co" });
    const r = await createContact({ display_name: "Ana", email: "ANA@x.co" });
    expect(r).toEqual({
      ok: false,
      error: "Ya existe un contacto con ese telefono o email. Te llevo a su ficha.",
      contactId: "existente-1",
      duplicate: true,
    });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("CAMBIA EN C2 (1): un @ de Instagram que ya existe FRENA el alta y lleva a la ficha", async () => {
    seed({ id: "viejo", instagram_username: "ana.ig" });
    const r = await createContact({ display_name: "Ana", instagram_username: "ana.ig" });
    expect(r).toMatchObject({ ok: false, duplicate: true, contactId: "viejo" });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("CAMBIA EN C2 (2): un Member que no ve al contacto duplicado recibe un mensaje SIN enlace ni nombre", async () => {
    role = "member";
    seed({ id: "ajeno", email: "ana@x.co", display_name: "Nombre Secreto" });
    // El cliente del usuario (RLS) no ve esa fila: se simula con una base vacia para la sesion.
    const session = memoryDb({ contacts: [] });
    const original = db;
    const r = await withSession(session, original, () => createContact({ display_name: "Ana", email: "ana@x.co" }));
    expect(r).toEqual({ ok: false, error: "Ya existe un contacto con ese dato. Pedile a un Admin que te lo asigne.", duplicate: true });
    expect(JSON.stringify(r)).not.toContain("ajeno");
    expect(JSON.stringify(r)).not.toContain("Nombre Secreto");
    expect(original.rows("contacts")).toHaveLength(1);
  });

  it("una persona con solo el nombre se puede cargar (el unico camino que lo permite)", async () => {
    const r = await createContact({ display_name: "Solo Nombre" });
    expect(r.ok).toBe(true);
    expect(db.rows("contacts")[0]).toMatchObject({ display_name: "Solo Nombre" });
  });

  it("un error de la base NO crea un duplicado", async () => {
    centralError = { message: "la base se cayo" };
    const r = await createContact({ display_name: "Ana", email: "ana@x.co" });
    expect(r).toMatchObject({ ok: false });
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("importacion de CSV (importBatch)", () => {
  const mapping = [
    { header: "Nombre", target: "display_name" as const },
    { header: "Email", target: "email" as const },
    { header: "Telefono", target: "phone" as const },
  ];

  it("un contacto nuevo cuenta como importado; uno existente, como actualizado (solo completa vacios)", async () => {
    db.rows("contacts").push({ id: "e1", workspace_id: WS, display_name: "Existente", email: "viejo@x.co", phone: null, deleted_at: null });
    const r = await importBatch({
      importId: "imp-1",
      rows: [["Otro Nombre", "viejo@x.co", "+50688887777"], ["Nuevo", "nuevo@x.co", ""]],
      mapping,
      offset: 0,
    });
    expect(r.ok && r.counters).toMatchObject({ imported: 1, updated: 1, errors: 0 });
    const e1 = db.rows("contacts").find((c) => c.id === "e1")!;
    expect(e1.display_name).toBe("Existente");
    expect(e1.phone).toBe("+50688887777");
    expect(r.ok && r.counters.linkedBy).toEqual({ phone: 0, email: 1, social: 0 });
  });

  it("CAMBIA EN C2 (4): un telefono de la planilla que ya es de OTRO contacto no se escribe y se cuenta", async () => {
    db.rows("contacts").push({ id: "a", workspace_id: WS, display_name: "A", email: "a@x.co", phone: null, deleted_at: null });
    db.rows("contacts").push({ id: "b", workspace_id: WS, display_name: "B", email: "b@x.co", phone: "+50688887777", deleted_at: null });
    // La fila trae el email de A y el telefono de B.
    const r = await importBatch({ importId: "imp-1", rows: [["Nombre", "a@x.co", "+50688887777"]], mapping, offset: 0 });
    expect(r.ok && r.counters).toMatchObject({ imported: 0, updated: 1, skippedConflicts: 1 });
    expect(db.rows("contacts").find((c) => c.id === "a")!.phone).toBeNull();
  });
});

describe("Ventas (createContactForSale)", () => {
  it("CAMBIA EN C2 (5): el telefono se normaliza", async () => {
    await createContactForSale({ name: "Ana", phone: " 506 8888-7777 " });
    expect(db.rows("contacts")[0]).toMatchObject({ phone: "+50688887777" });
  });

  it("ARREGLADO EN C2: un error de la base al buscar NO se toma como 'no encontrado': no crea el contacto", async () => {
    centralError = { message: "la base se cayo" };
    const r = await createContactForSale({ name: "Ana", email: "ana@x.co" });
    expect(r).toMatchObject({ ok: false });
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("comentarios (attributeComment)", () => {
  const params = (over: Record<string, unknown> = {}) => ({
    workspaceId: WS, platform: "tiktok", externalCommentId: "c-1", authorUsername: "Ana_TT", isOwn: false,
    commentedAt: "2026-10-05T12:00:00.000Z", socialPostId: null, ...over,
  });

  it("TikTok sin contacto crea uno anonimo con el usuario normalizado", async () => {
    const r = await attributeComment(db.client, params() as never);
    expect(r).toMatchObject({ createdContact: true });
    expect(db.rows("contacts")[0]).toMatchObject({ display_name: "Unknown commenter", tiktok_username: "ana_tt" });
  });

  it("CAMBIA EN C2 (7): el usuario se compara en minusculas y sin '@': no se crea un segundo contacto", async () => {
    db.rows("contacts").push({ id: "t1", workspace_id: WS, tiktok_username: "ana_tt", deleted_at: null });
    const r = await attributeComment(db.client, params({ authorUsername: "@Ana_TT" }) as never);
    expect(r).toMatchObject({ contactId: "t1", createdContact: false });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("Instagram sin contacto no crea nada", async () => {
    db.rows("social_post_comments")[0]!.platform = "instagram";
    const r = await attributeComment(db.client, params({ platform: "instagram", authorUsername: "nadie" }) as never);
    expect(r).toMatchObject({ contactId: null, createdContact: false });
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

/** Corre una accion con OTRA base para la sesion del usuario (la RLS que no ve el contacto) y la original para el servicio. */
async function withSession<T>(session: MemoryDb, service: MemoryDb, run: () => Promise<T>): Promise<T> {
  db = session;
  serviceDb = service;
  try {
    return await run();
  } finally {
    db = service;
    serviceDb = null;
  }
}
