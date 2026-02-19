// NetShield Popup — Main Logic

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

    let currentIP = '';

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
    async function loadNetworkInfo() {
        setStatus('loading', 'Fetching network info...');

        try {
            const data = await chrome.runtime.sendMessage({ type: 'GET_NETWORK_INFO' });

            if (data && data.success) {
                currentIP = data.ip;

                const locationStr = [data.city, data.country].filter(v => v && v !== 'Unknown').join(', ') || 'Unknown';
                const ispStr = (data.isp && data.isp !== 'Unknown') ? truncate(data.isp, 28) : 'Unknown';

                animateValue(ipValue, data.ip);
                animateValue(ispValue, ispStr);
                animateValue(locationValue, locationStr);

                setStatus('connected', 'Connected');
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
                renderPhishing({ safe: true, level: 'safe', riskScore: 0, risks: [], safeIndicators: ['No active tab'] });
                return;
            }

            const result = await chrome.runtime.sendMessage({ type: 'CHECK_PHISHING', url: tab.url });

            // Also get page info from content script
            let pageInfo = null;
            try {
                pageInfo = await chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' });
            } catch (e) { /* content script may not be available on all pages */ }

            if (pageInfo) {
                // Adjust risk score based on page analysis
                if (pageInfo.hasLoginForm && result.riskScore > 20) result.riskScore += 10;
                if (pageInfo.hiddenIframeCount > 0) {
                    result.riskScore += 15;
                    result.risks.push(`Hidden iframes (${pageInfo.hiddenIframeCount})`);
                }
                result.riskScore = Math.min(100, result.riskScore);
                if (result.riskScore >= 60) result.level = 'danger';
                else if (result.riskScore >= 30) result.level = 'warning';
                else result.level = 'safe';
                result.safe = result.riskScore < 30;
            }

            renderPhishing(result);
        } catch (err) {
            renderPhishing({ safe: true, level: 'safe', riskScore: 0, risks: [], error: err.message });
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
            danger: 'High Phishing Risk!'
        };
        phishingStatus.textContent = labels[level] || 'Unknown';

        // Risk score
        riskText.textContent = score > 0 ? `${score}% risk` : 'Safe';
        if (score === 0 && level === 'safe') riskText.textContent = 'Safe';

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

    function escapeHtml(str) {
        const d = document.createElement('div');
        d.appendChild(document.createTextNode(str));
        return d.innerHTML;
    }

    // ───────────────────────────────────────────
    // Speed Test
    // ───────────────────────────────────────────
    async function runSpeedTest() {
        runSpeedBtn.disabled = true;
        speedIdle.style.display = 'none';
        speedMetrics.classList.remove('visible');
        speedLoading.style.display = 'flex';

        try {
            const result = await chrome.runtime.sendMessage({ type: 'RUN_SPEED_TEST' });

            speedLoading.style.display = 'none';

            if (result && result.success) {
                const downloadMbps = parseFloat(result.download);
                const ping = parseInt(result.ping);

                downloadValue.textContent = downloadMbps;
                pingValue.textContent = ping;

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
            } else {
                speedIdle.style.display = 'flex';
                showToast('Speed test failed. Try again.');
            }
        } catch (err) {
            speedLoading.style.display = 'none';
            speedIdle.style.display = 'flex';
            showToast('Speed test unavailable.');
        } finally {
            runSpeedBtn.disabled = false;
        }
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

        await Promise.all([loadNetworkInfo(), checkCurrentSite()]);

        setTimeout(() => refreshBtn.classList.remove('spinning'), 600);
    });

    // Speed test button
    runSpeedBtn.addEventListener('click', runSpeedTest);

    // ───────────────────────────────────────────
    // Init
    // ───────────────────────────────────────────
    setStatus('loading', 'Connecting...');
    await Promise.all([loadNetworkInfo(), checkCurrentSite()]);
});
