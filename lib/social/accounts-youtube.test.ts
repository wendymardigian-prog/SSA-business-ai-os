/**
 * Varios canales de YouTube en el mismo negocio (00374): una cuenta por canal,
 * Postproxy en una sola, y un canal desconectado no se borra.
 */
import { describe, it, expect } from "vitest";
import { computeAccounts, type AccountSources, type ExistingAccount } from "./accounts";

const TODOS = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/youtube.upload",
];

const channel = (id: string, label: string, over: Record<string, unknown> = {}) => ({
  status: "active",
  granted_scopes: TODOS,
  external_account_id: id,
  account_label: label,
  ...over,
});

const sources = (over: Partial<AccountSources> = {}): AccountSources => ({
  zernioChannels: [],
  postproxyConnected: false,
  google: null,
  linkedin: null,
  threads: null,
  existing: [],
  ...over,
});

const youtube = (result: ReturnType<typeof computeAccounts>) => result.accounts.filter((a) => a.platform === "youtube");

describe("YouTube con varios canales (00374)", () => {
  it("cada canal es su propia cuenta, con su id y su nombre", () => {
    const result = computeAccounts(sources({ google: [channel("UC-A", "Canal A"), channel("UC-B", "Canal B")] }));

    const accounts = youtube(result);
    expect(accounts.map((a) => [a.externalId, a.displayName])).toEqual([
      ["UC-A", "Canal A"],
      ["UC-B", "Canal B"],
    ]);
    // Cada uno publica con SU canal: el publicador lleva el id.
    expect(accounts.map((a) => a.publishers.find((p) => p.publisher === "youtube_api")?.account_ref)).toEqual([
      "UC-A",
      "UC-B",
    ]);
  });

  it("cada canal actualiza su fila y el nuevo crea otra", () => {
    const existing: ExistingAccount[] = [
      { id: "row-a", platform: "youtube", external_id: "UC-A", default_publisher: "youtube_api", publishers: [] },
    ];
    const result = computeAccounts(sources({ google: [channel("UC-A", "Canal A"), channel("UC-B", "Canal B")], existing }));

    expect(youtube(result).map((a) => a.existingId ?? null)).toEqual(["row-a", null]);
  });

  it("la cuenta de antes, sin id de canal, la toma el primer canal", () => {
    const existing: ExistingAccount[] = [
      { id: "row-vieja", platform: "youtube", external_id: null, default_publisher: "youtube_api", publishers: [] },
    ];
    const result = computeAccounts(sources({ google: [channel("UC-A", "Canal A"), channel("UC-B", "Canal B")], existing }));

    expect(youtube(result).map((a) => [a.externalId, a.existingId ?? null])).toEqual([
      ["UC-A", "row-vieja"],
      ["UC-B", null],
    ]);
  });

  it("Postproxy queda en una sola cuenta: la que ya lo tenia", () => {
    const existing: ExistingAccount[] = [
      {
        id: "row-a",
        platform: "youtube",
        external_id: "UC-A",
        default_publisher: "youtube_api",
        publishers: [],
      },
      {
        id: "row-b",
        platform: "youtube",
        external_id: "UC-B",
        default_publisher: "postproxy",
        publishers: [
          { publisher: "postproxy", account_ref: "pp-1", status: "available", status_reason: null, verified_at: null, manually_enabled: false },
        ],
      },
    ];
    const result = computeAccounts(
      sources({
        postproxyConnected: true,
        postproxyProfileId: "pp-1",
        google: [channel("UC-A", "Canal A"), channel("UC-B", "Canal B")],
        existing,
      }),
    );

    const withPostproxy = youtube(result).filter((a) => a.publishers.some((p) => p.publisher === "postproxy"));
    expect(withPostproxy.map((a) => a.externalId)).toEqual(["UC-B"]);
  });

  it("sin cuenta que lo tenga, Postproxy va al canal mas antiguo", () => {
    const result = computeAccounts(
      sources({ postproxyConnected: true, postproxyProfileId: "pp-1", google: [channel("UC-A", "A"), channel("UC-B", "B")] }),
    );

    const withPostproxy = youtube(result).filter((a) => a.publishers.some((p) => p.publisher === "postproxy"));
    expect(withPostproxy.map((a) => a.externalId)).toEqual(["UC-A"]);
  });

  it("un canal desconectado no se borra: su cuenta queda sin poder publicar por la API", () => {
    const existing: ExistingAccount[] = [
      {
        id: "row-b",
        platform: "youtube",
        external_id: "UC-B",
        username: "canalb",
        display_name: "Canal B",
        default_publisher: "youtube_api",
        publishers: [
          { publisher: "youtube_api", account_ref: "UC-B", status: "unverified", status_reason: null, verified_at: null, manually_enabled: false },
        ],
      },
    ];
    const result = computeAccounts(sources({ google: [channel("UC-A", "Canal A")], existing }));

    const b = youtube(result).find((a) => a.existingId === "row-b")!;
    expect(b.externalId).toBe("UC-B");
    expect(b.username).toBe("canalb");
    expect(b.publishers).toEqual([
      expect.objectContaining({ publisher: "youtube_api", status: "unavailable", account_ref: "UC-B" }),
    ]);
    expect(b.defaultPublisher).toBeNull();
  });

  it("un solo canal pasado como antes (no lista) sigue funcionando", () => {
    const result = computeAccounts(sources({ google: channel("UC-A", "Canal A") }));
    expect(youtube(result).map((a) => a.externalId)).toEqual(["UC-A"]);
  });
});
