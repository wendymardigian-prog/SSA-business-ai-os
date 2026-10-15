import { beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";
import { defaultCommissionRoles } from "@/lib/commissions/roles";

const WS = "11111111-1111-4111-8111-111111111111";
const OTHER_WS = "99999999-9999-4999-8999-999999999999";
const ME = "22222222-2222-4222-8222-222222222222";
const ANA = "33333333-3333-4333-8333-333333333333";
const STRANGER = "44444444-4444-4444-8444-444444444444";
const PRODUCT = "55555555-5555-4555-8555-555555555555";
const FOREIGN_PRODUCT = "66666666-6666-4666-8666-666666666666";
const VARIANT = "77777777-7777-4777-8777-777777777777";

let db: MemoryDb;
let allowed: Set<string>;
const audits: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", async (orig) => ({ ...(await orig<typeof import("@/lib/audit")>()), logAudit: vi.fn(async (a: Record<string, unknown>) => { audits.push(a); return "a"; }) }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => db.client }));
vi.mock("@/lib/workspace-members", () => ({
  getWorkspaceMembers: async () => [
    { userId: ME, name: "Yo", role: "owner", email: "" },
    { userId: ANA, name: "Ana", role: "member", email: "" },
  ],
}));
vi.mock("@/lib/auth/guards", () => ({
  getPermissionAction: async (key: string) =>
    allowed.has(key) ? { supabase: db.client, user: { id: ME }, workspace: { id: WS, timezone: "America/Costa_Rica" } } : null,
}));

const actions = await import("./commission-rules");

const ruleInput = (over: Record<string, unknown> = {}) => ({ name: "Vendedor 8 %", calcType: "percent", rate: 8, base: "gross", ...over });
const uniquePosition = (a: Record<string, unknown>, b: Record<string, unknown>) =>
  a.workspace_id === b.workspace_id && a.role === b.role && a.position === b.position && a.archived_at == null && b.archived_at == null;

const seedRule = (over: Record<string, unknown> = {}) => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1", workspace_id: WS, name: "Regla", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 8, fixed_amount: null, base: "gross",
  beneficiary_user_id: null, hold_days: 0, valid_from: null, valid_until: null, is_active: true, archived_at: null, updated_at: "2026-10-01T00:00:00Z", ...over,
});
const ruleId = (n: number) => `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${n}`;

function seed(extra: Record<string, Array<Record<string, unknown>>> = {}) {
  return memoryDb(
    {
      workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles(), otra_clave: "se conserva" }, payment_methods: null }],
      commission_rules: [],
      products: [{ id: PRODUCT, workspace_id: WS }, { id: FOREIGN_PRODUCT, workspace_id: OTHER_WS }],
      product_variants: [{ id: VARIANT, workspace_id: WS, product_id: PRODUCT }],
      content_posts: [],
      ...extra,
    },
    { unique: { commission_rules: uniquePosition } },
  );
}

/** Hace fallar toda actualización de reglas desde la `n`-ésima (para probar el reordenamiento que se corta a la mitad). */
function failUpdatesFrom(target: MemoryDb, n: number, onlyThat = false) {
  let count = 0;
  const original = target.client.from.bind(target.client);
  (target.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
    const builder = original(table as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
    if (table !== "commission_rules") return builder;
    const update = builder.update;
    builder.update = (values: unknown) => {
      count += 1;
      if (count < n || (onlyThat && count > n)) return update(values);
      const failing: unknown = new Proxy({}, { get: (_t, prop) => (prop === "then" ? (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "boom" } }).then(ok) : () => failing) });
      return failing;
    };
    return builder;
  };
}

const positions = (role = "vendedor") =>
  db.rows("commission_rules").filter((r) => r.role === role && !r.archived_at).sort((a, b) => Number(a.position) - Number(b.position)).map((r) => [r.id, r.position]);

beforeEach(() => {
  audits.length = 0;
  allowed = new Set(["commissions.manage"]);
  db = seed();
});

describe("permisos", () => {
  it("sin commissions.manage, ninguna acción escribe", async () => {
    allowed = new Set(["commissions.view", "expenses.manage"]);
    const roles = defaultCommissionRoles();
    const results = [
      await actions.updateCommissionRoles(roles),
      await actions.createCommissionRule("vendedor", ruleInput()),
      await actions.updateCommissionRule(ruleId(1), ruleInput()),
      await actions.duplicateCommissionRule(ruleId(1)),
      await actions.setCommissionRuleActive(ruleId(1), false),
      await actions.archiveCommissionRule(ruleId(1)),
      await actions.reorderCommissionRules("vendedor", []),
      await actions.previewCommissions({ paymentId: ruleId(1) }),
    ];
    for (const r of results) expect(r).toEqual({ ok: false, error: "No tenés permiso para administrar las comisiones" });
    expect(audits).toHaveLength(0);
    expect(db.rows("commission_rules")).toHaveLength(0);
  });
});

describe("roles", () => {
  const withNew = () => [...defaultCommissionRoles().map(({ key, name, payee, active }) => ({ key, name, payee, active })), { key: "marketing", name: "Marketing", payee: "fixed", active: true }];

  it("agrega un rol, conserva el resto del jsonb, lo deja como no precargado y audita", async () => {
    const r = await actions.updateCommissionRoles(withNew());
    expect(r).toMatchObject({ ok: true, changed: true });
    const saved = db.rows("workspaces")[0].commission_settings as { roles: Array<Record<string, unknown>>; otra_clave: string };
    expect(saved.otra_clave).toBe("se conserva");
    expect(saved.roles.find((x) => x.key === "marketing")).toMatchObject({ name: "Marketing", payee: "fixed", active: true, system: false });
    expect(typeof saved.roles.find((x) => x.key === "marketing")?.created_at).toBe("string");
    expect(audits[0]).toMatchObject({ entityType: "workspace", entityId: WS, action: "commission.roles_updated", performedBy: ME });
  });

  it("el cliente no decide `system`: un rol nuevo que dice ser del sistema queda como del negocio", async () => {
    const r = await actions.updateCommissionRoles([...withNew().slice(0, 4), { key: "marketing", name: "Marketing", payee: "fixed", active: true, system: true }]);
    expect(r.ok).toBe(true);
    const saved = db.rows("workspaces")[0].commission_settings as { roles: Array<Record<string, unknown>> };
    expect(saved.roles.find((x) => x.key === "marketing")?.system).toBe(false);
  });

  it("renombra y desactiva un precargado", async () => {
    const roles = withNew().map((r) => (r.key === "pauta" ? { ...r, name: "Publicidad", active: false } : r));
    expect(await actions.updateCommissionRoles(roles)).toMatchObject({ ok: true });
    const saved = db.rows("workspaces")[0].commission_settings as { roles: Array<Record<string, unknown>> };
    expect(saved.roles.find((x) => x.key === "pauta")).toMatchObject({ name: "Publicidad", active: false, system: true, payee: "fixed" });
  });

  it("no se borra un rol: dice por qué y no escribe", async () => {
    const r = await actions.updateCommissionRoles(withNew().filter((x) => x.key !== "setter"));
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("no se puede borrar") });
    expect(r.ok === false && r.issues?.[0].code).toBe("key_removed");
    expect(audits).toHaveLength(0);
    expect((db.rows("workspaces")[0].commission_settings as { roles: unknown[] }).roles).toHaveLength(4);
  });

  it("no cambia a quién se le paga, ni se repite un nombre, ni una clave inválida", async () => {
    expect(await actions.updateCommissionRoles(withNew().map((r) => (r.key === "setter" ? { ...r, payee: "sale_vendedor" } : r)))).toMatchObject({ ok: false, error: expect.stringContaining("a quién se le paga") });
    expect(await actions.updateCommissionRoles(withNew().map((r) => (r.key === "marketing" ? { ...r, name: "setter" } : r)))).toMatchObject({ ok: false, error: expect.stringContaining("Ya hay un rol") });
    expect(await actions.updateCommissionRoles(withNew().map((r) => (r.key === "marketing" ? { ...r, key: "Marketing!" } : r)))).toMatchObject({ ok: false });
    expect(await actions.updateCommissionRoles("basura")).toEqual({ ok: false, error: "Los roles no son válidos" });
  });

  it("sin cambios no escribe ni audita", async () => {
    const r = await actions.updateCommissionRoles(defaultCommissionRoles().map(({ key, name, payee, active }) => ({ key, name, payee, active })));
    expect(r).toMatchObject({ ok: true, changed: false });
    expect(audits).toHaveLength(0);
  });

  it("si la base rechaza (CM002), el mensaje es claro y no se muestra el error técnico", async () => {
    const original = db.client.from.bind(db.client);
    (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table as never) as unknown as Record<string, unknown>;
      if (table === "workspaces") b.update = () => ({ eq: () => ({ select: async () => ({ data: null, error: { code: "CM002", message: "Un rol de comision no se borra: se desactiva (x)." } }) }) });
      return b;
    };
    const r = await actions.updateCommissionRoles(withNew());
    expect(r).toEqual({ ok: false, error: "Un rol de comisión no se borra: se desactiva." });
  });
});

describe("crear una regla", () => {
  it("va AL FINAL de su rol: max+1 entre las no archivadas", async () => {
    db = seed({ commission_rules: [seedRule({ id: ruleId(1), position: 1 }), seedRule({ id: ruleId(2), position: 2 }), seedRule({ id: ruleId(3), position: 9, archived_at: "2026-01-01" }), seedRule({ id: ruleId(4), role: "setter", position: 1 })] });
    const r = await actions.createCommissionRule("vendedor", ruleInput());
    expect(r).toMatchObject({ ok: true, position: 3 });
    const created = db.rows("commission_rules").find((x) => x.id === (r as { id: string }).id)!;
    expect(created).toMatchObject({ workspace_id: WS, role: "vendedor", position: 3, name: "Vendedor 8 %", calc_type: "percent", rate: 8, fixed_amount: null, created_by: ME, updated_by: ME });
    expect(audits[0]).toMatchObject({ entityType: "commission_rule", action: "commission_rule.created", metadata: { role: "vendedor" } });
    expect((audits[0].changes as Record<string, unknown>).position).toEqual({ old: null, new: 3 });
  });

  it("dos altas seguidas no repiten posición", async () => {
    await actions.createCommissionRule("vendedor", ruleInput({ name: "A" }));
    await actions.createCommissionRule("vendedor", ruleInput({ name: "B" }));
    expect(positions().map(([, p]) => p)).toEqual([1, 2]);
  });

  it("si otra alta se llevó la posición, reintenta con la siguiente", async () => {
    db = seed();
    const original = db.client.from.bind(db.client);
    let raced = false;
    (db.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
      if (table !== "commission_rules") return b;
      const insert = b.insert;
      b.insert = (values: unknown) => {
        if (!raced) {
          raced = true;
          db.rows("commission_rules").push(seedRule({ id: ruleId(7), position: 1 })); // «la otra persona» llegó primero
        }
        return insert(values);
      };
      return b;
    };
    const r = await actions.createCommissionRule("vendedor", ruleInput());
    expect(r).toMatchObject({ ok: true, position: 2 });
  });

  it("valida con el esquema del rol: porcentaje obligatorio; un rol de persona fija pide la persona", async () => {
    expect(await actions.createCommissionRule("vendedor", ruleInput({ rate: null }))).toEqual({ ok: false, error: "Poné el porcentaje" });
    expect(await actions.createCommissionRule("pauta", ruleInput())).toMatchObject({ ok: false, error: expect.stringContaining("persona fija") });
    expect(await actions.createCommissionRule("pauta", ruleInput({ beneficiaryUserId: ANA }))).toMatchObject({ ok: true });
    expect(db.rows("commission_rules")).toHaveLength(1);
  });

  it("el rol sale del workspace de la sesión: uno que no existe o está desactivado no sirve", async () => {
    expect(await actions.createCommissionRule("inventado", ruleInput())).toEqual({ ok: false, error: "Ese rol no existe" });
    expect(await actions.createCommissionRule("No Valido", ruleInput())).toEqual({ ok: false, error: "El rol no es válido" });
    const roles = defaultCommissionRoles().map((r) => (r.key === "setter" ? { ...r, active: false } : r));
    db = seed();
    db.rows("workspaces")[0].commission_settings = { roles };
    expect(await actions.createCommissionRule("setter", ruleInput())).toMatchObject({ ok: false, error: expect.stringContaining("desactivado") });
  });

  it("el `role` que venga adentro del input no pisa el de la pestaña", async () => {
    const r = await actions.createCommissionRule("setter", ruleInput({ role: "vendedor" }));
    expect(r.ok).toBe(true);
    expect(db.rows("commission_rules")[0].role).toBe("setter");
  });

  it("comprueba contra el workspace: producto de otro negocio, variante inexistente, persona ajena, método desconocido, pieza ajena", async () => {
    expect(await actions.createCommissionRule("vendedor", ruleInput({ conditions: { product_ids: [FOREIGN_PRODUCT] } }))).toEqual({ ok: false, error: "Uno de los productos elegidos no existe" });
    expect(await actions.createCommissionRule("vendedor", ruleInput({ conditions: { variant_ids: ["88888888-8888-4888-8888-888888888888"] } }))).toEqual({ ok: false, error: "Una de las variantes elegidas no existe" });
    expect(await actions.createCommissionRule("vendedor", ruleInput({ conditions: { vendedor_ids: [STRANGER] } }))).toEqual({ ok: false, error: "Una de las personas elegidas no es del equipo" });
    expect(await actions.createCommissionRule("pauta", ruleInput({ beneficiaryUserId: STRANGER }))).toEqual({ ok: false, error: "Una de las personas elegidas no es del equipo" });
    expect(await actions.createCommissionRule("vendedor", ruleInput({ conditions: { payment_methods: ["efectivo"] } }))).toEqual({ ok: false, error: "Uno de los métodos de pago elegidos no existe" });
    expect(await actions.createCommissionRule("vendedor", ruleInput({ conditions: { content_post_ids: ["88888888-8888-4888-8888-888888888888"] } }))).toEqual({ ok: false, error: "Una de las piezas elegidas no existe" });
    expect(db.rows("commission_rules")).toHaveLength(0);
    const ok = await actions.createCommissionRule("vendedor", ruleInput({ conditions: { product_ids: [PRODUCT], variant_ids: [VARIANT], vendedor_ids: [ANA], payment_methods: ["whop"], channels: [], utm: { campaign: { op: "contains", values: ["webinar"] } } } }));
    expect(ok.ok).toBe(true);
    // lo que no limita se limpia antes de guardar
    expect(db.rows("commission_rules")[0].conditions).toEqual({ product_ids: [PRODUCT], variant_ids: [VARIANT], vendedor_ids: [ANA], payment_methods: ["whop"], utm: { campaign: { op: "contains", values: ["webinar"] } } });
  });
});

describe("editar, duplicar, pausar", () => {
  beforeEach(() => {
    db = seed({ commission_rules: [seedRule({ id: ruleId(1), position: 1, name: "Primera" }), seedRule({ id: ruleId(2), position: 2, name: "Segunda", conditions: { vendedor_ids: [STRANGER] } })] });
  });

  it("editar guarda solo lo que cambió y deja el antes y el después", async () => {
    const r = await actions.updateCommissionRule(ruleId(1), ruleInput({ name: "Primera", rate: 12 }));
    expect(r).toEqual({ ok: true, changed: true });
    expect(db.rows("commission_rules")[0]).toMatchObject({ rate: 12, updated_by: ME, role: "vendedor", position: 1 });
    expect(audits[0]).toMatchObject({ action: "commission_rule.updated", entityId: ruleId(1), changes: { rate: { old: 8, new: 12 } } });
    expect(Object.keys(audits[0].changes as object)).toEqual(["rate"]);
  });

  it("sin cambios no escribe ni audita", async () => {
    expect(await actions.updateCommissionRule(ruleId(1), ruleInput({ name: "Primera" }))).toEqual({ ok: true, changed: false });
    expect(audits).toHaveLength(0);
  });

  it("el rol no cambia; una regla de otro workspace, archivada o inexistente no se toca", async () => {
    expect(await actions.updateCommissionRule(ruleId(1), ruleInput({ role: "setter" }))).toMatchObject({ ok: false, error: expect.stringContaining("no cambia de rol") });
    db.rows("commission_rules").push(seedRule({ id: ruleId(5), workspace_id: OTHER_WS }), seedRule({ id: ruleId(6), archived_at: "2026-01-01", position: 5 }));
    expect(await actions.updateCommissionRule(ruleId(5), ruleInput())).toEqual({ ok: false, error: "Esa regla no existe" });
    expect(await actions.updateCommissionRule(ruleId(6), ruleInput())).toEqual({ ok: false, error: "Una regla archivada no se edita" });
    expect(await actions.updateCommissionRule("no-es-uuid", ruleInput())).toEqual({ ok: false, error: "Esa regla no existe" });
  });

  it("puede seguir editando una regla que nombra a alguien que ya salió del equipo, pero no sumar a otra persona ajena", async () => {
    expect((await actions.updateCommissionRule(ruleId(2), ruleInput({ name: "Segunda", rate: 9, conditions: { vendedor_ids: [STRANGER] } }))).ok).toBe(true);
    expect(await actions.updateCommissionRule(ruleId(2), ruleInput({ name: "Segunda", conditions: { vendedor_ids: [STRANGER, "99999999-0000-4000-8000-000000000001"] } }))).toEqual({ ok: false, error: "Una de las personas elegidas no es del equipo" });
  });

  it("si cambió mientras se editaba, lo dice", async () => {
    expect(await actions.updateCommissionRule(ruleId(1), ruleInput({ rate: 3 }), "2020-01-01T00:00:00Z")).toMatchObject({ ok: false, error: expect.stringContaining("Alguien cambió") });
  });

  it("duplicar crea una copia al final, con la misma configuración", async () => {
    const r = await actions.duplicateCommissionRule(ruleId(2));
    expect(r).toMatchObject({ ok: true, position: 3 });
    const copy = db.rows("commission_rules").find((x) => x.id === (r as { id: string }).id)!;
    expect(copy).toMatchObject({ name: "Segunda (copia)", role: "vendedor", position: 3, conditions: { vendedor_ids: [STRANGER] }, rate: 8 });
    expect(audits[0]).toMatchObject({ action: "commission_rule.created", metadata: { duplicated_from: ruleId(2) } });
  });

  it("duplicar corta el nombre a 120 caracteres", async () => {
    db.rows("commission_rules")[0].name = "x".repeat(120);
    const r = await actions.duplicateCommissionRule(ruleId(1));
    expect(String(db.rows("commission_rules").find((x) => x.id === (r as { id: string }).id)?.name)).toHaveLength(120);
  });

  it("pausar y reactivar: audita cada vez y no hace nada si ya estaba así", async () => {
    expect(await actions.setCommissionRuleActive(ruleId(1), false)).toEqual({ ok: true, changed: true });
    expect(db.rows("commission_rules")[0].is_active).toBe(false);
    expect(audits[0]).toMatchObject({ action: "commission_rule.paused", changes: { is_active: { old: true, new: false } } });
    expect(await actions.setCommissionRuleActive(ruleId(1), false)).toEqual({ ok: true, changed: false });
    expect(await actions.setCommissionRuleActive(ruleId(1), true)).toEqual({ ok: true, changed: true });
    expect(audits.map((a) => a.action)).toEqual(["commission_rule.paused", "commission_rule.resumed"]);
    expect(await actions.setCommissionRuleActive(ruleId(1), "si" as never)).toMatchObject({ ok: false });
  });
});

describe("archivar", () => {
  it("libera la posición y renumera 1..N sin dejar huecos ni repetidos", async () => {
    db = seed({ commission_rules: [1, 2, 3, 4].map((n) => seedRule({ id: ruleId(n), position: n })) });
    expect(await actions.archiveCommissionRule(ruleId(2))).toEqual({ ok: true });
    const archived = db.rows("commission_rules").find((r) => r.id === ruleId(2))!;
    expect(typeof archived.archived_at).toBe("string");
    expect(positions()).toEqual([[ruleId(1), 1], [ruleId(3), 2], [ruleId(4), 3]]);
    expect(audits[0]).toMatchObject({ action: "commission_rule.archived", entityId: ruleId(2), metadata: { role: "vendedor", position: 2 } });
  });

  it("no toca las reglas de otros roles ni se archiva dos veces", async () => {
    db = seed({ commission_rules: [seedRule({ id: ruleId(1), position: 1 }), seedRule({ id: ruleId(2), position: 2 }), seedRule({ id: ruleId(3), role: "setter", position: 5 })] });
    await actions.archiveCommissionRule(ruleId(1));
    expect(db.rows("commission_rules").find((r) => r.id === ruleId(3))?.position).toBe(5);
    expect(await actions.archiveCommissionRule(ruleId(1))).toEqual({ ok: false, error: "Esta regla ya está archivada" });
    expect(await actions.archiveCommissionRule(ruleId(9))).toEqual({ ok: false, error: "Esa regla no existe" });
  });

  it("nada se borra: la fila sigue", async () => {
    db = seed({ commission_rules: [seedRule({ id: ruleId(1), position: 1 })] });
    await actions.archiveCommissionRule(ruleId(1));
    expect(db.rows("commission_rules")).toHaveLength(1);
  });
});

describe("reordenar", () => {
  beforeEach(() => {
    db = seed({ commission_rules: [1, 2, 3, 4, 5].map((n) => seedRule({ id: ruleId(n), position: n })) });
  });

  it("deja el orden pedido, sin que dos reglas vivas compartan posición en ningún momento (lo exige la restricción simulada)", async () => {
    const order = [ruleId(3), ruleId(1), ruleId(5), ruleId(2), ruleId(4)];
    expect(await actions.reorderCommissionRules("vendedor", order)).toEqual({ ok: true, changed: true });
    expect(positions()).toEqual(order.map((id, i) => [id, i + 1]));
  });

  it("audita una vez por cada regla que cambió de lugar", async () => {
    await actions.reorderCommissionRules("vendedor", [ruleId(1), ruleId(2), ruleId(4), ruleId(3), ruleId(5)]);
    expect(audits.map((a) => [a.entityId, a.action, a.changes])).toEqual([
      [ruleId(4), "commission_rule.reordered", { position: { old: 4, new: 3 } }],
      [ruleId(3), "commission_rule.reordered", { position: { old: 3, new: 4 } }],
    ]);
  });

  it("el mismo orden no escribe nada", async () => {
    expect(await actions.reorderCommissionRules("vendedor", [1, 2, 3, 4, 5].map(ruleId))).toEqual({ ok: true, changed: false });
    expect(audits).toHaveLength(0);
  });

  it("rechaza una lista que no sea EXACTAMENTE las reglas vivas del rol", async () => {
    const msg = "Las reglas cambiaron mientras las ordenabas. Recargá para ver las de ahora.";
    expect(await actions.reorderCommissionRules("vendedor", [1, 2, 3, 4].map(ruleId))).toEqual({ ok: false, error: msg });
    expect(await actions.reorderCommissionRules("vendedor", [...[1, 2, 3, 4, 5].map(ruleId), ruleId(8)])).toEqual({ ok: false, error: msg });
    expect(await actions.reorderCommissionRules("vendedor", [1, 1, 3, 4, 5].map(ruleId))).toEqual({ ok: false, error: msg });
    expect(await actions.reorderCommissionRules("vendedor", [1, 2, 3, 4, 9].map(ruleId))).toEqual({ ok: false, error: msg });
    expect(await actions.reorderCommissionRules("vendedor", ["no-uuid"])).toEqual({ ok: false, error: "El orden no es válido" });
    expect(positions().map(([, p]) => p)).toEqual([1, 2, 3, 4, 5]);
  });

  it("una regla archivada no cuenta como viva (no hay que mandarla)", async () => {
    db.rows("commission_rules").push(seedRule({ id: ruleId(8), position: 9, archived_at: "2026-01-01" }));
    expect((await actions.reorderCommissionRules("vendedor", [5, 4, 3, 2, 1].map(ruleId))).ok).toBe(true);
  });

  it("si UNA actualización falla a la mitad, vuelve al orden de antes", async () => {
    failUpdatesFrom(db, 3, true);
    const r = await actions.reorderCommissionRules("vendedor", [5, 4, 3, 2, 1].map(ruleId));
    expect(r).toMatchObject({ ok: false });
    expect(positions()).toEqual([1, 2, 3, 4, 5].map((n) => [ruleId(n), n]));
    expect(audits).toHaveLength(0);
  });

  it("si la vuelta atrás también falla, nunca deja posiciones repetidas", async () => {
    failUpdatesFrom(db, 3);
    const r = await actions.reorderCommissionRules("vendedor", [5, 4, 3, 2, 1].map(ruleId));
    expect(r.ok).toBe(false);
    expect(audits).toHaveLength(0);
    // sin repetidos aunque la vuelta atrás también haya fallado (todas las actualizaciones desde la 3.ª fallan)
    const ps = positions().map(([, p]) => p);
    expect(new Set(ps).size).toBe(ps.length);
  });
});

describe("probar con una venta no escribe nada", () => {
  const PAYMENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
  const SALE = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
  const TOUCH = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const facts = {
    payment: { id: PAYMENT, type: "installment", amount: 500, paid_on: "2026-10-15", method: "whop", fee_amount: 14.8, number: 1 },
    sale: { id: SALE, status: "pending_payment", financing_type: "installments", final_amount: 1500, product_id: PRODUCT, variant_id: VARIANT, setter_id: ANA, vendedor_id: ME, contact_id: null },
    touch: null,
    content_assignee_id: null,
  };

  /** Una base que ANOTA cualquier escritura (insert, update, delete, upsert) en vez de aplicarla. */
  function spiedDb(seedRows: Record<string, Array<Record<string, unknown>>>) {
    const writes: string[] = [];
    const d = memoryDb(seedRows, {
      rpc: {
        commission_facts: (args) => (args.p_payment_id === PAYMENT ? facts : null),
        commission_content_owner: () => ANA,
      },
    });
    const original = d.client.from.bind(d.client);
    (d.client as unknown as { from: (t: string) => unknown }).from = (table: string) => {
      const b = original(table as never) as unknown as Record<string, (...a: unknown[]) => unknown>;
      for (const op of ["insert", "update", "delete", "upsert"]) {
        const fn = b[op];
        b[op] = (...args: unknown[]) => {
          writes.push(`${op}:${table}`);
          return fn(...args);
        };
      }
      return b;
    };
    return { d, writes };
  }

  const baseSeed = () => ({
    workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() }, payment_methods: null }],
    commission_rules: [seedRule({ id: ruleId(1), position: 1, role: "vendedor", rate: 8 }), seedRule({ id: ruleId(2), position: 1, role: "setter", rate: 5 })],
    payments: [{ id: PAYMENT, workspace_id: WS, sale_id: SALE, type: "installment", status: "paid" }, { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1", workspace_id: OTHER_WS, sale_id: "x", type: "full", status: "paid" }],
    sales: [], product_variants: [], contact_touches: [],
  });

  it("de un cobro real: arma los hechos con la RPC, calcula y NO escribe (ni inserta, ni actualiza, ni audita)", async () => {
    const { d, writes } = spiedDb(baseSeed());
    db = d;
    const r = await actions.previewCommissions({ paymentId: PAYMENT });
    expect(r).toMatchObject({ ok: true, source: "payment", draftRules: 0 });
    if (!r.ok) return;
    expect(r.roles.find((x) => x.roleKey === "vendedor")).toMatchObject({ applies: true, amountCents: 4000, userId: ME, userName: "Yo", rule: { id: ruleId(1), draft: false } });
    expect(r.roles.find((x) => x.roleKey === "setter")).toMatchObject({ applies: true, amountCents: 2500, userName: "Ana" });
    expect(r.totalCents).toBe(6500);
    expect(writes).toEqual([]);
    expect(audits).toHaveLength(0);
    expect(d.rpcCalls.map((c) => c.name)).toEqual(["commission_facts"]);
  });

  it("las reglas sin guardar reemplazan por id o se suman, y se marcan", async () => {
    const { d, writes } = spiedDb(baseSeed());
    db = d;
    const r = await actions.previewCommissions({
      paymentId: PAYMENT,
      draftRules: [
        { id: ruleId(1), name: "Vendedor 20", role: "vendedor", position: 1, conditions: {}, calc_type: "percent", rate: 20, base: "gross", is_active: true },
        { id: "draft-nueva", name: "Setter fija", role: "setter", position: 1, conditions: {}, calc_type: "fixed", fixed_amount: 30, base: "gross", is_active: true },
      ],
    });
    expect(r).toMatchObject({ ok: true, draftRules: 2 });
    if (!r.ok) return;
    expect(r.roles.find((x) => x.roleKey === "vendedor")).toMatchObject({ amountCents: 10000, rule: { id: ruleId(1), draft: true } });
    // la sin guardar (posición 1, mismo lugar que la guardada) NO le gana a la de la base si empata: las dos están en 1 y la guardada va primero
    expect(r.roles.find((x) => x.roleKey === "setter")?.rule?.id).toBe(ruleId(2));
    expect(writes).toEqual([]);
    // la base no cambió
    expect(d.rows("commission_rules").find((x) => x.id === ruleId(1))?.rate).toBe(8);
  });

  it("unas reglas sin guardar inválidas se rechazan sin leer nada más", async () => {
    const { d } = spiedDb(baseSeed());
    db = d;
    expect(await actions.previewCommissions({ paymentId: PAYMENT, draftRules: [{ id: "d", role: "vendedor", position: 1, conditions: { inventada: [1] }, calc_type: "percent", rate: 5 }] })).toEqual({ ok: false, error: "Las reglas de la pantalla no son válidas" });
    expect(d.rpcCalls).toHaveLength(0);
  });

  it("un cobro de otro workspace o que no existe no se lee", async () => {
    const { d } = spiedDb(baseSeed());
    db = d;
    expect(await actions.previewCommissions({ paymentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1" })).toEqual({ ok: false, error: "Ese cobro no existe" });
    expect(await actions.previewCommissions({ paymentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee9" })).toEqual({ ok: false, error: "Ese cobro no existe" });
    expect(d.rpcCalls).toHaveLength(0);
    expect(await actions.previewCommissions({})).toEqual({ ok: false, error: "Elegí un cobro o una venta con un monto" });
  });

  it("de una venta (cobro hipotético): el número de pago es el siguiente a los vivos y el responsable de la pieza sale de la RPC", async () => {
    const seedRows = {
      ...baseSeed(),
      sales: [
        { id: SALE, workspace_id: WS, status: "pending_payment", financing_type: "installments", final_amount: 1500, product_variant_id: VARIANT, product_snapshot: {}, setter_id: ANA, vendedor_id: ME, contact_id: null, attribution_touch_id: TOUCH },
        { id: "cccccccc-cccc-4ccc-8ccc-ccccccccccc9", workspace_id: OTHER_WS, status: "paid", financing_type: "full", final_amount: 10, product_variant_id: null, product_snapshot: {}, setter_id: null, vendedor_id: null, contact_id: null, attribution_touch_id: null },
      ],
      product_variants: [{ id: VARIANT, workspace_id: WS, product_id: PRODUCT }],
      contact_touches: [{ id: TOUCH, workspace_id: WS, channel: "organic", source: "instagram", medium: "dm", campaign: null, content_label: null, term: null, content_post_id: "ffffffff-ffff-4fff-8fff-fffffffffff1", social_post_id: null, meta_ad_id: null, meta_adset_id: null, meta_campaign_id: null }],
      payments: [
        { id: "p1", workspace_id: WS, sale_id: SALE, type: "installment", status: "paid" },
        { id: "p2", workspace_id: WS, sale_id: SALE, type: "installment", status: "scheduled" },
        { id: "p3", workspace_id: WS, sale_id: SALE, type: "refund", status: "paid" },
        { id: "p4", workspace_id: WS, sale_id: SALE, type: "installment", status: "cancelled" },
      ],
      commission_rules: [
        seedRule({ id: ruleId(1), position: 1, role: "vendedor", rate: 10, conditions: { payment_number: { from: 3, to: 3 } } }),
        seedRule({ id: ruleId(3), position: 1, role: "contenido", calc_type: "fixed", rate: null, fixed_amount: 15, conditions: { channels: ["organic"] } }),
      ],
      workspaces: [{ id: WS, commission_settings: { roles: defaultCommissionRoles() }, payment_methods: [{ key: "whop", name: "Whop", fee_percent: 3, fee_fixed: 0, active: true, created_at: "2026-10-01T00:00:00Z" }] }],
    };
    const { d, writes } = spiedDb(seedRows);
    db = d;
    const r = await actions.previewCommissions({ saleId: SALE, amountCents: 50000, method: "whop" });
    expect(r).toMatchObject({ ok: true, source: "hypothetical" });
    if (!r.ok) return;
    expect(r.facts.payment).toMatchObject({ number: 3, type: "installment", amount: 500, method: "whop", fee_amount: 15, id: "hypothetical" });
    expect(r.facts.sale).toMatchObject({ product_id: PRODUCT, variant_id: VARIANT, vendedor_id: ME, setter_id: ANA });
    expect(r.facts.content_assignee_id).toBe(ANA);
    expect(r.roles.find((x) => x.roleKey === "vendedor")).toMatchObject({ applies: true, amountCents: 5000, rule: { id: ruleId(1) } });
    expect(r.roles.find((x) => x.roleKey === "contenido")).toMatchObject({ applies: true, amountCents: 1500, userId: ANA });
    expect(writes).toEqual([]);
    expect(d.rpcCalls.map((c) => c.name)).toEqual(["commission_content_owner"]);
    expect(d.rpcCalls[0].args).toMatchObject({ p_workspace: WS });
  });

  it("una venta de otro workspace o un método que no existe se rechazan", async () => {
    const { d } = spiedDb({ ...baseSeed(), sales: [{ id: SALE, workspace_id: OTHER_WS, status: "paid", financing_type: "full", final_amount: 10, product_variant_id: null, product_snapshot: {}, setter_id: null, vendedor_id: null, contact_id: null, attribution_touch_id: null }] });
    db = d;
    expect(await actions.previewCommissions({ saleId: SALE, amountCents: 1000, method: "whop" })).toEqual({ ok: false, error: "Esa venta no existe" });
    expect(await actions.previewCommissions({ saleId: SALE, amountCents: 0, method: null })).toMatchObject({ ok: false });
  });
});
