"use client";

import { Menu } from "lucide-react";
import { usePathname } from "next/navigation";
import { EVENTO_MENU_MOVIL, esPantallaDeMapa } from "./nav-lateral";

/**
 * El botón del menú en el teléfono, solo en las pantallas de mapa. Ahí el
 * menú lateral se esconde para que el mapa use todo el ancho (le sacaba un
 * sexto de la pantalla), y este botón lo trae de vuelta encima.
 */
export function BotonMenuMovil() {
  const pathname = usePathname();
  if (!esPantallaDeMapa(pathname)) return null;
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(EVENTO_MENU_MOVIL))}
      aria-label="Abrir el menú"
      className="mr-1 rounded-lg border border-borde-2 p-2 text-texto-2 transition hover:text-texto md:hidden"
    >
      <Menu size={17} />
    </button>
  );
}
