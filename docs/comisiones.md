# Comisiones

Quién cobra qué por cada pago cobrado. Se construyó en el Extra I (bloques CM1, CM2 y CM3). Avance y decisiones: `docs/PROGRESS-extra-i.md` y `docs/PENDIENTE-extra-i.md`; los gastos de liquidación viven en Finanzas ([finanzas.md](finanzas.md)); de dónde viene una venta, en [atribucion.md](atribucion.md).

## La idea

1. Cada negocio arma **roles de comisión** (Vendedor, Setter, Contenido y Pauta vienen precargados; se crean otros: «Marketing», «Content manager»…). Cada rol dice **a quién se le paga**: el vendedor de la venta, el setter de la venta, el responsable de la pieza que trajo la venta, o una persona fija.
2. Cada rol tiene **reglas ordenadas**. Gana la primera que cumple sus condiciones. Las condiciones se suman con «y» entre dimensiones y «o» dentro de cada lista: producto, variante, financiamiento, método de pago, tipo y número de pago, canal, red, pieza, campaña o anuncio de Meta, **UTM** (fuente, medio, campaña, contenido, término; «es igual a» o «contiene»), vendedor, setter, monto de la venta y vigencia.
3. **Cuando un pago entra a «cobrado»**, el sistema genera una comisión por cada rol activo cuya regla matchee. Congela la regla, la base, el monto y la atribución (una foto: editar la regla después no cambia lo ya generado).
4. Las comisiones se **liquidan**: se eligen varias y se genera un gasto por persona (o uno solo) en Finanzas. Si el gasto se anula, las comisiones vuelven a Pendiente. El estado de pago **se lee del gasto**, nunca se copia.

## Estados de una comisión (`lib/commissions/status.ts`, una sola fuente)

Anulada · Sin persona (la pieza no tiene responsable) · Pagada (su gasto está pagado) · En gasto · Retenida (`available_on` en el futuro) · Pendiente.

## Cuentas

- La base de cálculo es lo **cobrado** o lo **neto del procesador** (cobrado menos el fee que quedó congelado en el pago). El porcentaje admite hasta 3 decimales y se pasa a milésimas enteras: nunca hay flotantes; el medio centavo sube.
- Ejemplo del flujo: una cuota de USD 500 cobrada por Whop (2,9 % + 0,30, fee 14,80) con vendedor al 8 % del neto, setter al 5 % del cobrado y contenido USD 15 fijo da 38,82 / 25,00 / 15,00.

## Lo que no se puede romper

- **El motor tiene dos gemelas.** TypeScript (`lib/commissions/rules.ts`) y SQL (`commission_rule_matches`, `commission_pick_rule`, `commission_payee`, `commission_base_cents`, `commission_amount_cents`, `commission_content_owner`). Los casos compartidos son `lib/commissions/rules.cases.json` (113) y `content-owner.cases.json`: corren en Vitest contra TypeScript y en `verify-commissions.mjs` contra la base. **Si se cambia una regla, se cambia en las dos y se suma el caso.**
- **Solo el servidor escribe** `commissions` y `commission_rules` (no hay política de INSERT/UPDATE/DELETE para `authenticated`; `commissions_guard` lo repite). Las comisiones no cambian de monto, pago, regla ni tipo: se anulan y se generan de nuevo. Una comisión de un gasto **pagado** no se suelta.
- **Idempotencia:** el único `(payment_id, role)` entre las comisiones ganadas vivas hace que repetir la generación (o correrla dos veces a la vez) no duplique. Un cobro revertido anula las libres; **las que ya estaban en un gasto no se tocan**: se avisa a Owner/Admin (`commission_review_needed`) para que decidan un ajuste.
- **Un ajuste es la salida para un reembolso** (nunca se crea nada solo): el reembolso del 50 % de una comisión de 38,82 sugiere −19,41.
- **Liquidar** (`create_commission_payout`): candado por fila en orden fijo; dos llamadas a la vez dejan un gasto por persona y devuelven las repetidas como `already_in_expense`. Excluye (con motivo) anuladas, con gasto, sin persona y retenidas; un grupo con total ≤ 0 no genera gasto. **`expenses_release_commissions` es la excepción a «lo automático nunca tumba lo que lo origina»**: si no puede liberar las comisiones, la anulación del gasto FALLA.
- **Roles:** un rol no se borra, no cambia de `key` ni de `payee` y un precargado sigue siendo precargado (`CM002`); la regla de un rol que no existe o está desactivado se rechaza (`CM001`).
- **Permisos:** `commissions.view` (con alcance `own` o `all`) y `commissions.manage`. **El Member de sistema tiene SOLO `commissions.view` con alcance `own`** (cambio aprobado M9): ve las suyas. `can_see_commission` devuelve siempre true o false, nunca NULL.
- **Avisos:** `commission_generated` (a la persona, agrupado a 10 minutos), `commission_payout_paid` (cuando se paga su gasto), `commission_review_needed` (a Owner/Admin). Las notificaciones personales **las ve también todo Owner/Admin** (así funciona `can_see_notification`).
- **El historial** de comisiones y reglas lo ven quienes ven esa comisión o esas reglas por la política adicional `audit_log_select_commissions` (00232).

## Cómo se genera (y qué queda para después del merge)

El trigger de `payments` (`payments_enqueue_commissions`, **00235**) encola el job `commissions_payment` cuando un pago entra o sale de `cobrado`. La función del trigger (`private.enqueue_commissions_for_payment()`) ya está en la base (00231) y está envuelta en `EXCEPTION`: un cobro nunca falla por esto. **La 00235 se aplica después del merge** (el código que corre el job tiene que estar desplegado antes). Los pagos cobrados antes no generan comisiones: recalcular el pasado es una decisión del negocio.

## Verificación

```
node scripts/verify-commissions.mjs                    # paridad, roles, RLS, generar/revertir, liquidar, guard, trigger, huellas
node scripts/verify-commissions.mjs --despues-de-00235 # suma el recorrido real cobrar → se encola
node scripts/verify-audit-visibility.mjs --despues-de-00168
```

## Migraciones

`00231` (tablas, motor, liquidación, M9) y `00232` (política del historial): aplicadas. `00235` (el trigger de pagos): **escrita y ensayada, se aplica después del merge**.
