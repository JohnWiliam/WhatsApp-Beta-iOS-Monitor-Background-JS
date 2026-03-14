// ==UserScript==
// @name         WhatsApp Beta Monitor Background
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Monitoramento de alta precisão com interface de histórico moderna, verificação manual e opção para limpar logs.
// @author       John Wiliam
// @match        *://*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_notification
// @grant        GM_openInTab
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @run-at       background
// ==/UserScript==

(function() {
    'use strict';

    /** ============================
     * CONFIGURAÇÕES
     * ============================ */
    const TESTFLIGHT_URL = "https://testflight.apple.com/join/s4rTJVPb";
    const CHECK_INTERVAL = 300000; // 5 minutos (em ms)
    const HISTORY_KEY = "whatsappBetaHistory";
    const MAX_HISTORY_ENTRIES = 100;

    /** ============================
     * FUNÇÕES DE MONITORAMENTO
     * ============================ */

    function playAlertSound() {
        try {
            const audio = new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=");
            audio.loop = false;
            audio.volume = 1.0;
            audio.play().catch(err => console.warn("Falha ao tocar som:", err));
        } catch (e) {
            console.error("Erro ao reproduzir som:", e);
        }
    }

    function notify(msg) {
        GM_notification({
            title: "WhatsApp Beta",
            text: msg,
            highlight: true,
            timeout: 0,
            onclick: () => GM_openInTab(TESTFLIGHT_URL, { active: true })
        });
        playAlertSound();
    }

    function saveHistory(entry) {
        let history = GM_getValue(HISTORY_KEY, []);
        history.push(entry);
        if (history.length > MAX_HISTORY_ENTRIES) {
            history.shift();
        }
        GM_setValue(HISTORY_KEY, history);
    }

    function getHistory() {
        return GM_getValue(HISTORY_KEY, []);
    }

    // A função agora aceita um 'callback' opcional para ser executado após a conclusão
    function checkBeta(callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: TESTFLIGHT_URL,
            onload: function(response) {
                const html = response.responseText;
                const timestamp = new Date().toISOString();
                let status, details = "";

                const parser = new DOMParser();
                const doc = parser.parseFromString(html, "text/html");
                const statusDiv = doc.querySelector('.beta-status');

                if (statusDiv) {
                    const statusText = statusDiv.textContent.trim().replace(/\s+/g, ' ');

                    if (statusText.includes("Para participar do")) {
                        status = "VAGO";
                        details = `Texto de confirmação: "${statusText}"`;
                        const message = "🚀 O WhatsApp Beta abriu vagas no TestFlight!\n" + TESTFLIGHT_URL;
                        notify(message);
                        console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] ⚡ ${status}! ⚡`);

                    } else if (statusText.includes("Esta versão beta não aceita novos testers no momento.") || statusText.includes("This beta isn't accepting any new testers right now.")) {
                        status = "CHEIO";
                        details = `Texto de confirmação: "${statusText}"`;
                        console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] Status: ${status}`);

                    } else {
                        status = "TEXTO_DESCONHECIDO";
                        details = `O elemento '.beta-status' retornou um texto não previsto. Texto encontrado: "${statusText}"`;
                        console.warn(`[${new Date(timestamp).toLocaleString('pt-BR')}] ${details}`);
                    }
                } else {
                    status = "ERRO_ESTRUTURA";
                    details = "O elemento '.beta-status' não foi encontrado. A estrutura do site da Apple pode ter mudado.";
                    console.error(`[${new Date(timestamp).toLocaleString('pt-BR')}] ${details}`);
                }

                saveHistory({ timestamp, status, details: details || undefined });
                if (typeof callback === 'function') callback(); // Executa o callback se ele existir
            },
            onerror: function(err) {
                const timestamp = new Date().toISOString();
                const status = "ERRO_CONEXAO";
                console.error("Erro ao verificar TestFlight:", err);
                saveHistory({ timestamp: timestamp, status: status, error: String(err) });
                if (typeof callback === 'function') callback(); // Executa o callback em caso de erro também
            }
        });
    }

    /** ============================
     * FUNÇÕES DA INTERFACE DO HISTÓRICO (UI)
     * ============================ */

    function renderLogEntries() {
        const history = getHistory();
        const logContainer = document.getElementById('wbm-log-container');
        if (!logContainer) return;

        logContainer.innerHTML = '';

        if (history.length === 0) {
            logContainer.innerHTML = '<div class="log-entry status-info">Nenhum histórico de verificação encontrado.</div>';
            return;
        }

        const statusMap = {
            VAGO:    { icon: '🚀', text: 'VAGA DETECTADA', className: 'status-vago' },
            CHEIO:   { icon: '⛔', text: 'AINDA CHEIO', className: 'status-cheio' },
            TEXTO_DESCONHECIDO: { icon: '⚠️', text: 'TEXTO DESCONHECIDO', className: 'status-desconhecido' },
            ERRO_CONEXAO: { icon: '❌', text: 'ERRO DE CONEXÃO', className: 'status-erro' },
            ERRO_ESTRUTURA: { icon: '❌', text: 'ERRO DE ESTRUTURA', className: 'status-erro' },
        };

        history.slice().reverse().forEach(entry => {
            const statusInfo = statusMap[entry.status] || { icon: '❓', text: entry.status, className: 'status-info' };
            const localTime = new Date(entry.timestamp).toLocaleString('pt-BR');

            const logElement = document.createElement('div');
            logElement.className = `log-entry ${statusInfo.className}`;

            let detailsHTML = '';
            if (entry.details) detailsHTML = `<div class="log-details"><strong>Detalhes:</strong> ${entry.details}</div>`;
            if (entry.error) detailsHTML = `<div class="log-details"><strong>Erro:</strong> ${entry.error}</div>`;

            logElement.innerHTML = `
                <div class="log-header">
                    <span class="log-icon">${statusInfo.icon}</span>
                    <span class="log-timestamp">[${localTime}]</span>
                    <span class="log-status">${statusInfo.text}</span>
                </div>
                ${detailsHTML}
            `;
            logContainer.appendChild(logElement);
        });
    }

    // NOVA FUNÇÃO: Limpa o histórico com confirmação
    function confirmAndClearHistory() {
        if (confirm("Você tem certeza que deseja limpar todo o histórico de verificação?\nEsta ação não pode ser desfeita.")) {
            GM_setValue(HISTORY_KEY, []); // Apaga os dados
            renderLogEntries(); // Atualiza a interface
            console.log("Histórico de verificação foi limpo pelo usuário.");
        }
    }

    // NOVA FUNÇÃO: Aciona a verificação manual
    function manualCheck() {
        const btn = document.getElementById('wbm-check-now-btn');
        if (!btn) return;

        btn.textContent = 'Verificando...';
        btn.disabled = true;

        checkBeta(() => {
            renderLogEntries(); // Re-renderiza o log com o novo resultado
            btn.textContent = 'Verificar Agora';
            btn.disabled = false;
        });
    }

    function displayHistoryUI() {
        if (document.getElementById('wbm-modal-container')) return;

        const styles = `
            #wbm-modal-container {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%; background-color: rgba(0, 0, 0, 0.7);
                z-index: 99999; display: flex; align-items: center; justify-content: center; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
            }
            #wbm-modal-content {
                background-color: #1e1e1e; color: #e0e0e0; border-radius: 12px; padding: 20px;
                width: 90%; max-width: 850px; height: 85%; display: flex; flex-direction: column;
                box-shadow: 0 8px 30px rgba(0,0,0,0.5); border: 1px solid #333;
            }
            #wbm-modal-header {
                display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444;
                padding-bottom: 15px; margin-bottom: 15px;
            }
            #wbm-modal-header h2 { margin: 0; font-size: 1.4em; color: #fff; font-weight: 600; }
            #wbm-modal-buttons button {
                background-color: #333; color: #fff; border: 1px solid #555; padding: 8px 16px;
                border-radius: 8px; cursor: pointer; margin-left: 10px; font-size: 0.9em; transition: background-color 0.2s, border-color 0.2s;
            }
            #wbm-modal-buttons button:hover { background-color: #444; border-color: #777; }
            #wbm-modal-buttons button:disabled { background-color: #2a2a2a; color: #777; cursor: not-allowed; border-color: #444; }
            #wbm-clear-btn:hover { background-color: #c82333; border-color: #bd2130; }
            #wbm-log-container { flex-grow: 1; overflow-y: auto; padding-right: 10px; }
            .log-entry { padding: 12px; border-bottom: 1px solid #333; display: flex; flex-direction: column; font-size: 0.9em; line-height: 1.5; }
            .log-header { display: flex; align-items: center; gap: 10px; font-family: "SF Mono", "Menlo", "Consolas", monospace; }
            .log-icon { font-size: 1.2em; }
            .log-timestamp { color: #999; }
            .log-status { font-weight: bold; }
            .log-details { margin-top: 8px; color: #bbb; padding-left: 32px; font-size: 0.95em; word-break: break-all; }
            .log-details strong { color: #ddd; }
            .status-vago { color: #28a745; }
            .status-cheio { color: #ffc107; }
            .status-desconhecido { color: #fd7e14; }
            .status-erro { color: #dc3545; }
            .status-info { color: #17a2b8; }
        `;

        const styleSheet = document.createElement("style");
        styleSheet.innerText = styles;
        document.head.appendChild(styleSheet);

        const container = document.createElement('div');
        container.id = 'wbm-modal-container';
        container.innerHTML = `
            <div id="wbm-modal-content">
                <div id="wbm-modal-header">
                    <h2>Histórico do Monitor</h2>
                    <div id="wbm-modal-buttons">
                        <button id="wbm-check-now-btn" title="Força uma verificação imediata">Verificar Agora</button>
                        <button id="wbm-refresh-btn" title="Recarrega o histórico da memória">Atualizar</button>
                        <button id="wbm-clear-btn" title="Apaga permanentemente todo o histórico">Limpar Histórico</button>
                        <button id="wbm-close-btn">Fechar</button>
                    </div>
                </div>
                <div id="wbm-log-container"><div class="log-entry status-info">Carregando histórico...</div></div>
            </div>
        `;
        document.body.appendChild(container);

        document.getElementById('wbm-check-now-btn').addEventListener('click', manualCheck);
        document.getElementById('wbm-clear-btn').addEventListener('click', confirmAndClearHistory);
        document.getElementById('wbm-refresh-btn').addEventListener('click', renderLogEntries);
        document.getElementById('wbm-close-btn').addEventListener('click', () => {
            container.remove();
            styleSheet.remove();
        });
        container.addEventListener('click', (e) => {
            if (e.target.id === 'wbm-modal-container') {
                container.remove();
                styleSheet.remove();
            }
        });

        renderLogEntries();
    }

    /** ============================
     * INICIALIZAÇÃO
     * ============================ */
    GM_registerMenuCommand("Ver Histórico de Verificação", displayHistoryUI, "h");
    console.log("🔎 Monitoramento de alta precisão v4.0 iniciado...");
    checkBeta();
    setInterval(checkBeta, CHECK_INTERVAL);

})();