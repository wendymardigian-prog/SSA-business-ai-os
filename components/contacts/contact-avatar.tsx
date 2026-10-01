"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * La foto de un contacto, con fallback a la inicial (F16).
 *
 * Antes una URL vencida (el CDN de Meta, antes de que F16 la copiara a
 * nuestro Storage) dejaba el icono de imagen rota del navegador. El
 * `onError` hace caer a la inicial, igual que cuando no hay `avatarUrl`.
 *
 * Client Component chico a proposito: la pantalla de detalle del contacto es
 * un Server Component, y `onError` necesita JS en el cliente.
 */
export function ContactAvatar({
  avatarUrl,
  displayName,
  size = "md",
  className,
}: {
  avatarUrl: string | null | undefined;
  displayName: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const initial = displayName?.[0]?.toUpperCase() ?? "?";
  const sizeClass = size === "sm" ? "h-8 w-8 text-xs" : size === "lg" ? "h-16 w-16 text-xl" : "h-10 w-10 text-sm";

  if (!avatarUrl || broken) {
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full bg-muted font-semibold text-muted-foreground",
          sizeClass,
          className,
        )}
      >
        {initial}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- la URL puede ser del CDN de un proveedor externo o del bucket publico avatars; next/image no la puede optimizar sin configurar cada dominio.
    <img
      src={avatarUrl}
      alt=""
      onError={() => setBroken(true)}
      className={cn("rounded-full object-cover", sizeClass, className)}
    />
  );
}
