"use client";

import { useDialogo } from "@/components/Dialogo";
import { diasDesdeContato, montarMensagem, podeMandarAlo, registrarAlo, tipoDoAlo } from "@/lib/alo";
import { useEmpresa } from "@/lib/empresa";
import { primeiroNome } from "@/lib/formato";
import type { ClienteLista } from "@/lib/listaClientes";
import { abrirWhatsApp } from "@/lib/whatsapp";

export function textoChamada(dias: number): string {
  return dias === 0 ? "hoje" : `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

// Botão "Mandar alô": monta a mensagem do salão ({nome}, {servico}), abre o WhatsApp com
// ela pronta e grava o alô em contatos. Se ela foi chamada nos últimos 7 dias, pergunta antes.
export function BotaoMandarAlo({
  cliente: c,
  servico,
  aoChamar,
  compacto = false,
}: {
  cliente: ClienteLista;
  servico: string | null;
  aoChamar: () => void;
  compacto?: boolean;
}) {
  const empresa = useEmpresa();
  const { dialogo, perguntar, avisar } = useDialogo();
  if (!podeMandarAlo(c.status)) return null;

  const dias = diasDesdeContato(c.ultimo_contato);
  const recente = dias !== null && dias < 7;

  async function mandar() {
    if (
      recente &&
      !(await perguntar(`${primeiroNome(c.nome) || "Ela"} foi chamada ${textoChamada(dias!)}.\n\nChamar de novo?`, {
        confirmar: "Chamar de novo",
      }))
    )
      return;
    const tipo = tipoDoAlo(c.status);
    const mensagem = montarMensagem(empresa.config, tipo, c.nome, servico);
    abrirWhatsApp(c.telefone, mensagem);
    const erro = await registrarAlo(empresa.id, c.id, tipo, mensagem);
    if (erro) {
      await avisar(`O WhatsApp abriu, mas não foi possível registrar o alô: ${erro}`);
      return;
    }
    aoChamar();
  }

  return (
    <>
      <button
        onClick={mandar}
        className={`shrink-0 rounded-xl border border-neutral-300 bg-white font-semibold text-green-700 active:bg-neutral-100 ${
          compacto ? "h-9 px-3 text-sm" : "h-11 px-4"
        }`}
      >
        Mandar alô
      </button>
      {dialogo}
    </>
  );
}
