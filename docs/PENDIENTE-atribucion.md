# Pendiente · Webhooks entrantes, atribución y anuncios (Extra L)

Formato de cada entrada: **qué quedó**, **por qué**, **qué se decidió**.
Avance: [PROGRESS-atribucion.md](PROGRESS-atribucion.md).

## Punto de partida

- **`verify-attribution.mjs` falla antes de empezar.** Un caso, "todos los contactos reales tienen
  first_touch" (775 de 834). Es una comprobación de datos del backfill de la 00115 sobre contactos reales:
  los contactos creados después no tienen toque. Ya lo había anotado Formularios. **Decidido:** se anota y
  no puede empeorar; los demás casos pasan. El conteo sube solo con cada contacto nuevo sin toque.
- **`verify-sales.mjs` falla antes de empezar.** Un caso, "con todas las reglas en manual, crear un
  contacto NO encola nada" (00161). **Decidido:** no es de este módulo; se anota y no puede empeorar.
- **`verify-knowledge.mjs` no se corre** (llama a Voyage de verdad, con costo) y **`verify-webhook.mjs`
  tampoco** (necesita la app corriendo en local). Mismo criterio que Formularios.
- **`verify-rls`, `verify-roles` y `verify-workspace-isolation`** se corren con los flags
  `--despues-de-00143`, `--despues-de-00136` y `--despues-de-00147`, como dejó Llamadas. Ojo con zsh: una
  variable con varios flags sin comillas llega como UN solo argumento; pasarlos escritos a mano.

## Decisiones tomadas con Wendy (12/10/2026)

- **#254 → "solo el último".** Un contacto que ya existía y no tenía toques recibe antes un toque ancla
  `manual` (fecha de creación del contacto) y después el toque del webhook, así `record_contact_touch` no
  se toca.
- **"Asistió"** = `status_group = 'outcome'` de la agenda (el estado "asistió" no existe).
- **Ventas "no canceladas"** = se excluyen `cancelled` y `refunded`.
- **#260** reprocesar vuelve a mandar mensajes, con aviso y confirmación.

## Verificación en vivo (la hace Wendy, §11 del plano)

Pendiente hasta el final de la corrida; se completa con el resultado de cada punto.

- Formulario externo real (Framer, Typeform o Tally) → webhook → contacto con UTMs; repetir el envío no duplica.
- Respuesta a una historia, mención en una historia, anuncio de mensaje a Instagram (**pendiente desde la
  Fase 3**), anuncio de clic a WhatsApp, comentario en un anuncio.
- Agenda desde una landing con `?utm_content={{ad.id}}`; la misma persona navegando a la agenda sin
  parámetros usa la cookie.
- Parámetros de URL de los anuncios en Meta (`utm_campaign={{campaign.id}}&utm_term={{adset.id}}&utm_content={{ad.id}}`).
- Revisión visual en la app con sesión, si no se pudo hacer en la corrida.

## Entradas de la corrida

(Se agregan acá a medida que aparecen: cosas que no entraron, por qué y qué se decidió.)
