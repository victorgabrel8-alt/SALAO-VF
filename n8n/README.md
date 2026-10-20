# n8n — secretária de IA

Responsável: Victor

Workflows exportados em JSON (n8n → menu do workflow → Download). **Antes de exportar, confira que nenhuma chave aparece no JSON** — credenciais ficam só dentro do n8n.

| Arquivo | O que faz |
|---|---|
| `canal-entrada.json` | Recebe o webhook (Cloud API ou Evolution) e converte para o formato único |
| `agente.json` | Buffer, IA, tools da agenda, pausa para humano |
| `canal-envio.json` | Envia a resposta pelo canal ativo |
| `alerta-erro.json` | Avisa no WhatsApp do Victor quando algo falha |

Formato único de mensagem entre os workflows:

```json
{ "telefone": "5566999998888", "nome": "Ana", "tipo": "texto",
  "conteudo": "...", "midia_id": null, "wa_message_id": "...", "de_mim": false }
```
