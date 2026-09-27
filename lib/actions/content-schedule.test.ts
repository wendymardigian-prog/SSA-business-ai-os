/**
 * Programar y desprogramar redes (F25) — los bugs del grupo A.
 *
 * Esta accion no tenia ningun test, y por eso pasaron tres errores que dejan
 * el sistema sin publicar nada. Cada caso de aca reproduce uno de esos
 * errores con una pieza creada como la crea la pantalla: sin `publisher`
 * escrito a mano, que es justo lo que los tests del despachador tapaban.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { memoryDb, type MemoryDb } from "@/lib/agent/testing/memory-db";

const WS = "ws-1";
const POST = "post-1";
const USER = "user-1";

let db: MemoryDb;
let role = "owner";
let roleId: string | null = null;

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => undefined) }));
vi.mock("@/lib/workspace", () => ({
  getWorkspace: async () => ({
    user: { id: USER },
    workspace: { id: WS, timezone: "America/Argentina/Buenos_Aires" },
    role,
    roleId,
    supabase: db.client,
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => db.client,
}));

const { scheduleNetworks, unscheduleNetwork } = await import("./content-schedule");

/** Una pieza aprobada con Instagram, tal como la deja `createPost`. */
function seed(over: { networks?: unknown[]; accounts?: Record<string, unknown>[] } = {}) {
  const inOneHour = new Date(Date.now() + 60 * 60_000).toISOString();
  db = memoryDb({
    content_posts: [
      {
        id: POST,
        workspace_id: WS,
        title: "Mi pieza",
        status: "approved",
        // Asi nace una red en `createPost`: sin publisher y con options vacio.
        networks: over.networks ?? [{ platform: "instagram", planned_at: inOneHour, options: {} }],
      },
    ],
    social_accounts: over.accounts ?? [
      { id: "acc-1", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: "zernio" },
    ],
    social_posts: [],
    scheduled_jobs: [],
    workspace_roles: [],
  });
  return inOneHour;
}

beforeEach(() => {
  role = "owner";
  roleId = null;
  seed();
});

describe("A1 · el publicador sale de la cuenta", () => {
  it("programa una pieza creada sin publisher, usando el default de la cuenta", async () => {
    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
    // Sin esto el despachador llama getPublisher("") y falla para siempre.
    expect(db.rows("social_posts")[0].publisher).toBe("zernio");
  });

  it("no programa y explica donde elegirlo si la cuenta tampoco lo tiene", async () => {
    seed({ accounts: [{ id: "acc-1", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: null }] });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("Integraciones");
    // Mentir con una fila "programada" que nunca va a salir es peor que no programar.
    expect(db.rows("social_posts")).toHaveLength(0);
  });
});

describe("A3 · publicar ahora", () => {
  it("publica ahora una red sin fecha, sin pedir 5 minutos de margen", async () => {
    seed({ networks: [{ platform: "instagram", planned_at: null, options: {} }] });

    const result = await scheduleNetworks({ postId: POST, platform: "instagram", now: true });

    expect(result.ok).toBe(true);
    // Instagram va por Zernio, que agenda de su lado: la fila arranca
    // subiendo la media y pasa a programada cuando el post existe alla.
    expect(db.rows("social_posts")[0].status).toBe("uploading");
  });

  it("tambien publica ahora una red cuya fecha ya paso", async () => {
    const ayer = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    seed({ networks: [{ platform: "instagram", planned_at: ayer, options: {} }] });

    const result = await scheduleNetworks({ postId: POST, platform: "instagram", now: true });

    expect(result.ok).toBe(true);
  });
});

/**
 * La base le pone `status = 'pending'` por defecto a cada job; la base en
 * memoria no tiene defaults, asi que se lo ponemos nosotros para que el
 * borrado por estado se pruebe de verdad.
 */
function applyJobDefaults() {
  for (const job of db.rows("scheduled_jobs")) job.status ??= "pending";
}

describe("A4 · reprogramar no deja el job viejo", () => {
  /** Con un publicador que NO agenda de su lado: ahi el job lleva la hora. */
  function seedYoutube(at: string) {
    seed({
      networks: [{ platform: "youtube", planned_at: at, options: {} }],
      accounts: [
        { id: "acc-yt", workspace_id: WS, platform: "youtube", is_active: true, default_publisher: "youtube_api" },
      ],
    });
  }

  it("borra el job pendiente antes de agendar el nuevo", async () => {
    const enUnaHora = new Date(Date.now() + 60 * 60_000).toISOString();
    seedYoutube(enUnaHora);

    await scheduleNetworks({ postId: POST });
    applyJobDefaults();
    expect(db.rows("scheduled_jobs").filter((j) => j.status === "pending")).toHaveLength(1);

    const enDosHoras = new Date(Date.now() + 120 * 60_000).toISOString();
    db.rows("content_posts")[0].networks = [
      { platform: "youtube", planned_at: enDosHoras, options: {} },
    ];

    await scheduleNetworks({ postId: POST });
    applyJobDefaults();

    // Si quedaran los dos, la publicacion saldria a la hora vieja igual.
    const pending = db.rows("scheduled_jobs").filter((j) => j.status === "pending");
    expect(pending).toHaveLength(1);
    expect(new Date(String(pending[0].run_at)).toISOString()).toBe(enDosHoras);
  });

  it("tampoco deja dos con el camino de Zernio", async () => {
    await scheduleNetworks({ postId: POST });
    applyJobDefaults();
    await scheduleNetworks({ postId: POST });
    applyJobDefaults();

    expect(db.rows("scheduled_jobs").filter((j) => j.status === "pending")).toHaveLength(1);
  });
});

describe("D1 · quien agenda, segun el publicador", () => {
  it("Zernio agenda de su lado: la fila espera subiendo y el job corre ya", async () => {
    await scheduleNetworks({ postId: POST });

    expect(db.rows("social_posts")[0].status).toBe("uploading");
    const jobs = db.rows("scheduled_jobs");
    expect(jobs).toHaveLength(1);
    expect(jobs[0].type).toBe("content_provider_schedule");
    // No espera a la hora de salida: eso lo hace Zernio.
    expect(new Date(String(jobs[0].run_at)).getTime()).toBeLessThan(Date.now() + 60_000);
  });

  it("un publicador que NO agenda sigue por la cola, a su hora", async () => {
    const enUnaHora = new Date(Date.now() + 60 * 60_000).toISOString();
    seed({
      networks: [{ platform: "youtube", planned_at: enUnaHora, options: {} }],
      accounts: [
        { id: "acc-yt", workspace_id: WS, platform: "youtube", is_active: true, default_publisher: "youtube_api" },
      ],
    });

    await scheduleNetworks({ postId: POST });

    expect(db.rows("social_posts")[0].status).toBe("scheduled");
    const jobs = db.rows("scheduled_jobs");
    expect(jobs[0].type).toBe("content_upload");
    expect(new Date(String(jobs[0].run_at)).toISOString()).toBe(enUnaHora);
  });
});

describe("A16 · solo cuentas activas", () => {
  it("no engancha la publicacion a una cuenta desactivada", async () => {
    seed({
      accounts: [
        { id: "vieja", workspace_id: WS, platform: "instagram", is_active: false, default_publisher: "zernio" },
        { id: "acc-1", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: "zernio" },
      ],
    });

    await scheduleNetworks({ postId: POST });

    expect(db.rows("social_posts")[0].social_account_id).toBe("acc-1");
  });
});

describe("A20 · programar pide el permiso, no el cargo", () => {
  it("un Member comun no programa", async () => {
    role = "member";

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toContain("publicar");
  });

  it("un rol personalizado con content.publish SI programa", async () => {
    role = "member";
    roleId = "rol-1";
    db.rows("workspace_roles").push({
      id: "rol-1",
      workspace_id: WS,
      system_role: null,
      permissions: {
        keys: ["content.view", "content.create", "content.publish"],
        scopes: { leads: "all", conversations: "all" },
      },
    });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
  });
});

describe("desprogramar sigue andando", () => {
  it("cancela la fila, borra el job y conserva la fecha tentativa", async () => {
    await scheduleNetworks({ postId: POST });

    applyJobDefaults();
    const result = await unscheduleNetwork({ postId: POST, platform: "instagram" });

    expect(result.ok).toBe(true);
    expect(db.rows("social_posts")[0].status).toBe("cancelled");
    expect(db.rows("scheduled_jobs").filter((j) => j.status === "pending")).toHaveLength(0);
  });
});
