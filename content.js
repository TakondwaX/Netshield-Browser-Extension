// NetShield Content Script
// Analyzes the current page for phishing signals

(function () {
    // Only run once
    if (window.__netshieldInjected) return;
    window.__netshieldInjected = true;

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'GET_PAGE_INFO') {
            const info = analyzePage();
            sendResponse(info);
        }
        return true;
    });

    function analyzePage() {
        const forms = Array.from(document.querySelectorAll('form'));
        const passwordFields = Array.from(document.querySelectorAll('input[type="password"]'));
        const externalLinks = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => {
                try {
                    return new URL(a.href).hostname !== window.location.hostname;
                } catch (e) { return false; }
            });

        const hasLoginForm = passwordFields.length > 0;
        const formCount = forms.length;
        const externalLinkCount = externalLinks.length;

        const externalFormActionCount = forms.filter(form => {
            const action = form.getAttribute('action');
            if (!action) return false;
            try {
                const actionUrl = new URL(action, window.location.href);
                return actionUrl.hostname !== window.location.hostname;
            } catch (e) {
                return false;
            }
        }).length;

        // Check for hidden iframes
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const hiddenIframes = iframes.filter(f => {
            const style = window.getComputedStyle(f);
            return style.display === 'none' || style.visibility === 'hidden' || f.width === '0' || f.height === '0';
        });

        const mixedContentCount = window.location.protocol === 'https:' ? Array.from(
            document.querySelectorAll('img[src], script[src], link[href], iframe[src]')
        ).filter(el => {
            const url = el.getAttribute('src') || el.getAttribute('href');
            return url && url.startsWith('http://');
        }).length : 0;

        const title = document.title || '';
        const metaDescription = document.querySelector('meta[name="description"]')?.content || '';
        const suspiciousKeywordMatch = /(login|verify|account|secure|password|signin|bank|wallet)/i
            .test(`${title} ${metaDescription}`);

        // Check for favicon mismatch (basic brand spoofing check)
        const favicon = document.querySelector('link[rel*="icon"]');
        const faviconHref = favicon ? favicon.href : '';

        return {
            title,
            url: window.location.href,
            hasLoginForm,
            formCount,
            externalLinkCount,
            externalFormActionCount,
            passwordFieldCount: passwordFields.length,
            hiddenIframeCount: hiddenIframes.length,
            mixedContentCount,
            suspiciousKeywordMatch,
            faviconHref,
            metaDescription
        };
    }
})();
