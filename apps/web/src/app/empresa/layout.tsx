import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";
import { BotonTema } from "@/components/boton-tema";
import { BotonPush } from "@/components/boton-push";
import { ColaPendiente } from "./cola-pendiente";

/**
 * Layout del portal de empresas contratistas. Vive FUERA del route group
 * (app) a propósito: el capataz no necesita (ni debe ver) el chrome del
 * personal municipal — solo sus órdenes, en una columna, con targets grandes.
 */
export default async function LayoutEmpresa({ children }: { children: React.ReactNode }) {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  // Las cuadrillas propias reportan acá (ejecutan como "Administración");
  // admin y planificacion (el Director) entran para soporte y vista espejo;
  // cualquier otro rol tiene su propio portal.
  if (!["empresa", "cuadrilla", "admin", "planificacion"].includes(sesion.rol_cimba)) redirect("/mapa");

  return (
    <div className="min-h-screen bg-fondo">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-borde bg-panel px-4">
        <LogoCimba conSmt={false} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="hidden min-w-0 truncate text-sm font-semibold sm:inline" title={sesion.nombre}>
            {sesion.nombre}
          </span>
          <BotonTema />
          {/* La campana de push, que vivía solo en el encabezado del personal:
              la empresa no tenía desde dónde suscribirse y por eso no había ni
              una suscripción de contratistas en toda la base. */}
          <BotonPush />
          <a
            href="/api/auth/logout"
            title="Cerrar sesión"
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-lg border border-borde-2 px-3 text-sm font-medium text-texto-2 transition hover:border-peligro/50 hover:text-peligro"
          >
            <LogOut size={16} /> <span className="hidden sm:inline">Salir</span>
          </a>
        </div>
      </header>
      {/* Lo que espera señal: cuántos trabajos hay guardados en el teléfono y
          el botón para mandarlos. Es del teléfono, no de una orden: va acá. */}
      <ColaPendiente />
      {children}
    </div>
  );
}
