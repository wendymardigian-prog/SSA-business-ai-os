# Pendiente · Módulo Ventas

Formato: **qué quedó · por qué · qué se decidió**.

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar** (1 caso de datos del backfill de la 00115, 737 de 796). No es de Ventas; se anota y no puede empeorar.
- **`verify-knowledge` y `verify-webhook` no se corren** (Voyage real / app local).
- **Los `verify-*` se corren con los flags vigentes**: `--despues-de-00143`, `--despues-de-00136`, `--despues-de-00147`.

## Decisiones tomadas con Wendy (11/10/2026)

1. **Portado:** solo lo que el plano usa. `sales-team-rules.ts` (ranking del tablero, no reglas de asignación), `sale-payments.ts` y `sale-status-updater.ts` (escriben en la base y muestran avisos) **no se portan**. Las reglas de asignación salen de `reparto-condiciones.ts` y `run-assignment-rules`.
2. **Comisión de Whop: 0 %** hasta que Wendy confirme el valor real (el plano proponía 3 %). Está en `lib/sales/payment-methods.ts`. Cambiarla no reescribe lo cobrado.
3. **Nada molesta en producción antes del deploy:** la función del cron de mora solo encola si hay pagos `scheduled` vencidos candidatos; los flujos de cobranza precreados se crean al abrir Ventas por primera vez, al prender la opción en Ajustes y al crear un workspace (sin backfill durante la corrida).

## Diferencias entre el plano y el código real (gana el código)

| # | El plano supone | Lo real | Qué se hizo |
|---|---|---|---|
| D-1 | Tabla "Qué se porta" en §3 | No existe | Se porta según la decisión 1 |
| D-2 | `sales-team-rules.ts` evalúa reglas | Es el ranking del tablero | Se porta `reparto-condiciones.ts` y el evaluador de `run-assignment-rules` (operador desconocido = `false`) |
| D-3 | `sale-status-updater.ts` = derivación pura | Llama a una RPC; la derivación está en `sales-constants.ts` con otra precedencia | Estructura de prevxcrm + precedencia de F23 |
| D-4 | 6 workspaces | 1 (America/Costa_Rica) | Los tests igual usan UTC y CR |
| D-5 | Triggers `contacts_emit_*` | `contacts_automation_{created,changes,deanonymized}` | No se tocan; se suma `contacts_enqueue_sales_eval` |
| D-6 | Alta rápida de producto desde Contenido | No existe | Solo `createProduct`/`updateProduct` delegan en `lib/actions/products.ts` |
| D-7 | Productos = tabla | Lista `<ul>` con edición en línea; audita como `workspace` | Se rehace según F3; se conservan estados, contador, orden y "Mostrar discontinuados" |
| D-8 | Lectores de `content_offers` | Además tres tests | Se pasan a `products` |
| D-9 | Roles sin cambios de código | Alcances escritos a mano | Se suma `sales` en `roles-view`, `SYSTEM_ROLE_PERMISSIONS`, `parsePermissions` y literales de tests/scripts |
| D-10 | `bookings` como módulo de permisos | Solo es alcance | `sales` módulo propio; `ctx.scope("sales")` |
| D-11 | Ventas después de Agenda | El grupo tiene Llamadas | Ventas va después de Llamadas |
| D-12 | `ADMIN_PAGES` = 11 | Actividad suma una | Pasa a 12, a propósito |
| D-13 | `date-fns` | No está; hay `dayjs` y `lib/dates.ts` | `lib/sales/dates.ts` |
| D-14 | shadcn | No hay Button/Dialog/Select/Badge/Table | Se traduce a los componentes de SSA |
| D-15 | Ficha de agenda = página; estado "asistió" | Panel lateral; grupo `outcome` | "Cargar venta" con estado del grupo `outcome` |
| D-16 | Buscador de contactos reusable | Uno por módulo | `searchContactsForSale` |
| D-17 | Modal de pasos reusable | `BookManualDialog` es propio | Solo de molde visual |
| D-18 | `<Historial>` con diccionario; builder compartido | Solo etiquetas de acción; builder por entidad | `SALE_ACTION_LABELS` + `lib/audit-query.ts` global |
| D-19 | `configSchema`; acciones como registro | No hay; las acciones son nodos | `trigger-config.ts` + 3 nodos |
| D-20 | Presets de triggers | No existe el concepto | `presets.ts` + `SalesTriggerPanel` |
| D-21 | Variables en `bank-variables.ts` | Listas por módulo | `SALES_VARIABLE_KEYS` |
| D-22 | Constructor de condiciones extraíble | No hay genérico | `components/conditions/condition-tree-editor.tsx` |
| D-23 | Prellenado por mapeo | Solo por parámetros de URL | `buildContractPrefill` devuelve parámetros |
| D-24 | `contract_signed` con `sale_id` | El payload no lo trae | La 00164 lo suma |
| D-25 | Job desconocido | Pasa a `failed`; el test fija la lista | Se suman 3 tipos al test |
| D-26 | Duplicados tolerados por `scheduleJob` | Lanza 23505 | Relativos de pagos: uno por uno, toleran 23505 |
| D-27 | Asignación manual | `assignContact` | Suma `assignment_locked_at` |
| D-28 | Archivos de progreso y commits | Corrección de Wendy | `PROGRESS-ventas.md` / `PENDIENTE-ventas.md`, `feat: ventas - bloque X (nombre)` |

## Borrado diferido de `content_offers`

Se escribe en `docs/pendientes/drop_content_offers.sql` al cerrar B4 y **no se aplica**. Se aplica solo cuando: (1) el código de B1 está desplegado y comprobado; (2) `grep -rn "content_offers" app lib scripts` no encuentra lecturas; (3) corrieron las consultas de seguridad de su cabecera; (4) hay respaldo (`docs/ventas/respaldo-content-offers.json`). Es IRREVERSIBLE.

## Bloque B1 · decisiones y pendientes

- **Error encontrado en mi propio CHECK de la 00159 y corregido antes de seguir.** `NULL IN (...)` da NULL y un CHECK deja pasar un NULL: `recurring` sin intervalo y una garantía a medias entraban. `verify-sales` lo detectó; los dos CHECK se reescriben con `IS NOT NULL` explícito (la migración hace `DROP CONSTRAINT IF EXISTS` + `ADD`, sigue idempotente). Se reaplicó y se actualizó el texto registrado en `schema_migrations`.
- **El trigger que protege las versiones publicadas dejaba bloqueado borrar un workspace entero** (el borrado en cascada lo frenaba). Se permite cuando el workspace ya no existe; así los `verify-*` pueden limpiar. Probado en una transacción que se deshace sola.
- **Largo del nombre de producto: 60 caracteres en la aplicación** (el mismo tope de Contenido, `TAXONOMY_NAME_MAX`), aunque la base admite 120 como dice el plano. Subirlo es cambiar una constante; se dejó en 60 para no cambiar lo que Contenido valida hoy.
- **Un producto nuevo desde Ajustes nace con la versión 1 en borrador, precio 0 y la nota "Precio por definir"** (la base exige una nota para el precio 0). No se puede publicar así: `canPublish` pide cargar el precio. Desde Contenido, el alta publica la versión 1 con el precio.
- **Cambiar el precio desde Contenido** (`updateProduct({priceUsd})`) ya no pisa nada: crea una versión en la variante por defecto y la publica. La pantalla nueva no edita el precio en línea.
- **Un alta en `content_offers` hecha por el código viejo con un nombre que ya existe en `products` falla** (índice único de nombre activo). Se prefirió ese error a dejar una pieza huérfana. En la práctica el código viejo no corre después del deploy.
- **La cuenta de ventas por versión (historial de precios) es 0 hasta el Bloque 3** (`lib/sales/catalog/usage.ts`); F17 la reemplaza por la consulta real.
- **Ajustes > General sigue protegida por `requireWorkspaceAdmin`** (así estaba), así que la sección "Ventas" (métodos de pago) es de Owner y Admin; el plano pedía `settings.manage`. Un rol personalizado con `settings.manage` que no es Admin no llega a General. Cambiar eso toca la pantalla General entera y su test de caracterización: queda como mejora aparte. La acción `updateSalesSettings` sí pide `settings.manage`.
- **El aviso de pagos programados que usan un método apagado** se arma con `scheduledUsingDisabled`; hasta que existan los pagos (B3) la pantalla recibe `{}`.
- **`verify-rls` salió con código 1 una vez (con "Todo verde" al final)** y a la corrida siguiente dio 0 sin cambios; es el corte ocasional que ya anotó Formularios. No se reprodujo.
- **Revisión visual de B1** (navegador integrado, con la sesión de Wendy, servidor de este mismo directorio): lista de Productos (los 3 migrados, "1 pieza" de BusinessXcelerator intacto, aviso de Contenido), detalle con variante Estándar, pestaña Precio e historial, General > Ventas, `/dashboard/ventas` vacío; a 1440 y 390 px, claro y oscuro. Se encontró y arregló el campo del nombre colapsado a 390 px. **No se apretó ningún botón que escriba** (crear producto, variante, publicar): escribiría datos reales de Wendy; esos caminos los cubren `lib/actions/products.test.ts` y `verify-sales --block 1`.

## Bloque B2 · decisiones y pendientes

- **Dos arreglos al portar de prevxcrm** (los dos con test): un operador de condición DESCONOCIDO ya no coincide (el original devolvía `true`, y los operadores `greater_than`/`less_than` que ofrecía su editor "coincidían con todo"); y el puntero del reparto por turnos es el ÍNDICE del último asignado dentro de la lista, no un contador módulo la lista de activos (que se corría cuando alguien dejaba de estar activo).
- **`sales-team-rules.ts` no tiene reglas de asignación** (es el ranking del tablero): las reglas se portaron de `run-assignment-rules` y `reparto-condiciones.ts`. Ya estaba en la tabla de diferencias (D-2).
- **`assignment_locked_at` bloquea setter y vendedor, no el referido.** El bloqueo lo escribe `assignContact` (que solo maneja esos dos); que alguien asigne un setter a mano no tiene por qué impedir que una regla anote quién refirió al contacto. Cambiarlo es una línea en `resolveAssignments`.
- **Un contacto anónimo no se evalúa** (el que crea un comentario sin datos): no gasta turnos del reparto. Decisión mía, el plano no lo decía. Si después se le agregan datos y su atribución cambia, el trigger lo vuelve a encolar.
- **"Reparto equitativo" actúa sobre todo contacto nuevo sin setter/vendedor**, venga de un canal, de un CSV o de un alta manual (el trigger de la base se dispara con cualquier alta). Es lo que pide el plano; conviene saberlo antes de activarlo.
- **Los jobs de asignación solo se encolan si alguna regla deja de ser manual**, y todas arrancan en manual: hoy en producción no se encola nada. El handler se registra en `registerPublishing()`; hasta el deploy de esta rama, producción no tiene quien procese `sales_contact_eval`, pero tampoco hay quien lo encole (la pantalla para activar las reglas es de esta rama).
- **El trigger usa `AFTER INSERT OR UPDATE OF attribution`**: se dispara en cualquier UPDATE que nombre la columna aunque no cambie. La clave del job incluye el md5 de la atribución, así que el mismo valor mientras el primero espera no duplica (`verify-sales` lo comprueba).
- **El job se probó con la base en memoria, no corriendo contra la base real** (no hay forma de correr el cron `jobs` del servidor local contra producción sin desplegar). La RLS, el trigger, el encolado y la precarga sí se probaron contra la base real (`verify-sales --block 2`); lo que falta es la verificación en vivo del §18 del plano (punto 4): activar una regla y mandar un lead de prueba.
- **Revisión visual de B2** (navegador integrado con la sesión de Wendy): Ajustes > Asignación (las 3 tarjetas, el modo "Por condiciones" con una regla en borrador, el probador), la ficha de un contacto con su línea de último toque, a 1440 y 390 px. **Se encontraron y arreglaron dos bugs de maquetación**: la fila de pestañas de Ajustes se colapsaba a 1 px en las pantallas con contenido alto (el contenedor tenía `overflow-auto`; también afectaba a Productos) y el nombre de una regla quedaba diminuto en móvil. **No se apretó Guardar** (escribiría reglas reales de Wendy).
- **Ajustes > Asignación se agregó como pestaña** (permiso `settings.manage`, igual que Productos): `lib/settings/tabs.test.ts` y `permissions-characterization.test.ts` se actualizaron a propósito.
