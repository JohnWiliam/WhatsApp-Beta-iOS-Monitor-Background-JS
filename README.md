# WhatsApp-Beta-iOS-Monitor-Background-JS

> Script JavaScript para a extensão **Violentmonkey** no Firefox que monitora continuamente o link público do TestFlight do WhatsApp iOS e notifica quando surgir vaga.

![Version](https://img.shields.io/badge/Version-1.0.3-blue)
![Language](https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=F7DF1E)
![Author](https://img.shields.io/badge/Author-John%20Wiliam%20%26%20IA-orange)
[![Install](https://img.shields.io/badge/Install-Click_Here-green)](https://github.com/JohnWiliam/WhatsApp-Beta-iOS-Monitor-Background-JS/raw/refs/heads/main/WhatsApp%20Beta%20Monitor%20Background/WhatsApp%20Beta%20Monitor%20Background.user.js)

## O que o script faz

- Consulta periodicamente: `https://testflight.apple.com/join/s4rTJVPb`
- Detecta estados principais da página (`VAGO`, `CHEIO`, `TEXTO_DESCONHECIDO`)
- Envia notificação com clique para abrir o TestFlight quando encontrar vaga
- Registra histórico local das verificações
- Oferece menu com interface de histórico, verificação manual e painel de configurações avançado

## Novidades da v1.0.3

- Interface de configuração mais intuitiva com tempos em **segundos** (sem expor milissegundos ao usuário).
- Campos com descrições curtas para facilitar entendimento de cada ajuste.
- Remoção da opção de URL customizável: link do TestFlight agora é fixo no código para reduzir erro de configuração.
- Melhorias visuais nos botões do modal para manter consistência visual e melhor feedback de interação.
- Reforço de robustez: callback seguro e serialização melhor de erros de rede para evitar falhas silenciosas.

## Melhorias de confiabilidade implementadas

- Fallback de extração de status quando `DOMParser` não estiver disponível no contexto.
- Tratamento explícito de erros HTTP, conexão e timeout de rede.
- Cooldown anti-spam para notificação repetida quando a vaga permanece aberta.
- Eleição de líder (lock por storage) para evitar múltiplas instâncias monitorando ao mesmo tempo.

## Como usar

1. Instale a extensão **Violentmonkey** no Firefox.
2. Crie/importe o userscript `WhatsApp Beta Monitor Background.user.js`.
3. Salve o script e deixe o navegador aberto com a extensão ativa.
4. Use o menu do script para abrir **Ver Histórico de Verificação**.

## Observações

- O TestFlight pode mudar os textos/estrutura da página; nesse caso o histórico exibirá `TEXTO_DESCONHECIDO` ou `ERRO_ESTRUTURA`.
- O script permanece internamente em milissegundos por precisão, mas a UI converte para segundos automaticamente.
- O intervalo padrão continua em 5 minutos.
