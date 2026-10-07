/**
 * F87: el alta manual y la importación de CSV dejan un toque de atribución.
 *
 * Se prueban las acciones REALES, con la sesión, el detector de duplicados y la
 * base en memoria simulados. Lo que se fija:
 *  - el alta manual anota un toque `manual` (y con UTM, las UTM);
 *  - ya no se escribe la forma vieja de clicks en `contacts.attribution`;
 *  - la importación anota SOLO los contactos nuevos (actualizar uno que ya
 *    existía no es un origen nuevo);
 *  - ninguna de las dos puede fallar por culpa de la atribución.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const USER = "user-1";

let db: MemoryDb;
const touches: Array<{ contactId: string; touch: Record<string, unknown> }> = [];
let touchesFail = false;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: vi.fn(() => ({})) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS },
    role: "owner",
    roleId: null,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/auth/guards", () => ({ getAdminContext: async () => null }));
// No es parte de lo que prueba este archivo (F87, atribucion): se simula para
// no tener que mockear tambien @/lib/supabase/server#createClient.
vi.mock("@/lib/user-timezone", () => ({ resolveViewerTimezone: async () => "UTC" }));

// El detector de duplicados usa `.or()`, que la base en memoria no soporta.
const duplicates = new Set<string>();
vi.mock("@/lib/contacts/dedup", () => ({
  findDuplicateContact: async ({ emails = [] }: { emails?: Array<string | null> }) => {
    const hit = emails.find((email) => email && duplicates.has(email));
    return hit ? { id: `existente-${hit}` } : null;
  },
}));

const { createContact } = await import("./contacts");
const { importBatch } = await import("./csv-import");

beforeEach(() => {
  touches.length = 0;
  touchesFail = false;
  duplicates.clear();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  db = memoryDb(
    {
      contacts: [],
      csv_imports: [{ id: "imp-1", workspace_id: WS, imported: 0, updated: 0, errors: 0, error_details: [] }],
      contact_tags: [],
      tags: [],
      workspace_members: [],
    },
    {
      rpc: {
        record_contact_touch: (args) => {
          if (touchesFail) throw new Error("la atribucion se cayo");
          touches.push({ contactId: String(args.p_contact_id), touch: args.p_touch as Record<string, unknown> });
          return { inserted: true };
        },
      },
    },
  );
});
afterEach(() => vi.restoreAllMocks());

describe("el alta manual deja un toque (F87)", () => {
  it("anota un toque 'manual' con el contacto recién creado", async () => {
    const result = await createContact({ display_name: "Ana Pérez", email: "ana@example.com" });

    expect(result.ok).toBe(true);
    const created = db.rows("contacts")[0];
    expect(touches).toHaveLength(1);
    expect(touches[0].contactId).toBe(created.id);
    expect(touches[0].touch).toMatchObject({ source: "manual", origin: "manual", dedupe_key: `manual:${created.id}` });
  });

  it("con UTM en el pedido, las UTM mandan", async () => {
    await createContact({ display_name: "Ana", email: "ana@example.com", utm_source: "ig", utm_medium: "cpc", utm_campaign: "octubre" });

    expect(touches[0].touch).toMatchObject({ source: "instagram", medium: "paid_social", campaign: "octubre", origin: "manual" });
  });

  it("YA NO escribe la forma vieja de clicks en la atribución del contacto", async () => {
    await createContact({ display_name: "Ana", email: "ana@example.com", utm_source: "ig" });

    const created = db.rows("contacts")[0];
    expect(created.attribution).toBeUndefined();
    expect(JSON.stringify(created)).not.toContain("first_click");
  });

  it("un duplicado no anota nada", async () => {
    duplicates.add("ana@example.com");

    const result = await createContact({ display_name: "Ana", email: "ana@example.com" });

    expect(result.ok).toBe(false);
    expect(touches).toHaveLength(0);
  });

  it("si el registro del toque falla, el contacto se crea igual", async () => {
    touchesFail = true;

    const result = await createContact({ display_name: "Ana", email: "ana@example.com" });

    expect(result.ok).toBe(true);
    expect(db.rows("contacts")).toHaveLength(1);
  });
});

describe("la importación de CSV deja un toque por contacto nuevo (F87)", () => {
  const mapping = [
    { header: "Nombre", target: "display_name" as const },
    { header: "Email", target: "email" as const },
  ];
  const batch = (rows: string[][]) => importBatch({ importId: "imp-1", rows, mapping, offset: 0 });

  it("anota un toque csv / import por cada contacto nuevo", async () => {
    const result = await batch([["Ana", "ana@example.com"], ["Beto", "beto@example.com"]]);

    expect(result.ok && result.counters.imported).toBe(2);
    expect(touches).toHaveLength(2);
    expect(touches.every((t) => t.touch.source === "csv" && t.touch.medium === "import" && t.touch.origin === "import")).toBe(true);
    expect(touches.map((t) => t.touch.dedupe_key).sort()).toEqual(
      db.rows("contacts").map((c) => `import:imp-1:${c.id}`).sort(),
    );
  });

  it("un contacto que YA existía se actualiza pero NO se anota: no es un origen nuevo", async () => {
    duplicates.add("viejo@example.com");
    // El contacto que el detector dice que ya existe tiene que estar de verdad.
    db.rows("contacts").push({ id: "existente-viejo@example.com", workspace_id: WS, display_name: "Viejo", email: "viejo@example.com" });

    const result = await batch([["Nuevo", "nuevo@example.com"], ["Viejo", "viejo@example.com"]]);

    expect(result.ok && result.counters).toMatchObject({ imported: 1, updated: 1 });
    expect(touches).toHaveLength(1);
    const nuevo = db.rows("contacts").find((c) => c.email === "nuevo@example.com");
    expect(touches[0].contactId).toBe(nuevo?.id);
  });

  it("una fila con error no deja toque", async () => {
    const result = await batch([["Sin email valido", "no-es-un-email"], ["Ana", "ana@example.com"]]);

    expect(result.ok && result.counters).toMatchObject({ imported: 1, errors: 1 });
    expect(touches).toHaveLength(1);
  });

  it("si el registro de toques falla, la tanda se importa igual y los contadores quedan bien", async () => {
    touchesFail = true;

    const result = await batch([["Ana", "ana@example.com"], ["Beto", "beto@example.com"]]);

    expect(result.ok && result.counters).toMatchObject({ imported: 2, errors: 0 });
    expect(db.rows("contacts")).toHaveLength(2);
    expect(db.rows("csv_imports")[0].imported).toBe(2);
  });
});
