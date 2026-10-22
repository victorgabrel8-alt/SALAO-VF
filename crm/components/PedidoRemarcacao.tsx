"use client";

import { useEffect, useState } from "react";
import type { Atendimento } from "@/lib/atendimentos";
import { useEmpresa } from "@/lib/empresa";
import { buscarPedidos, mensagemDeRemarcacao, registrarPedido, SITUACAO, situacaoDoPedido, type Pedido } from "@/lib/remarcacao";
import { useTempoReal } from "@/lib/tempoReal";
import { abrirWhatsApp } from "@/lib/whatsapp";

// Pedidos de remarcação dos horários da tela, sempre em dia: o andamento muda quando a cliente
// responde (mensagens) ou quando o horário muda (agendamentos), as duas no tempo real
export function usePedidos(atendimentos: Atendimento[]) {
  const empresa = useEmpresa();
  const [pedidos, setPedidos] = useState<Map<string, Pedido>>(new Map());
  const [versao, setVersao] = useState(0);
  const ids = atendimentos.map((a) => a.id).join(",");

  useEffect(() => {
    let ativo = true;
    buscarPedidos(empresa.id, ids ? ids.split(",") : []).then((m) => {
      if (ativo) setPedidos(m);
    });
    return () => {
      ativo = false;
    };
  }, [empresa.id, ids, versao]);

  useTempoReal(["mensagens", "agendamentos"], empresa.id, () => setVersao((v) => v + 1));

  // Grava o pedido e abre o WhatsApp no mesmo toque (no iPhone, abrir depois de esperar o banco
  // é bloqueado). O registro termina bem antes de a Gleide apertar enviar.
  function pedir(a: Atendimento, aoFalhar: (erro: string) => void) {
    if (!a.clientes) return;
    const mensagem = mensagemDeRemarcacao(a);
    registrarPedido(empresa.id, a, mensagem).then((erro) => {
      if (erro) aoFalhar(erro);
      else setVersao((v) => v + 1);
    });
    abrirWhatsApp(a.clientes.telefone, mensagem);
  }

  return { pedidos, pedir };
}

// Etiqueta com o andamento do pedido: aguardando, respondeu, remarcado, sem resposta
export function SeloPedido({ pedido, atendimento }: { pedido: Pedido | undefined; atendimento: Atendimento }) {
  if (!pedido) return null;
  const s = SITUACAO[situacaoDoPedido(pedido, atendimento)];
  return <span className={`mt-1 w-fit rounded-full px-2 py-0.5 text-[11px] font-bold ${s.classe}`}>{s.rotulo(pedido)}</span>;
}

// Botão em pílula: "Pedir para remarcar" ou, já pedido e sem resposta, "Pedir de novo"
export function BotaoPedir({ pedido, atendimento, aoTocar }: { pedido: Pedido | undefined; atendimento: Atendimento; aoTocar: () => void }) {
  const situacao = pedido ? situacaoDoPedido(pedido, atendimento) : null;
  if (situacao === "remarcado" || situacao === "respondeu") return null;
  return (
    <button
      onClick={aoTocar}
      className={`h-9 shrink-0 rounded-full px-3.5 text-[13px] font-semibold active:scale-95 ${
        pedido ? "bg-campo text-texto" : "bg-grafite text-perola"
      }`}
    >
      {pedido ? "Pedir de novo" : "Pedir para remarcar"}
    </button>
  );
}
