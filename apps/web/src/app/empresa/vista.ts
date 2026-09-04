import "server-only";
import type { Sesion } from "@/lib/auth";
import { empresaDelEjecutor } from "@/lib/ordenes";

/**
 * Resolución de la empresa efectiva del portal /empresa.
 *
 * Los EJECUTORES ven siempre lo suyo y cualquier ?empresa= de la URL se
 * ignora: el rol empresa, su empresa (sesion.id_empresa); el rol cuadrilla,
 * la empresa "Administración (cuadrillas propias)" — la unificación
 * Campo ↔ Órdenes: las cuadrillas municipales son un ejecutor más, con el
 * mismo portal y las mismas acciones. Como la RLS está escrita pero NO se
 * aplica, este helper es la única barrera contra que un ejecutor espíe el
 * portal de otro. Para admin/planificacion, ?empresa=N habilita la "vista
 * espejo": ver el portal exactamente como lo ve esa empresa.
 */
export interface VistaPortal {
  /** Empresa cuyo portal se muestra; null si el staff todavía no eligió una. */
  empresaId: number | null;
  /** true cuando es staff mirando el portal de una empresa (no la empresa misma). */
  esVistaEspejo: boolean;
}

export async function resolverVistaPortal(
  sesion: Sesion,
  searchParams: { empresa?: string } | undefined,
): Promise<VistaPortal> {
  if (sesion.rol_cimba === "empresa" || sesion.rol_cimba === "cuadrilla") {
    return { empresaId: await empresaDelEjecutor(sesion), esVistaEspejo: false };
  }
  const elegida = Number(searchParams?.empresa);
  if (Number.isInteger(elegida) && elegida > 0) {
    return { empresaId: elegida, esVistaEspejo: true };
  }
  return { empresaId: null, esVistaEspejo: false };
}
