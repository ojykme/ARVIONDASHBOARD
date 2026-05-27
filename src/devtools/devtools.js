function safeSendMessage(msg) {
    try {
        if (chrome.runtime?.id) {
            chrome.runtime.sendMessage(msg);
        }
    } catch (e) {
        // 익스텐션이 리로드되면 컨텍스트가 무효화됨 - 정상적인 개발 환경 현상
        console.warn('[ARVION] Extension context invalidated. DevTools를 새로고침 해주세요.', e.message);
    }
}

chrome.devtools.panels.create(
    "ARVION DASHBOARD",
    "../../icon.png",
    "../../view.html",
    (panel) => {
        // 패널이 생성될 때 tabId를 background.js로 전송
        safeSendMessage({ type: "devtoolsTabId", tabId: chrome.devtools.inspectedWindow.tabId });

        panel.onShown.addListener(() => {
            safeSendMessage({ type: "devtoolsOpened", tabId: chrome.devtools.inspectedWindow.tabId });
        });

        panel.onHidden.addListener(() => {
            safeSendMessage({ type: "devtoolsClosed", tabId: chrome.devtools.inspectedWindow.tabId });
        });
    }
);
