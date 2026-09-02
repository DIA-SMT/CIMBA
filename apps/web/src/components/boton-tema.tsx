"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

const CLAVE = "cimba-tema";
export type Tema = "claro" | "oscuro";

export function temaActual(): Tema {
  if (typeof document === "undefined") return "claro";
  return document.documentElement.dataset.tema === "oscuro" ? "oscuro" : "claro";
}

/**
 * Alterna claro/oscuro. El claro es el default de oficina; el oscuro queda
 * para la pantalla de comando. El atributo lo pinta un script inline en el
 * layout raíz ANTES del primer frame (sin flash); acá solo se alterna y se
 * persiste. El mapa escucha el cambio vía MutationObserver sobre <html>.
 */
export function BotonTema({ compacto = false }: { compacto?: boolean }) {
  // Evita el desajuste de hidratación: el ícono real recién después del mount.
  const [tema, setTema] = useState<Tema | null>(null);
  useEffect(() => setTema(temaActual()), []);

  const alternar = () => {
    const nuevo: Tema = temaActual() === "oscuro" ? "claro" : "oscuro";
    document.documentElement.dataset.tema = nuevo;
    try {
      localStorage.setItem(CLAVE, nuevo);
    } catch {
      // sin storage (modo privado): el cambio vale para esta pestaña igual
    }
    setTema(nuevo);
  };

  return (
    <button
      type="button"
      onClick={alternar}
      title={tema === "oscuro" ? "Pasar a tema claro" : "Pasar a tema oscuro"}
      aria-label="Cambiar tema"
      className={`flex items-center justify-center rounded-lg border border-borde-2 text-texto-2 transition hover:border-celeste/50 hover:text-texto ${
        compacto ? "h-9 w-9" : "h-12 w-12 sm:h-9 sm:w-9"
      }`}
    >
      {tema === "oscuro" ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}
