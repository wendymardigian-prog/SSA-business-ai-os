/**
 * Lo que HOY puede un Member, fijado antes de tocar nada (F68).
 *
 * El bloque 9 cambia como se decide un permiso: de un booleano `role ===
 * "admin"` a una tabla de roles con claves. Es la zona mas delicada del
 * sistema, porque un error hace que alguien vea leads que no son suyos y
 * nadie se entera hasta que pasa.
 *
 * Este test no prueba el codigo nuevo: prueba el que YA ESTA. Recorre las
 * paginas y las acciones de verdad, mira que guard usa cada una, y lo
 * compara con una tabla escrita a mano. Si el bloque 9 cambia un guard sin
 * querer, este test falla nombrando el archivo.
 *
 * La tabla es la fuente: `SYSTEM_ROLE_PERMISSIONS.member` se deriva de ella,
 * no al revés. Así lo que un Member puede después es exactamente lo que
 * podía antes, y cualquier diferencia es una decisión explícita.
 */

import { visibleNavItems } from "@/lib/nav/items";
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NAV_ITEMS } from "@/lib/nav/items";
import { SYSTEM_ROLE_PERMISSIONS } from "@/lib/auth/permissions";

const ROOT = resolve(__dirname, "../..");

const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");

/**
 * Las paginas que HOY son solo de Owner/Admin.
 *
 * Cada una usa `requireWorkspaceAdmin`, que rebota al dashboard. Un Member
 * que escribe la URL a mano tampoco entra.
 *
 * Social y el dashboard de contenido salieron de esta lista en F78 (Contenido
 * v3): pasaron a pedir un permiso (`social.view`, `dashboards.content.view`)
 * y estan en `PERMISSION_PAGES`, mas abajo.
 */
/**
 * Las paginas que eran de Owner/Admin y pasaron a pedir un permiso (Equipo y roles). Siguen siendo
 * inaccesibles para un Member de sistema: la clave que piden NO esta en su lista. Cada pagina que sale
 * de `ADMIN_PAGES` entra aca con su clave, asi el total de "paginas de Admin de hoy" sigue siendo once.
 */
const MIGRATED_ADMIN_PAGES = [
  ["app/(dashboard)/dashboard/settings/team/page.tsx", "team.view", 'requirePermission("team.view")'],
  // General se parte en dos por permiso: la abre quien tiene `settings.general` o `sales.settings` (el Member, ninguna).
  ["app/(dashboard)/dashboard/settings/custom-fields/page.tsx", "custom_fields.manage", 'requirePermission("custom_fields.manage")'],
  // Ventas (F36): el historial de todo el workspace; ahora lo ve quien tiene `audit.view`.
  ["app/(dashboard)/dashboard/settings/actividad/page.tsx", "audit.view", 'requirePermission("audit.view")'],
  ["app/(dashboard)/dashboard/channels/page.tsx", "channels.manage", 'requirePermission("channels.manage")'],
  ["app/(dashboard)/dashboard/dashboards/unified/page.tsx", "dashboards.unified.view", 'requirePermission("dashboards.unified.view")'],
  ["app/(dashboard)/dashboard/knowledge/page.tsx", "knowledge.view", 'requirePermission("knowledge.view")'],
  ["app/(dashboard)/dashboard/knowledge/[documentId]/page.tsx", "knowledge.view", 'requirePermission("knowledge.view")'],
  ["app/(dashboard)/dashboard/agents/tareas/[task]/page.tsx", "ai_tasks.manage", 'requireAnyPermission(["ai_tasks.manage", "calls.configure"])'],
  [
    "app/(dashboard)/dashboard/settings/integrations/[providerId]/page.tsx",
    "integrations.view",
    'requireAnyPermission(["integrations.view", "integrations.manage", "channels.manage"])',
  ],
  [
    "app/(dashboard)/dashboard/settings/page.tsx",
    "settings.general",
    'requireAnyPermission(["settings.general", "sales.settings"])',
  ],
] as const;

const ADMIN_PAGES = [
] as const;

/**
 * Las paginas que un Member SI puede abrir.
 *
 * No usan `requireWorkspaceAdmin`: lo que ve adentro lo acota la RLS (el
 * scope de leads), no el guard.
 */
const MEMBER_PAGES = [
  // La bandeja vive en un grupo de rutas: (comunicacion) agrupa Inbox,
  // Secuencias y Growth bajo las mismas pestañas.
  "app/(dashboard)/dashboard/(comunicacion)/inbox/page.tsx",
  "app/(dashboard)/dashboard/contacts/page.tsx",
  "app/(dashboard)/dashboard/flows/page.tsx",
  "app/(dashboard)/dashboard/content/page.tsx",
  "app/(dashboard)/dashboard/agents/page.tsx",
  // Corridas (Bloque A+R, D8): ex pestaña del agente, ahora global. Un
  // Member la abre igual; sin ai_costs.view no ve costo ni tokens, y la
  // RLS ya lo deja ver solo los runs de sus conversaciones.
  "app/(dashboard)/dashboard/agents/runs/page.tsx",
  "app/(dashboard)/dashboard/dashboards/chat/page.tsx",
] as const;

/** Los archivos de acciones que HOY exigen Owner/Admin en todo lo que hacen. */
const ADMIN_ACTION_FILES = [
] as const;

/**
 * Los archivos de acciones que eran de Owner/Admin y pasaron a pedir un permiso (Equipo y roles).
 * Siguen siendo imposibles para un Member de sistema: ninguna de sus claves esta en su lista.
 */
const MIGRATED_ADMIN_ACTION_FILES = [
  ["lib/actions/workspace.ts", ["settings.general", "ai_tasks.manage"]],
  ["lib/actions/custom-fields.ts", ["custom_fields.manage"]],
  ["lib/actions/sequences.ts", ["sequences.edit"]],
  ["lib/actions/agents.ts", ["agents.edit", "ai_limits.manage"]],
  ["lib/actions/knowledge.ts", ["knowledge.edit"]],
  ["lib/actions/integrations.ts", ["integrations.manage", "channels.manage", "agents.edit"]],
  ["lib/actions/meta-accounts.ts", ["integrations.manage"]],
  ["lib/actions/metrics.ts", ["integrations.manage"]],
  ["lib/actions/patterns.ts", ["ai_tasks.manage"]],
  ["lib/actions/tag-effects.ts", ["tags.manage"]],
] as const;

/**
 * Los archivos donde un Member SI puede hacer algo.
 *
 * `contacts.ts` y `opt-out.ts` usan `getAdminContext` para ALGUNAS acciones
 * (borrar, importar) y `getWorkspace` para otras: por eso estan en las dos
 * listas y lo que importa es cada accion, no el archivo.
 */
const MEMBER_ACTION_FILES = [
  "lib/actions/content.ts",
  "lib/actions/content-review.ts",
  "lib/actions/content-media.ts",
  "lib/actions/content-versions.ts",
  "lib/actions/content-schedule.ts",
  "lib/actions/contacts.ts",
  "lib/actions/opt-out.ts",
] as const;

/**
 * Lo que un Member puede hacer en contenido, y lo que no.
 *
 * Es el unico modulo donde el permiso no es "todo o nada": crea y edita sus
 * piezas, las manda a revision, y NO aprueba ni programa. Ese reparto es lo
 * que el bloque 9 tiene que conservar.
 */
const MEMBER_CONTENT = {
  puede: ["create", "isAuthor"],
  noPuede: ["approve", "publish"],
} as const;

describe("caracterizacion: las paginas que hoy son de Owner/Admin (F68)", () => {
  it("todas usan requireWorkspaceAdmin", () => {
    const sinGuard = ADMIN_PAGES.filter((page) => !read(page).includes("requireWorkspaceAdmin"));

    expect(sinGuard, `estas paginas dejaron de exigir Admin: ${sinGuard.join(", ")}`).toEqual([]);
  });

  it("son exactamente once, y estan todas en el repo", () => {
    // El numero importa: si aparece una pagina nueva de Admin sin sumarla
    // aca, el bloque 9 puede cambiarle el guard sin que nadie lo note.
    // (Bloque G suma el detalle de una integracion, G5. F78 saca Social y el
    // dashboard de contenido: pasaron a un permiso. AT4 (F32) saca el dashboard
    // de Ads: pide `dashboards.ads.view`, que es lo que ya anunciaba `available.ts`.)
    // Integraciones (la lista) deja de ser de Admin: la abre todo el equipo (M8); por eso son diez.
    expect(ADMIN_PAGES.length + MIGRATED_ADMIN_PAGES.length).toBe(10);
    for (const page of [...ADMIN_PAGES, ...MIGRATED_ADMIN_PAGES.map(([p]) => p)]) {
      expect(existsSync(join(ROOT, page)), page).toBe(true);
    }
  });

  it.each(MIGRATED_ADMIN_PAGES)("%s ahora pide %s y un Member de sistema sigue sin entrar", (page, key, marker) => {
    expect(read(page)).toContain(marker);
    expect(read(page)).not.toContain("requireWorkspaceAdmin");
    expect(SYSTEM_ROLE_PERMISSIONS.member.keys).not.toContain(key);
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toContain(key);
    expect(SYSTEM_ROLE_PERMISSIONS.owner.keys).toContain(key);
  });

  it("no hay ninguna otra pagina con requireWorkspaceAdmin", async () => {
    // La lista de arriba tiene que ser completa: una pagina de Admin que no
    // este listada queda fuera de la caracterizacion.
    const { readdirSync, statSync } = await import("node:fs");

    const pages: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) walk(full);
        else if (entry === "page.tsx") pages.push(full.slice(ROOT.length + 1));
      }
    };
    walk(join(ROOT, "app"));

    const guarded = pages.filter((page) => read(page).includes("requireWorkspaceAdmin")).sort();

    expect(guarded).toEqual([...ADMIN_PAGES].sort());
  });
});

/**
 * Las paginas que pasaron de "Owner/Admin" a un permiso (F78).
 *
 * Owner y Admin tienen todas las claves, asi que para ellos no cambia nada. Lo
 * que cambia es que un rol personalizado puede darselas a un Member: el rol
 * "Content Manager" tiene las dos.
 */
const PERMISSION_PAGES = [
  ["app/(dashboard)/dashboard/social/page.tsx", "social.view"],
  ["app/(dashboard)/dashboard/dashboards/content/page.tsx", "dashboards.content.view"],
  ["app/(dashboard)/dashboard/dashboards/agenda/page.tsx", "dashboards.agenda.view"],
  // Extra L (AT4, F32): el dashboard de Ads pide su permiso, no el cargo (Owner y Admin lo tienen siempre).
  ["app/(dashboard)/dashboard/dashboards/ads/page.tsx", "dashboards.ads.view"],
  // Ventas (Etapa 5): la lista pide sales.view; el detalle de un producto, la
  // misma products.manage que la lista de Productos.
  ["app/(dashboard)/dashboard/ventas/page.tsx", "sales.view"],
  // Tareas (Extra A): la pantalla pide tasks.view (el Member de sistema lo tiene).
  ["app/(dashboard)/dashboard/tareas/page.tsx", "tasks.view"],
  ["app/(dashboard)/dashboard/settings/productos/[id]/page.tsx", "products.manage"],
] as const;

describe("caracterizacion: las paginas que piden un permiso (F78)", () => {
  it.each(PERMISSION_PAGES)("%s pide %s y ya no pide Admin", (page, key) => {
    const source = read(page);

    expect(source).toContain(`requirePermission("${key}")`);
    expect(source).not.toContain("requireWorkspaceAdmin");
  });

  it("las acciones de contenido deciden por permiso, no por cargo", () => {
    // Antes `content-review.ts` miraba `isAdminRole`: un rol con
    // `content.approve` no podia aprobar. Ahora es la clave.
    for (const file of ["lib/actions/content-review.ts", "lib/actions/content.ts", "lib/actions/content-schedule.ts"]) {
      expect(read(file), file).not.toContain("isAdminRole");
    }
    expect(read("lib/actions/content-review.ts")).toContain('can("content.approve")');
    expect(read("lib/actions/content-review.ts")).toContain('can("content.publish")');
  });
});

describe("caracterizacion: la banca de recursos decide por permiso (banca v2, F4)", () => {
  const source = read("lib/actions/response-assets.ts");

  it("crear, editar y borrar piden templates.manage, no el cargo", () => {
    // Antes era getAdminContext: un rol personalizado con la clave no podia
    // crear nada. La RLS de la 00131 acepta la clave igual que aca.
    expect(source).toContain('const MANAGE = "templates.manage"');
    expect(source).toMatch(/getPermissionAction\(MANAGE\)/);
    expect(source).not.toContain("getAdminContext");
    expect(source).not.toContain("isAdminRole");
    expect(read("supabase/migrations/00131_response_assets_six_kinds.sql")).toContain(
      "public.has_permission(workspace_id, 'templates.manage')",
    );
  });

  it("el Member de sistema la ve y la usa, pero no la administra", () => {
    expect(SYSTEM_ROLE_PERMISSIONS.member.keys).not.toContain("templates.manage");
    expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toContain("templates.manage");
    // La pantalla no tiene guard de pagina: la abre cualquier miembro.
    const page = read("app/(dashboard)/dashboard/settings/recursos/page.tsx");
    expect(page).not.toContain("requireWorkspaceAdmin");
    expect(page).not.toContain("requirePermission(");
  });
});

describe("caracterizacion: las paginas que un Member abre (F68)", () => {
  it("ninguna exige Admin", () => {
    const conGuard = MEMBER_PAGES.filter((page) => read(page).includes("requireWorkspaceAdmin"));

    expect(conGuard, `estas paginas empezaron a exigir Admin: ${conGuard.join(", ")}`).toEqual([]);
  });

  it("existen todas", () => {
    for (const page of MEMBER_PAGES) {
      expect(existsSync(join(ROOT, page)), page).toBe(true);
    }
  });
});

describe("caracterizacion: las acciones de Owner/Admin (F68)", () => {
  it("todas piden getAdminContext o requireWorkspaceAdmin", () => {
    const sinGuard = ADMIN_ACTION_FILES.filter((file) => {
      const source = read(file);
      return !source.includes("getAdminContext") && !source.includes("requireWorkspaceAdmin");
    });

    expect(sinGuard, `estos archivos dejaron de exigir Admin: ${sinGuard.join(", ")}`).toEqual([]);
  });

  it.each(MIGRATED_ADMIN_ACTION_FILES)("%s ahora pide %j y un Member de sistema sigue sin poder", (file, keys) => {
    const source = read(file);
    expect(source).not.toContain("getAdminContext");
    for (const key of keys) {
      expect(source, `${file} deberia pedir ${key}`).toContain(`getPermissionAction("${key}")`);
      expect(SYSTEM_ROLE_PERMISSIONS.member.keys).not.toContain(key);
      expect(SYSTEM_ROLE_PERMISSIONS.admin.keys).toContain(key);
    }
  });

  it("ninguna accion de Admin usa getWorkspace a secas", () => {
    // `getWorkspace` devuelve el rol pero no lo exige: usarlo en una accion
    // de Admin sin chequear despues es exactamente como se cuela un permiso.
    for (const file of ADMIN_ACTION_FILES) {
      const source = read(file);
      const usesPlain = /getWorkspace\(\)/.test(source);
      const guards = source.includes("getAdminContext") || source.includes("requireWorkspaceAdmin");
      expect(!usesPlain || guards, file).toBe(true);
    }
  });
});

describe("caracterizacion: lo que un Member hace en contenido (F68)", () => {
  const status = read("lib/content/status.ts");
  const review = read("lib/content/review.ts");

  it("el reparto de contenido esta escrito en las reglas puras, no en la pantalla", () => {
    // Si estuviera solo en los componentes, el bloque 9 podria cambiar el
    // permiso sin que ningun test se entere.
    for (const key of [...MEMBER_CONTENT.puede, ...MEMBER_CONTENT.noPuede]) {
      expect(status.includes(key) || review.includes(key), key).toBe(true);
    }
  });

  it("aprobar exige el permiso de aprobar, no el de crear", () => {
    expect(review).toMatch(/canApprove[\s\S]*?perms\.approve/);
  });

  it("programar exige el permiso de publicar", () => {
    expect(read("lib/content/schedule.ts")).toContain("publish");
  });

  it("un autor puede mandar su pieza a revision", () => {
    expect(review).toMatch(/canRequestReview[\s\S]*?isAuthor/);
  });
});

describe("caracterizacion: el menu (F68)", () => {
  // Bloque N (requerimientos v2.0, seccion 4, N2): Channels sale del menu (su
  // pantalla se conserva, se llega desde Integraciones) e Integraciones entra
  // con el mismo criterio adminOnly que sus vecinas de siempre. Settings e
  // Inbox se renombran a Ajustes y Bandeja; Contacts y Flows, a Contactos y
  // Automatizaciones. Ninguna clave de PERMISSION_KEYS se agrego para esto.
  // Equipo y roles (B1): `adminOnly` desaparecio. El menu se calcula con las claves de cada rol, y la
  // lista de lo que ve el Member de sistema es EXACTAMENTE la de siempre (este test no se afloja).
  const memberMenu = () =>
    visibleNavItems(NAV_ITEMS, { permissionKeys: SYSTEM_ROLE_PERMISSIONS.member.keys, flags: { eod: true } })
      .map((item) => item.name)
      .sort();

  it("las cuatro entradas que el Member NO ve son las de hoy: Ajustes, Conocimiento, Integraciones y Social", () => {
    const visibles = memberMenu();
    const ocultas = NAV_ITEMS.map((item) => item.name).filter((n) => !visibles.includes(n)).sort();

    // Social salio de "solo Admin" en F78: ya no es por cargo, es por el permiso `social.view`.
    expect(ocultas).toEqual(["Ajustes", "Conocimiento", "Integraciones", "Social"]);
  });

  it("las demas las ve un Member", () => {
    // "Agenda" (Etapa 4) y "Social" (F78) se filtran por permiso (`permissions`). El Member de sistema
    // ve Agenda porque tiene scheduling.use y bookings.view, y NO ve Social: no tiene social.view.
    expect(memberMenu()).toEqual([
      "Agenda",
      "Agentes IA",
      "Automatizaciones",
      "Bandeja",
      "Contactos",
      "Contenido",
      "Dashboards",
      // Formularios (alcance v7.1 §4.5): el Member de sistema tiene forms.view.
      "Formularios",
      // Llamadas (decision 152): el Member de sistema tiene calls.view.
      "Llamadas",
      // Reporte de fin de día (E10): no pide permiso, pide estar en la audiencia de un
      // EOD publicado (condición del servidor, `requires: "eod"`).
      "Mi reporte del día",
      // Banca v2 (F3): la misma pantalla que la pestaña de Ajustes, visible
      // para todos. Crear y editar los decide templates.manage.
      "Recursos",
      // Tareas (Extra A): el Member de sistema tiene tasks.view (alcance own).
      "Tareas",
      // Ventas (Etapa 5): el Member de sistema tiene sales.view (alcance own).
      "Ventas",
    ]);
  });
});

describe("caracterizacion: el scope de leads en la base (F68)", () => {
  const migration = read("supabase/migrations/ALL_MIGRATIONS.sql");

  it("can_see_contact y can_see_conversation existen", () => {
    // Son las dos funciones que el bloque 9 reescribe por dentro. Si
    // desaparecieran, el scope de leads dejaria de aplicarse en la base.
    expect(migration).toContain("can_see_contact");
    expect(migration).toContain("can_see_conversation");
  });

  it("el scope se evalua en la base, no solo en la pantalla", () => {
    expect(migration).toMatch(/can_see_contact/);
    expect(migration).toContain("is_workspace_admin");
  });
});
