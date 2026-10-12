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

## Borrado de `content_offers`

**Hecho el 12/10/2026 (migración 00171)**, después de desplegar el código de Ventas y de repetir la auditoría. Respaldo: `docs/ventas/respaldo-content-offers.json`.

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

## Bloque B3 · decisiones y pendientes

- **`verify-forms` tuvo que cambiar UN caso a propósito.** El caso «guarda el service_id y el sale_id de la firma (sin tablas de servicios ni ventas)» mandaba un `sale_id` inventado y esperaba que se guardara tal cual. Con la 00164 una venta que no existe se DESCARTA (queda null, con `meta.sale_id_discarded`): ahora el caso comprueba eso. Es el cambio de comportamiento que pide el plano (F26b), no una regresión. La primera corrida de `verify-forms` después de aplicar la 00164 dio 3 fallas y las dos siguientes 1 y 0 (las dos que quedaron fueron ese caso y luego nada): la primera pudo cruzarse con otra cosa que corría en la base; no se reprodujo.
- **El estado de las ventas viejas de Formularios**: no hay ninguna fila con `sale_id` en producción (0 en `form_submissions` y en `contract_signatures`), así que la FK de la 00163 no tuvo nada que arreglar.
- **El duplicado de venta activa se avisa en el paso 2** (cuando ya se eligió el producto) y no en el paso 1: el plano lo pone en el paso 1 pero ahí todavía no hay producto. Pide una casilla de confirmación para seguir.
- **Un pago programado con fecha pasada «nace moroso»**: el asistente avisa «ya venció» y lo deja pasar; la base lo marca moroso en la próxima corrida del barrido (B4). Hasta B4 queda como `scheduled`.
- **El plan de pagos es de solo lectura en la ficha** (cobrar, reprogramar, incobrable y reembolso son B4). Sí se puede «Rearmar el plan» (con `payments.manage`) cuando un cambio de precio lo descuadra.
- **«Pendiente» de una venta cancelada** muestra final − cobrado (como pide el plano con `saleBalance`): en una cancelada sin cobros dice el total. Si confunde, se muestra «—» para cancelada/reembolsada: es un cambio de una línea en la lista.
- **Comprobantes**: la sección «comprobantes» de la ficha es del B4 (F27, bucket `payment-receipts`).
- **El historial de la ficha (`<Historial entityType="sale">`) lo ve hoy solo quien ya ve `audit_log`** (Owner y Admin): la política `audit_log_select_sales` es la 00168 del B4. Hasta entonces un Member ve la sección vacía.
- **`versionSalesCounts` cuenta con el cliente de servicio** (todas las ventas del workspace, no solo las que ve quien mira): un rol con alcance `own` y `settings.manage` habría visto un número bajo.
- **Revisión visual de B3**: lista, ficha y diálogo de edición con datos de ejemplo (una página temporal con fixtures, ya borrada: producción no tiene ventas y no se escribe nada real), asistente completo hasta el paso 3 contra el catálogo real (sin guardar), sección «Ventas» de un contacto real y el panel de la Agenda; a 1440 y 375 px, claro y oscuro. No se apretó «Guardar venta», «Cancelar» ni «Enviar contrato».


## Bloque B4 · decisiones y pendientes

- **Comisión de Whop: 0 %** hasta que Wendy confirme el porcentaje real (anotado con fecha en `lib/sales/payment-methods.ts`). El criterio del plano (`computeProviderFee(100,'whop') = 3.00`) se prueba pasando el método explícito `{pct: 3, fixed: 0}`. Whop como pasarela es Fase 2.
- **Borrado de `content_offers`**: aplicado (00171), ver arriba.
- **Cancelar como sistema no usa la RPC `cancel_sale`** (la RPC siempre escribe `actor_type 'user'`): se hace con sentencias directas y `auditAsSystem` con la etiqueta («Job de mora» / nombre del flow). Si más adelante la RPC acepta actor de sistema, se unifica.
- **`total_paid` en `payment_health` es la cantidad de pagos cobrados**, no el monto (el nombre viene del plano). Los montos salen de `sales`.
- **Republicar un flow desde el lienzo duplica las filas de trigger que no son del builder**: es anterior a Ventas y afecta a otros eventos; para los tipos de venta se corrigió en `app/api/v1/flows/[flowId]/publish/route.ts`. Los demás quedan igual a propósito.
- **Los flujos de cobranza se crean al abrir Ventas por primera vez** (Owner/Admin) o al prender la opción: al desplegar, el primer ingreso escribe cuatro flows en borrador en el workspace real. Quedan apagados; no mandan nada hasta que se publiquen.
- **`verify-rls` salió con código 1 una vez** y a la corrida siguiente dio 0 (el corte ocasional ya anotado en B1); no se reprodujo.
- **No hay tests unitarios directos de `payments-core`**: lo cubren `lib/actions/payments.test.ts`, `sales-actions.test.ts` (nodos) y `verify-sales --block 4` contra la base real.
- **Revisión visual de B4** (navegador integrado, sesión de Wendy): Pagos vacío, editor de flows con los 11 atajos y el panel de filtros, Ajustes > Actividad, Ajustes > General > Ventas. No se abrió `/dashboard/ventas` con el admin para no disparar la creación de los flows en el workspace real, ni se apretó ningún botón que escriba.
- **Pendiente en vivo (§18 del plano)**: con la rama desplegada, cargar una venta de prueba con un pago programado vencido y comprobar que la mora y el flow de cobranza se disparan una sola vez.

## Después del cierre: precio en la variante (12/10/2026)

- **`content_offers` ya se borró** (00171, después del deploy).
- **Se perdió a propósito** el borrador de precio (preparar un precio y publicarlo después) y el contador de ventas por versión. El cambio de precio es inmediato.
- **Precio 0 = sin precio**: la variante no se ofrece en una venta nueva. No hay un precio «de cortesía» de 0.
- **Actor en el historial**: si una escritura no trae sesión ni `updated_by`, queda como `system`; si trae un `updated_by` viejo sin sesión (rarísimo: un proceso interno que no lo actualiza), se le atribuye a esa persona.
- **Las 4 filas de `audit_log` de `product_version`**: no había ninguna (0); la política `audit_log_select_sales` sigue nombrando ese tipo, inofensivo.
- **Revisión visual de la pestaña «Precio» no hecha**: el servidor local no estaba corriendo en esta vuelta y no se escribe un precio sobre datos reales. Queda para mirar con el deploy.
