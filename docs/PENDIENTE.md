# Pendientes de la corrida — Fase 3, Bloques 2e y 3

Lo que quedó sin cerrar durante la corrida autónoma, para retomar con Wendy. Formato de cada entrada:

- **Qué quedó:** …
- **Por qué:** …
- **Qué se decidió en su lugar:** …

---

## API por lote (Bloque 5, §21.2)
- **Qué quedó:** el proveedor de IA se llama con pedidos agrupados, no con la API por lote (batch) real.
- **Por qué:** el AI SDK v6 (`ai` + `@ai-sdk/*`) no expone modo batch para ningún proveedor, y los SDK crudos no están instalados.
- **Qué se decidió en su lugar:** interfaz `BatchProvider` lista para sumar el lote real por `fetch` cuando se quiera; el modo "Económico" agrupa pedidos. Se construye en el Bloque 5.

## Barra superior global de 56 px en todas las páginas (F13)
- **Qué quedó:** el componente `PageHeader` (56 px, ⓘ con tooltip) existe y se usa en el dashboard de Chat, pero las otras ~21 páginas siguen con su encabezado propio (h1 + subtítulo).
- **Por qué:** reemplazar el encabezado en 21 pantallas y unificar la barra móvil (`MobileTopBar` → un solo `PageHeader` responsive) es un cambio cosmético grande, y las pantallas se verifican a ojo, no por test.
- **Qué se decidió en su lugar:** se dejó el componente y la navegación nuevos (Dashboards primero, redirect 308 de `/dashboard/analytics`), y el rollout a las demás páginas queda para hacerlo con Wendy mirando. En mobile el dashboard muestra la `MobileTopBar` del layout más su `PageHeader` (dos barras) hasta unificarlas.

## Detalle de tendencias con 4 pestañas (F16)
- **Qué quedó:** el dashboard muestra una serie (conversaciones nuevas por día). La función SQL `chat_dashboard_trends` ya devuelve recibidos, enviados y nuevas por día.
- **Por qué:** las 4 pestañas con leyenda, colores por serie y paso a semanal >62 días son presentación; el dato está.
- **Qué se decidió en su lugar:** una barra simple sobre el dato real; las pestañas se completan en la pasada de pantallas con Wendy.

## Recorrida de pantallas en vivo (Bloques 2 y 3)
- **Qué quedó:** no se recorrieron las pantallas nuevas (editor de reglas, dashboard) a ojo.
- **Por qué:** la app pide login y no se ingresan credenciales en la corrida autónoma.
- **Qué se decidió en su lugar:** la lógica va en funciones puras con tests y en scripts `verify-*`; la recorrida a 1440 y 390 px queda para hacerla con Wendy (lista en §19 del plano).

## Bloque 4 (Patrones) — empezado, sin aplicar ni commitear
- **Qué quedó:** el archivo `supabase/migrations/00079_message_patterns.sql` está escrito (tablas `message_categories`/`message_texts`, `messages.text_norm`, trigger, categorías fallback, siembra de los 12 botones y backfill), pero **NO está aplicado a la base** (la base sigue en 00078) ni commiteado. Falta todo el código de app del bloque: clasificador (F20), correcciones (F21) y la sección Patrones del dashboard (F22), con sus tests.
- **Por qué:** se alcanzó el límite de uso a mitad del Bloque 4.
- **Qué se decidió en su lugar:** no aplicar una migración sin verificarla contra un `verify-dashboards` extendido, para no dejar la base adelantada respecto del código. Al retomar: revisar la 00079, aplicarla, y construir F20-F22 + F23-F26 (Bloque 5).

## Bloque 5 (Tareas en segundo plano, calidad, intención) — no empezado
- **Qué quedó:** F23-F26 completos sin construir (migración 00080, jobs de despacho/recolección, calidad, versiones del clasificador, herramienta `declarar_intencion` + graduación).
- **Por qué:** límite de uso.

## F22 "Qué le responden" (§11.7) y drilldown de correcciones en la UI
- **Qué quedó:** la sección Patrones muestra "lo que más se recibe" (categorías, variantes, confianza). Falta "qué le responden" (§11.7, entrante que sigue a un saliente de una categoría dentro de 24 h) y los controles de corrección (Mover a…/Renombrar/Unir) enganchados en la UI (las Server Actions ya existen en `lib/actions/patterns.ts`).
- **Por qué:** el volumen del bloque; la lógica y las acciones están, falta el cableado visual y una función SQL extra.
- **Qué se decidió en su lugar:** se dejó la sección de lectura y las acciones probadas; el drilldown y "qué le responden" se completan en la pasada de pantallas con Wendy.
