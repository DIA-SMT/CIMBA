import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CheckCheck,
  ClipboardList,
  FileSignature,
  GitCompareArrows,
  HardHat,
  Inbox,
  Landmark,
  LogOut,
  Map as MapIcon,
  ShieldCheck,
  Smartphone,
  Upload,
  UserRound,
} from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";
import { MigueChat } from "@/components/migue-chat";
import { BotonPush } from "@/components/boton-push";

const NAV = [
  { href: "/mapa", etiqueta: "Mapa", icono: MapIcon },
  { href: "/brecha", etiqueta: "Brecha", icono: GitCompareArrows },
  { href: "/ordenes", etiqueta: "Órdenes", icono: FileSignature },
  { href: "/demandas", etiqueta: "Demandas", icono: Inbox },
  { href: "/incidentes", etiqueta: "Incidentes", icono: ClipboardList },
  { href: "/intervenciones", etiqueta: "Intervenciones", icono: HardHat },
  { href: "/cierres", etiqueta: "Cierres", icono: CheckCheck },
  { href: "/calidad", etiqueta: "Calidad", icono: ShieldCheck },
  { href: "/cargar", etiqueta: "Cargar", icono: Upload },
  { href: "/hcd/nuevo", etiqueta: "HCD", icono: Landmark },
  { href: "/funcionarios/nuevo", etiqueta: "Funcionarios", icono: UserRound },
  { href: "/campo", etiqueta: "Campo", icono: Smartphone },
];

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
        <nav className="z-20 flex w-16 shrink-0 flex-col items-center gap-1 border-r border-borde bg-panel py-3 md:w-44 md:items-stretch md:px-3">
          {NAV.map(({ href, etiqueta, icono: Icono }) => (
            <Link
              key={href}
              href={href}
              className="group flex items-center gap-3 rounded-lg px-3 py-2.5 text-texto-2 transition hover:bg-panel-2 hover:text-texto"
            >
              <Icono size={17} className="shrink-0 transition group-hover:text-celeste" />
              <span className="hidden text-[13px] font-medium md:inline">{etiqueta}</span>
            </Link>
          ))}
          <div className="mt-auto hidden px-3 pb-1 md:block">
            <p className="text-[9px] leading-relaxed text-texto-3">
              CIMBA v0.1
              <br />
              Municipalidad de
              <br />
              San Miguel de Tucumán
            </p>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>

      <MigueChat />
    </div>
  );
}
