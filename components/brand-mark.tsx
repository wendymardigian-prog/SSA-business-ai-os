import { readableTextOn, resolveBrand, type Brand } from "@/lib/brand";

/**
 * El logo del producto, o un monograma si el cliente no subio uno.
 *
 * Sin esto, un clon sin `NEXT_PUBLIC_BRAND_LOGO_URL` configurada quedaria sin
 * ningun logo (antes se mostraba uno fijo a mano). El monograma hace
 * que la pantalla de acceso y el menu lateral nunca queden vacios.
 */
export function BrandMark({ size = 48, className, brand }: { size?: number; className?: string; brand?: Brand }) {
  // Sin `brand`, la marca de la instalacion (login, invitacion). Adentro del
  // panel se pasa la del negocio (`resolveBrand(workspace)`).
  const { name, logoUrl, initial, colorHex } = brand ?? resolveBrand();

  if (logoUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- el dominio del logo lo define cada cliente, no se puede fijar en next.config
      <img
        src={logoUrl}
        alt={name}
        width={size}
        height={size}
        className={className}
        style={{ width: size, height: size, objectFit: "contain" }}
      />
    );
  }

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.22,
        // Con una marca pasada, su propio color (la vista previa de Ajustes muestra el que se esta eligiendo);
        // la inicial, clara u oscura segun ese color (lib/brand.ts, readableTextOn).
        background: brand && colorHex ? colorHex : "var(--primary)",
        color: brand && colorHex ? readableTextOn(colorHex) : "var(--primary-foreground)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: size * 0.5,
        lineHeight: 1,
      }}
      aria-label={name}
      role="img"
    >
      {initial}
    </div>
  );
}
