import { Cabecalho, EmBreve } from "@/components/Cabecalho";

export default function ClientesPage() {
  return (
    <>
      <Cabecalho titulo="Clientes" />
      <EmBreve fase={2} oQue="A lista de clientes com filtros" />
    </>
  );
}
