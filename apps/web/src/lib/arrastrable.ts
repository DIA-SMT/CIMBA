"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface Desplazamiento {
  x: number;
  y: number;
}

/**
 * Paneles que el usuario puede reubicar arrastrándolos de su cabecera, para
 * que no le tapen la parte del mapa que quiere ver. El desplazamiento se
 * guarda por panel en localStorage: donde lo dejó, ahí queda la próxima vez.
 *
 * Devuelve el estilo a aplicar sobre la posición original (nunca la reemplaza:
 * es un translate), los handlers para la cabecera y si fue movido.
 */
export function usePanelArrastrable(
  clave: string,
  /** `asaEsControl`: el asa ES un botón (Migue cerrado), así que no se ignoran
   *  los punteros sobre controles y se suprime el clic si hubo arrastre. */
  opciones: { asaEsControl?: boolean } = {},
) {
  const [pos, setPos] = useState<Desplazamiento>({ x: 0, y: 0 });
  const [arrastrando, setArrastrando] = useState(false);
  const inicioRef = useRef<{ puntero: Desplazamiento; panel: Desplazamiento } | null>(null);
  const huboArrastreRef = useRef(false);

  const claveLs = `cimba:panel:${clave}`;

  useEffect(() => {
    try {
      const guardado = localStorage.getItem(claveLs);
      if (guardado) {
        const p = JSON.parse(guardado) as Desplazamiento;
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) setPos(p);
      }
    } catch {
      // localStorage inaccesible (modo privado): el panel arranca en su lugar
    }
  }, [claveLs]);

  const guardar = useCallback(
    (p: Desplazamiento) => {
      try {
        if (p.x === 0 && p.y === 0) localStorage.removeItem(claveLs);
        else localStorage.setItem(claveLs, JSON.stringify(p));
      } catch {
        // sin persistencia: igual funciona en esta sesión
      }
    },
    [claveLs],
  );

  const alBajarPuntero = useCallback(
    (e: React.PointerEvent) => {
      // no secuestrar clics de los botones que viven en la cabecera
      if (!opciones.asaEsControl && (e.target as HTMLElement).closest("button, a, input, select")) return;
      if (!opciones.asaEsControl) e.preventDefault();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // sin captura el arrastre sigue funcionando mientras el puntero no salga del asa
      }
      inicioRef.current = { puntero: { x: e.clientX, y: e.clientY }, panel: pos };
      huboArrastreRef.current = false;
      setArrastrando(true);
    },
    [pos, opciones.asaEsControl],
  );

  const alMoverPuntero = useCallback((e: React.PointerEvent) => {
    const ini = inicioRef.current;
    if (!ini) return;
    const bruto = {
      x: ini.panel.x + (e.clientX - ini.puntero.x),
      y: ini.panel.y + (e.clientY - ini.puntero.y),
    };
    if (Math.abs(bruto.x - ini.panel.x) > 4 || Math.abs(bruto.y - ini.panel.y) > 4) {
      huboArrastreRef.current = true;
    }
    // Tope generoso pero que nunca deja el panel fuera de la pantalla
    const limite = { x: window.innerWidth * 0.85, y: window.innerHeight * 0.8 };
    setPos({
      x: Math.max(-limite.x, Math.min(limite.x, bruto.x)),
      y: Math.max(-limite.y, Math.min(limite.y, bruto.y)),
    });
  }, []);

  const alSoltarPuntero = useCallback(
    (e: React.PointerEvent) => {
      if (!inicioRef.current) return;
      inicioRef.current = null;
      setArrastrando(false);
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      } catch {
        // ya liberado por el navegador
      }
      setPos((p) => {
        guardar(p);
        return p;
      });
    },
    [guardar],
  );

  const reubicar = useCallback(() => {
    setPos({ x: 0, y: 0 });
    guardar({ x: 0, y: 0 });
  }, [guardar]);

  return {
    movido: pos.x !== 0 || pos.y !== 0,
    arrastrando,
    reubicar,
    /** Estilo del contenedor del panel (se suma a su posición original). */
    estilo: {
      transform: `translate(${pos.x}px, ${pos.y}px)`,
      transition: arrastrando ? "none" : "transform 120ms ease-out",
    } as React.CSSProperties,
    /** Props para la cabecera: es la zona por donde se agarra. */
    asaProps: {
      onPointerDown: alBajarPuntero,
      onPointerMove: alMoverPuntero,
      onPointerUp: alSoltarPuntero,
      onPointerCancel: alSoltarPuntero,
      // Si el asa es un botón, un arrastre no debe además disparar su acción
      onClick: opciones.asaEsControl
        ? (e: React.MouseEvent) => {
            if (huboArrastreRef.current) {
              huboArrastreRef.current = false; // se consume: el próximo clic sí abre
              e.preventDefault();
              e.stopPropagation();
            }
          }
        : undefined,
      style: { cursor: arrastrando ? "grabbing" : "grab", touchAction: "none" } as React.CSSProperties,
    },
  };
}
