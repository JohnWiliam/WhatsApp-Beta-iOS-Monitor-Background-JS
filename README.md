# WhatsApp-Beta-iOS-Monitor-Background-JS

>Script JavaScript para a extensão **Violentmonkey** no Firefox que monitora continuamente o link público do TestFlight do WhatsApp iOS e notifica quando surgir vaga.


![Version](https://img.shields.io/badge/Version-1.0.2-blue)
![Language](https://img.shields.io/badge/Language-JavaScript-F7DF1E?logo=javascript&logoColor=F7DF1E)
![Author](https://img.shields.io/badge/Author-John%20Wiliam%20%26%20IA-orange)
[![Install](https://img.shields.io/badge/Install-Click_Here-green)](https://github.com/JohnWiliam/WhatsApp-Beta-iOS-Monitor-Background-JS/raw/refs/heads/main/WhatsApp%20Beta%20Monitor%20Background/WhatsApp%20Beta%20Monitor%20Background.user.js)


## O que o script faz

- Consulta periodicamente: `https://testflight.apple.com/join/s4rTJVPb`
- Detecta estados principais da página (`VAGO`, `CHEIO`, `TEXTO_DESCONHECIDO`)
- Envia notificação com clique para abrir o TestFlight quando encontrar vaga
- Registra histórico local das verificações
- Oferece menu com interface de histórico, botão de verificação manual e limpeza de logs

## Melhorias de confiabilidade implementadas

- Fallback de extração de status quando `DOMParser` não estiver disponível no contexto.
- Tratamento explícito de erros HTTP e timeout de rede.
- Cooldown anti-spam para notificação repetida quando a vaga permanece aberta.
- Eleição de líder (lock por storage) para evitar múltiplas instâncias monitorando ao mesmo tempo.

## Como usar

1. Instale a extensão **Violentmonkey** no Firefox.
2. Crie/importe o userscript `WhatsApp Beta Monitor Background.user.js`.
3. Salve o script e deixe o navegador aberto com a extensão ativa.
4. Use o menu do script para abrir **Ver Histórico de Verificação**.

## Observações

- O TestFlight pode mudar os textos/estrutura da página; nesse caso o histórico exibirá `TEXTO_DESCONHECIDO` ou `ERRO_ESTRUTURA`.
- O script está configurado com intervalo de 5 minutos por padrão.
