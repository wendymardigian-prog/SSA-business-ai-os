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
