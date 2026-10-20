import { Cabecalho, EmBreve } from "@/components/Cabecalho";
import { BotaoSair } from "@/lib/empresa";

export default function ConfiguracoesPage() {
  return (
    <>
      <Cabecalho titulo="Configurações" />
      <EmBreve fase={5} oQue="Serviços, profissionais e mensagens" />
      <div className="px-4">
        <BotaoSair />
      </div>
    </>
  );
}
