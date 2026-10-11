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


## Bloque L2 · decisiones y pendientes

- **`configurable` sigue siendo "tiene modo por lote".** El plano pedía `configurable: true` para Clasificación y Análisis de llamadas, pero `configurable` ya significa "tiene un modo por lote en `BackgroundSettings`" (lo lee `page.tsx`, lo fija `catalog.test.ts` y `CONFIGURABLE_AI_TASKS`). Para no mezclar dos cosas distintas, las tareas de llamadas llevan `configurable: false` y un campo propio `callTask` (`call_classification` | `call_analysis`) que activa su configuración propia en la pestaña. El efecto para quien usa la pantalla es el mismo.
- **El payload de `call_analyze` usa `manual` (no `regenerate`).** `manual: true` deja tomar una llamada que NO está `pending` (analizada, con error, por revisar); regenerar manda además `reason` y, con `falta_contexto`, `extraContext`. Es la misma idea que el `regenerate: true` del plano.
- **Reintentos propios del modelo.** Los handlers `call_classify` y `call_analyze` no lanzan por un fallo del proveedor (la cola reintentaría a los 10 s encima): reagendan ellos a 1, 5 y 15 minutos (`lib/calls/ai-retry.ts`). Una key inválida (401/403/400) no se reintenta; una respuesta cortada por largo es un error definitivo; un objeto que no cumple el esquema deja la llamada "Por revisar" (motivo `schema`).
- **Estados nuevos de "Por revisar"** (`status.ts`): `ai_off` (ninguna regla decide y la IA está apagada), `ai_error` (la IA no pudo clasificar), `schema`. Un tope de gasto en la clasificación deja `needs_review` con motivo `budget`; en el análisis deja `pending` con motivo `budget` y avisa a quienes tienen `calls.configure` una vez por día.
- **La pantalla de la tarea sigue siendo solo de Owner/Admin** (`requireWorkspaceAdmin`): un rol personalizado con `calls.configure` que no es Admin no la abre, aunque la acción de guardar sí le respondería. Abrirla a `calls.configure` toca el guard de toda la pantalla de Agentes IA: se deja para una decisión aparte. El ⚙ de la lista de Llamadas solo lo ve quien tiene `calls.configure`.
- **El esquema del análisis es más estricto que el texto del SPSP en dos cosas** (lo fija el plano): `resultado.categoria` es una de las siete de `OUTCOME_CATEGORIES` y el estado de una creencia es Firme / Parcial / Débil / No explorado. Si el modelo devuelve otra cosa, el análisis queda "Por revisar" (motivo `schema`) en vez de guardarse a medias. **Para comprobarlo con el SPSP real hace falta correr un análisis con IA de verdad, que esta corrida no hace** (ver "Verificación en vivo").
- **"Corregir con IA"**: el valor nuevo viaja como texto JSON (`despues_json`) y no como un campo libre del esquema, porque los proveedores no aceptan igual un campo "cualquier cosa".
- **Revisión visual limitada**: el panel del navegador de esta corrida mide ~800×512 px (y el modo celular de 375 px para la configuración), en oscuro y claro. No se revisó la ficha a 1440 px ni a 390 px en claro después de sumar las herramientas de sección; la estructura es la misma de L1.
- **Verificación en vivo pendiente (no se llama a IA real):** un análisis con el SPSP, una corrección con IA, una prueba del borrador y una clasificación con IA contra el proveedor de verdad. Todo está probado con el modelo simulado (`generate` inyectado).
- **Hallazgo ajeno (sin tocar):** ver más arriba, `analyzeAdsWithAi` abre la corrida con el cliente del usuario.
