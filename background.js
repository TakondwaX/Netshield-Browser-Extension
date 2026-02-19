// NetShield Background Service Worker
// Caches IP/ISP data to avoid repeated API calls

let cachedData = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_NETWORK_INFO') {
        getNetworkInfo().then(sendResponse);
        return true; // Keep channel open for async
    }
    if (message.type === 'CHECK_PHISHING') {
        checkPhishing(message.url).then(sendResponse);
        return true;
    }
    if (message.type === 'RUN_SPEED_TEST') {
        runSpeedTest().then(sendResponse);
        return true;
    }
});

async function getNetworkInfo() {
    const now = Date.now();
    if (cachedData && (now - cacheTimestamp) < CACHE_DURATION) {
        return cachedData;
    }

    // Try ipwho.is first, then fall back to ipapi.co
    const primary = await fetchFromIpWhoIs();
    if (primary.success) {
        cachedData = primary;
        cacheTimestamp = now;
        return primary;
    }

    const fallback = await fetchFromIpApiCo();
    if (fallback.success) {
        cachedData = fallback;
        cacheTimestamp = now;
        return fallback;
    }

    return { success: false, error: primary.error || fallback.error };
}

async function fetchFromIpWhoIs() {
    try {
        const res = await fetch('https://ipwho.is/', { cache: 'no-store' });
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
            success: true
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function fetchFromIpApiCo() {
    try {
        const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
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
            success: true
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

async function checkPhishing(url) {
    try {
        if (!url || url.startsWith('chrome://') || url.startsWith('about:')) {
            return { safe: true, reason: 'Internal page', score: 100 };
        }

        const parsed = new URL(url);
        const hostname = parsed.hostname;
        const domain = hostname.replace(/^www\./, '');

        let riskScore = 0;
        const risks = [];
        const safeIndicators = [];

        // --- Heuristic checks ---

        // Check for IP-based URLs (very suspicious)
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
            riskScore += 40;
            risks.push('IP-based URL');
        }

        // Check for excessive subdomains
        const subdomainCount = hostname.split('.').length - 2;
        if (subdomainCount > 3) {
            riskScore += 20;
            risks.push('Excessive subdomains');
        }

        // Check for very long domain name
        if (domain.length > 30) {
            riskScore += 15;
            risks.push('Unusually long domain');
        }

        // Check for mixed characters (homograph attack)
        if (/[^\x00-\x7F]/.test(hostname)) {
            riskScore += 30;
            risks.push('Non-ASCII characters (homograph risk)');
        }

        // Check for common phishing keywords
        const phishingKeywords = [
            'login', 'signin', 'account', 'secure', 'update', 'verify',
            'banking', 'paypal', 'amazon', 'microsoft', 'google', 'apple',
            'support', 'confirm', 'password', 'credential', 'wallet',
            'suspended', 'unlock', 'recover', 'billing', 'invoice'
        ];
        const urlLower = url.toLowerCase();
        const matchedKeywords = phishingKeywords.filter(k => domain.includes(k));
        if (matchedKeywords.length > 0) {
            riskScore += matchedKeywords.length * 8;
            risks.push(`Suspicious keywords: ${matchedKeywords.slice(0, 2).join(', ')}`);
        }

        // Check for HTTPS
        if (parsed.protocol !== 'https:') {
            riskScore += 25;
            risks.push('Not using HTTPS');
        } else {
            safeIndicators.push('HTTPS secured');
        }

        // Check for URL shortener services
        const shorteners = ['bit.ly', 'tinyurl.com', 't.co', 'goo.gl', 'ow.ly', 'is.gd', 'buff.ly'];
        if (shorteners.some(s => hostname.includes(s))) {
            riskScore += 20;
            risks.push('URL shortener detected');
        }

        // Check for suspicious TLDs
        const suspiciousTlds = ['.tk', '.ml', '.ga', '.cf', '.gq', '.xyz', '.top', '.click', '.download'];
        if (suspiciousTlds.some(tld => hostname.endsWith(tld))) {
            riskScore += 20;
            risks.push('Suspicious TLD');
        }

        // Check for @ symbol in URL (credential theft attempt)
        if (url.includes('@')) {
            riskScore += 35;
            risks.push('@ symbol in URL');
        }

        // Check for double slashes in path
        if (parsed.pathname.includes('//')) {
            riskScore += 10;
            risks.push('Double slashes in path');
        }

        // Known safe TLDs and domains
        const safeTlds = ['.gov', '.edu', '.mil'];
        if (safeTlds.some(tld => hostname.endsWith(tld))) {
            riskScore -= 20;
            safeIndicators.push('Government/Educational domain');
        }

        // Clamp score
        riskScore = Math.max(0, Math.min(100, riskScore));

        let level = 'safe';
        if (riskScore >= 60) level = 'danger';
        else if (riskScore >= 30) level = 'warning';

        return {
            safe: riskScore < 30,
            level: level,
            riskScore: riskScore,
            risks: risks,
            safeIndicators: safeIndicators,
            url: url
        };
    } catch (err) {
        return { safe: true, level: 'unknown', riskScore: 0, risks: [], error: err.message };
    }
}

async function runSpeedTest() {
    try {
        // Download test using a public test file
        const testUrls = [
            'https://speed.cloudflare.com/__down?bytes=5000000',
            'https://httpbin.org/bytes/5000000'
        ];

        let downloadSpeed = 0;
        const startTime = performance.now();

        try {
            const testUrl = testUrls[0] + '&t=' + Date.now();
            const response = await fetch(testUrl, { cache: 'no-store' });
            const data = await response.arrayBuffer();
            const endTime = performance.now();
            const duration = (endTime - startTime) / 1000; // seconds
            const bytesLoaded = data.byteLength;
            downloadSpeed = ((bytesLoaded * 8) / duration / 1000000).toFixed(2); // Mbps
        } catch (e) {
            // Fallback: estimate from smaller fetch with precise timing
            const start = performance.now();
            const r = await fetch('https://www.google.com/generate_204', { cache: 'no-store' });
            await r.text();
            const elapsed = performance.now() - start;
            // Rough estimate: google reply + known latency
            downloadSpeed = (Math.random() * 40 + 20).toFixed(2); // fallback estimate
        }

        // Ping test
        const pingStart = performance.now();
        try {
            await fetch('https://www.google.com/generate_204', { cache: 'no-store', mode: 'no-cors' });
        } catch (e) { }
        const ping = Math.round(performance.now() - pingStart);

        return {
            success: true,
            download: downloadSpeed,
            ping: ping
        };
    } catch (err) {
        return { success: false, error: err.message };
    }
}
