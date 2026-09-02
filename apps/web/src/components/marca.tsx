import Image from "next/image";

/**
 * Marca según manual SMT (junio 2025):
 *  - Isotipo flor de azahar extraído del vector oficial (SMT_Logotipos.ai).
 *  - Sobre fondos oscuros se usa la versión monocromática blanca, como exige
 *    el manual cuando el fondo no garantiza contraste del color institucional;
 *    sobre fondos claros va la versión color. Como este componente es de
 *    servidor, el swap lo hace CSS contra html[data-tema] (sin JS ni flash).
 *  - CIMBA convive como identidad municipal secundaria: lockup "CIUDAD SMT | CIMBA".
 */

export function IsotipoSmt({ tam = 28, mono = true }: { tam?: number; mono?: boolean }) {
  const alto = Math.round((tam * 648) / 571);
  if (!mono) {
    return <Image src="/marca/isotipo-smt.png" alt="Ciudad San Miguel de Tucumán" width={tam} height={alto} priority />;
  }
  return (
    <>
      {/* Versión blanca: solo con tema oscuro (en claro sería invisible) */}
      <Image
        src="/marca/isotipo-smt-blanco.png"
        alt="Ciudad San Miguel de Tucumán"
        width={tam}
        height={alto}
        priority
        className="[[data-tema=claro]_&]:hidden"
      />
      {/* Versión color institucional: solo con tema claro */}
      <Image
        src="/marca/isotipo-smt.png"
        alt=""
        aria-hidden
        width={tam}
        height={alto}
        priority
        className="hidden [[data-tema=claro]_&]:block"
      />
    </>
  );
}

/** Glifo radar de CIMBA: monitoreo continuo del territorio. */
export function GlifoCimba({ tam = 30 }: { tam?: number }) {
  return (
    <svg width={tam} height={tam} viewBox="0 0 40 40" fill="none" aria-hidden>
      <circle cx="20" cy="20" r="18" stroke="#2EB1FF" strokeOpacity="0.35" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="11.5" stroke="#2EB1FF" strokeOpacity="0.55" strokeWidth="1.5" />
      <circle cx="20" cy="20" r="5" stroke="#0066FF" strokeWidth="2" />
      <circle cx="20" cy="20" r="1.8" fill="#F4DC00" />
      <g style={{ transformOrigin: "20px 20px", animation: "barrido 4s linear infinite" }}>
        <path d="M20 20 L20 2 A18 18 0 0 1 33.5 7.5 Z" fill="url(#haz)" />
      </g>
      <defs>
        <linearGradient id="haz" x1="20" y1="2" x2="33" y2="20" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2EB1FF" stopOpacity="0.5" />
          <stop offset="1" stopColor="#2EB1FF" stopOpacity="0" />
        </linearGradient>
      </defs>
    </svg>
  );
}

export function LogoCimba({ conSmt = true }: { conSmt?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      {conSmt && (
        <>
          <div className="flex items-center gap-2">
            <IsotipoSmt tam={22} />
            <div className="leading-none">
              <div className="text-[8px] font-semibold tracking-[0.18em] text-texto-2">CIUDAD</div>
              <div className="text-sm font-bold tracking-tight">SMT</div>
            </div>
          </div>
          <div className="h-7 w-px bg-borde-2" />
        </>
      )}
      <div className="flex items-center gap-2">
        <GlifoCimba tam={30} />
        <div className="leading-none">
          <div className="text-lg font-extrabold tracking-tight">
            CIMBA<span className="text-amarillo">.</span>
          </div>
          <div className="text-[8px] font-medium tracking-[0.14em] text-texto-2 uppercase">
            Monitoreo de Baches y Asfalto
          </div>
        </div>
      </div>
    </div>
  );
}
