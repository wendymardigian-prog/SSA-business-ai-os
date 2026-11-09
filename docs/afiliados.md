# Afiliados y links

Cualquier persona del equipo o un contacto externo puede traer ventas con los links de cada producto (bloque AF de
Servicios A1, migración `00343_affiliates`). Es de BAIOS y sigue a **Ventas** en la plantilla: no depende del módulo
de Servicios. Avance y decisiones en `docs/PROGRESS-servicios.md` y `docs/PENDIENTE-servicios.md` («Decisiones de AF»).

## Links del producto

`products.links` (con `links_rev`): los links públicos de cada producto (los dos principales en la tarjeta Links de
Productos), cada uno con una clave `lk_xxxxxx`. Los valida `validate_product_links` (gemela
`lib/affiliates/product-links.ts`, `product-links.cases.json`).

## Códigos

Cada afiliado tiene un código que no cambia: `workspace_members.affiliate_code` (equipo) o `contacts.affiliate_code`
(externo). Únicos en el negocio entre los dos (AF001); no se cambian (AF004). `affiliate_ensure_code` lo crea la primera
vez. Una persona ve sus links con su código en **Mis links** (menú de usuario).

## El link corto

`/r/<código>/<link>` (ruta reservada, pública, con tope de 120 pedidos por minuto por IP, `noindex`, nunca 500): busca
el producto con esa clave en el negocio donde existe el código y redirige al destino con `?ref=<código>`. Si no puede
decidir el negocio, cae a la app (nunca a uno equivocado). La ruta solo redirige: la asignación la hace el toque que deja
la página de destino.

## Asignación

El trigger sobre `contact_touches` (`trg_affiliate_touch`) toma el `ref` del toque (`entry_url`, `raw.utm` o
`landing_page`) y asigna el contacto al afiliado con `affiliate_assign` según las reglas del negocio
(`workspaces.affiliate_settings`: ventana, quién gana si ya tenía uno, vencimiento). Gemela
`lib/affiliates/settings.ts` y `affiliate-assign.cases.json`. Nunca tumba el toque. A mano: ficha del contacto, con
`affiliates.assign` y motivo. El vencimiento de las asignaciones es el cron de afiliados (`affiliates-daily`).

## Ventas y comisiones

- La venta hereda el afiliado vigente del contacto (`inheritContactAffiliate`, después de `create_sale`, que no se
  tocó). Se cambia desde la ficha de la venta. La sesión no puede tocar `sales` (AF010).
- El destinatario «El afiliado de la venta» (`sale_affiliate`) en las reglas de comisión, con «si también es el
  vendedor: pagar las dos / solo la mayor» (`when-also-seller.cases.json`) y la condición por tipo de afiliado.
- Una comisión se puede editar a mano (`commission_edit`, queda `edited_manually`); los recálculos nunca la pisan.
- Al dar de baja a alguien del equipo, sus asignaciones vigentes se avisan (F105).

## Pantallas

- **Afiliados** (grupo Ventas): Resumen, Afiliados (con el alta de uno externo) y Reglas.
- **Mis links** (menú de usuario).
- La tarjeta **Links** del producto, el campo Afiliado en las fichas del contacto y de la venta, «Editar» en la ficha
  de una comisión. Tres disparadores: `affiliate_lead_created`, `affiliate_sale_created`, `affiliate_assignment_expired`.
- Portal › programa › Afiliados: qué links ven los estudiantes en el portal.

## Convivencia con «Referido»

`contacts.referred_by_*` y la regla «Referido» de Ventas (00161) conviven sin tocarse con los afiliados. Unificarlos
queda en `docs/PENDIENTE-servicios.md`.

## Verificación

```
node scripts/verify-affiliates.mjs   # gemelas SQL = TS, códigos, asignación, link corto, comisiones y bajas
```
