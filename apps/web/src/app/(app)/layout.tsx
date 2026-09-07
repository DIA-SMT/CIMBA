import Link from "next/link";
import { redirect } from "next/navigation";
import {
  Activity as ActivityIcon,
  CheckCheck,
  ClipboardList,
  FileSignature,
  GitCompareArrows,
  HardHat,
  Inbox,
  LogOut,
  Map as MapIcon,
  ShieldCheck,
  Smartphone,
  Upload,
  UserRound,
} from "lucide-react";
import { leerSesion } from "@/lib/auth";
import { LogoCimba } from "@/components/marca";
import { BotonTema } from "@/components/boton-tema";
import { MigueChat } from "@/components/migue-chat";
import { BotonPush } from "@/components/boton-push";

interface ItemNav {
  href: string;
  etiqueta: string;
  icono: typeof MapIcon;
  /** Sin roles: lo ve todo el personal. Con roles: solo esos. */
  roles?: string[];
}

/**
 * El menú agrupado por TRABAJO, no por tabla — "que no queden tantos botones,
 * ver a dónde se agrupa cada cosa" (el Director, 7/9). Cuatro grupos con
 * rótulo: mirar la ciudad, mandar el trabajo, responderle al vecino y
 * administrar el sistema. Las rutas no cambian: solo el orden y el aire.
 */
const NAV_GRUPOS: Array<{ etiqueta: string | null; items: ItemNav[] }> = [
  {
    etiqueta: null,
    items: [
      { href: "/mapa", etiqueta: "Mapa", icono: MapIcon },
      { href: "/brecha", etiqueta: "Brecha", icono: GitCompareArrows },
    ],
  },
  {
    etiqueta: "El trabajo",
    items: [
      { href: "/ordenes", etiqueta: "Órdenes", icono: FileSignature },
      { href: "/incidentes", etiqueta: "Incidentes", icono: ClipboardList },
      { href: "/intervenciones", etiqueta: "Intervenciones", icono: HardHat },
      { href: "/campo", etiqueta: "Campo", icono: Smartphone },
    ],
  },
  {
    etiqueta: "El vecino",
    items: [
      { href: "/demandas", etiqueta: "Demandas", icono: Inbox },
      { href: "/calidad", etiqueta: "Tratamiento", icono: ShieldCheck },
      { href: "/cierres", etiqueta: "Cierres", icono: CheckCheck },
      { href: "/ciudadano", etiqueta: "Ciudadano", icono: UserRound },
    ],
  },
  {
    etiqueta: "Sistema",
    items: [
      { href: "/cargar", etiqueta: "Cargar", icono: Upload },
      // Trazabilidad de uso: solo la conducción (admin y el Director).
      { href: "/actividad", etiqueta: "Actividad", icono: ActivityIcon, roles: ["admin", "planificacion"] },
    ],
  },
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
        <nav className="z-20 flex w-16 shrink-0 flex-col items-center gap-1 border-r border-borde bg-panel py-3 md:w-44 md:items-stretch md:px-3">
          {NAV_GRUPOS.map((grupo, gi) => {
            const items = grupo.items.filter((i) => !i.roles || i.roles.includes(sesion.rol_cimba));
            if (items.length === 0) return null;
            return (
              <div key={gi} className="w-full">
                {grupo.etiqueta ? (
                  <>
                    {/* Con nombres: el rótulo del grupo. Solo íconos: una línea. */}
                    <p className="mt-3 mb-1 hidden px-3 text-[9px] font-bold tracking-[0.14em] text-texto-3 uppercase md:block">
                      {grupo.etiqueta}
                    </p>
                    <div className="mx-auto my-2 h-px w-6 bg-borde md:hidden" />
                  </>
                ) : null}
                <div className="flex flex-col items-center gap-1 md:items-stretch">
                  {items.map(({ href, etiqueta, icono: Icono }) => (
                    <Link
                      key={href}
                      href={href}
                      // En pantallas angostas el menú es solo ícono: sin el title
                      // había que entrar uno por uno para saber qué era cada cosa.
                      title={etiqueta}
                      aria-label={etiqueta}
                      className="group flex items-center gap-3 rounded-lg px-3 py-2 text-texto-2 transition hover:bg-panel-2 hover:text-texto"
                    >
                      <Icono size={17} className="shrink-0 transition group-hover:text-celeste" />
                      <span className="hidden text-[13px] font-medium md:inline">{etiqueta}</span>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
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
