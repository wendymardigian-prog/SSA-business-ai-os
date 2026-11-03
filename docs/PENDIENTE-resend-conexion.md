# Conexión de Resend — decisiones y pendientes

## Decisiones tomadas en la corrida

1. **Un webhook por negocio, con `?w=<workspace_id>` en la URL.** El receptor usa el parámetro SOLO para elegir con qué secreto verificar: la firma sigue siendo obligatoria. Un `w` que no es un UUID, o que no tiene secreto, da 401. Sin el parámetro, el receptor funciona como antes (compatibilidad).
2. **Qué cuenta como webhook de SSA:** mismo origen y mismo camino que el receptor, y además sin query o con `w=` de ESTE negocio.
   - Uno con `w=` de otro negocio, con otro camino o con otro dominio no se toca nunca.
   - SSA nunca borra un webhook.
   - Si adopta uno sin `w=` (creado a mano), le pone el `endpoint` con `?w=` y le manda la unión de sus eventos con los nuestros: no le saca ninguno.
3. **El secreto sigue llamándose `resend_inbound_webhook_secret` en Vault.** Renombrarlo obligaría a mover los secretos de las instalaciones que ya lo tienen. En TypeScript la clave pasa a ser `SECRET_NAMES.resendWebhookSecret`, con el mismo texto.
4. **La configuración vive en el `config` de la fila `resend`**, en claves planas de texto que volver a guardar la key no pisa (`DISCOVERED_CONFIG_KEYS`).
5. **El canal de email sigue siendo uno por negocio.** Su `email_address` es la dirección principal (`<usuario>@<dominio de recepción>`), y el dominio sale de ahí, así que no hace falta columna. Apagar la recepción desactiva el canal.
6. **Desconectar Resend borra solo la API key, como antes.** El secreto del webhook queda, así los rebotes y las quejas se siguen validando al cambiar la key. Se borra con «Quitar secreto» en la sección Webhook.
7. **«Probar y guardar» para Resend:** `GET /domains`.
   - 200: acceso completo.
   - 401 `restricted_api_key`: solo envío, se guarda igual.
   - Otro 400/401/403: clave inválida, no se guarda.
   - Red caída o 5xx: se guarda igual, como con las keys de IA.
8. **Dos negocios con el mismo dominio de recepción:** con `?w=` gana el parámetro; sin él, 401 y una línea en el log (no se adivina).
9. **La respuesta sale desde la dirección a la que escribió la persona** solo si es del dominio del canal. Si no, sale desde la principal. Nunca desde un dominio ajeno.

## Para después del deploy (Wendy)

- [x] Aplicada la 00279 (ver PROGRESS).
- [ ] Abrir Ajustes → Integraciones → Resend y tocar «Conectar webhook automáticamente». Si ya creaste uno a mano con la URL de SSA, lo adopta en vez de duplicarlo. Si Resend no devuelve su secreto, la pantalla pide pegarlo.
- [ ] Para recibir emails: activar Receiving en el dominio desde resend.com, cargar el MX, y después prender «Recibir emails en la bandeja» y elegir el dominio.

## Abierto

- (se completa durante la corrida)
