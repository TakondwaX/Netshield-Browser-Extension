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
        const forms = document.querySelectorAll('form');
        const passwordFields = document.querySelectorAll('input[type="password"]');
        const externalLinks = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => {
                try {
                    return new URL(a.href).hostname !== window.location.hostname;
                } catch (e) { return false; }
            });

        const hasLoginForm = passwordFields.length > 0;
        const formCount = forms.length;
        const externalLinkCount = externalLinks.length;

        // Check for hidden iframes
        const iframes = Array.from(document.querySelectorAll('iframe'));
        const hiddenIframes = iframes.filter(f => {
            const style = window.getComputedStyle(f);
            return style.display === 'none' || style.visibility === 'hidden' || f.width === '0' || f.height === '0';
        });

        // Check for favicon mismatch (basic brand spoofing check)
        const favicon = document.querySelector('link[rel*="icon"]');
        const faviconHref = favicon ? favicon.href : '';

        return {
            title: document.title,
            url: window.location.href,
            hasLoginForm,
            formCount,
            externalLinkCount,
            hiddenIframeCount: hiddenIframes.length,
            faviconHref,
            metaDescription: document.querySelector('meta[name="description"]')?.content || ''
        };
    }
})();
