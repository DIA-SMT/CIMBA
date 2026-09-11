"use client";

import {
  AYUDA_MEDICION,
  ETIQUETA_MEDICION,
  MEDICIONES,
  type Medicion,
  volumenDe,
} from "@/lib/medicion";

/**
 * CÓMO SE MIDE EL BACHE — los tres caminos, en un solo lugar.
 *
 * El formulario pedía ancho × largo × espesor y eso supone que el bache es un
 * rectángulo. No lo es: son manchas irregulares, y el capataz terminaba
 * inventando dos números que multiplicados dieran lo que él sabía que había
 * tapado. Un número inventado es peor que uno menos preciso, y encima es el
 * número con el que se certifica el pago.
 *
 * Vive acá y no adentro de cada formulario porque lo usan los dos lugares
 * donde una empresa carga trabajo —el item de una orden y la carga libre— y
 * tienen que pedir exactamente lo mismo: si divergen, la certificación recibe
 * dos criterios distintos para el mismo dato.
 */

export interface ValorMedida {
  medicion: Medicion;
  ancho: string;
  largo: string;
  superficie: string;
  volumen: string;
  espesor: string;
}

export const medidaVacia = (medicion: Medicion = "lados"): ValorMedida => ({
  medicion,
  ancho: "",
  largo: "",
  superficie: "",
  volumen: "",
  espesor: "",
});

/** El teclado del teléfono mete coma decimal: se normaliza antes de parsear. */
const aNumero = (s: string) => Number(s.trim().replace(",", "."));

/**
 * Lo que se puede calcular con lo cargado, y qué falta para poder enviar.
 * Una sola función para el cartel en vivo y para la validación: si fueran dos,
 * el capataz vería "= 6 m²" y el botón le diría que falta algo.
 */
export function resumenMedida(v: ValorMedida): {
  superficie: number | null;
  volumen: number | null;
  falta: string | null;
} {
  const espesor = aNumero(v.espesor);
  const sinEspesor = !(espesor > 0);

  if (v.medicion === "lados") {
    const a = aNumero(v.ancho);
    const l = aNumero(v.largo);
    if (!(a > 0) || !(l > 0) || sinEspesor) {
      return { superficie: null, volumen: null, falta: "Cargá el ancho, el largo y el espesor." };
    }
    const superficie = Math.round(a * l * 100) / 100;
    return { superficie, volumen: volumenDe(superficie, espesor), falta: null };
  }

  if (v.medicion === "superficie") {
    const s = aNumero(v.superficie);
    if (!(s > 0) || sinEspesor) {
      return { superficie: null, volumen: null, falta: "Cargá la superficie en m² y el espesor." };
    }
    const superficie = Math.round(s * 100) / 100;
    return { superficie, volumen: volumenDe(superficie, espesor), falta: null };
  }

  const m3 = aNumero(v.volumen);
  if (!(m3 > 0) || sinEspesor) {
    return { superficie: null, volumen: null, falta: "Cargá el volumen de mezcla y el espesor." };
  }
  // m³ ÷ (cm ÷ 100) = m². El espesor sigue siendo obligatorio porque sin él el
  // volumen no se puede llevar a la superficie, que es la unidad que se paga.
  return {
    superficie: Math.round((m3 / (espesor / 100)) * 100) / 100,
    volumen: Math.round(m3 * 100) / 100,
    falta: null,
  };
}

/** Los campos que viajan al servidor, según el modo. Lo que no corresponde NO
 *  se manda: así la base no guarda un ancho que nadie midió. */
export function medidaAFormData(fd: FormData, v: ValorMedida) {
  fd.set("medicion", v.medicion);
  fd.set("espesorCm", String(aNumero(v.espesor)));
  if (v.medicion === "lados") {
    fd.set("anchoM", String(aNumero(v.ancho)));
    fd.set("largoM", String(aNumero(v.largo)));
  } else if (v.medicion === "superficie") {
    fd.set("superficieM2", String(aNumero(v.superficie)));
  } else {
    fd.set("volumenM3", String(aNumero(v.volumen)));
  }
}

function Campo({
  etiqueta,
  valor,
  alCambiar,
  paso = 0.1,
}: {
  etiqueta: string;
  valor: string;
  alCambiar: (v: string) => void;
  paso?: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-texto-2">{etiqueta}</span>
      <input
        type="number"
        inputMode="decimal"
        step={paso}
        min={0}
        value={valor}
        onChange={(e) => alCambiar(e.target.value)}
        className="num w-full rounded-xl border border-borde-2 bg-panel-2 px-3 py-3.5 text-lg"
      />
    </label>
  );
}

export function CamposMedida({
  valor,
  alCambiar,
  extra,
}: {
  valor: ValorMedida;
  alCambiar: (v: ValorMedida) => void;
  /** Lo que va a la derecha del título: hoy, el botón de dictar. */
  extra?: React.ReactNode;
}) {
  const set = (parcial: Partial<ValorMedida>) => alCambiar({ ...valor, ...parcial });
  const { superficie, volumen } = resumenMedida(valor);
  const derivada = valor.medicion === "volumen";

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-texto-3 uppercase">
          Medidas reales
        </span>
        {extra}
      </div>

      {/* Cómo se puede medir ESTE bache. Targets grandes: se elige con guantes. */}
      <div className="mb-2 grid grid-cols-3 gap-2">
        {MEDICIONES.map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => set({ medicion: m })}
            title={AYUDA_MEDICION[m]}
            className={`min-h-11 rounded-xl border-2 px-2 py-2 text-[12px] leading-tight font-bold transition active:scale-[0.99] ${
              valor.medicion === m
                ? "border-azul bg-azul/15 text-celeste"
                : "border-borde-2 bg-panel-2 text-texto-2 hover:border-celeste/60"
            }`}
          >
            {ETIQUETA_MEDICION[m]}
          </button>
        ))}
      </div>
      <p className="mb-2 text-[11px] leading-snug text-texto-3">{AYUDA_MEDICION[valor.medicion]}</p>

      {valor.medicion === "lados" && (
        <div className="grid grid-cols-3 gap-2">
          <Campo etiqueta="Ancho (m)" valor={valor.ancho} alCambiar={(v) => set({ ancho: v })} />
          <Campo etiqueta="Largo (m)" valor={valor.largo} alCambiar={(v) => set({ largo: v })} />
          <Campo etiqueta="Espesor (cm)" valor={valor.espesor} alCambiar={(v) => set({ espesor: v })} />
        </div>
      )}

      {valor.medicion === "superficie" && (
        <div className="grid grid-cols-2 gap-2">
          <Campo
            etiqueta="Superficie (m²)"
            valor={valor.superficie}
            alCambiar={(v) => set({ superficie: v })}
          />
          <Campo etiqueta="Espesor (cm)" valor={valor.espesor} alCambiar={(v) => set({ espesor: v })} />
        </div>
      )}

      {valor.medicion === "volumen" && (
        <div className="grid grid-cols-2 gap-2">
          <Campo
            etiqueta="Mezcla usada (m³)"
            valor={valor.volumen}
            alCambiar={(v) => set({ volumen: v })}
            paso={0.01}
          />
          <Campo etiqueta="Espesor (cm)" valor={valor.espesor} alCambiar={(v) => set({ espesor: v })} />
        </div>
      )}

      {superficie != null && (
        <p className="num mt-2 text-xl font-extrabold text-celeste">
          = {superficie.toLocaleString("es-AR", { maximumFractionDigits: 2 })} m²
          {volumen != null && (
            <span className="text-texto-2">
              {" "}
              · {volumen.toLocaleString("es-AR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} m³
            </span>
          )}
        </p>
      )}

      <p className="mt-1 text-xs leading-relaxed text-texto-3">
        {derivada
          ? "La superficie se calcula con la mezcla y el espesor: es una estimación, y así queda anotada."
          : "Medí lo que realmente pavimentaste: a veces es un bache pero se hace el paño entero."}
      </p>
    </div>
  );
}
