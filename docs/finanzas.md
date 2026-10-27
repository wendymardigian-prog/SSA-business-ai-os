# Finanzas

Gastos, proveedores, gastos que se repiten, gastos automáticos y un Resumen de cuánto entra, cuánto sale y cuánto queda. Se construyó en el Extra I (bloques G1, G2 y G3); las comisiones del equipo se liquidan acá como gastos (ver [comisiones.md](comisiones.md)). Avance y decisiones: `docs/PROGRESS-extra-i.md` y `docs/PENDIENTE-extra-i.md`.

## Qué hay

| Pantalla | Ruta | Permiso |
|---|---|---|
| Resumen | `/dashboard/finanzas` | `expenses.view` |
| Gastos (lista y ficha) | `/dashboard/finanzas/gastos` | `expenses.view` (cambiar: `expenses.manage`) |
| Recurrentes | `/dashboard/finanzas/recurrentes` | `expenses.view` / `expenses.manage` |
| Proveedores | `/dashboard/finanzas/proveedores` | `expenses.view` / `expenses.manage` |
| Categorías y gastos automáticos | Ajustes > General > Finanzas | `expenses.manage` |

El menú «Finanzas» lo ve quien tenga `expenses.view` o `commissions.view` (un Member ve solo sus comisiones).

## El modelo (solo 3 tablas y 1 columna)

- `expenses`, `recurring_expenses` y `vendors` (00225). Nada se borra: un gasto se **anula**, una plantilla se **pausa**, un proveedor se **archiva**. No hay política de DELETE.
- `workspaces.finance_settings` (jsonb): las 12 categorías precargadas (con su grupo: Adquisición, Entrega, Operación u Otro), la configuración de los gastos automáticos y los días de cierre. Cada pantalla escribe SU clave; las Server Actions escriben con el cliente de servicio después de chequear el permiso (la política de `workspaces` sigue siendo de Admin).
- Un gasto tiene **estado**: `por_revisar` (sin monto, lo dejó una plantilla variable), `programado`, `vencido`, `pagado`, `anulado`. La regla pura está en `lib/finance/expense-status.ts`.
- La plata va en **céntimos enteros** (`lib/shared/money.ts`) y siempre en USD. Las fechas son civiles (`AAAA-MM-DD`) en la zona del negocio.

## Lo que no se puede romper

- **`expenses_guard` (trigger):** una persona (rol `authenticated`) solo da de alta gastos `manual` o `adjustment`; el origen no cambia nunca; un anulado es final; un pagado no cambia monto ni fechas (se revierte primero); el monto de un gasto automático no pagado y el de una liquidación de comisiones lo calcula el sistema.
- **Idempotencia por índice único:** `(recurring_expense_id, scheduled_date)` para lo que generan las plantillas y `(workspace_id, auto_key)` para los automáticos. Repetir el trabajo diario es seguro.
- **El trabajo diario** es el job `finance_daily` (uno por workspace y día local, desde las 03:00 locales). Corre cinco pasos, cada uno en su propio `try`: generar recurrentes → recalcular automáticos y cerrar los de meses viejos → vencer los programados → avisar. Si un paso falla, los demás corren y el job lanza **al final** (queda fallido y la cola lo reintenta). Lo encola `private.enqueue_finance_daily()` (00228); **el `cron.schedule` es la 00233, que se aplica después del merge**. Mientras tanto, «Calcular ahora» en Ajustes encola uno a mano.
- **Recurrentes:** editar la regla de fechas o la anticipación reinicia `generation_anchor` a hoy (no se «recuperan» fechas pasadas con la regla nueva); reactivar también, y la pantalla avisa qué fechas se saltearon. Un gasto que ya nació copió los datos de la plantilla y no cambia si se edita después. Con débito automático el gasto nace **pagado**; una plantilla variable nace **por revisar** con monto 0.
- **Gastos automáticos** (comisión de cada procesador de pagos, y pauta de Meta por cuenta): UN gasto por método o cuenta y mes (`auto_key`). Se **recalcula entero** cada día para los tres meses de la ventana (nunca «se le suma lo nuevo»). La decisión vive en la base (`upsert_auto_expense`, con candado por clave) y tiene su gemela pura `decideAutoExpenseAction`; los mismos casos (`lib/finance/auto-expenses.cases.json`) corren contra las dos. Si el total cambia **después de pagado**, no se toca el monto: se marca la diferencia y la persona elige «Crear ajuste» (un gasto `adjustment` con el signo de la diferencia) o «Ignorar» (con motivo). La pauta de Meta suma solo el nivel `account`, solo cuentas en USD. Un mes termina de cerrarse solo (`auto_close_days`, 3 por defecto) si el cobro es automático.
- **Resumen:** período «Este mes» por defecto, en la zona del NEGOCIO. Ingresos = pagos `paid` (los reembolsos son filas negativas `paid` y restan solos); gastos = gastos `pagado` por `paid_date`. Pagos y ventas se leen en el servidor después de `expenses.view` y al navegador solo viajan **agregados** (un test mira la forma). Un dato que no existe es «—», nunca 0.
- **El historial** de Finanzas lo lee quien tenga `expenses.view` por la política adicional `audit_log_select_finance` (00227); `audit_log_select` no se tocó.
- **Exportar CSV de gastos** lo habilita `expenses.view` (como pide el plano de Gastos), no `data.export`.

## Verificación

```
node scripts/verify-expenses.mjs                    # RLS, triggers, índices únicos, concurrencia, paridad del automático, bucket, historial
node scripts/verify-expenses.mjs --despues-de-00233 # suma la tarea de pg_cron `finance-daily`
```

Crea y limpia sus datos (prefijo `zz-test-`); no se corre a la vez que otro `verify-*`.

## Migraciones

`00225` (tablas y RLS), `00226` (bucket privado de comprobantes), `00227` (política del historial), `00228` (vencer y encolar), `00229` (gastos automáticos): aplicadas. `00233` (el cron): **escrita y ensayada, se aplica después del merge**.
