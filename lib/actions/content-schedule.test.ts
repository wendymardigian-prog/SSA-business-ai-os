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
        caption: "Un caption de prueba",
        // El servidor ahora valida lo que se programa (F77): una pieza sin
        // media no sale en Instagram, YouTube ni TikTok. Un video corto basta.
        media: [
          {
            storage_path: `${WS}/${POST}/video.mp4`,
            mime_type: "video/mp4",
            kind: "video",
            size_bytes: 5_000_000,
            width: 1080,
            height: 1920,
            duration_ms: 30_000,
          },
        ],
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
      networks: [{ platform: "youtube", planned_at: at, options: {}, youtube_title: "Un titulo" }],
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
      { platform: "youtube", planned_at: enDosHoras, options: {}, youtube_title: "Un titulo" },
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
      networks: [{ platform: "youtube", planned_at: enUnaHora, options: {}, youtube_title: "Un titulo" }],
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

describe("F77 · el servidor valida y cuenta el tope diario", () => {
  const tiktokOptions = {
    privacyLevel: "PUBLIC_TO_EVERYONE",
    contentPreviewConfirmed: true,
    expressConsentGiven: true,
  };

  /** Una red de TikTok lista para programar, con su cuenta. */
  function seedTiktok(media: unknown[]) {
    const at = seed({
      networks: [{ platform: "tiktok", planned_at: new Date(Date.now() + 60 * 60_000).toISOString(), options: tiktokOptions }],
      accounts: [{ id: "acc-tt", workspace_id: WS, platform: "tiktok", is_active: true, default_publisher: "zernio" }],
    });
    db.rows("content_posts")[0].media = media;
    return at;
  }

  const photo = {
    storage_path: `${WS}/${POST}/foto.jpg`,
    mime_type: "image/jpeg",
    kind: "image",
    size_bytes: 1_000_000,
  };

  /** `n` publicaciones de TikTok ya agendadas para el mismo instante. */
  const alreadyScheduled = (n: number, mediaType: string, at: string) =>
    Array.from({ length: n }, (_, i) => ({
      id: `previa-${mediaType}-${i}`,
      workspace_id: WS,
      content_post_id: `otra-${i}`,
      platform: "tiktok",
      status: "scheduled",
      media_type: mediaType,
      scheduled_at: at,
      deleted_at: null,
    }));

  it("rechaza lo que la validacion rechaza, aunque el editor lo haya dejado pasar", async () => {
    // Una llamada directa a la accion (sin pasar por el editor) con un caption
    // que Instagram no acepta: antes de F77 esto se programaba igual.
    db.rows("content_posts")[0].caption = "x".repeat(2300);

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2300 caracteres y instagram acepta 2200/);
    expect(db.rows("social_posts")).toHaveLength(0);
  });

  it("el mensaje es el mismo que muestra el editor", async () => {
    const { validateNetwork } = await import("@/lib/content/validation");
    db.rows("content_posts")[0].media = [];

    const result = await scheduleNetworks({ postId: POST });

    const delEditor = validateNetwork({ platform: "instagram", text: "Un caption de prueba", media: [], options: {} }).errors.join(" ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(delEditor);
  });

  it("una red con errores no frena a las demas", async () => {
    const at = new Date(Date.now() + 60 * 60_000).toISOString();
    seed({
      networks: [
        { platform: "instagram", planned_at: at, options: {} },
        { platform: "youtube", planned_at: at, options: {} }, // sin titulo: no sale
      ],
      accounts: [
        { id: "acc-1", workspace_id: WS, platform: "instagram", is_active: true, default_publisher: "zernio" },
        { id: "acc-yt", workspace_id: WS, platform: "youtube", is_active: true, default_publisher: "youtube_api" },
      ],
    });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.scheduled).toEqual(["instagram"]);
      expect(result.data.skipped[0].platform).toBe("youtube");
      expect(result.data.skipped[0].reason).toMatch(/titulo/i);
    }
  });

  it("TikTok: con 15 videos ya agendados ese dia, el 16 se rechaza nombrando el limite", async () => {
    seedTiktok([{ ...photo, kind: "video", mime_type: "video/mp4", storage_path: `${WS}/${POST}/v.mp4`, duration_ms: 20_000 }]);
    const plannedAt = String((db.rows("content_posts")[0].networks as Array<{ planned_at: string }>)[0].planned_at);
    db.rows("social_posts").push(...alreadyScheduled(15, "video", plannedAt));

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/15 videos de tiktok ese dia y el limite es 15/);
    expect(db.rows("social_posts").filter((r) => r.content_post_id === POST)).toHaveLength(0);
  });

  it("TikTok: los 15 videos NO bloquean una publicacion de fotos", async () => {
    seedTiktok([photo]);
    const plannedAt = String((db.rows("content_posts")[0].networks as Array<{ planned_at: string }>)[0].planned_at);
    db.rows("social_posts").push(...alreadyScheduled(15, "video", plannedAt));

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
  });

  it("la fila guarda el tipo de lo que se manda, para poder contar el tope", async () => {
    seedTiktok([photo, { ...photo, storage_path: `${WS}/${POST}/foto2.jpg` }]);

    await scheduleNetworks({ postId: POST });

    expect(db.rows("social_posts").find((r) => r.content_post_id === POST)?.media_type).toBe("carousel");
  });
});

describe("F93 · el servidor valida el formato y los archivos de cada red", () => {
  const at = () => new Date(Date.now() + 60 * 60_000).toISOString();

  const img = (name: string) => ({
    id: name,
    storage_path: `${WS}/${POST}/${name}.jpg`,
    mime_type: "image/jpeg",
    kind: "image",
    size_bytes: 1_000_000,
  });

  /** Una pieza con un video y tres imagenes en la biblioteca, e Instagram con ese formato. */
  function seedFormat(network: Record<string, unknown>) {
    seed({ networks: [{ platform: "instagram", planned_at: at(), options: {}, ...network }] });
    const video = (db.rows("content_posts")[0].media as unknown[])[0];
    db.rows("content_posts")[0].media = [video, img("i1"), img("i2"), img("i3")];
  }

  it("CRITERIO: un carrusel con un solo archivo NO se programa, aunque se salteen el editor", async () => {
    seedFormat({ format: "carousel", files: ["i1"] });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("Faltan archivos: este formato pide entre 2 y 10");
    expect(db.rows("social_posts")).toHaveLength(0);
  });

  it("el mensaje es el mismo que muestra el editor", async () => {
    const { validateNetwork } = await import("@/lib/content/validation");
    seedFormat({ format: "carousel", files: ["i1"] });

    const result = await scheduleNetworks({ postId: POST });

    const delEditor = validateNetwork({
      platform: "instagram",
      text: "Un caption de prueba",
      format: "carousel",
      media: [img("i1")] as never,
      options: {},
    }).errors.join(" ");
    expect(result.ok === false && result.error).toBe(delEditor);
  });

  it("un carrusel con 3 imagenes se programa y la fila guarda el tipo", async () => {
    seedFormat({ format: "carousel", files: ["i3", "i1", "i2"] });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
    expect(db.rows("social_posts")[0].media_type).toBe("carousel");
  });

  it("el formato Reel marca el tipo aunque las opciones guardadas digan otra cosa", async () => {
    seedFormat({ format: "reel", files: ["video"], options: { contentType: "feed" } });

    await scheduleNetworks({ postId: POST });

    expect(db.rows("social_posts")[0].media_type).toBe("reel");
  });

  it("un Reel con una imagen se rechaza: el archivo no sirve para el formato", async () => {
    seedFormat({ format: "reel", files: ["i1"] });

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("no sirve");
  });

  it("una red del modelo anterior (sin formato ni files) se programa como siempre", async () => {
    seedFormat({});

    const result = await scheduleNetworks({ postId: POST });

    expect(result.ok).toBe(true);
  });
});
