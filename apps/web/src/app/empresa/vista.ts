import "server-only";
import type { Sesion } from "@/lib/auth";

/**
 * Resolución de la empresa efectiva del portal /empresa.
 *
 * El rol empresa SIEMPRE ve la suya (sesion.id_empresa) y cualquier
 * ?empresa= de la URL se ignora: como la RLS está escrita pero NO se
 * aplica, este helper es la única barrera contra que una contratista
 * espíe el portal de otra. Para admin/planificacion, ?empresa=N habilita
 * la "vista espejo": ver el portal exactamente como lo ve esa empresa.
 */
export interface VistaPortal {
  /** Empresa cuyo portal se muestra; null si el staff todavía no eligió una. */
  empresaId: number | null;
  /** true cuando es staff mirando el portal de una empresa (no la empresa misma). */
  esVistaEspejo: boolean;
}

export function resolverVistaPortal(
  sesion: Sesion,
  searchParams: { empresa?: string } | undefined,
): VistaPortal {
  if (sesion.rol_cimba === "empresa") {
    return { empresaId: sesion.id_empresa ?? null, esVistaEspejo: false };
  }
  const elegida = Number(searchParams?.empresa);
  if (Number.isInteger(elegida) && elegida > 0) {
    return { empresaId: elegida, esVistaEspejo: true };
  }
  return { empresaId: null, esVistaEspejo: false };
}
