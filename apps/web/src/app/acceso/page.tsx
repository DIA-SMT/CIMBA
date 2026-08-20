import Image from "next/image";
import { GlifoCimba } from "@/components/marca";
import { SelectorRolDev } from "./selector-rol";

export default async function Acceso({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const devSso = process.env.DEV_FAKE_SSO === "1";
  const portal = "https://ciudaddigital.smt.gob.ar";

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

        <a
          href={portal}
          className="block w-full rounded-xl bg-azul px-4 py-3.5 text-center font-semibold text-white transition hover:brightness-110"
        >
          Ingresar con Ciudad Digital
        </a>
        <p className="mt-3 text-center text-xs text-texto-3">
          El acceso se gestiona desde el portal municipal. CIMBA no usa contraseñas propias.
        </p>

        {devSso && <SelectorRolDev requiereCodigo={Boolean(process.env.DEV_SSO_CODIGO)} />}
      </div>
    </main>
  );
}
