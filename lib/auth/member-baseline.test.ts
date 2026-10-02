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

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { NAV_ITEMS } from "@/lib/nav/items";

const ROOT = resolve(__dirname, "../..");

const read = (relativePath: string) => readFileSync(join(ROOT, relativePath), "utf8");

/**
 * Las paginas que HOY son solo de Owner/Admin.
 *
 * Cada una usa `requireWorkspaceAdmin`, que rebota al dashboard. Un Member
 * que escribe la URL a mano tampoco entra.
 */
const ADMIN_PAGES = [
  "app/(dashboard)/dashboard/channels/page.tsx",
  "app/(dashboard)/dashboard/dashboards/ads/page.tsx",
  "app/(dashboard)/dashboard/dashboards/content/page.tsx",
  "app/(dashboard)/dashboard/dashboards/unified/page.tsx",
  "app/(dashboard)/dashboard/knowledge/page.tsx",
  "app/(dashboard)/dashboard/knowledge/[documentId]/page.tsx",
  "app/(dashboard)/dashboard/settings/page.tsx",
  "app/(dashboard)/dashboard/settings/background/page.tsx",
  "app/(dashboard)/dashboard/settings/custom-fields/page.tsx",
  "app/(dashboard)/dashboard/settings/integrations/page.tsx",
  "app/(dashboard)/dashboard/settings/integrations/[providerId]/page.tsx",
  "app/(dashboard)/dashboard/settings/team/page.tsx",
  "app/(dashboard)/dashboard/social/page.tsx",
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
  "app/(dashboard)/dashboard/dashboards/chat/page.tsx",
] as const;

/** Los archivos de acciones que HOY exigen Owner/Admin en todo lo que hacen. */
const ADMIN_ACTION_FILES = [
  "lib/actions/agents.ts",
  "lib/actions/custom-fields.ts",
  "lib/actions/integrations.ts",
  "lib/actions/knowledge.ts",
  "lib/actions/meta-accounts.ts",
  "lib/actions/metrics.ts",
  "lib/actions/patterns.ts",
  "lib/actions/sequences.ts",
  "lib/actions/tag-effects.ts",
  "lib/actions/response-assets.ts",
  "lib/actions/workspace.ts",
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

  it("son exactamente trece, y estan todas en el repo", () => {
    // El numero importa: si aparece una pagina nueva de Admin sin sumarla
    // aca, el bloque 9 puede cambiarle el guard sin que nadie lo note.
    // (Bloque G suma el detalle de una integracion, G5.)
    expect(ADMIN_PAGES).toHaveLength(13);
    for (const page of ADMIN_PAGES) {
      expect(existsSync(join(ROOT, page)), page).toBe(true);
    }
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
  it("las cuatro entradas de Admin son las de hoy, con Integraciones en vez de Channels", () => {
    const adminOnly = NAV_ITEMS.filter((item) => item.adminOnly).map((item) => item.name).sort();

    expect(adminOnly).toEqual(["Ajustes", "Conocimiento", "Integraciones", "Social"]);
  });

  it("las demas las ve un Member", () => {
    const visible = NAV_ITEMS.filter((item) => !item.adminOnly).map((item) => item.name).sort();

    // "Agenda" (Etapa 4) no es adminOnly: se filtra por permiso (`permissions`),
    // y el Member de sistema lo ve porque tiene scheduling.use y bookings.view.
    expect(visible).toEqual([
      "Agenda",
      "Agentes",
      "Automatizaciones",
      "Bandeja",
      "Contactos",
      "Contenido",
      "Dashboards",
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
