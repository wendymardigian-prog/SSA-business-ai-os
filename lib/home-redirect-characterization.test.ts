/**
 * Caracterización de la página de inicio: `/` redirige a `/login`.
 *
 * La página vive en `app/(sitio)/page.tsx`, y la versión por defecto es ese
 * redirect. Este test sigue la página donde esté y exige que la versión por
 * defecto lleve al login.
 */
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const CANDIDATES = ["app/(sitio)/page.tsx", "app/page.tsx"];

describe("la página de inicio por defecto", () => {
  it("existe en una sola ubicación y redirige a /login", () => {
    const found = CANDIDATES.filter((p) => existsSync(p));
    expect(found).toHaveLength(1);
    const source = readFileSync(found[0], "utf8");
    expect(source).toMatch(/redirect\(\s*["']\/login["']\s*\)/);
  });
});
