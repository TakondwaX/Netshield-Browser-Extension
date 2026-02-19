// NetShield Website — Live Demo & Interactions

document.addEventListener('DOMContentLoaded', () => {
    initSmoothScroll();
    initThemeToggle();
    initNetworkDemo();
    initCopyButton();
    initSpeedTest();
});

function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                e.preventDefault();
                target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
    });
}

async function fetchNetworkInfo() {
    // Try ipwho.is first (CORS enabled)
    try {
        const res = await fetch('https://ipwho.is/', { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.message || 'API error');

        return {
            ip: data.ip || '—',
            isp: data.connection?.isp || data.connection?.org || '—',
            city: data.city || '—',
            country: data.country || '—',
            region: data.region || '—'
        };
    } catch (e1) {
        // Fallback: ipapi.co
        try {
            const res = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            if (data.error) throw new Error(data.reason || 'API error');

            return {
                ip: data.ip || '—',
                isp: data.org || '—',
                city: data.city || '—',
                country: data.country_name || '—',
                region: data.region || '—'
            };
        } catch (e2) {
            throw new Error('Could not fetch network info');
        }
    }
}

function initNetworkDemo() {
    const loading = document.getElementById('demoLoading');
    const content = document.getElementById('demoContent');
    const errorEl = document.getElementById('demoError');

    fetchNetworkInfo()
        .then((data) => {
            loading.style.display = 'none';
            errorEl.style.display = 'none';
            content.style.display = 'block';

            document.getElementById('demoIp').textContent = data.ip;
            document.getElementById('demoIsp').textContent = data.isp;
            document.getElementById('demoLocation').textContent =
                [data.city, data.country].filter(v => v && v !== '—').join(', ') || '—';

            // Update hero mockup
            const mockupIp = document.getElementById('mockupIp');
            const mockupIsp = document.getElementById('mockupIsp');
            const mockupLoc = document.getElementById('mockupLoc');
            if (mockupIp) mockupIp.textContent = data.ip;
            if (mockupIsp) mockupIsp.textContent = data.isp.length > 20 ? data.isp.slice(0, 17) + '…' : data.isp;
            if (mockupLoc) mockupLoc.textContent = [data.city, data.country].filter(v => v && v !== '—').join(', ') || '—';
        })
        .catch(() => {
            loading.style.display = 'none';
            content.style.display = 'none';
            errorEl.style.display = 'block';
        });
}

function initThemeToggle() {
    const toggle = document.getElementById('themeToggle');
    const html = document.documentElement;
    
    // Load saved theme or default to light
    const savedTheme = localStorage.getItem('theme') || 'light';
    html.setAttribute('data-theme', savedTheme);
    
    toggle?.addEventListener('click', () => {
        const currentTheme = html.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        html.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
    });
}

function initCopyButton() {
    const btn = document.getElementById('copyIpDemo');
    const toast = document.getElementById('toast');
    if (!btn) return;

    btn.addEventListener('click', () => {
        const ipEl = document.getElementById('demoIp');
        const ip = ipEl?.textContent;
        if (!ip || ip === '—') return;

        navigator.clipboard.writeText(ip).then(() => {
            toast.textContent = 'IP copied to clipboard!';
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        }).catch(() => {
            toast.textContent = 'Could not copy';
            toast.classList.add('show');
            setTimeout(() => toast.classList.remove('show'), 2000);
        });
    });
}

async function runSpeedTest() {
    const speedEl = document.getElementById('demoSpeed');
    const btn = document.getElementById('runSpeedTest');
    const toast = document.getElementById('toast');
    
    if (!speedEl || !btn) return;
    
    btn.disabled = true;
    speedEl.textContent = 'Testing...';
    
    try {
        // Download test using Cloudflare speed test
        const testUrl = 'https://speed.cloudflare.com/__down?bytes=5000000&t=' + Date.now();
        const startTime = performance.now();
        
        const response = await fetch(testUrl, { cache: 'no-store' });
        const data = await response.arrayBuffer();
        const endTime = performance.now();
        
        const duration = (endTime - startTime) / 1000; // seconds
        const bytesLoaded = data.byteLength;
        const downloadSpeed = ((bytesLoaded * 8) / duration / 1000000).toFixed(2); // Mbps
        
        speedEl.textContent = downloadSpeed + ' Mbps';
        toast.textContent = 'Speed test complete!';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    } catch (err) {
        speedEl.textContent = 'Failed';
        toast.textContent = 'Speed test failed. Try again.';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2000);
    } finally {
        btn.disabled = false;
    }
}

function initSpeedTest() {
    const btn = document.getElementById('runSpeedTest');
    btn?.addEventListener('click', runSpeedTest);
}
