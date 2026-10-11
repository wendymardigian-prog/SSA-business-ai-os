# Ventas (Fase 1)

Catálogo de productos con precio versionado, atribución y asignación automática de cada lead, alta de venta en tres pasos, plan de pagos, mora, historial y triggers por cambio de estado. **Una venta nace de un contacto, congela el precio y la atribución de ese momento, y cada cambio de estado puede disparar automatizaciones.**

Plano: [requerimientos-ventas-v7.md](requerimientos-ventas-v7.md) (v1.1; gana sobre cualquier otra copia). Avance: [PROGRESS-ventas.md](PROGRESS-ventas.md). Decisiones, diferencias con el plano y pendientes: [PENDIENTE-ventas.md](PENDIENTE-ventas.md). Triggers y nodos: [flow-registry.md](flow-registry.md).

## Datos

Migraciones **00159** a **00168** (la próxima libre es la **00169**).

- **Catálogo** (00159, 00160): `products` → `product_variants` → `product_versions`. El precio vive en la **versión**; cambiarlo crea una versión nueva (la publicada es inmutable, por trigger). `content_offers` se absorbió con el mismo id y un puente, así que las ideas y piezas de Contenido siguen apuntando bien; su borrado quedó escrito y **sin aplicar** (`docs/pendientes/drop_content_offers.sql`).
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

Asistente de tres pasos (contacto y asignación → producto, descuento y financiación → plan de pagos con cuadre). El servidor **relee el catálogo**: si la versión que mostró el asistente ya no es la vigente, rechaza con el precio nuevo. El descuento sobre el tope pide motivo y alcance `all`. Un Member con alcance `own` tiene que quedar como setter o vendedor (si no, no vería lo que creó).

## Pagos y mora

- Cobrar, revertir un cobro, agregar una cuota, reprogramar, marcar incobrable y reembolsar viven en `lib/sales/payments-core.ts`, con un actor **usuario o sistema**: lo usan las Server Actions y los nodos de flow, así hacen lo mismo venga quien venga y la auditoría dice quién fue («Job de mora», el nombre del flow o la persona).
- El **desfase** (`delay_days`) es la diferencia en días de calendario, en la zona del workspace, entre el vencimiento original y el día del cobro (`lib/sales/delay.ts`).
- La **mora** corre de madrugada local por SQL directo (`call_app_cron` no se toca): `UPDATE … WHERE status='scheduled'` condicional, una sola vez por pago, y la venta se recalcula en la base.
- Comprobantes: hasta 10 MB; se valida el contenido, no la extensión.

## Triggers de automatización

Seis tipos (`sale_created`, `sale_status_changed`, `payment_created`, `payment_status_changed`, `payment_before_due`, `payment_after_due`), once atajos en el selector y tres nodos de acción (cobrar un pago, reprogramarlo, cambiar el estado de la venta). El detalle está en [flow-registry.md](flow-registry.md).

**Por qué un cambio dispara una sola vez**: un flow puede tener varios triggers que coinciden con el mismo cambio (por ejemplo «Pago cobrado» y «Cambió el estado del pago»). `pickCanonicalTrigger` elige un ganador por `(prioridad, id del trigger, id del evento)` dentro de `eventMatches`, y los demás no disparan. Los relativos se **agendan** (`payment_relative_trigger`) con una clave que incluye el número de reprogramaciones, así mover un vencimiento rehabilita el recordatorio.

Los flujos de cobranza precreados (cuatro, en borrador y apagados) se crean al abrir Ventas por primera vez (Owner/Admin), al prender la opción en Ajustes y al crear un workspace.

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
