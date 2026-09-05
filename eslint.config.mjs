import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  // Las Edge Functions corren en Deno, no en Node: usan imports jsr: y el
  // global Deno, que las reglas de Next no entienden.
  { ignores: ["supabase/functions/**"] },
  ...nextVitals,
];

export default eslintConfig;
