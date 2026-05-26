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

const elements = {
    useSafeBrowsing: document.getElementById('useSafeBrowsing'),
    safeBrowsingKey: document.getElementById('safeBrowsingKey'),
    useHeuristics: document.getElementById('useHeuristics'),
    usePageSignals: document.getElementById('usePageSignals'),
    allowlist: document.getElementById('allowlist'),
    denylist: document.getElementById('denylist'),
    notificationsEnabled: document.getElementById('notificationsEnabled'),
    notifyWarnings: document.getElementById('notifyWarnings'),
    refreshCadence: document.getElementById('refreshCadence'),
    storeHistory: document.getElementById('storeHistory'),
    storeSpeedHistory: document.getElementById('storeSpeedHistory'),
    storeNetworkHistory: document.getElementById('storeNetworkHistory'),
    themeSelect: document.getElementById('themeSelect'),
    saveBtn: document.getElementById('saveBtn'),
    resetBtn: document.getElementById('resetBtn'),
    clearSiteHistory: document.getElementById('clearSiteHistory'),
    clearSpeedHistory: document.getElementById('clearSpeedHistory'),
    clearNetworkHistory: document.getElementById('clearNetworkHistory'),
    toast: document.getElementById('toast')
};

document.addEventListener('DOMContentLoaded', () => {
    const versionBadge = document.querySelector('[data-version]');
    if (versionBadge) {
        versionBadge.textContent = `v${chrome.runtime.getManifest().version}`;
    }
    loadSettings();
    elements.saveBtn.addEventListener('click', saveSettings);
    elements.resetBtn.addEventListener('click', resetSettings);
    elements.clearSiteHistory.addEventListener('click', () => clearHistory('siteHistory'));
    elements.clearSpeedHistory.addEventListener('click', () => clearHistory('speedHistory'));
    elements.clearNetworkHistory.addEventListener('click', () => clearHistory('networkHistory'));
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

function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(item => item.trim().toLowerCase()).filter(Boolean))];
}

async function loadSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    const merged = mergeSettings(DEFAULT_SETTINGS, settings || {});

    elements.useSafeBrowsing.checked = merged.phishing.useSafeBrowsing;
    elements.safeBrowsingKey.value = merged.phishing.safeBrowsingApiKey || '';
    elements.useHeuristics.checked = merged.phishing.useHeuristics;
    elements.usePageSignals.checked = merged.privacy.enablePageSignals;
    elements.allowlist.value = (merged.phishing.allowlist || []).join('\n');
    elements.denylist.value = (merged.phishing.denylist || []).join('\n');
    elements.notificationsEnabled.checked = merged.notifications.enabled;
    elements.notifyWarnings.checked = merged.notifications.onWarning;
    elements.refreshCadence.value = String(merged.refresh.cadenceMinutes);
    elements.storeHistory.checked = merged.privacy.storeHistory;
    elements.storeSpeedHistory.checked = merged.privacy.storeSpeedHistory;
    elements.storeNetworkHistory.checked = merged.privacy.storeNetworkHistory;
    elements.themeSelect.value = merged.theme || 'system';
}

async function saveSettings() {
    const updated = {
        theme: elements.themeSelect.value,
        notifications: {
            enabled: elements.notificationsEnabled.checked,
            onWarning: elements.notifyWarnings.checked,
            onDanger: true
        },
        refresh: {
            cadenceMinutes: Number(elements.refreshCadence.value || 0)
        },
        privacy: {
            storeHistory: elements.storeHistory.checked,
            storeSpeedHistory: elements.storeSpeedHistory.checked,
            storeNetworkHistory: elements.storeNetworkHistory.checked,
            enablePageSignals: elements.usePageSignals.checked
        },
        phishing: {
            useSafeBrowsing: elements.useSafeBrowsing.checked,
            safeBrowsingApiKey: elements.safeBrowsingKey.value.trim(),
            useHeuristics: elements.useHeuristics.checked,
            allowlist: normalizeList(elements.allowlist.value.split('\n')),
            denylist: normalizeList(elements.denylist.value.split('\n'))
        }
    };

    await chrome.storage.sync.set({ settings: updated });
    showToast('Settings saved');
}

async function resetSettings() {
    await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
    await loadSettings();
    showToast('Settings reset to defaults');
}

async function clearHistory(key) {
    await chrome.storage.local.set({ [key]: [] });
    showToast('History cleared');
}

function showToast(message) {
    elements.toast.textContent = message;
    elements.toast.classList.add('show');
    setTimeout(() => elements.toast.classList.remove('show'), 2000);
}
