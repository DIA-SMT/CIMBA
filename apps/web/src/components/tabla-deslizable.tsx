"use client";

import { useEffect, useRef, useState } from "react";

/**
 * UNA TABLA ANCHA EN UN TELÉFONO, SIN QUE PAREZCA ROTA.
 *
 * Las tablas del sistema tienen entre 7 y 10 columnas y en un celular entran
 * dos. El contenedor ya tenía `overflow-x-auto`, así que técnicamente se podía
 * deslizar — pero nada lo decía: se veía "EMPRESA | USUARIO | administrac…"
 * cortado contra el borde y la pantalla parecía rota. Medido en /ordenes/
 * empresas con 375 px: 985 px de tabla dentro de 262 px visibles, siete
 * columnas invisibles y ninguna pista.
 *
 * Esto agrega las dos cosas que faltaban: un aviso que dice cuántas columnas
 * quedan afuera y un degradado en el borde que muestra que hay más. Los dos
 * desaparecen solos cuando la tabla entra entera (escritorio) o cuando ya se
 * llegó al final — un aviso que no se apaga se vuelve ruido.
 */
export function TablaDeslizable({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [desborde, setDesborde] = useState(0);
  const [alFinal, setAlFinal] = useState(false);
  const [columnasOcultas, setColumnasOcultas] = useState(0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const medir = () => {
      const sobra = el.scrollWidth - el.clientWidth;
      setDesborde(sobra);
      setAlFinal(el.scrollLeft >= sobra - 2);
      /**
       * Cuántas columnas quedan afuera, contando de verdad: decir "deslizá"
       * a secas no informa, y decir "faltan 7 columnas" sí — el usuario sabe
       * si vale la pena o si mejor lo mira en la computadora.
       */
      const ths = el.querySelectorAll("thead th");
      const derechaVisible = el.getBoundingClientRect().right;
      let fuera = 0;
      for (const th of ths) {
        const r = th.getBoundingClientRect();
        // El th vacío de la columna de acciones no se cuenta como información.
        if (r.left >= derechaVisible - 4 && (th.textContent ?? "").trim() !== "") fuera++;
      }
      setColumnasOcultas(fuera);
    };
    medir();
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    el.addEventListener("scroll", medir, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", medir);
    };
  }, [children]);

  return (
    <div className="relative">
      <div ref={ref} className={`overflow-x-auto ${className}`}>
        {children}
      </div>

      {desborde > 0 && !alFinal && (
        <>
          {/* El degradado vive sobre el borde derecho y no intercepta toques:
              es una pista visual, no un control. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-y-0 right-0 w-10 rounded-r-xl bg-gradient-to-l from-panel to-transparent"
          />
          <p className="mt-1.5 text-right text-[11px] text-texto-3 sm:hidden">
            Deslizá la tabla para ver
            {columnasOcultas > 0 ? (
              <>
                {" "}
                las otras <b className="num">{columnasOcultas}</b> columnas
              </>
            ) : (
              " el resto"
            )}{" "}
            →
          </p>
        </>
      )}
    </div>
  );
}

/**
 * El Panel de siempre, pero con la tabla adentro deslizable y avisada. Es el
 * reemplazo directo de `<Panel className="… overflow-x-auto …">`: mismo
 * borde, mismo fondo, y el contenedor que scrollea pasa a ser el de adentro
 * para que el aviso quede pegado a la tabla y no al panel entero.
 */
export function PanelTabla({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-borde bg-panel ${className}`}>
      <TablaDeslizable className="rounded-xl">{children}</TablaDeslizable>
    </div>
  );
}
