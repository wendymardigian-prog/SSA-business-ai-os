/**
 * F75: las cifras de perfil de una cuenta (seguidos, publicaciones, videos,
 * vistas, me gusta) salen de `getFollowerStats` de Zernio y viajan en
 * `extra.profile` del snapshot de la cuenta.
 *
 * Lo que importa: un campo que Zernio no da NO se escribe (un cero se lee como
 * "no tiene"), un fallo de esta lectura no tumba la de los posts, y sin plan de
 * analitica ni siquiera se pregunta.
 */
import { describe, it, expect, vi } from "vitest";
import { readZernioMetrics } from "@/lib/metrics/zernio";

const params = { apiKey: "k", accountId: "acc-1", platform: "instagram", fromDate: "2026-09-01" };

function client(opts: {
  analytics?: { data?: unknown; error?: unknown };
  stats?: () => Promise<{ data?: unknown; error?: unknown }>;
  withAccounts?: boolean;
}) {
  const getAnalytics = vi.fn(async () => opts.analytics ?? { data: { posts: [], accounts: [{ _id: "acc-1", followerCount: 100 }] } });
  const getFollowerStats = vi.fn(opts.stats ?? (async () => ({ data: { accounts: [] } })));
  return {
    client: { analytics: { getAnalytics }, ...(opts.withAccounts === false ? {} : { accounts: { getFollowerStats } }) } as never,
    getFollowerStats,
  };
}

describe("cifras de perfil (F75)", () => {
  it("guarda las que Zernio da en extra.profile", async () => {
    const { client: c, getFollowerStats } = client({
      stats: async () => ({
        data: { accounts: [{ _id: "acc-1", accountStats: { followingCount: 402, mediaCount: 312 } }] },
      }),
    });
    const result = await readZernioMetrics({ ...params, client: c });

    expect(getFollowerStats).toHaveBeenCalledWith({ query: { accountIds: "acc-1" } });
    expect(result.accountDaily[0].extra).toEqual({ profile: { following: 402, posts: 312 } });
    expect(result.accountDaily[0].followers).toBe(100);
  });

  it("un campo que no vino no se escribe, ni como cero", async () => {
    const { client: c } = client({
      stats: async () => ({ data: { accounts: [{ _id: "acc-1", accountStats: { followingCount: 7 } }] } }),
    });
    const profile = (await readZernioMetrics({ ...params, client: c })).accountDaily[0].extra.profile as Record<string, number>;

    expect(Object.keys(profile)).toEqual(["following"]);
  });

  it("sin accountStats no hay extra: no se inventa un perfil vacio", async () => {
    const { client: c } = client({});
    const result = await readZernioMetrics({ ...params, client: c });

    expect(result.accountDaily[0].extra).toEqual({});
  });

  it("si la lectura del perfil falla, los posts y los seguidores se guardan igual", async () => {
    const { client: c } = client({ stats: async () => { throw new Error("Zernio caído"); } });
    const result = await readZernioMetrics({ ...params, client: c });

    expect(result.accountDaily[0].followers).toBe(100);
    expect(result.accountDaily[0].extra).toEqual({});
    expect(result.warnings).toEqual([]);
  });

  it("un cliente sin accounts (versión vieja del SDK) no rompe nada", async () => {
    const { client: c } = client({ withAccounts: false });
    const result = await readZernioMetrics({ ...params, client: c });

    expect(result.accountDaily[0].followers).toBe(100);
  });

  it("sin analitica en el plan no se pregunta por el perfil", async () => {
    const { client: c, getFollowerStats } = client({ analytics: { data: { hasAnalyticsAccess: false } } });
    const result = await readZernioMetrics({ ...params, client: c });

    expect(getFollowerStats).not.toHaveBeenCalled();
    expect(result.warnings.join(" ")).toMatch(/no incluye analitica/);
  });
});
