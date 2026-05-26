// NetShield Background Service Worker
// Handles network info caching, phishing checks, speed tests, settings, history, and notifications

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

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const HISTORY_LIMITS = {
    site: 30,
    speed: 12,
    network: 20
};
const NOTIFY_COOLDOWN = 5 * 60 * 1000;
const EXTENSION_VERSION = chrome.runtime.getManifest().version;

let cachedData = null;
let cacheTimestamp = 0;

chrome.runtime.onInstalled.addListener(() => {
    initializeSettings();
});

chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.settings) {
        const merged = mergeSettings(DEFAULT_SETTINGS, changes.settings.newValue || {});
        updateRefreshAlarm(normalizeSettings(merged));
    }
});

chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === 'refreshNetwork') {
        getNetworkInfo({ force: true });
    }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_NETWORK_INFO') {
        getNetworkInfo({ force: message.force }).then(sendResponse);
        return true;
    }
    if (message.type === 'CHECK_PHISHING') {
        checkPhishing(message.url, message.pageInfo).then(sendResponse);
        return true;
    }
    if (message.type === 'RUN_SPEED_TEST') {
        runSpeedTest().then(sendResponse);
        return true;
    }
});

async function initializeSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    if (!settings) {
        await chrome.storage.sync.set({ settings: DEFAULT_SETTINGS });
        updateRefreshAlarm(DEFAULT_SETTINGS);
        return;
    }
    const merged = mergeSettings(DEFAULT_SETTINGS, settings || {});
    updateRefreshAlarm(normalizeSettings(merged));
}

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

function normalizeSettings(settings) {
    return {
        ...settings,
        refresh: {
            cadenceMinutes: Number(settings.refresh?.cadenceMinutes || 0)
        },
        phishing: {
            ...settings.phishing,
            allowlist: normalizeList(settings.phishing?.allowlist),
            denylist: normalizeList(settings.phishing?.denylist),
            safeBrowsingApiKey: (settings.phishing?.safeBrowsingApiKey || '').trim()
        }
    };
}

function normalizeList(list) {
    if (!Array.isArray(list)) return [];
    return [...new Set(list.map(item => item.trim().toLowerCase()).filter(Boolean))];
}

async function getSettings() {
    const { settings } = await chrome.storage.sync.get('settings');
    return normalizeSettings(mergeSettings(DEFAULT_SETTINGS, settings || {}));
}

async function updateRefreshAlarm(settings) {
    await chrome.alarms.clear('refreshNetwork');
    const cadence = Number(settings?.refresh?.cadenceMinutes || 0);
    if (cadence > 0) {
        chrome.alarms.create('refreshNetwork', { periodInMinutes: cadence });
    }
}

async function getNetworkInfo({ force = false } = {}) {
    const settings = await getSettings();
    const now = Date.now();

    if (!force) {
        if (cachedData && (now - cacheTimestamp) < CACHE_DURATION) {
            return { ...cachedData, cached: true };
        }
        const { networkCache } = await chrome.storage.local.get('networkCache');
        if (networkCache && (now - networkCache.timestamp) < CACHE_DURATION) {
            cachedData = networkCache.data;
            cacheTimestamp = networkCache.timestamp;
            return { ...networkCache.data, cached: true };
        }
    }

    const primary = await fetchFromIpWhoIs();
    if (primary.success) {
        await persistNetworkInfo(primary, now, settings);
        return { ...primary, cached: false };
    }

    const fallback = await fetchFromIpApiCo();
    if (fallback.success) {
        await persistNetworkInfo(fallback, now, settings);
        return { ...fallback, cached: false };
    }

    return { success: false, error: primary.error || fallback.error };
}

async function persistNetworkInfo(data, timestamp, settings) {
    cachedData = data;
    cacheTimestamp = timestamp;
    await chrome.storage.local.set({ networkCache: { data, timestamp } });

    if (settings.privacy?.storeNetworkHistory) {
        const location = [data.city, data.country].filter(v => v && v !== 'Unknown').join(', ') || 'Unknown';
        await appendHistory('networkHistory', {
            timestamp,
            ip: data.ip,
            isp: data.isp,
            location,
            source: data.source || 'unknown'
        }, HISTORY_LIMITS.network);
    }
}

async function fetchFromIpWhoIs() {
    try {
        const res = await fetchWithTimeout('https://ipwho.is/', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'API returned failure');

        const isp = data.connection?.isp || data.connection?.org || null;
        const city = data.city || null;
        const country = data.country || null;

        return {
            ip: data.ip || 'Unknown',
            isp: isp || 'Unknown',
            country: country || 'Unknown',
            region: data.region || 'Unknown',
            city: city || 'Unknown',
            timezone: data.timezone?.id || 'Unknown',
            source: 'ipwho.is',
            success: true
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function fetchFromIpApiCo() {
    try {
        const res = await fetchWithTimeout('https://ipapi.co/json/', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (data.error) throw new Error(data.reason || 'API returned error');

        return {
            ip: data.ip || 'Unknown',
            isp: data.org || data.asn?.org || 'Unknown',
            country: data.country_name || 'Unknown',
            region: data.region || 'Unknown',
            city: data.city || 'Unknown',
            timezone: data.timezone || 'Unknown',
            source: 'ipapi.co',
            success: true
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function checkPhishing(url, pageInfo) {
    const settings = await getSettings();

    try {
        if (!url || url.startsWith('chrome://') || url.startsWith('about:')) {
            return buildResult({
                safe: true,
                level: 'safe',
                riskScore: 0,
                label: 'Internal page',
                badgeText: 'Safe',
                safeIndicators: ['Browser internal page'],
                sources: ['System'],
                url
            }, settings);
        }

        const parsed = new URL(url);
        const hostname = parsed.hostname;
        const domain = hostname.replace(/^www\./, '');

        const allowlisted = isDomainListed(hostname, settings.phishing.allowlist);
        const denylisted = isDomainListed(hostname, settings.phishing.denylist);

        if (denylisted) {
            return buildResult({
                safe: false,
                level: 'blocked',
                riskScore: 100,
                label: 'Blocked by denylist',
                badgeText: 'Blocked',
                risks: ['Domain is on your blocklist'],
                sources: ['Denylist'],
                url,
                hostname
            }, settings);
        }

        if (allowlisted) {
            return buildResult({
                safe: true,
                level: 'allowlisted',
                riskScore: 0,
                label: 'Allowlisted site',
                badgeText: 'Allowlisted',
                safeIndicators: ['Domain is on your allowlist'],
                sources: ['Allowlist'],
                url,
                hostname
            }, settings);
        }

        let riskScore = 0;
        const risks = [];
        const safeIndicators = [];
        const sources = [];

        if (settings.phishing.useHeuristics) {
            sources.push('Heuristics');

            if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
                riskScore += 40;
                risks.push('IP-based URL');
            }

            const subdomainCount = hostname.split('.').length - 2;
            if (subdomainCount > 3) {
                riskScore += 20;
                risks.push('Excessive subdomains');
            }

            if (domain.length > 30) {
                riskScore += 15;
                risks.push('Unusually long domain');
            }

            if (/[^\x00-\x7F]/.test(hostname)) {
                riskScore += 30;
                risks.push('Non-ASCII characters (homograph risk)');
            }

            const phishingKeywords = [
                'login', 'signin', 'account', 'secure', 'update', 'verify',
                'banking', 'paypal', 'amazon', 'microsoft', 'google', 'apple',
                'support', 'confirm', 'password', 'credential', 'wallet',
                'suspended', 'unlock', 'recover', 'billing', 'invoice'
            ];
            const matchedKeywords = phishingKeywords.filter(k => domain.includes(k));
            if (matchedKeywords.length > 0) {
                riskScore += matchedKeywords.length * 8;
                risks.push(`Suspicious keywords: ${matchedKeywords.slice(0, 2).join(', ')}`);
            }

            if (parsed.protocol !== 'https:') {
                riskScore += 25;
                risks.push('Not using HTTPS');
            } else {
                safeIndicators.push('HTTPS secured');
            }

            const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];
            if (shorteners.some(s => hostname.includes(s))) {
                riskScore += 20;
                risks.push('URL shortener detected');
            }

            const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click', '.download'];
            if (suspiciousTlds.some(tld => hostname.endsWith(tld))) {
                riskScore += 20;
                risks.push('Suspicious TLD');
            }

            if (url.includes('@')) {
                riskScore += 35;
                risks.push('@ symbol in URL');
            }

            if (parsed.pathname.includes('//')) {
                riskScore += 10;
                risks.push('Double slashes in path');
            }

            const safeTlds = ['.gov', '.edu', '.mil'];
            if (safeTlds.some(tld => hostname.endsWith(tld))) {
                riskScore -= 20;
                safeIndicators.push('Government/Educational domain');
            }
        }

        if (settings.privacy.enablePageSignals && pageInfo) {
            sources.push('Page signals');

            if (pageInfo.hasLoginForm) {
                riskScore += 8;
                risks.push('Login form detected');
            }
            if (pageInfo.passwordFieldCount > 1) {
                riskScore += 8;
                risks.push('Multiple password fields');
            }
            if (pageInfo.externalFormActionCount > 0) {
                riskScore += 15;
                risks.push('External form submission');
            }
            if (pageInfo.hiddenIframeCount > 0) {
                riskScore += 15;
                risks.push(`Hidden iframes (${pageInfo.hiddenIframeCount})`);
            }
            if (pageInfo.mixedContentCount > 0) {
                riskScore += 10;
                risks.push('Mixed content over HTTP');
            }
            if (pageInfo.suspiciousKeywordMatch) {
                riskScore += 10;
                risks.push('Suspicious keywords in page metadata');
            }
        }

        if (settings.phishing.useSafeBrowsing && settings.phishing.safeBrowsingApiKey) {
            sources.push('Safe Browsing');
            const safeBrowsing = await checkSafeBrowsing(url, settings.phishing.safeBrowsingApiKey);
            if (safeBrowsing.match) {
                riskScore = Math.max(riskScore, 90);
                risks.push(`Safe Browsing match (${safeBrowsing.threats.join(', ')})`);
            } else {
                safeIndicators.push('Safe Browsing: no matches');
            }
        }

        riskScore = Math.max(0, Math.min(100, riskScore));

        let level = 'safe';
        if (riskScore >= 70) level = 'danger';
        else if (riskScore >= 35) level = 'warning';

        return buildResult({
            safe: riskScore < 35,
            level,
            riskScore,
            risks,
            safeIndicators,
            sources,
            url,
            hostname
        }, settings);
    } catch (err) {
        return buildResult({
            safe: true,
            level: 'safe',
            riskScore: 0,
            label: 'Unable to analyze',
            badgeText: 'Unknown',
            risks: [],
            safeIndicators: [],
            sources: ['System'],
            error: err.message,
            url
        }, settings);
    }
}

async function checkSafeBrowsing(url, apiKey) {
    try {
        const body = {
            client: {
                clientId: 'netshield',
                clientVersion: EXTENSION_VERSION
            },
            threatInfo: {
                threatTypes: ['MALWARE', 'SOCIAL_ENGINEERING', 'UNWANTED_SOFTWARE', 'POTENTIALLY_HARMFUL_APPLICATION'],
                platformTypes: ['ANY_PLATFORM'],
                threatEntryTypes: ['URL'],
                threatEntries: [{ url }]
            }
        };

        const res = await fetchWithTimeout(
            `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(apiKey)}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            },
            12000
        );

        if (!res.ok) throw new Error(`Safe Browsing HTTP ${res.status}`);
        const data = await res.json();
        const matches = Array.isArray(data.matches) ? data.matches : [];
        const threats = [...new Set(matches.map(match => match.threatType || 'UNKNOWN'))];
        return { match: matches.length > 0, threats: threats.length ? threats : ['UNKNOWN'] };
    } catch (err) {
        return { match: false, threats: [], error: err.message };
    }
}

function isDomainListed(hostname, list) {
    return list.some(entry => hostname === entry || hostname.endsWith(`.${entry}`));
}

async function buildResult(result, settings) {
    const timestamp = Date.now();
    const output = {
        safe: result.safe,
        level: result.level,
        riskScore: result.riskScore,
        risks: result.risks || [],
        safeIndicators: result.safeIndicators || [],
        sources: result.sources || [],
        label: result.label,
        badgeText: result.badgeText,
        url: result.url,
        hostname: result.hostname,
        error: result.error,
        checkedAt: timestamp
    };

    if (settings.privacy?.storeHistory && result.url && /^https?:/i.test(result.url)) {
        await appendHistory('siteHistory', {
            timestamp,
            hostname: result.hostname || extractHostname(result.url),
            level: result.level,
            riskScore: result.riskScore,
            summary: summarizeRisks(result.risks, result.safeIndicators)
        }, HISTORY_LIMITS.site);
    }

    await maybeNotify(output, settings);
    return output;
}

function summarizeRisks(risks = [], safeIndicators = []) {
    if (risks.length) return risks.slice(0, 2).join(' · ');
    if (safeIndicators.length) return safeIndicators.slice(0, 2).join(' · ');
    return 'No threats detected';
}

function extractHostname(url) {
    try {
        return new URL(url).hostname;
    } catch {
        return 'Unknown';
    }
}

async function maybeNotify(result, settings) {
    if (!settings.notifications?.enabled) return;
    const notifyForLevel = {
        warning: settings.notifications.onWarning,
        danger: settings.notifications.onDanger,
        blocked: settings.notifications.onDanger
    };
    if (!notifyForLevel[result.level]) return;

    const hostname = result.hostname || extractHostname(result.url || '');
    if (!hostname) return;

    const { notifyState } = await chrome.storage.local.get('notifyState');
    const currentState = notifyState || {};
    const lastNotified = currentState[hostname] || 0;
    const now = Date.now();

    if (now - lastNotified < NOTIFY_COOLDOWN) return;

    currentState[hostname] = now;
    await chrome.storage.local.set({ notifyState: currentState });

    const titles = {
        warning: 'NetShield: Caution advised',
        danger: 'NetShield: High phishing risk',
        blocked: 'NetShield: Blocked domain'
    };

    chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: titles[result.level] || 'NetShield alert',
        message: `${hostname} • ${summarizeRisks(result.risks, result.safeIndicators)}`
    });
}

async function runSpeedTest() {
    const settings = await getSettings();
    try {
        const endpoints = [
            { label: 'Cloudflare', url: 'https://speed.cloudflare.com/__down?bytes=5000000' },
            { label: 'HTTPBin', url: 'https://httpbin.org/bytes/5000000' }
        ];

        let downloadSpeed = 0;
        let serverLabel = '';
        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                const testUrl = `${endpoint.url}&t=${Date.now()}`;
                const startTime = performance.now();
                const response = await fetchWithTimeout(testUrl, { cache: 'no-store' }, 15000);
                const data = await response.arrayBuffer();
                const endTime = performance.now();
                const duration = (endTime - startTime) / 1000;
                const bytesLoaded = data.byteLength;
                downloadSpeed = ((bytesLoaded * 8) / duration / 1000000).toFixed(2);
                serverLabel = endpoint.label;
                break;
            } catch (err) {
                lastError = err;
            }
        }

        if (!downloadSpeed) {
            throw new Error(lastError?.message || 'All speed test endpoints failed');
        }

        const ping = await measurePing();

        const result = {
            success: true,
            download: downloadSpeed,
            ping,
            server: serverLabel
        };

        if (settings.privacy?.storeSpeedHistory) {
            await appendHistory('speedHistory', {
                timestamp: Date.now(),
                download: downloadSpeed,
                ping,
                server: serverLabel
            }, HISTORY_LIMITS.speed);
        }

        return result;
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function measurePing() {
    const pingStart = performance.now();
    try {
        await fetchWithTimeout('https://www.google.com/generate_204', { cache: 'no-store', mode: 'no-cors' }, 8000);
    } catch (e) { }
    return Math.round(performance.now() - pingStart);
}

async function appendHistory(key, entry, limit) {
    const stored = await chrome.storage.local.get(key);
    const items = Array.isArray(stored[key]) ? stored[key] : [];
    items.unshift(entry);
    await chrome.storage.local.set({ [key]: items.slice(0, limit) });
}

async function fetchWithTimeout(url, options = {}, timeout = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}
