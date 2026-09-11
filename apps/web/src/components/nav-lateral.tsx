"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity as ActivityIcon,
  CheckCheck,
  ClipboardList,
  FileSignature,
  GitCompareArrows,
  HardHat,
  Inbox,
  Map as MapIcon,
  ShieldCheck,
  Smartphone,
  Upload,
  UserRound,
} from "lucide-react";

/**
 * El menú lateral, con la pantalla actual MARCADA.
 *
 * Antes los doce ítems se veían idénticos siempre: estando en /ordenes,
 * "Órdenes" era indistinguible de "Campo". Lo único que cambiaba el color era
 * pasar el mouse — o sea que en el celular, donde no hay mouse y el riel es
 * solo íconos, no había forma de saber dónde estabas.
 *
 * Vive en el cliente por usePathname(). Por eso NAV_GRUPOS se mudó acá entero:
 * los íconos son referencias a componentes y no cruzan el límite
 * server→client. Esconder un link nunca fue el control de acceso — /actividad
 * tiene su propia guarda en el servidor — así que pasar solo el rol alcanza.
 */

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

/** Una subpágina marca su sección: en /ordenes/nueva sigue encendido "Órdenes".
 *  El `/` del prefijo evita que /calidad encienda también a un futuro
 *  /calidad-algo. */
const esActual = (pathname: string, href: string) =>
  pathname === href || pathname.startsWith(`${href}/`);

export function NavLateral({ rol }: { rol: string }) {
  const pathname = usePathname();

  return (
    <nav className="z-20 flex w-16 shrink-0 flex-col items-center gap-1 border-r border-borde bg-panel py-3 md:w-44 md:items-stretch md:px-3">
      {NAV_GRUPOS.map((grupo, gi) => {
        const items = grupo.items.filter((i) => !i.roles || i.roles.includes(rol));
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
              {items.map(({ href, etiqueta, icono: Icono }) => {
                const activo = esActual(pathname, href);
                return (
                  <Link
                    key={href}
                    href={href}
                    // En pantallas angostas el menú es solo ícono: sin el title
                    // había que entrar uno por uno para saber qué era cada cosa.
                    title={etiqueta}
                    aria-label={etiqueta}
                    aria-current={activo ? "page" : undefined}
                    /**
                     * Fondo redondeado y no un filete al borde: bajo md el riel
                     * es w-16 con los ítems centrados, y un filete pegado al
                     * borde izquierdo queda flotando lejos del ícono. El
                     * celeste al 10% es el mismo "esto está seleccionado" que
                     * usan los chips de filtro en /cierres y /demandas.
                     */
                    className={`group flex items-center gap-3 rounded-lg px-3 py-2 transition ${
                      activo
                        ? "bg-celeste/10 font-semibold text-celeste"
                        : "text-texto-2 hover:bg-panel-2 hover:text-texto"
                    }`}
                  >
                    <Icono
                      size={17}
                      className={`shrink-0 transition ${activo ? "text-celeste" : "group-hover:text-celeste"}`}
                    />
                    <span className="hidden text-[13px] md:inline">{etiqueta}</span>
                  </Link>
                );
              })}
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
  );
}
