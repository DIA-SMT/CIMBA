import Link from "next/link";
import { redirect } from "next/navigation";
import { LogOut } from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";
import { BotonTema } from "@/components/boton-tema";
import { MigueChat } from "@/components/migue-chat";
import { BotonPush } from "@/components/boton-push";
import { NavLateral } from "@/components/nav-lateral";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sesion = await leerSesion();
  if (!sesion) redirect("/acceso");
  // La empresa contratista tiene su propio portal: nada del chrome del
  // personal le sirve, y las RLS igual no le dejarían ver casi nada.
  if (sesion.rol_cimba === "empresa") redirect("/empresa");

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-borde bg-panel px-4">
        <Link href="/mapa" aria-label="CIMBA — inicio">
          <LogoCimba />
        </Link>
        <div className="flex items-center gap-4">
          <BotonTema compacto />
          <BotonPush />
          <div className="hidden text-right sm:block">
            <div className="text-xs font-semibold">{sesion.nombre}</div>
            <div className="text-[10px] font-medium tracking-wider text-celeste uppercase">
              {sesion.rol_cimba.replaceAll("_", " ")}
            </div>
          </div>
          <a
            href="/api/auth/logout"
            title="Cerrar sesión"
            className="rounded-lg border border-borde-2 p-2 text-texto-2 transition hover:border-peligro/50 hover:text-peligro"
          >
            <LogOut size={15} />
          </a>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <NavLateral rol={sesion.rol_cimba} />

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <MigueChat />
    </div>
  );
}
