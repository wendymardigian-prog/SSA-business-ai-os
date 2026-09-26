/**
 * Lo que solo se puede leer por la Graph de Meta (F43). Todo simulado.
 */

import { describe, it, expect, vi } from "vitest";
import {
  readAccountInsights,
  readActiveStories,
  readAudience,
  readProfile,
  readReachBreakdown,
} from "./instagram-graph";

/** Responde segun lo que pide la URL: las llamadas van en paralelo. */
function routed(routes: Array<[RegExp, unknown]>) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    const hit = routes.find(([pattern]) => pattern.test(href));
    return {
      ok: true,
      status: 200,
      json: async () => hit?.[1] ?? { error: { message: "sin ruta", code: 100 } },
    };
  }) as unknown as typeof fetch;
}

describe("alcance entre seguidores y no seguidores (F43)", () => {
  it("separa las dos y junta el resto en desconocido", () => {
    // Saber que el 70% vino de gente que no te sigue es la diferencia entre
    // "funciono" y "funciono para traer gente nueva".
    const impl = routed([
      [
        /insights/,
        {
          data: [
            {
              name: "reach",
              total_value: {
                breakdowns: [
                  {
                    results: [
                      { dimension_values: ["FOLLOWER"], value: 300 },
                      { dimension_values: ["NON_FOLLOWER"], value: 700 },
                      { dimension_values: ["UNKNOWN"], value: 12 },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    ]);

    return expect(readReachBreakdown({ mediaId: "m1", token: "t", fetchImpl: impl })).resolves.toEqual({
      followers: 300,
      nonFollowers: 700,
      unknown: 12,
    });
  });

  it("si Meta no lo da, null y no ceros", async () => {
    // Ceros dirian que el post no llego a nadie.
    const impl = routed([[/insights/, { data: [] }]]);

    expect(await readReachBreakdown({ mediaId: "m1", token: "t", fetchImpl: impl })).toBeNull();
  });

  it("un error tampoco inventa numeros", async () => {
    const impl = routed([[/insights/, { error: { code: 100, message: "no soportado" } }]]);

    expect(await readReachBreakdown({ mediaId: "m1", token: "t", fetchImpl: impl })).toBeNull();
  });
});

describe("insights de la cuenta (F43)", () => {
  it("trae la curva de seguidores y los totales", async () => {
    const impl = routed([
      [
        /metric=follower_count/,
        {
          data: [
            {
              name: "follower_count",
              values: [
                { value: 12, end_time: "2026-10-01T07:00:00+0000" },
                { value: 8, end_time: "2026-10-02T07:00:00+0000" },
              ],
            },
          ],
        },
      ],
      [
        /metric=reach/,
        {
          data: [
            { name: "reach", total_value: { value: 5000 } },
            { name: "profile_views", total_value: { value: 120 } },
          ],
        },
      ],
    ]);

    const result = await readAccountInsights({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(result.followerCountByDay).toHaveLength(2);
    expect(result.reach).toBe(5000);
    expect(result.profileViews).toBe(120);
  });

  it("si un bloque falla, el otro se devuelve igual y lo avisa", async () => {
    // Una cuenta sin permiso de insights no puede dejar sin metricas a todo
    // el resto.
    const impl = routed([
      [/metric=follower_count/, { error: { code: 100, message: "sin permiso" } }],
      [/metric=reach/, { data: [{ name: "reach", total_value: { value: 10 } }] }],
    ]);

    const result = await readAccountInsights({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(result.reach).toBe(10);
    expect(result.followerCountByDay).toEqual([]);
    expect(result.warnings[0]).toContain("Seguidores por dia");
  });
});

describe("audiencia (F43)", () => {
  it("usa el metric viejo cuando la cuenta todavia lo responde", async () => {
    const impl = routed([
      [
        /metric=audience_gender_age/,
        { data: [{ name: "audience_gender_age", values: [{ value: { "F.25-34": 500 } }] }] },
      ],
    ]);

    const result = await readAudience({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(result.ageGender).toEqual({ "F.25-34": 500 });
  });

  it("cae al nuevo cuando el viejo no contesta", async () => {
    // Meta los cambio y las cuentas no migraron todas a la vez.
    const impl = routed([
      [/metric=audience_/, { data: [] }],
      [
        /follower_demographics.*breakdown=country/,
        {
          data: [
            {
              name: "follower_demographics",
              total_value: { breakdowns: [{ results: [{ dimension_values: ["AR"], value: 900 }] }] },
            },
          ],
        },
      ],
    ]);

    const result = await readAudience({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(result.country).toEqual({ AR: 900 });
  });

  it("sin datos devuelve vacio, no rompe", async () => {
    const impl = routed([[/insights/, { data: [] }]]);

    expect(await readAudience({ igId: "ig-1", token: "t", fetchImpl: impl })).toEqual({
      ageGender: {},
      country: {},
      city: {},
    });
  });
});

describe("historias activas (F43)", () => {
  it("trae cada historia con sus metricas", async () => {
    const impl = routed([
      [/\/stories/, { data: [{ id: "s1", media_type: "IMAGE", permalink: "https://ig/s1" }] }],
      [
        /s1\/insights/,
        { data: [{ name: "reach", total_value: { value: 400 } }, { name: "replies", total_value: { value: 3 } }] },
      ],
    ]);

    const { stories } = await readActiveStories({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(stories[0]).toMatchObject({ id: "s1", mediaType: "IMAGE" });
    expect(stories[0].metrics).toEqual({ reach: 400, replies: 3 });
  });

  it("un error vuelve como aviso, con la lista vacia", async () => {
    const impl = routed([[/\/stories/, { error: { code: 190, message: "bad token" } }]]);

    const result = await readActiveStories({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(result.stories).toEqual([]);
    expect(result.warning).toContain("Business Manager");
  });
});

describe("perfil (F43)", () => {
  it("devuelve lo que muestra la pagina Social", async () => {
    const impl = routed([
      [/ig-1\?/, { username: "minegocio", followers_count: 4200, media_count: 180 }],
    ]);

    const profile = await readProfile({ igId: "ig-1", token: "t", fetchImpl: impl });

    expect(profile).toMatchObject({ username: "minegocio", followersCount: 4200, mediaCount: 180 });
  });

  it("sin token valido devuelve null en vez de un perfil vacio", async () => {
    const impl = routed([[/ig-1/, { error: { code: 190 } }]]);

    expect(await readProfile({ igId: "ig-1", token: "t", fetchImpl: impl })).toBeNull();
  });
});
