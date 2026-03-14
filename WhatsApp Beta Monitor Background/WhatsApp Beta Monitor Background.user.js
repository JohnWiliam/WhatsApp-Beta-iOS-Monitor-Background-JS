// ==UserScript==
// @name         WhatsApp Beta Monitor Background
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Monitoramento contínuo com histórico, verificação manual e notificação anti-spam quando surgir vaga.
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
    const REQUEST_TIMEOUT = 20000; // 20 segundos
    const HISTORY_KEY = "whatsappBetaHistory";
    const MAX_HISTORY_ENTRIES = 100;
    const LAST_ALERT_AT_KEY = "whatsappBetaLastAlertAt";
    const ALERT_COOLDOWN_MS = 1800000; // 30 minutos

    // Evita múltiplas instâncias monitorando ao mesmo tempo em vários contexts/tabs
    const LEADER_LOCK_KEY = "whatsappBetaLeaderLock";
    const LEADER_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const LEADER_TTL_MS = 120000;
    const LEADER_HEARTBEAT_MS = 30000;

    let monitorTimer = null;
    let heartbeatTimer = null;

    /** ============================
     * FUNÇÕES DE MONITORAMENTO
     * ============================ */

    function playAlertSound() {
        if (typeof Audio === 'undefined') return;

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

    function notifyWithCooldown(msg) {
        const now = Date.now();
        const lastAlertAt = Number(GM_getValue(LAST_ALERT_AT_KEY, 0));

        if (now - lastAlertAt < ALERT_COOLDOWN_MS) {
            console.log("🔕 Vaga detectada, mas notificação suprimida por cooldown para evitar spam.");
            return;
        }

        GM_setValue(LAST_ALERT_AT_KEY, now);
        notify(msg);
    }

    function saveHistory(entry) {
        const history = GM_getValue(HISTORY_KEY, []);
        history.push(entry);
        if (history.length > MAX_HISTORY_ENTRIES) {
            history.shift();
        }
        GM_setValue(HISTORY_KEY, history);
    }

    function getHistory() {
        return GM_getValue(HISTORY_KEY, []);
    }

    function extractStatusText(html) {
        if (!html || typeof html !== 'string') return null;

        // Caminho principal: parser de HTML
        if (typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");
            const statusDiv = doc.querySelector('.beta-status');
            if (statusDiv) {
                return statusDiv.textContent.trim().replace(/\s+/g, ' ');
            }
        }

        // Fallback para contextos sem DOMParser (alguns backgrounds)
        const regex = /<[^>]*class=["'][^"']*beta-status[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/i;
        const match = html.match(regex);
        if (!match || !match[1]) return null;

        return match[1]
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function detectStatus(statusText) {
        const text = (statusText || '').toLowerCase();

        const openSignals = [
            'para participar do',
            'está aceitando novos testadores',
            'this beta is accepting new testers',
            'start testing'
        ];

        const fullSignals = [
            'esta versão beta não aceita novos testers no momento',
            "this beta isn't accepting any new testers right now",
            'this beta is full'
        ];

        if (openSignals.some(signal => text.includes(signal))) return 'VAGO';
        if (fullSignals.some(signal => text.includes(signal))) return 'CHEIO';
        return 'TEXTO_DESCONHECIDO';
    }

    // A função aceita um 'callback' opcional para ser executado após a conclusão
    function checkBeta(callback) {
        GM_xmlhttpRequest({
            method: "GET",
            url: TESTFLIGHT_URL,
            timeout: REQUEST_TIMEOUT,
            headers: {
                'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7'
            },
            onload: function(response) {
                const timestamp = new Date().toISOString();

                if (response.status < 200 || response.status >= 300) {
                    const status = "ERRO_HTTP";
                    const details = `Resposta HTTP inesperada: ${response.status}`;
                    console.error(`[${new Date(timestamp).toLocaleString('pt-BR')}] ${details}`);
                    saveHistory({ timestamp, status, details });
                    if (typeof callback === 'function') callback();
                    return;
                }

                const html = response.responseText;
                const statusText = extractStatusText(html);
                let status;
                let details = "";

                if (statusText) {
                    status = detectStatus(statusText);

                    if (status === 'VAGO') {
                        details = `Texto de confirmação: "${statusText}"`;
                        const message = "🚀 O WhatsApp Beta abriu vagas no TestFlight!\n" + TESTFLIGHT_URL;
                        notifyWithCooldown(message);
                        console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] ⚡ ${status}! ⚡`);
                    } else if (status === 'CHEIO') {
                        details = `Texto de confirmação: "${statusText}"`;
                        console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] Status: ${status}`);
                    } else {
                        details = `O elemento '.beta-status' retornou um texto não previsto. Texto encontrado: "${statusText}"`;
                        console.warn(`[${new Date(timestamp).toLocaleString('pt-BR')}] ${details}`);
                    }
                } else {
                    status = "ERRO_ESTRUTURA";
                    details = "Não foi possível extrair o conteúdo de '.beta-status'. A estrutura da página pode ter mudado.";
                    console.error(`[${new Date(timestamp).toLocaleString('pt-BR')}] ${details}`);
                }

                saveHistory({ timestamp, status, details: details || undefined });
                if (typeof callback === 'function') callback();
            },
            onerror: function(err) {
                const timestamp = new Date().toISOString();
                const status = "ERRO_CONEXAO";
                console.error("Erro ao verificar TestFlight:", err);
                saveHistory({ timestamp, status, error: String(err) });
                if (typeof callback === 'function') callback();
            },
            ontimeout: function() {
                const timestamp = new Date().toISOString();
                const status = "ERRO_TIMEOUT";
                const details = `Timeout após ${REQUEST_TIMEOUT}ms ao consultar TestFlight.`;
                console.error(details);
                saveHistory({ timestamp, status, details });
                if (typeof callback === 'function') callback();
            }
        });
    }

    /** ============================
     * CONTROLE DE LIDERANÇA (instância única)
     * ============================ */

    function readLock() {
        return GM_getValue(LEADER_LOCK_KEY, null);
    }

    function writeLock() {
        GM_setValue(LEADER_LOCK_KEY, { id: LEADER_ID, ts: Date.now() });
    }

    function amILeader() {
        const lock = readLock();
        return !!(lock && lock.id === LEADER_ID);
    }

    function tryBecomeLeader() {
        const lock = readLock();
        const now = Date.now();

        if (!lock || !lock.id || !lock.ts || (now - Number(lock.ts)) > LEADER_TTL_MS) {
            writeLock();
            return amILeader();
        }

        return lock.id === LEADER_ID;
    }

    function startMonitoring() {
        if (monitorTimer) return;

        checkBeta();
        monitorTimer = setInterval(() => {
            if (!tryBecomeLeader()) {
                stopMonitoring();
                return;
            }
            checkBeta();
        }, CHECK_INTERVAL);

        heartbeatTimer = setInterval(() => {
            if (amILeader()) {
                writeLock();
            }
        }, LEADER_HEARTBEAT_MS);

        console.log("👑 Instância líder ativa: monitoramento iniciado.");
    }

    function stopMonitoring() {
        if (monitorTimer) {
            clearInterval(monitorTimer);
            monitorTimer = null;
        }
        if (heartbeatTimer) {
            clearInterval(heartbeatTimer);
            heartbeatTimer = null;
        }
    }

    function initLeaderElection() {
    const attemptLeadership = () => {
        // Tenta se tornar líder. Se conseguir, inicia o monitoramento.
        // A função startMonitoring() já previne a execução múltipla, então é seguro chamar.
        if (tryBecomeLeader()) {
            startMonitoring();
        }
    };

    // Tenta assumir a liderança imediatamente ao iniciar o script.
    attemptLeadership();

    // Configura uma verificação periódica para que instâncias em standby
    // possam assumir a liderança se ela ficar vaga.
    setInterval(attemptLeadership, LEADER_HEARTBEAT_MS);
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
            TEXTO_DESCONHECIDO: { icon: '❓', text: 'STATUS DESCONHECIDO', className: 'status-desconhecido' },
            ERRO_ESTRUTURA: { icon: '🏗️', text: 'ERRO DE ESTRUTURA', className: 'status-erro' },
            ERRO_CONEXAO: { icon: '🌐', text: 'ERRO DE CONEXÃO', className: 'status-erro' },
            ERRO_TIMEOUT: { icon: '⏱️', text: 'TIMEOUT', className: 'status-erro' },
            ERRO_HTTP: { icon: '📡', text: 'ERRO HTTP', className: 'status-erro' },
        };

        history.slice().reverse().forEach(entry => {
            const statusInfo = statusMap[entry.status] || { icon: '⚪', text: entry.status || 'DESCONHECIDO', className: 'status-info' };
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

    function confirmAndClearHistory() {
        if (confirm("Você tem certeza que deseja limpar todo o histórico de verificação?\nEsta ação não pode ser desfeita.")) {
            GM_setValue(HISTORY_KEY, []);
            renderLogEntries();
            console.log("Histórico de verificação foi limpo pelo usuário.");
        }
    }

    function manualCheck() {
        const btn = document.getElementById('wbm-check-now-btn');
        if (!btn) return;

        btn.textContent = 'Verificando...';
        btn.disabled = true;

        checkBeta(() => {
            renderLogEntries();
            btn.textContent = 'Verificar Agora';
            btn.disabled = false;
        });
    }

    function displayHistoryUI() {
        if (typeof document === 'undefined') {
            console.warn('Não é possível abrir a interface de histórico neste contexto sem DOM.');
            return;
        }

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
    console.log("🔎 Monitoramento de alta precisão v1.0.1 iniciado...");
    initLeaderElection();
})();
