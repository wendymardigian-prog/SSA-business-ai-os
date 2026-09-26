import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "."),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    // node_modules: obvio.
    // docs/referencia: codigo de referencia de la etapa 2, se lee y no se corre.
    // .claude/worktrees: copias completas del repo que crea la app de Claude
    //   Code para otras sesiones. Sin esta linea, `vitest run` desde la raiz
    //   corre tambien los tests de la otra sesion (y falla por su trabajo a
    //   medio hacer, que no es nuestro).
    exclude: ["node_modules/**", "docs/referencia/**", ".claude/worktrees/**"],
    environment: "node",
  },
});
