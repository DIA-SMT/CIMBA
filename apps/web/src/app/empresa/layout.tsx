import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";

/**
 * Layout del portal de empresas contratistas. Vive FUERA del route group
 * (app) a propósito: el capataz no necesita (ni debe ver) el chrome del
 * personal municipal — solo sus órdenes, en una columna, con targets grandes.
 */
export default async function LayoutEmpresa({ children }: { children: React.ReactNode }) {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  // admin entra para dar soporte; cualquier otro rol tiene su propio portal
  if (sesion.rol_cimba !== "empresa" && sesion.rol_cimba !== "admin") redirect("/mapa");

  return (
    <div className="min-h-screen bg-fondo">
      <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-borde bg-panel px-4">
        <LogoCimba conSmt={false} />
        <div className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate text-sm font-semibold" title={sesion.nombre}>
            {sesion.nombre}
          </span>
          <a
            href="/api/auth/logout"
            title="Cerrar sesión"
            className="flex h-12 shrink-0 items-center gap-1.5 rounded-lg border border-borde-2 px-3 text-sm font-medium text-texto-2 transition hover:border-peligro/50 hover:text-peligro"
          >
            <LogOut size={16} /> Salir
          </a>
        </div>
      </header>
      {children}
    </div>
  );
}
