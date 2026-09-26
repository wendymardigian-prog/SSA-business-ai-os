import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  // Codigo de referencia de la etapa 2: se lee, nunca se compila ni se lintea.
  // Se borra al cerrar la etapa (docs/requerimientos-etapa2.md, seccion 3.7).
  { ignores: ["docs/referencia/**", ".claude/worktrees/**"] },
  ...nextVitals,
];

export default eslintConfig;
