import Image from "next/image";
import { GlifoCimba } from "@/components/marca";
import { FormularioAcceso } from "./formulario-acceso";

export default async function Acceso({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <main className="fondo-grilla flex min-h-screen items-center justify-center p-6">
      <div className="panel-vidrio w-full max-w-md rounded-2xl p-8">
        <div className="mb-8 flex flex-col items-center gap-5 text-center">
          <div className="rounded-2xl bg-white p-3 shadow-lg">
            <Image src="/marca/isotipo-smt.png" alt="Ciudad San Miguel de Tucumán" width={56} height={64} priority />
          </div>
          <div>
            <div className="flex items-center justify-center gap-2">
              <GlifoCimba tam={34} />
              <h1 className="text-3xl font-extrabold tracking-tight">
                CIMBA<span className="text-amarillo">.</span>
              </h1>
            </div>
            <p className="mt-2 text-sm text-texto-2">
              Centro Inteligente de Monitoreo de Baches y Asfalto
            </p>
            <p className="mt-1 text-[11px] font-medium tracking-widest text-texto-3 uppercase">
              Municipalidad de San Miguel de Tucumán
            </p>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-peligro/40 bg-peligro/10 px-4 py-3 text-sm text-peligro">
            {error === "token_invalido" && "El token de Ciudad Digital no es válido o expiró."}
            {error === "perfil_inactivo" && "Tu perfil está inactivo. Contactá al administrador de CIMBA."}
          </div>
        )}

        <FormularioAcceso />

        <p className="mt-6 text-center text-xs leading-relaxed text-texto-3">
          ¿Sos empresa contratista? Entrás por acá mismo, con el usuario y la clave que te da la
          Dirección de Bacheo.
        </p>
      </div>
    </main>
  );
}
