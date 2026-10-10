# Pendiente · Módulo Llamadas

Formato: **qué quedó** · **por qué** · **qué se decidió**.

## Punto de partida

- **`verify-knowledge.mjs` falla antes de empezar** (caso "un documento eliminado desaparece de la busqueda").
  - Por qué: el script usa el único workspace real (`limit(1)`) y, desde que hay un documento de Wendy cargado ("Scaling Systems - Rediseño de Oferta"), la búsqueda con similitud mínima 0 lo devuelve. La función SQL `match_knowledge_chunks` sí filtra `deleted_at`.
  - Decisión: no es culpa de esta corrida. Se corrige el script al final para que el caso mire solo el documento de prueba (cambio mínimo), y se anota acá.
- **`verify-rls.mjs` sin flag falla una línea** esperada (la 00143 ya está aplicada). Se corre con `--despues-de-00143`.
- **Hallazgo ajeno:** `analyzeAdsWithAi` (`lib/actions/ads-analysis.ts`) abre la corrida con el cliente del usuario; `agent_runs` no tiene policy de INSERT, así que probablemente no registra el costo. No se toca acá.
- **Hallazgo ajeno:** `purge_rate_limits` no la llama ningún cron.

## Decisiones

- **SPSP:** en el prompt se reemplaza "SalesXcelerator" por **"Scaling Systems Academy"** (decisión de Wendy; `workspaces.name` es "Wendy's Workspace", el nombre automático).
