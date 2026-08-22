import { leerSesion } from "@/lib/auth";
import { TituloPagina } from "@/components/ui";
import { FormularioFuncionario } from "./formulario";

export const dynamic = "force-dynamic";

export default async function PaginaFuncionarioNuevo() {
  const sesion = (await leerSesion())!;
  const puede = ["funcionario", "planificacion", "supervision", "admin"].includes(sesion.rol_cimba);

  return (
    <div className="mx-auto max-w-3xl p-6">
      <TituloPagina
        titulo="Pedidos de funcionarios"
        sub="Para cargar desde el territorio: usá tu ubicación (GPS) o marcá en el mapa según el distrito que estés recorriendo. Entra como demanda con fuente Secretarías."
      />
      {puede ? (
        <FormularioFuncionario nombreSesion={sesion.nombre} />
      ) : (
        <p className="rounded-lg border border-borde bg-panel px-4 py-6 text-sm text-texto-2">
          Este formulario es para funcionarios municipales (perfiles <b>funcionario</b>, <b>planificación</b> o{" "}
          <b>supervisión</b>). Tu rol actual es <b>{sesion.rol_cimba}</b>.
        </p>
      )}
    </div>
  );
}
