// ==UserScript==
// @name         WhatsApp Beta Monitor Background
// @namespace    http://tampermonkey.net/
// @version      1.0.3
// @description  Monitoramento contínuo com histórico, verificação manual e notificação anti-spam quando surgir vaga.
// @author       John Wiliam
// @icon         https://web.whatsapp.com//favicon/1x/favicon/v1/
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
     * CHAVES DE ARMAZENAMENTO
     * ============================ */
    const HISTORY_KEY = 'whatsappBetaHistory';
    const LAST_ALERT_AT_KEY = 'whatsappBetaLastAlertAt';
    const LEADER_LOCK_KEY = 'whatsappBetaLeaderLock';
    const SETTINGS_KEY = 'whatsappBetaSettings';
    const TESTFLIGHT_URLS = Object.freeze([
        'https://testflight.apple.com/join/s4rTJVPb',
        'https://testflight.apple.com/join/YcmGWyxV',
        'https://testflight.apple.com/join/dH8lkFZi',
    ]);

    /** ============================
     * CONFIGURAÇÕES PADRÃO
     * ============================ */
    const DEFAULT_SETTINGS = Object.freeze({
        checkIntervalMs: 300000,
        requestTimeoutMs: 20000,
        maxHistoryEntries: 100,
        alertCooldownMs: 1800000,
        leaderTtlMs: 120000,
        leaderHeartbeatMs: 30000,
        acceptLanguage: 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
    });

    const SETTINGS_SCHEMA = Object.freeze({
        checkIntervalMs: { type: 'int', min: 15000, max: 86400000 },
        requestTimeoutMs: { type: 'int', min: 5000, max: 120000 },
        maxHistoryEntries: { type: 'int', min: 20, max: 1000 },
        alertCooldownMs: { type: 'int', min: 60000, max: 86400000 },
        leaderTtlMs: { type: 'int', min: 30000, max: 600000 },
        leaderHeartbeatMs: { type: 'int', min: 5000, max: 300000 },
        acceptLanguage: { type: 'text', minLength: 2, maxLength: 120 },
    });

    const LEADER_ID = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const VALID_TARGET_URLS = Object.freeze([...new Set(TESTFLIGHT_URLS)].filter((url) => {
        if (typeof url !== 'string') return false;

        try {
            const parsed = new URL(url);
            return parsed.protocol === 'https:' && Boolean(parsed.hostname);
        } catch {
            return false;
        }
    }));

    let monitorTimer = null;
    let heartbeatTimer = null;
    let standbyLeadershipTimer = null;
    let settings = loadSettings();

    /** ============================
     * CONFIGURAÇÃO - UTILITÁRIOS
     * ============================ */

    function clamp(value, min, max) {
        return Math.min(max, Math.max(min, value));
    }

    function sanitizeSettings(input) {
        const source = (input && typeof input === 'object') ? input : {};
        const sanitized = { ...DEFAULT_SETTINGS };

        for (const [key, rule] of Object.entries(SETTINGS_SCHEMA)) {
            const candidate = source[key];

            if (rule.type === 'int') {
                const value = Number(candidate);
                if (Number.isFinite(value)) {
                    sanitized[key] = clamp(Math.round(value), rule.min, rule.max);
                }
                continue;
            }

            if (rule.type === 'text' && typeof candidate === 'string') {
                const trimmed = candidate.trim();
                if (trimmed.length >= rule.minLength && trimmed.length <= rule.maxLength) {
                    sanitized[key] = trimmed;
                }
            }
        }

        if (sanitized.leaderHeartbeatMs >= sanitized.leaderTtlMs) {
            const adjustedHeartbeat = Math.floor(sanitized.leaderTtlMs / 2);
            sanitized.leaderHeartbeatMs = clamp(adjustedHeartbeat, SETTINGS_SCHEMA.leaderHeartbeatMs.min, SETTINGS_SCHEMA.leaderHeartbeatMs.max);
        }

        sanitized.requestTimeoutMs = Math.min(sanitized.requestTimeoutMs, Math.max(sanitized.checkIntervalMs - 1000, SETTINGS_SCHEMA.requestTimeoutMs.min));

        return sanitized;
    }

    function loadSettings() {
        return sanitizeSettings(GM_getValue(SETTINGS_KEY, DEFAULT_SETTINGS));
    }

    function persistSettings(nextSettings) {
        const sanitized = sanitizeSettings(nextSettings);
        GM_setValue(SETTINGS_KEY, sanitized);
        settings = sanitized;
        return sanitized;
    }

    /** ============================
     * FUNÇÕES DE MONITORAMENTO
     * ============================ */

    function playAlertSound() {
        if (typeof Audio === 'undefined') return;

        try {
            const audio = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAIlYAAESsAAACABAAZGF0YQAAAAA=');
            audio.loop = false;
            audio.volume = 1.0;
            audio.play().catch(err => console.warn('Falha ao tocar som:', err));
        } catch (e) {
            console.error('Erro ao reproduzir som:', e);
        }
    }

    function getTargetLabel(url) {
        if (typeof url !== 'string') return 'Link desconhecido';

        try {
            const parsedUrl = new URL(url);
            const segments = parsedUrl.pathname.split('/').filter(Boolean);
            const joinCode = segments[segments.length - 1];
            return joinCode ? `join/${joinCode}` : parsedUrl.hostname;
        } catch {
            return url;
        }
    }

    function notify(msg, targetUrl) {
        GM_notification({
            title: 'WhatsApp Beta',
            text: msg,
            highlight: true,
            timeout: 0,
            onclick: () => GM_openInTab(targetUrl, { active: true }),
        });
        playAlertSound();
    }


    function normalizeHistoryEntry(entry) {
        const normalized = (entry && typeof entry === 'object') ? { ...entry } : {};
        const validTargetUrl = typeof normalized.targetUrl === 'string' ? normalized.targetUrl : null;
        const fallbackLabel = validTargetUrl ? getTargetLabel(validTargetUrl) : 'Link não registrado';
        const validTargetLabel = (typeof normalized.targetLabel === 'string' && normalized.targetLabel.trim())
            ? normalized.targetLabel.trim()
            : fallbackLabel;

        normalized.targetUrl = validTargetUrl || undefined;
        normalized.targetLabel = validTargetLabel;
        return normalized;
    }


    function safeCallback(callback) {
        if (typeof callback !== 'function') return;
        try {
            callback();
        } catch (error) {
            console.error('Erro ao executar callback:', error);
        }
    }

    function serializeRequestError(err) {
        if (err instanceof Error) return `${err.name}: ${err.message}`;
        if (typeof err === 'string') return err;
        try {
            return JSON.stringify(err);
        } catch {
            return String(err);
        }
    }

    function notifyWithCooldown(msg, targetUrl) {
        const now = Date.now();
        const lastAlertAt = Number(GM_getValue(LAST_ALERT_AT_KEY, 0));

        if (now - lastAlertAt < settings.alertCooldownMs) {
            console.log('🔕 Vaga detectada, mas notificação suprimida por cooldown para evitar spam.');
            return;
        }

        GM_setValue(LAST_ALERT_AT_KEY, now);
        notify(msg, targetUrl);
    }

    function getHistory() {
        const history = GM_getValue(HISTORY_KEY, []);
        if (!Array.isArray(history)) return [];
        return history.map(normalizeHistoryEntry);
    }

    function saveHistory(entry) {
        const history = getHistory();
        history.push(normalizeHistoryEntry(entry));

        if (history.length > settings.maxHistoryEntries) {
            history.splice(0, history.length - settings.maxHistoryEntries);
        }

        GM_setValue(HISTORY_KEY, history);
    }

    function extractStatusText(html) {
        if (!html || typeof html !== 'string') return null;

        if (typeof DOMParser !== 'undefined') {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const statusDiv = doc.querySelector('.beta-status');
            if (statusDiv) {
                return statusDiv.textContent.trim().replace(/\s+/g, ' ');
            }
        }

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
            'start testing',
        ];

        const fullSignals = [
            'esta versão beta não aceita novos testers no momento',
            "this beta isn't accepting any new testers right now",
            'this beta is full',
        ];

        if (openSignals.some(signal => text.includes(signal))) return 'VAGO';
        if (fullSignals.some(signal => text.includes(signal))) return 'CHEIO';
        return 'TEXTO_DESCONHECIDO';
    }

    function checkBeta(targetUrl, callback) {
        const targetLabel = getTargetLabel(targetUrl);

        try {
            GM_xmlhttpRequest({
                method: 'GET',
                url: targetUrl,
                timeout: settings.requestTimeoutMs,
                headers: {
                    'Accept-Language': settings.acceptLanguage,
                },
                onload: function(response) {
                    const timestamp = new Date().toISOString();

                    if (response.status < 200 || response.status >= 300) {
                        const status = 'ERRO_HTTP';
                        const details = `Resposta HTTP inesperada: ${response.status}`;
                        console.error(`[${new Date(timestamp).toLocaleString('pt-BR')}] [${targetLabel}] ${details}`);
                        saveHistory({ timestamp, status, details, targetUrl, targetLabel });
                        safeCallback(callback);
                        return;
                    }

                    const html = response.responseText;
                    const statusText = extractStatusText(html);
                    let status;
                    let details = '';

                    if (statusText) {
                        status = detectStatus(statusText);

                        if (status === 'VAGO') {
                            details = `Texto de confirmação: "${statusText}"`;
                            const message = `🚀 O WhatsApp Beta abriu vagas no TestFlight!\n${targetUrl}`;
                            notifyWithCooldown(message, targetUrl);
                            console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] [${targetLabel}] ⚡ ${status}! ⚡`);
                        } else if (status === 'CHEIO') {
                            details = `Texto de confirmação: "${statusText}"`;
                            console.log(`[${new Date(timestamp).toLocaleString('pt-BR')}] [${targetLabel}] Status: ${status}`);
                        } else {
                            details = `O elemento '.beta-status' retornou um texto não previsto. Texto encontrado: "${statusText}"`;
                            console.warn(`[${new Date(timestamp).toLocaleString('pt-BR')}] [${targetLabel}] ${details}`);
                        }
                    } else {
                        status = 'ERRO_ESTRUTURA';
                        details = "Não foi possível extrair o conteúdo de '.beta-status'. A estrutura da página pode ter mudado.";
                        console.error(`[${new Date(timestamp).toLocaleString('pt-BR')}] [${targetLabel}] ${details}`);
                    }

                    saveHistory({ timestamp, status, details: details || undefined, targetUrl, targetLabel });
                    safeCallback(callback);
                },
                onerror: function(err) {
                    const timestamp = new Date().toISOString();
                    const status = 'ERRO_CONEXAO';
                    console.error(`Erro ao verificar TestFlight [${targetLabel}]:`, err);
                    saveHistory({ timestamp, status, error: serializeRequestError(err), targetUrl, targetLabel });
                    safeCallback(callback);
                },
                ontimeout: function() {
                    const timestamp = new Date().toISOString();
                    const status = 'ERRO_TIMEOUT';
                    const details = `Timeout após ${settings.requestTimeoutMs}ms ao consultar TestFlight.`;
                    console.error(`[${targetLabel}] ${details}`);
                    saveHistory({ timestamp, status, details, targetUrl, targetLabel });
                    safeCallback(callback);
                },
            });
        } catch (err) {
            const timestamp = new Date().toISOString();
            const status = 'ERRO_CONEXAO';
            const details = `Falha ao iniciar requisição: ${serializeRequestError(err)}`;
            console.error(`[${targetLabel}] ${details}`);
            saveHistory({ timestamp, status, details, targetUrl, targetLabel });
            safeCallback(callback);
        }
    }


    function checkAllBetas(callback) {
        const urlsToCheck = VALID_TARGET_URLS;

        if (urlsToCheck.length === 0) {
            console.warn('Nenhuma URL válida configurada para monitoramento.');
            safeCallback(callback);
            return;
        }

        const timestamp = new Date().toLocaleString('pt-BR');
        console.log(`[${timestamp}] Iniciando ciclo de verificação de ${urlsToCheck.length} URL(s).`);

        let pendingChecks = urlsToCheck.length;
        urlsToCheck.forEach((targetUrl) => {
            checkBeta(targetUrl, () => {
                pendingChecks -= 1;
                if (pendingChecks === 0) {
                    console.log(`[${new Date().toLocaleString('pt-BR')}] Ciclo de verificação concluído. ${urlsToCheck.length} URL(s) processadas.`);
                    safeCallback(callback);
                }
            });
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
        return Boolean(lock && lock.id === LEADER_ID);
    }

    function tryBecomeLeader() {
        const lock = readLock();
        const now = Date.now();

        if (!lock || !lock.id || !lock.ts || (now - Number(lock.ts)) > settings.leaderTtlMs) {
            writeLock();
            return amILeader();
        }

        return lock.id === LEADER_ID;
    }

    function startMonitoring() {
        if (monitorTimer) return;

        checkAllBetas();

        monitorTimer = setInterval(() => {
            if (!tryBecomeLeader()) {
                stopMonitoring();
                return;
            }
            checkAllBetas();
        }, settings.checkIntervalMs);

        heartbeatTimer = setInterval(() => {
            if (amILeader()) {
                writeLock();
            }
        }, settings.leaderHeartbeatMs);

        console.log('👑 Instância líder ativa: monitoramento iniciado.');
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
            if (tryBecomeLeader()) {
                startMonitoring();
            }
        };

        attemptLeadership();

        if (standbyLeadershipTimer) {
            clearInterval(standbyLeadershipTimer);
        }

        standbyLeadershipTimer = setInterval(attemptLeadership, settings.leaderHeartbeatMs);
    }

    function restartMonitoringWithNewSettings() {
        stopMonitoring();
        initLeaderElection();
    }

    /** ============================
     * FUNÇÕES DA INTERFACE DO HISTÓRICO (UI)
     * ============================ */

    function createLogEntryElement(entry, statusInfo) {
        const localTime = new Date(entry.timestamp).toLocaleString('pt-BR');
        const logElement = document.createElement('div');
        logElement.className = `log-entry ${statusInfo.className}`;

        const header = document.createElement('div');
        header.className = 'log-header';

        const icon = document.createElement('span');
        icon.className = 'log-icon';
        icon.textContent = statusInfo.icon;

        const timestamp = document.createElement('span');
        timestamp.className = 'log-timestamp';
        timestamp.textContent = `[${localTime}]`;

        const status = document.createElement('span');
        status.className = 'log-status';
        status.textContent = statusInfo.text;

        const target = document.createElement('span');
        target.className = 'log-target';
        target.textContent = `(${entry.targetLabel || getTargetLabel(entry.targetUrl)})`;

        header.append(icon, timestamp, status, target);
        logElement.appendChild(header);

        if (entry.details || entry.error) {
            const details = document.createElement('div');
            details.className = 'log-details';

            const label = document.createElement('strong');
            label.textContent = entry.error ? 'Erro: ' : 'Detalhes: ';
            details.appendChild(label);
            details.append(entry.error || entry.details || '');

            logElement.appendChild(details);
        }

        return logElement;
    }

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
            VAGO: { icon: '🚀', text: 'VAGA DETECTADA', className: 'status-vago' },
            CHEIO: { icon: '⛔', text: 'AINDA CHEIO', className: 'status-cheio' },
            TEXTO_DESCONHECIDO: { icon: '❓', text: 'STATUS DESCONHECIDO', className: 'status-desconhecido' },
            ERRO_ESTRUTURA: { icon: '🏗️', text: 'ERRO DE ESTRUTURA', className: 'status-erro' },
            ERRO_CONEXAO: { icon: '🌐', text: 'ERRO DE CONEXÃO', className: 'status-erro' },
            ERRO_TIMEOUT: { icon: '⏱️', text: 'TIMEOUT', className: 'status-erro' },
            ERRO_HTTP: { icon: '📡', text: 'ERRO HTTP', className: 'status-erro' },
        };

        history.slice().reverse().forEach((entry) => {
            const statusInfo = statusMap[entry.status] || { icon: '⚪', text: entry.status || 'DESCONHECIDO', className: 'status-info' };
            logContainer.appendChild(createLogEntryElement(entry, statusInfo));
        });
    }

    function confirmAndClearHistory() {
        if (confirm('Você tem certeza que deseja limpar todo o histórico de verificação?\nEsta ação não pode ser desfeita.')) {
            GM_setValue(HISTORY_KEY, []);
            renderLogEntries();
            console.log('Histórico de verificação foi limpo pelo usuário.');
        }
    }

    function manualCheck() {
        const btn = document.getElementById('wbm-check-now-btn');
        if (!btn) return;

        btn.textContent = 'Verificando...';
        btn.disabled = true;

        checkAllBetas(() => {
            renderLogEntries();
            btn.textContent = 'Verificar Agora';
            btn.disabled = false;
        });
    }

    function fillSettingsForm(form, values) {
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            const input = form.querySelector(`[name="${key}"]`);
            if (!input) continue;
            const value = Number(values[key]);
            if (input.dataset.unit === 'seconds' && Number.isFinite(value)) {
                input.value = String(Math.round(value / 1000));
                continue;
            }

            input.value = String(values[key]);
        }
    }

    function formToSettings(form) {
        const formData = new FormData(form);
        const raw = {};
        for (const key of Object.keys(DEFAULT_SETTINGS)) {
            const input = form.querySelector(`[name="${key}"]`);
            const formValue = formData.get(key);

            if (input && input.dataset.unit === 'seconds') {
                const valueInSeconds = Number(formValue);
                raw[key] = Number.isFinite(valueInSeconds) ? valueInSeconds * 1000 : formValue;
                continue;
            }

            raw[key] = formValue;
        }
        return sanitizeSettings(raw);
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
                width: 92%; max-width: 900px; height: 88%; display: flex; flex-direction: column;
                box-shadow: 0 8px 30px rgba(0,0,0,0.5); border: 1px solid #333; gap: 12px;
            }
            #wbm-modal-header {
                display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #444;
                padding-bottom: 12px; margin-bottom: 2px; gap: 12px;
            }
            #wbm-modal-header h2 { margin: 0; font-size: 1.4em; color: #fff; font-weight: 600; }
            #wbm-modal-buttons { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
            .wbm-btn {
                background: linear-gradient(180deg, #3e4754, #2f3743);
                color: #eef3f9;
                border: 1px solid rgba(177, 190, 208, 0.35);
                padding: 9px 15px;
                border-radius: 10px;
                cursor: pointer;
                font-size: 0.9em;
                font-weight: 600;
                letter-spacing: 0.01em;
                transition: transform 0.14s ease, background-color 0.2s, border-color 0.2s, box-shadow 0.2s, filter 0.2s;
                box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22), 0 1px 0 rgba(255,255,255,0.1) inset;
            }
            .wbm-btn:hover { background: linear-gradient(180deg, #4a5565, #38414f); border-color: rgba(204, 218, 236, 0.55); }
            .wbm-btn:active { transform: translateY(1px) scale(0.99); filter: brightness(0.96); }
            .wbm-btn:focus-visible { outline: none; box-shadow: 0 0 0 2px rgba(130, 172, 224, 0.45), 0 8px 18px rgba(0, 0, 0, 0.22); }
            .wbm-btn:disabled { background: #2b3138; color: #7f8893; cursor: not-allowed; border-color: #46505c; box-shadow: none; }
            .wbm-btn--danger { background: linear-gradient(180deg, #b74a56, #943843); border-color: rgba(236, 162, 171, 0.4); }
            .wbm-btn--danger:hover { background: linear-gradient(180deg, #c95864, #a0424d); border-color: rgba(246, 188, 195, 0.62); }
            #wbm-settings-btn { min-width: 42px; font-size: 1.1em; padding: 7px 10px; }
            #wbm-settings-panel {
                display: none; background: #202020; border: 1px solid #3a3a3a; border-radius: 10px; padding: 12px;
            }
            #wbm-settings-panel.open { display: block; }
            #wbm-settings-form {
                display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px 12px;
            }
            .wbm-field { display: flex; flex-direction: column; gap: 5px; }
            .wbm-field label { font-size: 0.82em; color: #b8b8b8; }
            .wbm-field small { font-size: 0.75em; color: #8e8e8e; line-height: 1.35; }
            .wbm-field input {
                background: #2a2a2a; border: 1px solid #4a4a4a; border-radius: 7px; color: #f0f0f0;
                padding: 8px; font-size: 0.88em;
            }
            .wbm-field input:focus { outline: none; border-color: #888; box-shadow: 0 0 0 1px #666 inset; }
            #wbm-settings-actions { grid-column: 1 / -1; display: flex; gap: 8px; justify-content: flex-end; padding-top: 4px; }
            #wbm-settings-feedback { grid-column: 1 / -1; min-height: 1.2em; font-size: 0.8em; color: #9ccfff; }
            #wbm-log-container { flex-grow: 1; overflow-y: auto; padding-right: 8px; }
            .log-entry { padding: 12px; border-bottom: 1px solid #333; display: flex; flex-direction: column; font-size: 0.9em; line-height: 1.5; }
            .log-header { display: flex; align-items: center; gap: 10px; font-family: "SF Mono", "Menlo", "Consolas", monospace; }
            .log-icon { font-size: 1.2em; }
            .log-timestamp { color: #999; }
            .log-status { font-weight: bold; }
            .log-target { color: #8ab4ff; }
            .log-details { margin-top: 8px; color: #bbb; padding-left: 32px; font-size: 0.95em; word-break: break-all; }
            .log-details strong { color: #ddd; }
            .status-vago { color: #28a745; }
            .status-cheio { color: #ffc107; }
            .status-desconhecido { color: #fd7e14; }
            .status-erro { color: #dc3545; }
            .status-info { color: #17a2b8; }
        `;

        const styleSheet = document.createElement('style');
        styleSheet.textContent = styles;
        document.head.appendChild(styleSheet);

        const container = document.createElement('div');
        container.id = 'wbm-modal-container';
        container.innerHTML = `
            <div id="wbm-modal-content">
                <div id="wbm-modal-header">
                    <h2>Histórico do Monitor</h2>
                    <div id="wbm-modal-buttons">
                        <button id="wbm-settings-btn" class="wbm-btn" title="Abrir/fechar configurações">⚙️</button>
                        <button id="wbm-check-now-btn" class="wbm-btn" title="Força uma verificação imediata">Verificar Agora</button>
                        <button id="wbm-refresh-btn" class="wbm-btn" title="Recarrega o histórico da memória">Atualizar</button>
                        <button id="wbm-clear-btn" class="wbm-btn wbm-btn--danger" title="Apaga permanentemente todo o histórico">Limpar Histórico</button>
                        <button id="wbm-close-btn" class="wbm-btn">Fechar</button>
                    </div>
                </div>
                <div id="wbm-settings-panel">
                    <form id="wbm-settings-form">
                        <div class="wbm-field"><label for="wbm-check-interval">Intervalo de verificação (segundos)</label><input id="wbm-check-interval" name="checkIntervalMs" type="number" min="15" max="86400" step="1" data-unit="seconds" required><small>Define de quanto em quanto tempo o script consulta o TestFlight.</small></div>
                        <div class="wbm-field"><label for="wbm-request-timeout">Timeout da requisição (segundos)</label><input id="wbm-request-timeout" name="requestTimeoutMs" type="number" min="5" max="120" step="1" data-unit="seconds" required><small>Tempo máximo de espera por resposta de rede antes de registrar timeout.</small></div>
                        <div class="wbm-field"><label for="wbm-history-size">Tamanho do histórico</label><input id="wbm-history-size" name="maxHistoryEntries" type="number" min="20" max="1000" required><small>Quantidade máxima de eventos armazenados localmente.</small></div>
                        <div class="wbm-field"><label for="wbm-alert-cooldown">Intervalo mínimo entre alertas (segundos)</label><input id="wbm-alert-cooldown" name="alertCooldownMs" type="number" min="60" max="86400" step="1" data-unit="seconds" required><small>Evita spam quando a vaga continua aberta por muito tempo.</small></div>
                        <div class="wbm-field"><label for="wbm-leader-ttl">Expiração do líder (segundos)</label><input id="wbm-leader-ttl" name="leaderTtlMs" type="number" min="30" max="600" step="1" data-unit="seconds" required><small>Se o líder parar de atualizar o lock nesse prazo, outra aba assume.</small></div>
                        <div class="wbm-field"><label for="wbm-leader-heartbeat">Heartbeat do líder (segundos)</label><input id="wbm-leader-heartbeat" name="leaderHeartbeatMs" type="number" min="5" max="300" step="1" data-unit="seconds" required><small>Frequência com que a aba líder renova o lock de monitoramento.</small></div>
                        <div class="wbm-field"><label for="wbm-accept-language">Header Accept-Language</label><input id="wbm-accept-language" name="acceptLanguage" type="text" minlength="2" maxlength="120" required><small>Ajuda a manter respostas consistentes de idioma da página monitorada.</small></div>
                        <div id="wbm-settings-feedback" aria-live="polite"></div>
                        <div id="wbm-settings-actions">
                            <button type="button" class="wbm-btn" id="wbm-settings-reset-btn" title="Restaurar valores padrão">Restaurar Padrão</button>
                            <button type="submit" class="wbm-btn" id="wbm-settings-save-btn" title="Salvar e aplicar as configurações">Salvar Configurações</button>
                        </div>
                    </form>
                </div>
                <div id="wbm-log-container"><div class="log-entry status-info">Carregando histórico...</div></div>
            </div>
        `;
        document.body.appendChild(container);

        const checkBtn = document.getElementById('wbm-check-now-btn');
        const clearBtn = document.getElementById('wbm-clear-btn');
        const refreshBtn = document.getElementById('wbm-refresh-btn');
        const closeBtn = document.getElementById('wbm-close-btn');
        const settingsBtn = document.getElementById('wbm-settings-btn');
        const settingsPanel = document.getElementById('wbm-settings-panel');
        const settingsForm = document.getElementById('wbm-settings-form');
        const settingsResetBtn = document.getElementById('wbm-settings-reset-btn');
        const settingsFeedback = document.getElementById('wbm-settings-feedback');

        fillSettingsForm(settingsForm, settings);

        const closeModal = () => {
            container.remove();
            styleSheet.remove();
        };

        checkBtn.addEventListener('click', manualCheck);
        clearBtn.addEventListener('click', confirmAndClearHistory);
        refreshBtn.addEventListener('click', renderLogEntries);
        closeBtn.addEventListener('click', closeModal);

        settingsBtn.addEventListener('click', () => {
            settingsPanel.classList.toggle('open');
        });

        settingsResetBtn.addEventListener('click', () => {
            fillSettingsForm(settingsForm, DEFAULT_SETTINGS);
            settingsFeedback.textContent = 'Valores padrão carregados no formulário. Clique em "Salvar Configurações" para aplicar.';
        });

        settingsForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const nextSettings = formToSettings(settingsForm);
            const previous = settings;
            const persisted = persistSettings(nextSettings);
            fillSettingsForm(settingsForm, persisted);

            if (JSON.stringify(previous) !== JSON.stringify(persisted)) {
                restartMonitoringWithNewSettings();
            }

            settingsFeedback.textContent = 'Configurações salvas e aplicadas com sucesso.';
            renderLogEntries();
        });

        container.addEventListener('click', (event) => {
            if (event.target && event.target.id === 'wbm-modal-container') {
                closeModal();
            }
        });

        renderLogEntries();
    }

    /** ============================
     * INICIALIZAÇÃO
     * ============================ */
    GM_registerMenuCommand('Ver Histórico de Verificação', displayHistoryUI, 'h');
    console.log('🔎 Monitoramento de alta precisão v1.0.3 iniciado...');
    initLeaderElection();
})();
