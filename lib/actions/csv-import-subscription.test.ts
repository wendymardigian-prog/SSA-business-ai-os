/**
 * El importador con suscripcion a emails (E6), con el archivo de prueba del formato
 * real de wendymardigian.com (`scripts/fixtures/import-wendymardigian-sample.csv`).
 *
 * Se corren las acciones REALES (la prueba en seco y la importacion) sobre una base
 * en memoria con la regla unica y `set_email_status` simuladas con la MISMA tabla de
 * transiciones (`decideEmailStatus`). Lo que se fija:
 *  - las columnas de suscripcion, fechas y motivo se mapean solas;
 *  - la prueba en seco y la importacion dan los mismos conteos, y son los esperados;
 *  - nadie se re-suscribe (la baja gana), las fechas originales se respetan;
 *  - la importacion no dispara automatizaciones (los eventos quedan procesados).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { memoryCentralRpc } from "@/lib/contacts/testing/memory-central";
import { parseCsv } from "@/lib/csv/parse";
import { mapRow, suggestMapping } from "@/lib/csv/map";
import { consolidateSubscriptions, subscriptionTotals, type SubscriptionOutcome } from "@/lib/csv/subscription";
import { decideEmailStatus, emailStatusRank, normalizeEmailAddress } from "@/lib/email/subscription";

const WS = "ws-1";
let db: MemoryDb;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined), diffFields: vi.fn(() => ({})) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({ user: { id: "user-1" }, workspace: { id: WS }, role: "owner", roleId: null, supabase: db.client }),
}));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) => (key === "contacts.import" ? { user: { id: "user-1" }, workspace: { id: WS }, supabase: null } : null),
}));

const { importBatch, previewBatch } = await import("./csv-import");

const FILE = readFileSync(join(__dirname, "..", "..", "scripts", "fixtures", "import-wendymardigian-sample.csv"), "utf8");
const parsed = parseCsv(FILE);
const mapping = suggestMapping(parsed.headers);

type Row = Record<string, unknown>;
const addrOf = (c: Row) => [c.email, c.secondary_email].map((v) => normalizeEmailAddress(v as string)).filter(Boolean) as string[];

/** `set_email_status` en memoria: la misma tabla que la base, sobre el contacto y los que comparten su direccion. */
function memorySetEmailStatus(args: Row, mem: MemoryDb) {
  const contacts = mem.tables.contacts as Row[];
  const target = contacts.find((c) => c.id === args.p_contact_id);
  if (!target) return { not_found: true, changed: false };
  const addr = normalizeEmailAddress(args.p_address as string) ?? addrOf(target)[0] ?? null;
  const group = contacts.filter((c) => c === target || (addr && c.workspace_id === target.workspace_id && addrOf(c).includes(addr)));
  let changed = 0;
  let kept = false;
  const before = group.reduce((w, c) => (emailStatusRank(c.email_status as string) > emailStatusRank(w) ? (c.email_status as string) : w), "subscribed");
  for (const c of group) {
    const d = decideEmailStatus((c.email_status as string) ?? "subscribed", args.p_status as string, args.p_mode as string);
    if (d === "apply") {
      c.email_status = args.p_status;
      c.email_status_at = args.p_occurred_at ?? new Date().toISOString();
      c.email_status_source = args.p_source;
      changed++;
    } else if (d === "kept") kept = true;
    if (args.p_subscribed_at && (!c.email_subscribed_at || String(args.p_subscribed_at) < String(c.email_subscribed_at))) c.email_subscribed_at = args.p_subscribed_at;
  }
  const after = group.reduce((w, c) => (emailStatusRank(c.email_status as string) > emailStatusRank(w) ? (c.email_status as string) : w), "subscribed");
  return { status: after, previous_status: before, changed: changed > 0, kept_existing: kept && changed === 0, contacts_changed: changed };
}

function memoryAddressStatus(args: Row, mem: MemoryDb) {
  const addr = normalizeEmailAddress(args.p_email as string);
  let worst = "subscribed";
  for (const c of mem.tables.contacts as Row[]) {
    if (c.workspace_id === args.p_workspace_id && addr && addrOf(c).includes(addr) && emailStatusRank(c.email_status as string) > emailStatusRank(worst)) worst = c.email_status as string;
  }
  return worst;
}

function world() {
  db = memoryDb(
    {
      contacts: [
        { id: "existe-a", workspace_id: WS, display_name: "A", email: "existe.suscripto@example.com", email_status: "subscribed", deleted_at: null, created_at: "2024-01-01T00:00:00Z" },
        { id: "existe-b", workspace_id: WS, display_name: "B", email: "existe.baja@example.com", email_status: "unsubscribed", deleted_at: null, created_at: "2024-01-02T00:00:00Z" },
        { id: "existe-c", workspace_id: WS, display_name: "C", email: null, phone: "+5491155550001", email_status: "subscribed", deleted_at: null, created_at: "2024-01-03T00:00:00Z" },
      ],
      csv_imports: [{ id: "imp-1", workspace_id: WS, file_name: "export.csv", imported: 0, updated: 0, errors: 0, error_details: [] }],
      contact_tags: [],
      tags: [],
      workspace_members: [],
      custom_field_definitions: [],
      automation_events: [],
    },
    {
      rpc: {
        // La base emite "contacto nuevo" al crear (trigger): se simula para probar que la importacion lo apaga.
        find_or_create_contact: (args, mem) => {
          const out = memoryCentralRpc(args, mem) as Row;
          if (out.created) {
            (mem.tables.automation_events ??= []).push({ id: `ev-${out.contact_id}`, workspace_id: WS, contact_id: out.contact_id, event_type: "contact_created", processed_at: null, created_at: new Date(Date.now() + 1000).toISOString() });
            const created = (mem.tables.contacts as Row[]).find((c) => c.id === out.contact_id);
            if (created) created.email_status ??= "subscribed";
          }
          return out;
        },
        set_email_status: memorySetEmailStatus,
        email_address_status: memoryAddressStatus,
        record_contact_touch: () => ({ inserted: true }),
      },
    },
  );
}

/** Lo que hace la pantalla: valida en el navegador para consolidar y manda las tandas con lo consolidado. */
function consolidated() {
  const refs = parsed.rows.flatMap((values, i) => {
    const r = mapRow(values, mapping, i, [], "2026-10-29");
    return r.ok ? [{ line: r.row.line, email: r.row.patch.email ?? null, subscription: r.row.subscription }] : [];
  });
  return consolidateSubscriptions(refs);
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  world();
});
afterEach(() => vi.restoreAllMocks());

const EXPECTED = {
  imported: 8,
  updated: 6,
  linkedBy: { phone: 1, email: 5, social: 0 },
  errors: 1,
  consolidated: 3,
  subscription: { subscribed: 3, unsubscribed: 6, bounced: 1, complained: 1, notResubscribed: 1 },
};

describe("el archivo de prueba con el formato real", () => {
  it("las columnas de suscripcion, fechas y motivo quedan mapeadas solas", () => {
    const byHeader = Object.fromEntries(mapping.map((m) => [m.header, m.target]));
    expect(byHeader.email_subscribed).toBe("sub:status");
    expect(byHeader.subscribed_at).toBe("sub:subscribed_at");
    expect(byHeader.unsubscribed_at).toBe("sub:unsubscribed_at");
    expect(byHeader.unsubscribe_source).toBe("sub:unsubscribe_source");
    expect(byHeader.created_at).toBe("attr:first_touch_at");
  });

  it("consolida las filas repetidas: gana la baja, con su fecha, y el consentimiento mas viejo", () => {
    const { byEmail, consolidatedRows } = consolidated();
    expect(consolidatedRows).toBe(EXPECTED.consolidated);
    expect(byEmail["triple@example.com"]).toMatchObject({ status: "unsubscribed", at: "2025-07-01T10:00:00.000Z", subscribedAt: "2025-01-15T10:00:00.000Z", originalSource: "email_footer" });
    expect(byEmail["mayus@example.com"].status).toBe("unsubscribed");
  });

  async function run(kind: "preview" | "import") {
    const c = consolidated();
    const input = { rows: parsed.rows, mapping, offset: 0, origin: "wendymardigian", subscriptions: c.byEmail };
    const res = kind === "preview" ? await previewBatch({ ...input, fileName: "export.csv" }) : await importBatch({ ...input, importId: "imp-1" });
    if (!res.ok) throw new Error(res.error);
    return { counters: res.counters, totals: subscriptionTotals(res.subscription as SubscriptionOutcome[]), consolidated: c.consolidatedRows };
  }

  it("la prueba en seco da los conteos esperados y no escribe nada", async () => {
    const before = JSON.stringify(db.tables);
    const out = await run("preview");
    expect(out.counters).toMatchObject({ imported: EXPECTED.imported, updated: EXPECTED.updated, linkedBy: EXPECTED.linkedBy, errors: EXPECTED.errors });
    expect(out.counters.details).toEqual([{ line: 16, error: "Falta el estado de suscripción a emails" }]);
    expect(out.totals).toEqual(EXPECTED.subscription);
    expect(JSON.stringify(db.tables)).toBe(before);
    expect(db.rpcCalls.map((c) => c.name)).not.toContain("set_email_status");
  });

  it("la importacion da EXACTAMENTE los mismos conteos que la prueba en seco", async () => {
    const preview = await run("preview");
    world();
    const real = await run("import");
    expect(real.counters).toMatchObject({ imported: preview.counters.imported, updated: preview.counters.updated, linkedBy: preview.counters.linkedBy, errors: preview.counters.errors });
    expect(real.totals).toEqual(preview.totals);
    expect(real.totals).toEqual(EXPECTED.subscription);
  });

  it("nadie se re-suscribe y las bajas quedan con su fecha original y el origen", async () => {
    await run("import");
    const contacts = db.tables.contacts as Row[];
    const byEmail = (e: string) => contacts.find((c) => addrOf(c).includes(e))!;
    expect(byEmail("existe.baja@example.com").email_status).toBe("unsubscribed");
    expect(byEmail("existe.suscripto@example.com")).toMatchObject({ email_status: "unsubscribed", email_status_source: "import:wendymardigian" });
    expect(byEmail("baja.footer@example.com")).toMatchObject({ email_status: "unsubscribed", email_status_at: "2025-05-01T18:30:00.000Z" });
    expect(byEmail("rebote@example.com").email_status).toBe("bounced");
    expect(byEmail("queja@example.com").email_status).toBe("complained");
    expect(byEmail("triple@example.com")).toMatchObject({ email_status: "unsubscribed", email_subscribed_at: "2025-01-15T10:00:00.000Z" });
    // El contacto que se encontro por telefono quedo con el email del archivo.
    expect((contacts.find((c) => c.id === "existe-c") as Row).email).toBe("nuevo.email@example.com");
    // Ninguna llamada pidio otra cosa que modo sistema.
    expect(db.rpcCalls.filter((c) => c.name === "set_email_status").every((c) => c.args.p_mode === "system")).toBe(true);
    expect(db.rpcCalls.find((c) => c.name === "set_email_status")?.args).toMatchObject({ p_source: "import:wendymardigian" });
  });

  it("la importacion no dispara automatizaciones: los eventos de 'contacto nuevo' quedan procesados", async () => {
    await run("import");
    const events = db.tables.automation_events as Row[];
    expect(events.length).toBe(EXPECTED.imported);
    expect(events.every((e) => e.processed_at !== null)).toBe(true);
  });

  it("el origen va como etiqueta origen:<valor>", async () => {
    await run("import");
    expect((db.tables.tags as Row[]).map((t) => t.name)).toContain("origen:wendymardigian");
  });
});
