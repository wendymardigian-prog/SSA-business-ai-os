import { describe, it, expect } from "vitest";
import { computeAccounts, type AccountSources } from "./accounts";
import type { PublisherEntry } from "./accounts-schema";

const sources = (over: Partial<AccountSources> = {}): AccountSources => ({
  zernioChannels: [],
  postproxyConnected: false,
  google: null,
  linkedin: null,
  threads: null,
  existing: [],
  ...over,
});

const google = (scopes: string[], over: Record<string, unknown> = {}) => ({
  status: "active",
  granted_scopes: scopes,
  external_account_id: "UC123",
  account_label: "Mi canal",
  ...over,
});

const TODOS = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

const find = (result: ReturnType<typeof computeAccounts>, platform: string) =>
  result.accounts.find((a) => a.platform === platform);

describe("que cuentas y publicadores salen de lo conectado (F13)", () => {
  it("sin nada conectado no hay cuentas", () => {
    expect(computeAccounts(sources()).accounts).toEqual([]);
  });

  it("un canal de Instagram por Zernio da su cuenta, atada al canal de la bandeja", () => {
    const result = computeAccounts(
      sources({
        zernioChannels: [
          { id: "ch-1", platform: "instagram", late_account_id: "acc-1", username: "minegocio", display_name: "Mi Negocio" },
        ],
      }),
    );

    const ig = find(result, "instagram")!;
    expect(ig.channelId).toBe("ch-1");
    expect(ig.username).toBe("minegocio");
    expect(ig.publishers.map((p) => p.publisher)).toEqual(["zernio"]);
    expect(ig.defaultPublisher).toBe("zernio");
  });

  it("un canal de WhatsApp no es una cuenta social", () => {
    const result = computeAccounts(
      sources({
        zernioChannels: [
          { id: "ch-2", platform: "whatsapp", late_account_id: "evolution:x", username: null, display_name: null },
        ],
      }),
    );

    expect(result.accounts).toEqual([]);
  });

  it("Postproxy y Google conectados: YouTube tiene los dos caminos y usa Postproxy", () => {
    // El criterio de F13: youtube_api queda sin verificar hasta que se pruebe
    // una publicacion directa, asi que el que se usa es Postproxy.
    const result = computeAccounts(sources({ postproxyConnected: true, google: google(TODOS) }));

    const yt = find(result, "youtube")!;
    expect(yt.publishers.map((p) => [p.publisher, p.status])).toEqual([
      ["postproxy", "available"],
      ["youtube_api", "unverified"],
    ]);
    expect(yt.defaultPublisher).toBe("postproxy");
  });

  it("sin el permiso de subir, la API de YouTube queda no disponible y dice por que", () => {
    const result = computeAccounts(
      sources({ google: google(["https://www.googleapis.com/auth/youtube.readonly"]) }),
    );

    const api = find(result, "youtube")!.publishers[0];
    expect(api).toMatchObject({ publisher: "youtube_api", status: "unavailable" });
    expect(api.status_reason).toContain("subir videos");
  });

  it("si se desconecta Postproxy, YouTube cambia de camino y avisa", () => {
    const antes: PublisherEntry[] = [
      { publisher: "postproxy", account_ref: null, status: "available", status_reason: null, verified_at: null, manually_enabled: false },
      { publisher: "youtube_api", account_ref: null, status: "available", status_reason: null, verified_at: "2026-09-01T00:00:00Z", manually_enabled: true },
    ];
    const result = computeAccounts(
      sources({
        postproxyConnected: false,
        google: google(TODOS),
        existing: [{ platform: "youtube", default_publisher: "postproxy", publishers: antes }],
      }),
    );

    const yt = find(result, "youtube")!;
    expect(yt.publishers.map((p) => p.publisher)).toEqual(["youtube_api"]);
    expect(yt.defaultPublisher).toBe("youtube_api");
    expect(yt.defaultChanged).toBe(true);
    expect(result.warnings[0]).toContain("postproxy");
  });

  it("si no queda ninguno, lo dice en vez de dejarlo en silencio", () => {
    const result = computeAccounts(
      sources({
        google: google(["https://www.googleapis.com/auth/youtube.readonly"]),
        existing: [{ platform: "youtube", default_publisher: "postproxy", publishers: [] }],
      }),
    );

    expect(find(result, "youtube")!.defaultPublisher).toBeNull();
    expect(result.warnings[0]).toContain("no queda por donde publicar");
  });

  it("la primera vez no avisa nada: no habia nada elegido", () => {
    const result = computeAccounts(sources({ postproxyConnected: true }));

    expect(find(result, "youtube")!.defaultChanged).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it("se respeta lo elegido a mano mientras siga sirviendo", () => {
    const result = computeAccounts(
      sources({
        postproxyConnected: true,
        google: google(TODOS),
        existing: [
          {
            platform: "youtube",
            default_publisher: "youtube_api",
            publishers: [
              { publisher: "youtube_api", account_ref: null, status: "available", status_reason: null, verified_at: "2026-09-01T00:00:00Z", manually_enabled: true },
            ],
          },
        ],
      }),
    );

    const yt = find(result, "youtube")!;
    expect(yt.defaultPublisher).toBe("youtube_api");
    expect(yt.defaultChanged).toBe(false);
    // Y no se pierde que alguien ya lo habia habilitado y verificado.
    const api = yt.publishers.find((p) => p.publisher === "youtube_api")!;
    expect(api.manually_enabled).toBe(true);
    expect(api.verified_at).toBe("2026-09-01T00:00:00Z");
  });

  it("LinkedIn y Threads conectados dan su cuenta", () => {
    const result = computeAccounts(
      sources({
        linkedin: { status: "active", granted_scopes: [], external_account_id: "urn:li:person:1", account_label: "Wendy M" },
        threads: { status: "active", granted_scopes: [], external_account_id: "9", account_label: "@minegocio" },
      }),
    );

    expect(find(result, "linkedin")!.defaultPublisher).toBe("linkedin_api");
    expect(find(result, "threads")!.displayName).toBe("@minegocio");
  });

  it("una conexion revocada deja la cuenta sin por donde publicar", () => {
    const result = computeAccounts(
      sources({
        threads: { status: "revoked", granted_scopes: [], external_account_id: "9", account_label: "@x" },
      }),
    );

    const threads = find(result, "threads")!;
    expect(threads.publishers[0]).toMatchObject({ status: "unavailable" });
    expect(threads.defaultPublisher).toBeNull();
  });

  it("sincronizar dos veces con lo mismo da lo mismo", () => {
    const base = sources({ postproxyConnected: true, google: google(TODOS) });
    const primera = computeAccounts(base);
    const segunda = computeAccounts({
      ...base,
      existing: primera.accounts.map((a) => ({
        platform: a.platform,
        default_publisher: a.defaultPublisher,
        publishers: a.publishers,
      })),
    });

    expect(segunda.accounts).toEqual(
      primera.accounts.map((a) => ({ ...a, defaultChanged: false })),
    );
    expect(segunda.warnings).toEqual([]);
  });
});
