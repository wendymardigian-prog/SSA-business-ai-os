import { describe, expect, it } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { buildPatch, upsertContactFromWebhook } from "./upsert-contact";
import { DEFAULT_UPSERT_CONFIG, type MapRow, type UpsertContactConfig } from "./upsert-config";

const WS = "ws-1";
type Row = Record<string, unknown>;

const row = (target: string, path: string, transform?: MapRow["transform"]): MapRow => ({ target, source: { path }, ...(transform ? { transform } : {}) });
const config = (over: Partial<UpsertContactConfig> = {}): UpsertContactConfig => ({
  ...DEFAULT_UPSERT_CONFIG,
  map: [row("contact.email", "email", "lowercase"), row("contact.phone", "phone", "clean_phone"), row("contact.display_name", "name")],
  ...over,
});

/** Una base con el `find_contact_for_form` y el `record_contact_touch` mínimos de la real. */
function world(contacts: Row[] = [], extra: Record<string, Row[]> = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, timezone: "America/Costa_Rica" }],
      custom_field_definitions: [{ id: "cf-1", workspace_id: WS, slug: "empresa", name: "Empresa", type: "text", deleted_at: null }],
      contacts,
      contact_custom_fields: [],
      contact_channels: [],
      contact_touches: [],
      tags: [{ id: "tag-vip", workspace_id: WS, name: "VIP" }, { id: "tag-lead", workspace_id: WS, name: "Lead" }],
      contact_tags: [],
      audit_log: [],
      ...extra,
    },
    {
      rpc: {
        find_contact_for_form: (args, db: MemoryDb) => {
          const live = db.tables.contacts.filter((c) => c.workspace_id === args.p_workspace_id && !c.deleted_at);
          const hits: { by: string; contact_id: string }[] = [];
          const add = (by: string, c: Row) => hits.push({ by, contact_id: String(c.id) });
          for (const c of live) {
            if (args.p_phone && (c.phone === args.p_phone || c.whatsapp_phone === args.p_phone)) add("phone", c);
          }
          for (const c of live) {
            if (args.p_email && String(c.email ?? "").toLowerCase() === args.p_email) add("email", c);
          }
          const social = (args.p_social ?? {}) as Record<string, string>;
          for (const c of live) {
            if (social.instagram && c.instagram_username === social.instagram) add("instagram", c);
          }
          const winner = hits[0] ?? null;
          const conflicts = hits.filter((h) => winner && h.contact_id !== winner.contact_id);
          return { contact_id: winner?.contact_id ?? null, matched_by: winner?.by ?? null, conflict_contact_id: conflicts[0]?.contact_id ?? null, conflicts };
        },
        record_contact_touch: (args, db: MemoryDb) => {
          const t = args.p_touch as Row;
          if (db.tables.contact_touches.some((x) => x.dedupe_key === t.dedupe_key)) return { inserted: false, reason: "duplicate" };
          db.tables.contact_touches.push({ id: `touch-${db.tables.contact_touches.length + 1}`, contact_id: args.p_contact_id, ...t });
          return { inserted: true };
        },
      },
    },
  );
}

const webhook = (payload: unknown, query: unknown = {}) => ({ inboundId: "in-1", endpointId: "ep-1", endpointName: "Typeform", payload, query });
const run = (db: MemoryDb, payload: unknown, cfg = config(), query: unknown = {}) =>
  upsertContactFromWebhook({ db: db.client, workspaceId: WS, config: cfg, webhook: webhook(payload, query), nodeId: "n-1" });

describe("encontrar al contacto (nunca por nombre)", () => {
  it("un email que ya existe, con otra capitalización y espacios, se vincula y no crea otro", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "ana@example.com", display_name: "Ana" }]);
    const out = await run(db, { email: " ANA@Example.com ", name: "Ana" });
    expect(out).toMatchObject({ ok: true, contactId: "c-1" });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("+506 8888-1234 se vincula con el contacto que tiene +50688881234", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, phone: "+50688881234", display_name: "Ana" }]);
    const out = await run(db, { phone: "+506 8888-1234" });
    expect(out).toMatchObject({ ok: true, contactId: "c-1" });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("también con un teléfono guardado sin el «+» (de antes de normalizar)", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, phone: "50688881234", display_name: "Ana" }]);
    const out = await run(db, { phone: "+506 8888-1234" });
    expect(out).toMatchObject({ ok: true, contactId: "c-1" });
    expect(db.rows("contacts")).toHaveLength(1);
  });

  it("sin teléfono, email ni red: «No se pudo» con no_identifier y no crea nada", async () => {
    const db = world();
    const out = await run(db, { name: "Solo Nombre" });
    expect(out).toMatchObject({ ok: false, reason: "no_identifier" });
    expect(db.rows("contacts")).toHaveLength(0);
    expect(db.rows("contact_touches")).toHaveLength(0);
  });

  it("update_only y no existe: «No se pudo» con not_found, y no crea", async () => {
    const db = world();
    const out = await run(db, { email: "nuevo@example.com" }, config({ mode: "update_only" }));
    expect(out).toMatchObject({ ok: false, reason: "not_found" });
    expect(db.rows("contacts")).toHaveLength(0);
  });
});

describe("crear", () => {
  it("crea con el nombre, email y teléfono normalizados, y deja el historial del webhook", async () => {
    const db = world();
    const out = await run(db, { email: "Nuevo@Example.com", phone: "8888 1234", name: "Nuevo Lead" });
    expect(out).toMatchObject({ ok: true, result: "created", contactName: "Nuevo Lead" });
    expect(db.rows("contacts")[0]).toMatchObject({ workspace_id: WS, email: "nuevo@example.com", phone: "+50688881234", display_name: "Nuevo Lead" });
    expect(db.rows("audit_log")[0]).toMatchObject({ entity_type: "contact", action: "contact.created", actor_type: "webhook", actor_label: "Webhook «Typeform»" });
  });

  it("sin nombre, el email hace de nombre", async () => {
    const db = world();
    await run(db, { email: "sin@nombre.com" }, config({ map: [row("contact.email", "email")] }));
    expect(db.rows("contacts")[0].display_name).toBe("sin@nombre.com");
  });

  it("el workspace sale del endpoint, nunca del payload", async () => {
    const db = world();
    await run(db, { email: "a@b.com", workspace_id: "ws-ajeno" });
    expect(db.rows("contacts")[0].workspace_id).toBe(WS);
  });

  it("no encuentra a alguien de OTRO workspace con el mismo email: crea uno nuevo en el suyo", async () => {
    const db = world([{ id: "c-x", workspace_id: "ws-otro", email: "a@b.com", display_name: "Ajeno" }]);
    const out = await run(db, { email: "a@b.com" });
    expect(out).toMatchObject({ ok: true, result: "created" });
    expect(db.rows("contacts")).toHaveLength(2);
  });
});

describe("actualizar: fill_empty y overwrite", () => {
  const existing = { id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Nombre Viejo", phone: null, country: null };

  it("fill_empty: el nombre que ya tiene NO cambia y lo vacío se completa", async () => {
    const db = world([{ ...existing }]);
    const out = await run(db, { email: "a@b.com", phone: "8888 1234", name: "Nombre Nuevo" });
    expect(out).toMatchObject({ ok: true, result: "updated" });
    expect(db.rows("contacts")[0]).toMatchObject({ display_name: "Nombre Viejo", phone: "+50688881234" });
    expect(out.ok && out.diff).toEqual({ phone: { before: null, after: "+50688881234" } });
  });

  it("overwrite: el nombre SÍ cambia", async () => {
    const db = world([{ ...existing }]);
    const out = await run(db, { email: "a@b.com", name: "Nombre Nuevo" }, config({ update: "overwrite" }));
    expect(db.rows("contacts")[0].display_name).toBe("Nombre Nuevo");
    expect(out.ok && out.diff.display_name).toEqual({ before: "Nombre Viejo", after: "Nombre Nuevo" });
    expect(db.rows("audit_log")[0]).toMatchObject({ action: "contact.updated" });
  });

  it("sin nada que cambiar: unchanged y no ensucia el historial", async () => {
    const db = world([{ ...existing }]);
    const out = await run(db, { email: "a@b.com", name: "Otro" });
    expect(out).toMatchObject({ ok: true, result: "unchanged" });
    expect(db.rows("audit_log")).toHaveLength(0);
  });

  it("el @ de Instagram de un contacto con canal de Instagram vinculado NO se pisa, ni con overwrite", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Ana", instagram_username: "ana.real" }], { contact_channels: [{ contact_id: "c-1", channel_id: "ch-1" }] });
    const cfg = config({ update: "overwrite", map: [row("contact.email", "email"), row("contact.instagram_username", "ig")] });
    await run(db, { email: "a@b.com", ig: "@otro.usuario" }, cfg);
    expect(db.rows("contacts")[0].instagram_username).toBe("ana.real");
  });

  it("buildPatch: sin canal de Instagram, overwrite sí cambia el usuario", () => {
    const current = { display_name: "A", email: "a@b.com", phone: null, whatsapp_phone: null, country: null, instagram_username: "viejo", tiktok_username: null, twitter_username: null, linkedin_profile_url: null, facebook_id: null, youtube_channel_id: null };
    expect(buildPatch(current, { instagram_username: "nuevo" }, true, [], false)).toEqual({ instagram_username: "nuevo" });
    expect(buildPatch(current, { instagram_username: "nuevo" }, true, [], true)).toEqual({});
    expect(buildPatch(current, { instagram_username: "nuevo" }, false, [], false)).toEqual({});
  });
});

describe("conflicto: el teléfono es de uno y el email de otro", () => {
  it("usa el contacto del teléfono (prioridad), NO fusiona, y lo anota", async () => {
    const db = world([
      { id: "c-tel", workspace_id: WS, phone: "+50688881234", display_name: "Del teléfono" },
      { id: "c-mail", workspace_id: WS, email: "b@b.com", display_name: "Del email" },
    ]);
    const out = await run(db, { phone: "+506 8888-1234", email: "b@b.com" }, config({ update: "overwrite" }));
    expect(out).toMatchObject({ ok: true, contactId: "c-tel", conflict: [{ by: "email", contact_id: "c-mail" }] });
    expect(db.rows("contacts")).toHaveLength(2);
    // El email es de OTRO contacto: no se escribe en este (dejaria dos con el mismo email).
    expect(db.rows("contacts").find((c) => c.id === "c-tel")!.email).toBeUndefined();
    expect(db.rows("audit_log")[0].metadata).toMatchObject({ conflicts: [{ by: "email", contact_id: "c-mail" }] });
  });
});

describe("tags y campos personalizados", () => {
  it("los tags se suman (fijos por id y desde el payload por nombre) y no se repiten", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Ana" }], { contact_tags: [{ contact_id: "c-1", tag_id: "tag-vip" }] });
    const cfg = config({ tags: { fixed: ["tag-vip"], fromSource: { path: "tags" } } });
    const out = await run(db, { email: "a@b.com", tags: "lead, inexistente" }, cfg);
    expect(db.rows("contact_tags").map((r) => r.tag_id).sort()).toEqual(["tag-lead", "tag-vip"]);
    expect(out.ok && out.notes).toContain("tag_inexistente:inexistente");
  });

  it("un campo personalizado se completa si está vacío y respeta la política", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Ana" }], { contact_custom_fields: [{ contact_id: "c-1", field_id: "cf-1", value: "ACME" }] });
    const cfg = config({ map: [row("contact.email", "email"), row("contact.custom.empresa", "empresa")] });
    await run(db, { email: "a@b.com", empresa: "Otra SA" }, cfg);
    expect(db.rows("contact_custom_fields")[0].value).toBe("ACME");
    const over = await run(db, { email: "a@b.com", empresa: "Otra SA" }, { ...cfg, update: "overwrite" });
    expect(db.rows("contact_custom_fields")[0].value).toBe("Otra SA");
    expect(over.ok && over.diff["custom.empresa"]).toEqual({ before: "ACME", after: "Otra SA" });
  });
});

describe("el toque (F14)", () => {
  it("anota un toque webhook con las UTMs detectadas, también para un contacto nuevo", async () => {
    const db = world();
    const out = await run(db, { email: "a@b.com", hidden: { utm_source: "facebook", utm_content: "120215" } });
    expect(out.ok && out.touch).toMatchObject({ recorded: true, source: "facebook", medium: "form", content: "120215" });
    expect(db.rows("contact_touches")).toHaveLength(1);
    expect(db.rows("contact_touches")[0]).toMatchObject({ origin: "webhook", source: "facebook", content: "120215", dedupe_key: "webhook:in-1:n-1" });
  });

  it("sin nada de atribución igual hay un toque webhook con medium form", async () => {
    const db = world();
    await run(db, { email: "a@b.com" });
    expect(db.rows("contact_touches")[0]).toMatchObject({ origin: "webhook", source: "webhook", medium: "form" });
  });

  it("un contacto que ya existía y NO tenía toques: antes recibe un toque ancla manual y el webhook queda último", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Ana", created_at: "2025-01-01T00:00:00Z" }]);
    await run(db, { email: "a@b.com" });
    const touches = db.rows("contact_touches");
    expect(touches.map((t) => t.origin)).toEqual(["manual", "webhook"]);
    expect(touches[0]).toMatchObject({ occurred_at: "2025-01-01T00:00:00.000Z", dedupe_key: "manual:c-1" });
  });

  it("un contacto que ya tenía toques NO recibe el ancla", async () => {
    const db = world([{ id: "c-1", workspace_id: WS, email: "a@b.com", display_name: "Ana" }], { contact_touches: [{ id: "t0", contact_id: "c-1", origin: "dm", dedupe_key: "msg:1" }] });
    await run(db, { email: "a@b.com" });
    expect(db.rows("contact_touches").map((t) => t.origin)).toEqual(["dm", "webhook"]);
  });

  it("reprocesar el mismo envío NO crea un segundo contacto ni un segundo toque", async () => {
    const db = world();
    await run(db, { email: "a@b.com", name: "Ana" });
    await run(db, { email: "a@b.com", name: "Ana" });
    expect(db.rows("contacts")).toHaveLength(1);
    expect(db.rows("contact_touches")).toHaveLength(1);
  });

  it("si anotar el toque falla, el paso termina «Listo» igual", async () => {
    const db = memoryDb(
      { workspaces: [{ id: WS, timezone: "UTC" }], custom_field_definitions: [], contacts: [], contact_custom_fields: [], contact_channels: [], contact_touches: [], tags: [], contact_tags: [], audit_log: [] },
      {
        rpc: {
          find_contact_for_form: () => ({ contact_id: null, matched_by: null, conflicts: [] }),
          record_contact_touch: () => {
            throw new Error("se cayo");
          },
        },
      },
    );
    const out = await run(db, { email: "a@b.com" });
    expect(out).toMatchObject({ ok: true, result: "created" });
  });
});
