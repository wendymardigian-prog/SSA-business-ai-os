/**
 * Caracterizacion de la matriz de acceso (Equipo y roles, regla 2).
 *
 * Fija QUE paginas, acciones, rutas y entradas de menu puede usar hoy cada rol de
 * sistema, recorriendo el codigo real. La foto vive en `access-matrix.baseline.json`
 * y se genero ANTES de tocar ningun permiso.
 *
 * Reglas del test:
 *  - Owner y Admin: tienen que dar IDENTICO a la foto, siempre. No hay lista blanca.
 *  - Member: identico a la foto, salvo las filas de `APPROVED_MEMBER_CHANGES`
 *    (cada una con su motivo y su test propio).
 *  - Una entrada que desaparece o cambia de nombre tambien falla: nadie se escapa
 *    de la matriz renombrando una funcion.
 *
 * Para regenerar la foto (solo al arrancar el modulo; despues NO se toca):
 *   UPDATE_ACCESS_BASELINE=1 npx vitest run lib/auth/access-matrix.characterization.test.ts
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";
import { NAV_ITEMS, visibleNavItems } from "@/lib/nav/items";
import { pageActions } from "@/lib/nav/page-actions";
import { AGENT_TYPES, tabsForViewer } from "@/lib/agent/agent-types";

type Role = "owner" | "admin" | "member";
type Cell = boolean | "partial";
type Triple = [boolean, boolean, Cell];

const ROOT = process.cwd();
const BASELINE_FILE = path.join(ROOT, "lib/auth/access-matrix.baseline.json");

/** Filas del Member que cambian a proposito. Vacio al arrancar. */
export const APPROVED_MEMBER_CHANGES: Record<string, { from: Cell; to: Cell; why: string }> = {
  // M8 (decision del 13/10/2026): la pantalla de Integraciones la abre todo el equipo y un Member ve solo
  // «Mis conexiones»; el menu del Member NO cambia (el item sigue pidiendo integrations.view/manage/channels.manage).
  // M3 (plano §9.3): el Member pierde los webhooks (paginas y acciones). Las acciones se agregan abajo.
  "app/(dashboard)/dashboard/settings/integrations/webhooks/page.tsx": { from: true, to: false, why: "M3: webhooks.manage" },
  "app/(dashboard)/dashboard/settings/integrations/webhooks/[endpointId]/page.tsx": { from: true, to: false, why: "M3: webhooks.manage" },
  // M6 (decision del 13/10/2026): el Member pierde Broadcasts (pagina y API).
  "app/(dashboard)/dashboard/(comunicacion)/broadcasts/page.tsx": { from: true, to: false, why: "M6: broadcasts.manage" },
  "app/api/v1/broadcasts/route.ts#GET": { from: true, to: false, why: "M6: broadcasts.manage" },
  "app/api/v1/broadcasts/route.ts#POST": { from: true, to: false, why: "M6: broadcasts.manage" },
  "app/api/v1/broadcasts/[broadcastId]/send/route.ts#POST": { from: true, to: false, why: "M6: broadcasts.manage" },
  // M1 (plano §9.3): el Member pierde importar contactos.
  "app/(dashboard)/dashboard/contacts/import/page.tsx": { from: true, to: false, why: "M1: contacts.import" },
  "lib/actions/csv-import.ts#startImport": { from: true, to: false, why: "M1: contacts.import" },
  "lib/actions/csv-import.ts#importBatch": { from: true, to: false, why: "M1: contacts.import" },
  "lib/actions/csv-import.ts#finishImport": { from: true, to: false, why: "M1: contacts.import" },
  "app/(dashboard)/dashboard/settings/integrations/page.tsx": {
    from: false,
    to: true,
    why: "M8: Integraciones abre para todos (Mis conexiones); canales y negocio piden sus claves",
  },
};

// M3: todas las acciones de webhooks (los endpoints y el editor de flujos) pasan a `webhooks.manage`.
for (const id of Object.keys((JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as { actions: Record<string, unknown> }).actions)) {
  if (id.startsWith("lib/actions/webhook-endpoints.ts#") || id.startsWith("lib/actions/webhook-flow-editor.ts#")) {
    APPROVED_MEMBER_CHANGES[id] = { from: true, to: false, why: "M3: el Member pierde los webhooks (plano §9.3)" };
  }
}

/** Entradas que el escaner no puede resolver solas. Cada una explica por que. */
const MANUAL: Record<string, Triple> = {
  // Chequeo de rol escrito a mano (`isAdminRole` contra la membresia), no un guard comun.
  "lib/actions/team.ts#inviteTeamMember": [true, true, false],
  "lib/actions/team.ts#revokeInvite": [true, true, false],
  "lib/actions/team.ts#changeMemberRole": [true, true, false],
  // Solo el Owner (`membership.role === "owner"` escrito a mano).
  "lib/actions/team.ts#removeTeamMember": [true, false, false],
  // `isAdminRole` solo decide que contadores mostrar; la RLS decide que ve cada quien.
  "lib/actions/agent-drafts.ts#countPendingDrafts": [true, true, true],
  // Poner la marca puede cualquiera; QUITARLA exige `getAdminContext` (rama parcial).
  "lib/actions/contacts.ts#setDoNotContact": [true, true, "partial"],
};

const toTriple = (v: boolean[]): Triple => [v[0], v[1], v[2]];

// ── Recorrido de archivos ────────────────────────────────────────────────

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, match, out);
    else if (match(full)) out.push(full);
  }
  return out;
}
const rel = (f: string) => path.relative(ROOT, f).split(path.sep).join("/");
const read = (f: string) => readFileSync(f, "utf8");

// ── Guards ───────────────────────────────────────────────────────────────

type Guard =
  | { kind: "admin" }
  | { kind: "owner" }
  | { kind: "perm"; key: string }
  | { kind: "any"; keys: string[] }
  | { kind: "isAdminRole" };

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function constants(src: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of src.matchAll(/\bconst\s+([A-Z_][A-Z0-9_]*)\s*=\s*["'`]([^"'`]+)["'`]/g)) out[m[1]] = m[2];
  return out;
}

function guardsIn(text: string, consts: Record<string, string>): Guard[] {
  const out: Guard[] = [];
  if (/\b(requireWorkspaceAdmin|getAdminContext)\s*\(/.test(text)) out.push({ kind: "admin" });
  if (/\brequireWorkspaceOwner\s*\(/.test(text)) out.push({ kind: "owner" });
  for (const m of text.matchAll(/\b(?:requirePermission|getPermissionAction)\(\s*(?:(["'`])([^"'`]+)\1|([A-Z_][A-Z0-9_]*))\s*\)/g)) {
    const key = m[2] ?? consts[m[3]];
    if (key) out.push({ kind: "perm", key });
  }
  for (const m of text.matchAll(/\b(?:requireAnyPermission|getAnyPermissionAction)\(\s*\[([^\]]*)\]/g)) {
    out.push({ kind: "any", keys: [...m[1].matchAll(/["'`]([^"'`]+)["'`]/g)].map((x) => x[1]) });
  }
  if (/\blistRoles\s*\(/.test(text)) out.push({ kind: "perm", key: "roles.manage" });
  if (/\bloadDetailPage\s*\(/.test(text)) out.push({ kind: "perm", key: "dashboards.ads.view" });
  return out;
}

function evaluate(guards: Guard[], role: Role): boolean {
  const keys = SYSTEM_ROLE_PERMISSIONS[role].keys;
  return guards.every((g) => {
    if (g.kind === "admin") return role !== "member";
    if (g.kind === "owner") return role === "owner";
    if (g.kind === "perm") return keys.includes(g.key);
    if (g.kind === "any") return g.keys.some((k) => keys.includes(k));
    return true;
  });
}
const tripleOf = (guards: Guard[]): Triple => toTriple((["owner", "admin", "member"] as Role[]).map((r) => evaluate(guards, r)));

// ── Funciones exportadas de un archivo ───────────────────────────────────

interface FnBlock { name: string; exported: boolean; body: string }

function functionBlocks(src: string): FnBlock[] {
  const clean = stripComments(src);
  const re = /^(export\s+)?(?:async\s+)?function\s+(\w+)|^(export\s+)?const\s+(\w+)\s*=\s*(?:async\s*)?(?:\(|function)/gm;
  const marks: Array<{ idx: number; name: string; exported: boolean }> = [];
  for (const m of clean.matchAll(re)) marks.push({ idx: m.index ?? 0, name: m[2] ?? m[4], exported: Boolean(m[1] ?? m[3]) });
  return marks.map((mk, i) => ({
    name: mk.name,
    exported: mk.exported,
    body: clean.slice(mk.idx, i + 1 < marks.length ? marks[i + 1].idx : clean.length),
  }));
}

function resolveGuards(block: FnBlock, all: FnBlock[], consts: Record<string, string>, seen = new Set<string>()): Guard[] {
  seen.add(block.name);
  const out = guardsIn(block.body, consts);
  if (/\bisAdminRole\s*\(/.test(block.body)) out.push({ kind: "isAdminRole" });
  for (const other of all) {
    if (other.exported || seen.has(other.name)) continue;
    if (new RegExp(`\\b${other.name}\\s*\\(`).test(block.body)) out.push(...resolveGuards(other, all, consts, seen));
  }
  return out;
}

function scanFunctions(files: string[], methodsOnly = false): Record<string, Triple> {
  const out: Record<string, Triple> = {};
  for (const file of files) {
    const src = read(file);
    const blocks = functionBlocks(src);
    const consts = constants(src);
    for (const b of blocks.filter((x) => x.exported)) {
      if (methodsOnly && !/^(GET|POST|PUT|PATCH|DELETE)$/.test(b.name)) continue;
      const id = `${rel(file)}#${b.name}`;
      const guards = resolveGuards(b, blocks, consts);
      if (id in MANUAL) { out[id] = MANUAL[id]; continue; }
      if (guards.some((g) => g.kind === "isAdminRole")) throw new Error(`Sin clasificar (agregarla a MANUAL): ${id}`);
      out[id] = tripleOf(guards);
    }
  }
  return out;
}

function scanPages(): Record<string, Triple> {
  const out: Record<string, Triple> = {};
  const files = [
    ...walk(path.join(ROOT, "app/(dashboard)"), (f) => f.endsWith("/page.tsx")),
    ...walk(path.join(ROOT, "app/invite"), (f) => f.endsWith("/page.tsx")),
  ];
  for (const file of files) {
    const src = stripComments(read(file));
    const guards = guardsIn(src, constants(src));
    // El layout de Agenda → Configuracion deja pasar solo a quien tiene agenda propia o administra categorias.
    if (rel(file).includes("/agenda/configuracion/")) guards.push({ kind: "any", keys: ["scheduling.use", "scheduling.manage_categories"] });
    out[rel(file)] = tripleOf(guards);
  }
  return out;
}

// ── Lo que se dibuja ─────────────────────────────────────────────────────

const ROLES: Role[] = ["owner", "admin", "member"];

/** Adaptadores: si cambia la firma de una funcion, se cambia ESTO, no la foto. */
function navFor(role: Role): string[] {
  const perms = SYSTEM_ROLE_PERMISSIONS[role];
  return visibleNavItems(NAV_ITEMS, { permissionKeys: perms.keys, flags: { eod: true } }).map((i) => i.name);
}

const ACTION_ROUTES = [
  "/dashboard/settings/integrations", "/dashboard/settings/team", "/dashboard/content", "/dashboard/contacts",
  "/dashboard/flows", "/dashboard/sequences", "/dashboard/broadcasts", "/dashboard/channels",
  "/dashboard/knowledge", "/dashboard/settings/custom-fields", "/dashboard/settings/recursos",
];
function actionsFor(role: Role): Record<string, string[]> {
  const perms = SYSTEM_ROLE_PERMISSIONS[role];
  const out: Record<string, string[]> = {};
  for (const route of ACTION_ROUTES) {
    out[route] = pageActions(route, { permissionKeys: perms.keys }).map((a) => a.id);
  }
  return out;
}

function agentTabsFor(role: Role): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [type, def] of Object.entries(AGENT_TYPES)) {
    out[type] = tabsForViewer(def, (key) => SYSTEM_ROLE_PERMISSIONS[role].keys.includes(key)).tabs.map((t) => t.key);
  }
  return out;
}

function snapshot() {
  const actionFiles = walk(path.join(ROOT, "lib/actions"), (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.includes("/testing/"));
  const routeFiles = walk(path.join(ROOT, "app/api/v1"), (f) => f.endsWith("/route.ts"));
  const rendered: Record<string, unknown> = {};
  for (const r of ROLES) rendered[r] = { nav: navFor(r), pageActions: actionsFor(r), agentTabs: agentTabsFor(r) };
  return {
    pages: scanPages(),
    actions: scanFunctions(actionFiles),
    routes: scanFunctions(routeFiles, true),
    rendered,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────

describe("caracterizacion: la matriz de acceso de Owner, Admin y Member", () => {
  const now = snapshot();

  if (process.env.UPDATE_ACCESS_BASELINE === "1") {
    writeFileSync(BASELINE_FILE, JSON.stringify(now, null, 2) + "\n");
  }
  const base = JSON.parse(read(BASELINE_FILE)) as ReturnType<typeof snapshot>;

  for (const section of ["pages", "actions", "routes"] as const) {
    describe(section, () => {
      it("no desaparece ninguna entrada de la foto", () => {
        const missing = Object.keys(base[section]).filter((id) => !(id in now[section]));
        expect(missing).toEqual([]);
      });

      it("Owner y Admin dan IDENTICO a la foto", () => {
        const diffs = Object.entries(base[section])
          .filter(([id]) => id in now[section])
          .filter(([id, t]) => t[0] !== now[section][id][0] || t[1] !== now[section][id][1])
          .map(([id, t]) => `${id}: antes ${JSON.stringify(t.slice(0, 2))} ahora ${JSON.stringify(now[section][id].slice(0, 2))}`);
        expect(diffs).toEqual([]);
      });

      it("el Member cambia solo en las filas aprobadas", () => {
        const diffs = Object.entries(base[section])
          .filter(([id]) => id in now[section])
          .filter(([id, t]) => t[2] !== now[section][id][2] && !(id in APPROVED_MEMBER_CHANGES))
          .map(([id, t]) => `${id}: antes ${t[2]} ahora ${now[section][id][2]}`);
        expect(diffs).toEqual([]);
      });

      it("cada fila aprobada cambia de verdad y de lo que dice", () => {
        for (const [id, c] of Object.entries(APPROVED_MEMBER_CHANGES)) {
          if (!(id in base[section])) continue;
          expect(base[section][id][2], `${id} (antes)`).toBe(c.from);
          expect(now[section][id]?.[2], `${id} (ahora)`).toBe(c.to);
        }
      });
    });
  }

  describe("lo que se dibuja (menu, botones de cabecera, pestanas del agente)", () => {
    it("Owner y Admin ven EXACTAMENTE lo mismo que antes", () => {
      for (const r of ["owner", "admin"] as const) expect(now.rendered[r]).toEqual(base.rendered[r]);
    });

    it("el menu del Member es el de hoy", () => {
      expect((now.rendered.member as { nav: string[] }).nav).toEqual((base.rendered.member as { nav: string[] }).nav);
    });

    it("las pestanas del agente del Member son las de hoy", () => {
      expect((now.rendered.member as { agentTabs: unknown }).agentTabs).toEqual((base.rendered.member as { agentTabs: unknown }).agentTabs);
    });

    it("los botones de cabecera del Member son los de hoy, salvo los aprobados", () => {
      const actions = JSON.parse(JSON.stringify((now.rendered.member as { pageActions: Record<string, string[]> }).pageActions)) as Record<string, string[]>;
      // Cambio aprobado, plano §9.3: el Member pierde importar contactos (M1), y con eso el boton "Importar".
      actions["/dashboard/contacts"] = ["import", ...actions["/dashboard/contacts"]];
      expect(actions).toEqual((base.rendered.member as { pageActions: Record<string, string[]> }).pageActions);
    });
  });
});
