// NetShield Popup — Main Logic

const DEFAULT_SETTINGS = {
    theme: 'system',
    notifications: {
        enabled: true,
        onWarning: false,
        onDanger: true
    },
    refresh: {
        cadenceMinutes: 15
    },
    privacy: {
        storeHistory: true,
        storeSpeedHistory: true,
        storeNetworkHistory: true,
        enablePageSignals: true
    },
    phishing: {
        useSafeBrowsing: false,
        safeBrowsingApiKey: '',
        useHeuristics: true,
        allowlist: [],
        denylist: []
    }
};

// ── Splash exit ──────────────────────────────
(function dismissSplash() {
    const splash = document.getElementById('splash');
    if (!splash) return;
    setTimeout(() => {
        splash.classList.add('splash-exit');
        splash.addEventListener('transitionend', () => splash.remove(), { once: true });
    }, 1800);
})();
// ─────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
    const versionBadge = document.querySelector('[data-version]');
    if (versionBadge) {
        versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    }
    // Elements
    const refreshBtn = document.getElementById('refreshBtn');
    const runSpeedBtn = document.getElementById('runSpeedBtn');
    const ipValue = document.getElementById('ipValue');
    const ispValue = document.getElementById('ispValue');
    const locationValue = document.getElementById('locationValue');
    const phishingCard = document.getElementById('phishingCard');
    const phishingIcon = document.getElementById('phishingIcon');
    const phishingStatus = document.getElementById('phishingStatus');
    const phishingDetails = document.getElementById('phishingDetails');
    const riskBadge = document.getElementById('riskBadge');
    const riskText = document.getElementById('riskText');
    const statusDot = document.getElementById('statusDot');
    const statusText = document.getElementById('statusText');
    const footerDate = document.getElementById('footerDate');
    const footerTime = document.getElementById('footerTime');
    const toast = document.getElementById('toast');
    const speedIdle = document.getElementById('speedIdle');
    const speedLoading = document.getElementById('speedLoading');
    const speedMetrics = document.getElementById('speedMetrics');
    const downloadValue = document.getElementById('downloadValue');
    const pingValue = document.getElementById('pingValue');
    const downloadCircle = document.getElementById('downloadCircle');
    const pingCircle = document.getElementById('pingCircle');
    const copyIpBtn = document.getElementById('copyIpBtn');
    const speedSource = document.getElementById('speedSource');
    const currentSite = document.getElementById('currentSite');
    const currentSiteStatus = document.getElementById('currentSiteStatus');
    const allowlistBtn = document.getElementById('allowlistBtn');
    const denylistBtn = document.getElementById('denylistBtn');
    const openSettingsBtn = document.getElementById('openSettingsBtn');
    const siteHistoryList = document.getElementById('siteHistoryList');
    const speedHistoryList = document.getElementById('speedHistoryList');
    const siteHistoryEmpty = document.getElementById('siteHistoryEmpty');
    const speedHistoryEmpty = document.getElementById('speedHistoryEmpty');
    const siteHistoryCount = document.getElementById('siteHistoryCount');
    const speedHistoryCount = document.getElementById('speedHistoryCount');

    let currentIP = '';
    let currentDomain = '';
    let settings = await getSettings();

    applyTheme(settings.theme);

    // Clock & Date
    function updateClock() {
        const now = new Date();
        footerDate.textContent = now.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
        footerTime.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    updateClock();
    setInterval(updateClock, 1000);

    // Toast notification
    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
    }

    // Set status indicator
    function setStatus(state, text) {
        statusDot.className = 'status-dot ' + state;
        statusText.textContent = text;
    }

    // ───────────────────────────────────────────
    // Network Info (IP + ISP + Location)
    // ───────────────────────────────────────────
    async function loadNetworkInfo(force = false) {
        setStatus('loading', 'Fetching network info...');

        try {
            const data = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_INFO', force });

            if (data && data.success) {
                currentIP = data.ip;

                const locationStr = [data.city, data.country].filter(v => v && v !== 'Unknown').join(', ') || 'Unknown';
                const ispStr = (data.isp && data.isp !== 'Unknown') ? truncate(data.isp, 28) : 'Unknown';

                animateValue(ipValue, data.ip);
                animateValue(ispValue, ispStr);
                animateValue(locationValue, locationStr);

                const statusLabel = data.cached ? 'Connected (cached)' : 'Connected';
                setStatus('connected', statusLabel);
            } else {
                animateValue(ipValue, 'Unavailable');
                animateValue(ispValue, 'Unavailable');
                animateValue(locationValue, 'Unavailable');
                setStatus('error', 'Connection error');
            }
        } catch (err) {
            animateValue(ipValue, 'Error');
            animateValue(ispValue, 'Error');
            animateValue(locationValue, 'Error');
            setStatus('error', 'Failed to fetch');
        }
    }

    function animateValue(el, value) {
        el.style.opacity = '0';
        el.style.transform = 'translateY(4px)';
        el.style.transition = 'opacity 0.2s ease, transform 0.2s ease';
        setTimeout(() => {
            el.innerHTML = value;
            el.style.opacity = '1';
            el.style.transform = 'translateY(0)';
        }, 150);
    }

    function truncate(str, maxLen) {
        return str && str.length > maxLen ? str.slice(0, maxLen - 1) + '…' : str;
    }

    // ───────────────────────────────────────────
    // Phishing Detection
    // ───────────────────────────────────────────
    async function checkCurrentSite() {
        phishingStatus.textContent = 'Analyzing...';
        phishingDetails.innerHTML = '<div class="shimmer-line"></div><div class="shimmer-line short"></div>';

        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.url) {
                currentDomain = '';
                updateCurrentSite('No active tab');
                renderPhishing({
                    safe: true,
                    level: 'safe',
                    riskScore: 0,
                    label: 'No active tab',
                    badgeText: 'Safe',
                    risks: [],
                    safeIndicators: ['No active tab']
                });
                return;
            }

            const parsed = new URL(tab.url);
            currentDomain = parsed.hostname.replace(/^www\./, '');
            updateCurrentSite(currentDomain);

            let pageInfo = null;
            if (settings.privacy.enablePageSignals) {
                try {
                    pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
                } catch (e) { /* content script may not be available on all pages */ }
            }

            const result = await chrome.runtime.sendMessage({
                type: 'CHECK_PHISHING',
                url: tab.url,
                pageInfo
            });

            renderPhishing(result);
            updateActionButtons();
            await loadHistory();
        } catch (err) {
            renderPhishing({
                safe: true,
                level: 'safe',
                riskScore: 0,
                label: 'Unable to analyze',
                badgeText: 'Unknown',
                risks: [],
                error: err.message
            });
        }
    }

    function renderPhishing(result) {
        const level = result.level || 'safe';
        const score = result.riskScore || 0;

        // Update card class
        phishingCard.className = 'card phishing-card ' + level;
        phishingIcon.className = 'card-icon ' + level;
        riskBadge.className = 'risk-badge ' + level;

        // Labels
        const labels = {
            safe: 'Site Appears Safe',
            warning: 'Proceed with Caution',
            danger: 'High Phishing Risk!',
            allowlisted: 'Allowlisted',
            blocked: 'Blocked Site',
            unknown: 'Unknown'
        };
        const statusLabel = result.label || labels[level] || 'Unknown';
        phishingStatus.textContent = statusLabel;
        currentSiteStatus.textContent = statusLabel;

        // Risk score
        riskText.textContent = result.badgeText || (score > 0 ? `${score}% risk` : 'Safe');

        // Build detail items
        phishingDetails.innerHTML = '';

        if (result.risks && result.risks.length > 0) {
            result.risks.slice(0, 3).forEach(risk => {
                const item = createRiskItem(risk, 'threat');
                phishingDetails.appendChild(item);
            });
        }

        if (result.safeIndicators && result.safeIndicators.length > 0) {
            result.safeIndicators.slice(0, 2).forEach(indicator => {
                const item = createRiskItem(indicator, 'safe-indicator');
                phishingDetails.appendChild(item);
            });
        }

        if (result.sources && result.sources.length > 0) {
            const item = createRiskItem(`Sources: ${result.sources.join(', ')}`, 'info');
            phishingDetails.appendChild(item);
        }

        if (phishingDetails.children.length === 0) {
            const item = createRiskItem('No threats detected', 'safe-indicator');
            phishingDetails.appendChild(item);
        }
    }

    function createRiskItem(text, type) {
        const div = document.createElement('div');
        div.className = 'risk-item ' + type;
        div.innerHTML = `<div class="risk-dot"></div><span>${escapeHtml(text)}</span>`;
        return div;
    }

    // ───────────────────────────────────────────
    // Speed Test
    // ───────────────────────────────────────────
    async function runSpeedTest() {
        runSpeedBtn.disabled = true;
        speedIdle.style.display = 'none';
        speedMetrics.classList.remove('visible');
        speedLoading.style.display = 'flex';
        speedSource.textContent = '—';

        try {
            const result = await chrome.runtime.sendMessage({ type: 'RUN_SPEED_TEST' });

            speedLoading.style.display = 'none';

            if (result && result.success) {
                const downloadMbps = parseFloat(result.download);
                const ping = parseInt(result.ping);

                downloadValue.textContent = downloadMbps;
                pingValue.textContent = ping;
                speedSource.textContent = result.server ? `via ${result.server}` : '—';

                // Animate rings
                // Download: max reference 100 Mbps
                const dlPercent = Math.min(downloadMbps / 100, 1);
                const pingPercent = Math.min(1 - (ping / 200), 1); // lower ping = fuller ring

                const circumference = 201;
                setTimeout(() => {
                    downloadCircle.style.strokeDashoffset = circumference - (dlPercent * circumference);
                    pingCircle.style.strokeDashoffset = circumference - (pingPercent * circumference);
                }, 100);

                speedMetrics.classList.add('visible');
                await loadHistory();
            } else {
                speedIdle.style.display = 'flex';
                speedSource.textContent = '—';
                showToast('Speed test failed. Try again.');
            }
        } catch (err) {
            speedLoading.style.display = 'none';
            speedIdle.style.display = 'flex';
            speedSource.textContent = '—';
            showToast('Speed test unavailable.');
        } finally {
            runSpeedBtn.disabled = false;
        }
    }

    // ───────────────────────────────────────────
    // Quick Actions
    // ───────────────────────────────────────────
    function updateCurrentSite(value) {
        currentSite.textContent = value || '—';
    }

    function isDomainListed(hostname, list) {
        return list.some(entry => hostname === entry || hostname.endsWith(`.${entry}`));
    }

    function updateActionButtons() {
        if (!currentDomain) {
            allowlistBtn.disabled = true;
            denylistBtn.disabled = true;
            return;
        }
        const allowlisted = isDomainListed(currentDomain, settings.phishing.allowlist);
        const denylisted = isDomainListed(currentDomain, settings.phishing.denylist);

        allowlistBtn.disabled = false;
        denylistBtn.disabled = false;
        allowlistBtn.textContent = allowlisted ? 'Remove allowlist' : 'Allowlist site';
        denylistBtn.textContent = denylisted ? 'Remove blocklist' : 'Blocklist site';
        allowlistBtn.dataset.action = allowlisted ? 'remove' : 'add';
        denylistBtn.dataset.action = denylisted ? 'remove' : 'add';
    }

    async function toggleListEntry(listKey, action) {
        if (!currentDomain) return;
        const updated = mergeSettings(DEFAULT_SETTINGS, settings);
        const list = new Set(updated.phishing[listKey]);

        if (action === 'add') {
            list.add(currentDomain);
            if (listKey === 'allowlist') {
                updated.phishing.denylist = updated.phishing.denylist.filter(entry => entry !== currentDomain);
            }
            if (listKey === 'denylist') {
                updated.phishing.allowlist = updated.phishing.allowlist.filter(entry => entry !== currentDomain);
            }
        } else {
            list.delete(currentDomain);
        }

        updated.phishing[listKey] = Array.from(list);
        await chrome.storage.sync.set({ settings: updated });
        settings = await getSettings();
        showToast(action === 'add' ? 'List updated' : 'Removed from list');
        updateActionButtons();
        await checkCurrentSite();
    }

    // ───────────────────────────────────────────
    // History
    // ───────────────────────────────────────────
    async function loadHistory() {
        const { siteHistory = [], speedHistory = [] } = await chrome.storage.local.get(['siteHistory', 'speedHistory']);

        renderHistoryList(siteHistoryList, siteHistory, siteHistoryEmpty, siteHistoryCount, renderSiteHistoryItem);
        renderHistoryList(speedHistoryList, speedHistory, speedHistoryEmpty, speedHistoryCount, renderSpeedHistoryItem);
    }

    function renderHistoryList(container, items, emptyEl, countEl, renderer) {
        container.innerHTML = '';
        countEl.textContent = String(items.length);
        if (!items.length) {
            emptyEl.style.display = 'block';
            return;
        }
        emptyEl.style.display = 'none';
        items.slice(0, 4).forEach(item => {
            container.appendChild(renderer(item));
        });
    }

    function renderSiteHistoryItem(item) {
        const li = document.createElement('li');
        li.className = `history-item ${item.level || 'safe'}`;
        li.innerHTML = `
            <span class="history-title">${escapeHtml(item.hostname || 'Unknown')}</span>
            <span class="history-meta">${escapeHtml(item.summary || '')} • ${formatTimeAgo(item.timestamp)}</span>
        `;
        return li;
    }

    function renderSpeedHistoryItem(item) {
        const li = document.createElement('li');
        li.className = 'history-item';
        li.innerHTML = `
            <span class="history-title">${escapeHtml(item.download || '—')} Mbps • ${escapeHtml(item.ping || '—')} ms</span>
            <span class="history-meta">${escapeHtml(item.server || 'Speed test')} • ${formatTimeAgo(item.timestamp)}</span>
        `;
        return li;
    }

    function formatTimeAgo(timestamp) {
        if (!timestamp) return 'just now';
        const diff = Date.now() - timestamp;
        const minutes = Math.floor(diff / 60000);
        if (minutes < 1) return 'just now';
        if (minutes < 60) return `${minutes}m ago`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `${hours}h ago`;
        const days = Math.floor(hours / 24);
        return `${days}d ago`;
    }

    // ───────────────────────────────────────────
    // Copy IP
    // ───────────────────────────────────────────
    copyIpBtn.addEventListener('click', async () => {
        if (!currentIP) return;
        try {
            await navigator.clipboard.writeText(currentIP);
            showToast('IP copied to clipboard!');
            copyIpBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
          <polyline points="20 6 9 17 4 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>`;
            setTimeout(() => {
                copyIpBtn.innerHTML = `
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
            <rect x="9" y="9" width="13" height="13" rx="2" stroke="currentColor" stroke-width="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" stroke="currentColor" stroke-width="2"/>
          </svg>`;
            }, 2000);
        } catch (e) {
            showToast('Could not copy.');
        }
    });

    // ───────────────────────────────────────────
    // Refresh
    // ───────────────────────────────────────────
    refreshBtn.addEventListener('click', async () => {
        if (refreshBtn.classList.contains('spinning')) return;
        refreshBtn.classList.add('spinning');

        // Reset shimmer
        ipValue.innerHTML = '<span class="shimmer-text"></span>';
        ispValue.innerHTML = '<span class="shimmer-text"></span>';
        locationValue.innerHTML = '<span class="shimmer-text"></span>';
        phishingDetails.innerHTML = '<div class="shimmer-line"></div><div class="shimmer-line short"></div>';
        currentIP = '';

        await Promise.all([loadNetworkInfo(true), checkCurrentSite()]);

        setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
    });

    // Speed test button
    runSpeedBtn.addEventListener('click', runSpeedTest);

    // Quick actions
    allowlistBtn.addEventListener('click', () => toggleListEntry('allowlist', allowlistBtn.dataset.action || 'add'));
    denylistBtn.addEventListener('click', () => toggleListEntry('denylist', denylistBtn.dataset.action || 'add'));
    openSettingsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

    // ───────────────────────────────────────────
    // Init
    // ───────────────────────────────────────────
    setStatus('loading', 'Connecting...');
    await Promise.all([loadNetworkInfo(), checkCurrentSite(), loadHistory()]);
});

function mergeSettings(base, override) {
    const merged = { ...base };
    Object.keys(override || {}).forEach((key) => {
        if (override[key] && typeof override[key] === 'object' && !Array.isArray(override[key])) {
            merged[key] = mergeSettings(base[key] || {}, override[key]);
        } else if (override[key] !== undefined) {
            merged[key] = override[key];
        }
    });
    return merged;
}

async function getSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, settings || {}));
}

function applyTheme(theme) {
    const root = document.documentElement;
    if (theme === 'system') {
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const updateTheme = () => root.setAttribute('data-theme', media.matches ? 'dark' : 'light');
        updateTheme();
        media.addEventListener('change', updateTheme);
    } else {
        root.setAttribute('data-theme', theme);
    }
}

function normalizeSettings(settings) {
    return {
        ...settings,
        phishing: {
            ...settings.phishing,
            allowlist: normalizeList(settings.phishing?.allowlist),
            denylist: normalizeList(settings.phishing?.denylist)
        }
    };
}

function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(item => item.trim().toLowerCase()).filter(Boolean))];
}

function escapeHtml(str) {
    const d = document.createElement('div');
    d.appendChild(document.createTextNode(str));
    return d.innerHTML;
}
