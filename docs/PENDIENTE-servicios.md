# PENDIENTE — Servicios v12, Corrida A1

Formato: **qué quedó · por qué · qué se decidió**. Lo que encontró la exploración del principio y la regla que se aplicó (el plano pide anotarlo acá) va en la primera sección.

## Lo que encontró la exploración (regla aplicada)

- **`submit_form_response` guarda el `meta` sin filtrar** (00204). · El plano pedía mirarlo. · Rama A de F17: el servidor pone el paso firmado en `meta.service_item_id` y un `BEFORE INSERT` lo valida y lo copia a `service_item_id`.
- **`get_public_form` descarta el EOD con `f.type <> 'eod'`** (00243) y `loadPublishedForm` con `isPublicFormType`. · Regla de F52. · No se reescribe; los tipos `terms`, `quiz` y `activity` se rechazan en el servidor de SSA (la lista de no públicos y la página).
- **Las reuniones guardan las UTM** (`bookings.utm jsonb`). · Regla de F18. · Se respeta `utm.svc_item` solo si el contacto es el del servicio.
- **`bookings` no tiene el estado `attended`.** · F18 lo nombra. · "Asistió" = la reunión pasa a `status_group = 'outcome'` (el mismo criterio de las métricas de anuncios, 00195).
- **`lib/assignment` no tiene gemela SQL.** · Regla de F96. · `svc_pick_owner` implementa en SQL el reparto y las condiciones, con casos compartidos con la gemela TS que reusa `lib/assignment`.
- **`sales.product_variant_id` es `NOT NULL`.** · Regla de F6. · La creación automática usa siempre esa variante; la rama "venta sin variante" queda programada pero no se dispara.
- **No existe `platform.set_module`.** · Regla de F97. · Se crea `app_servicio.set_module_enabled(workspace_id, enabled)` con `EXECUTE` solo para `service_role`.
- **`registerDesignVariables` y `onDesignGenerated` existen** (`lib/designer/extensions.ts`). · Regla de CE. · Se usan sin tocar el Diseñador. El aviso sale cuando el render queda listo.
- **`ai_threads` existe** y su CHECK ya admite el canal `portal` y `subject_type = 'product'`. · Regla de S15. · S15 suma solo la política de lectura del canal.
- **Reglas de comisión:** la tabla es `commission_rules`; los roles viven en `workspaces.commission_settings`; `commissions.user_id` acepta NULL y no hay `contact_id`. · Regla de F75. · S13 suma `commissions.contact_id` con un CHECK "una persona o un contacto, no los dos".
- **El `ref` de la URL** no se guarda en una columna de atribución del toque: solo sobrevive en `contact_touches.entry_url` (y en `raw.utm` para la Agenda). · Regla de F72. · El trigger lo busca en `entry_url`, después en `raw->'utm'` y después en `landing_page`.
- **Rutas de Ajustes › Productos:** `/dashboard/settings/productos/[id]`. · Regla de F114. · Se respeta el prefijo y el nombre del parámetro: la variante va en `/productos/[id]/variantes/[variantId]`.

## Diferencias con el plano

- **"Precio y cobro" sin versiones, Whop, "Crear ventas solas" ni link de pago.** · Nada de eso existe hoy: cada variante tiene un solo precio y su historial va a `audit_log`. · La pestaña es la de Precio e Historial de hoy, movida sin cambios. Lo que no existe no se construye.
- **"Recalcular pendientes" de comisiones no existe.** · F107 lo nombra. · Igual se suma `commissions.edited_manually`, y la generación y la reversión nunca pisan una comisión editada.
- **"Referido" de Ventas** (`contacts.referred_by_*`, regla "Referido" de la 00161). · Es parecido a "afiliado" y el plano no lo nombra. · Decisión de Wendy (8/11): **conviven sin tocarse**. Unificarlos queda para más adelante.
- **`rules.cases.json` nombra `public.commission_evaluate`, que no existe.** · Es un comentario viejo de Extra I. · Los casos nuevos corren contra `commission_payee` y `generate_commissions_for_payment`.

## Pasos manuales de Wendy

- **Apagar "Allow new users to sign up"** en Supabase › Authentication. `verify-auth-settings` lo informa.
