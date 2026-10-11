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

## Bloque L1

- **Un error que solo vio el servidor de desarrollo.** `validateFathomApp` era una función sincrónica exportada desde un archivo `"use server"`: Next lo rechaza ("Server Actions must be async functions") y ni el typecheck, ni el build, ni los tests lo veían. Se movió a `lib/fathom/app-validation.ts` y se **reforzó `lib/vault-boundary.test.ts`**: ahora falla si un archivo `"use server"` exporta una función sin `async`.
- **Colores de los puntajes.** El plano (§13.0) dice ámbar por debajo de 50 y verde desde 65; prevxcrm usa 55 y 70 con rojo abajo. Gana el plano: `lib/calls/badges.ts` es el único mapa y lo usan el número, la barra y el chip. Entre 50 y 64 el chip es neutro.
- **Tipos de aviso.** El plano habla de "+5 tipos" pero solo enumera tres. Se sumaron los tres que usa el módulo (`fathom_connection_error`, `call_analysis_budget`, `call_objection`); si L2/L3 necesitan otro, se suma entonces.
- **`createNotificationOnce` y el destinatario.** No miraba a quién iba el aviso: con una lista de destinatarios, solo el primero lo recibiría. Se sumó la opción `perRecipient` (por defecto no cambia nada).
- **`closer_emails` lo puede leer cualquier miembro.** Vive en `workspace_members`, cuya lectura no se achicó (columnas con `select("*")` en el código existente se romperían). Son correos alternos que el propio equipo ya conoce; si se quiere ocultarlos, hace falta una vista aparte. No se tocó.
- **Identidad de Fathom.** `fetchIdentity` usa un id de cuenta fijo (`fathom`): Fathom es una cuenta por persona, y un id fijo hace que reconectar actualice la misma fila aunque `/users/me` falle una vez y funcione la siguiente (con el id del plano, `fathom:` + userId, no se puede armar: no recibe el usuario).
- **`audit_log` sin `entity_type 'integration'`.** Conectar/desconectar Fathom se audita como `oauth_connection` (como ya hace Google Calendar).
- **Pendiente para la verificación en vivo (§18), que no se hizo:** que `/users/me`, el endpoint de transcripción, `recorded_by[]` con OAuth, la rotación del refresh token y el límite real de pedidos de Fathom funcionen como los usa prevxcrm. Todo se probó contra Fathom simulado.
- **El botón "Sincronizar ahora" y la tarjeta Mi Fathom** se probaron con tests y a la vista, pero no con una conexión real (no se conectó ninguna cuenta).
