# Ventas (Fase 1)

Catálogo de productos con el precio en cada variante, atribución y asignación automática de cada lead, alta de venta en tres pasos, plan de pagos, mora, historial y triggers por cambio de estado. **Una venta nace de un contacto, congela el precio y la atribución de ese momento, y cada cambio de estado puede disparar automatizaciones.**

Plano: [requerimientos-ventas-v7.md](requerimientos-ventas-v7.md) (v1.1; gana sobre cualquier otra copia). Avance: [PROGRESS-ventas.md](PROGRESS-ventas.md). Decisiones, diferencias con el plano y pendientes: [PENDIENTE-ventas.md](PENDIENTE-ventas.md). Triggers y nodos: [flow-registry.md](flow-registry.md).

## Datos

Migraciones **00159** a **00171** (la próxima libre es la **00172**).

- **Catálogo** (00159, 00160, 00169): `products` → `product_variants`. El precio vive en la **variante** (`price`, USD; 0 = sin precio, no se vende). Cambiarlo es inmediato y queda en el historial general. Hubo una tabla `product_versions`; se borró en la 00169 porque la venta ya guarda su copia congelada del producto y del precio. `content_offers` se absorbió con el mismo id (00160) y se **borró en la 00171**, después de desplegar el código nuevo (respaldo en `docs/ventas/respaldo-content-offers.json`).
- **Historial del catálogo** (00170): el trigger `catalog_audit` escribe `audit_log` por cada cambio de `products` y `product_variants` (alta, estado, archivado, precio y demás campos), con quién lo hizo. Un UPDATE de varios campos es una sola fila y uno que no cambia nada no escribe nada.
- **Asignación** (00161): `assignment_rules` (setter, vendedor, referido; manual, por turnos o por condiciones) y el trigger `contacts_enqueue_sales_eval`, que solo encola y atrapa toda excepción.
- **Ventas y pagos** (00162): `sales` y `payments`. **Escribe solo el servidor** (Server Actions con el cliente de servicio, después de `getPermissionAction`); la app lee con la RLS (`can_see_sale`). Un cambio = un evento: los triggers de base emiten `sale_*` / `payment_*` con un `change_id`, y `create_sale` / `cancel_sale` hacen todo en una transacción.
- **Formularios** (00163, 00164): `sale_id` con FK en respuestas y firmas; `submit_form_response` valida el `sale_id` del link firmado.
- **Comprobantes** (00165): bucket privado `payment-receipts`, sin policies (el servidor firma 60 s).
- **Automatizaciones** (00166): el CHECK de `triggers.type` suma los seis tipos de venta y `payment.receipt_uploaded`.
- **Mora** (00167): `private.enqueue_payments_overdue_sweep()` + pg_cron. Solo encola si hay pagos candidatos.
- **Historial** (00168): política ADICIONAL `audit_log_select_sales`. `audit_log_select` no se reescribe.

## Estados

**De una venta**: cuatro se escriben y ganan (`cancelled`, `refunded`, `disputed`, `subscription_cancelled`); cinco se derivan por precedencia (`derive_sale_status` en SQL y `deriveSaleStatus` en TypeScript, con los mismos casos en `lib/sales/sale-status.cases.json`):

1. `subscription_active` si es suscripción,
2. `overdue` si hay un pago moroso,
3. `paid` si el saldo (final − cobrado neto) es ≤ 0, calculado **en céntimos**,
4. `reserved` si hay una reserva cobrada y queda saldo,
5. `pending_payment`.

Un pago **incobrable no baja el saldo**: una venta con uno nunca llega a `paid`.

**De un pago**: `scheduled`, `paid`, `overdue`, `uncollectible`, `refunded`, `cancelled`. Un reembolso es una fila **nueva y negativa** en `paid`; un reembolso total escribe primero la venta como `refunded`, cancela los pagos pendientes y recién ahí inserta la fila.

## Plata

Todo en **céntimos** (`lib/sales/money.ts`, `Number(x) || 0`). Siempre USD. La comisión del proveedor se congela al cobrar (`provider_fee_amount`); **Whop está en 0 %** hasta que se confirme el porcentaje real.

## Atribución y asignación

La venta guarda una **copia congelada** del último toque del contacto (o de otro toque del historial, o una atribución cargada a mano). Las reglas de asignación se evalúan en el job `sales_contact_eval`; asignar a mano escribe `assignment_locked_at` y bloquea setter y vendedor (no el referido). Un operador de condición desconocido **no coincide** (el original de prevxcrm coincidía con todo).

## Alta de venta

Asistente de tres pasos (contacto y asignación → producto, descuento y financiación → plan de pagos con cuadre). El servidor **relee el catálogo**: si el precio que mostró el asistente ya no es el de la variante, rechaza con el precio nuevo (`price_changed`). El descuento sobre el tope pide motivo y alcance `all`. Un Member con alcance `own` tiene que quedar como setter o vendedor (si no, no vería lo que creó).

## Pagos y mora

- Cobrar, revertir un cobro, agregar una cuota, reprogramar, marcar incobrable y reembolsar viven en `lib/sales/payments-core.ts`, con un actor **usuario o sistema**: lo usan las Server Actions y los nodos de flow, así hacen lo mismo venga quien venga y la auditoría dice quién fue («Job de mora», el nombre del flow o la persona).
- El **desfase** (`delay_days`) es la diferencia en días de calendario, en la zona del workspace, entre el vencimiento original y el día del cobro (`lib/sales/delay.ts`).
- La **mora** corre de madrugada local por SQL directo (`call_app_cron` no se toca): `UPDATE … WHERE status='scheduled'` condicional, una sola vez por pago, y la venta se recalcula en la base.
- Comprobantes: hasta 10 MB; se valida el contenido, no la extensión.

## Triggers de automatización

Seis tipos (`sale_created`, `sale_status_changed`, `payment_created`, `payment_status_changed`, `payment_before_due`, `payment_after_due`), once atajos en el selector y tres nodos de acción (cobrar un pago, reprogramarlo, cambiar el estado de la venta). El detalle está en [flow-registry.md](flow-registry.md).

**Por qué un cambio dispara una sola vez**: un flow puede tener varios triggers que coinciden con el mismo cambio (por ejemplo «Pago cobrado» y «Cambió el estado del pago»). `pickCanonicalTrigger` elige un ganador por `(prioridad, id del trigger, id del evento)` dentro de `eventMatches`, y los demás no disparan. Los relativos se **agendan** (`payment_relative_trigger`) con una clave que incluye el número de reprogramaciones, así mover un vencimiento rehabilita el recordatorio.

Los flujos de cobranza precreados (cuatro, en borrador y apagados) se crean al abrir Ventas por primera vez (Owner/Admin), al prender la opción en Ajustes y al crear un workspace.

## Métodos de pago (Extra I, bloque MP)

Los métodos de pago dejaron de ser una lista fija: viven en `workspaces.payment_methods` (jsonb, 00224) y se administran en Ajustes > General > Ventas (`sales.settings`). Cada uno tiene nombre, **comisión del procesador** (porcentaje + monto fijo, con tope opcional) y estado activo o inactivo (nunca se borra: un pago viejo conserva su método).

- **El pago congela la comisión al cobrar:** `provider_fee_percent`, `provider_fee_fixed` y `provider_fee_amount` (y la reversión de un cobro los limpia). Cambiar la comisión de un método después no toca los pagos ya cobrados; la ficha del pago muestra «Cobrado · Comisión (2,9 % + 0,30) · Neto». «Corregir la comisión» de un pago cobrado queda en el historial.
- **La base valida el método** (`payments_validate_method`, `PM001`): un pago solo puede usar un método que exista en el negocio. `create_sale` no se tocó: un trigger copia el porcentaje y el fijo del snapshot de la opción de pago cuando el pago nace cobrado.
- **Un solo lector:** todo el código obtiene los métodos con `workspaceMethods(workspace)` (`lib/sales/workspace-methods.ts`); un test de frontera falla si algo vuelve a leer `enabled_payment_methods` (la columna vieja quedó sin leerse). Los cinco de siempre (Whop, transferencia CR, transferencia USA, Wise, Binance) arrancan con comisión 0 hasta que se carguen las reales.
- Los gastos de comisión de procesador se calculan solos en Finanzas ([finanzas.md](finanzas.md)).

## De dónde vino la venta (Extra I)

La ficha tiene «De dónde vino» (canal, pieza con su responsable, anuncio o referido), la lista una columna «Origen» con filtros por canal y por pieza, y la venta puede sugerir el último toque **con origen** si el último fue directo. Detalle en [atribucion.md](atribucion.md). Cada cobro genera sus comisiones: [comisiones.md](comisiones.md).

## Contrato desde la venta

El link firmado del contrato lleva el `sale_id` **adentro del token**. Uno suelto en la URL o en el cuerpo se ignora; uno que no existe o es de otro workspace se descarta (`meta.sale_id_discarded`).

## Permisos

`sales.view`, `sales.manage`, `payments.manage`, y el alcance `sales` (`own` / `all`). El Member de sistema carga y cobra lo suyo (alcance `own`); Owner y Admin ven todo. Ajustes > Actividad es de Owner/Admin.

## Pantallas

`/dashboard/ventas` (lista, con pastillas y filtros en la URL), `/dashboard/ventas/[id]` (ficha), `/dashboard/ventas/pagos`, sección «Ventas» en la ficha del contacto y en el panel de la Agenda, Ajustes > Productos / Asignación / General > Ventas / Actividad.

## Verificación

```
node scripts/verify-sales.mjs                       # bloques 1 a 4, contra la base real
node scripts/verify-audit-visibility.mjs --despues-de-00168
```

Valen las reglas de siempre: crean y limpian sus datos (prefijo `zz-test-`) y no se corren dos a la vez.
