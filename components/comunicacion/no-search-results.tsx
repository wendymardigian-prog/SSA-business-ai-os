import { SearchX } from "lucide-react";

/**
 * El vacio de "tu busqueda no encontro nada" en Broadcasts, Sequences y Growth
 * (Bloque I, I4). Distinto del vacio de "todavia no hay nada": uno pide crear
 * algo, el otro pide buscar otra cosa.
 */
/** `none` va con su articulo y su genero: "Ningún broadcast", "Ninguna secuencia". */
export function NoSearchResults({ query, none }: { query: string; none: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-4 py-20 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground/40" aria-hidden />
      <p className="mt-3 text-sm font-medium text-muted-foreground">
        {none} coincide con &quot;{query}&quot;
      </p>
      <p className="mt-1 text-xs text-muted-foreground/70">Probá con otra palabra o borrá la búsqueda.</p>
    </div>
  );
}
