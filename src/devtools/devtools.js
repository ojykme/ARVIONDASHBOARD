chrome.devtools.panels.create(
    "ARVION DASHBOARD",
    "../../icon.png",
    "view.html",
    (panel) => {
        // 패널이 생성될 때 tabId를 background.js로 전송합니다. (한 번만 호출)
        chrome.runtime.sendMessage({ type: "devtoolsTabId", tabId: chrome.devtools.inspectedWindow.tabId });

        panel.onShown.addListener(() => {
            // "devtoolsOpened" 메시지 전송 (기존 코드 유지)
            chrome.runtime.sendMessage({ type: "devtoolsOpened", tabId: chrome.devtools.inspectedWindow.tabId });

            // 불필요한 tabId 전송 제거 - 아래 주석 처리된 부분
            /*
            chrome.devtools.inspectedWindow.tabId.then(tabId => {
                chrome.runtime.sendMessage({ type: "devtoolsTabId", tabId: tabId });
            });
            */
        });


        panel.onHidden.addListener(() => {
            // "devtoolsClosed" 메시지와 tabId 전송
            chrome.runtime.sendMessage({ type: "devtoolsClosed", tabId: chrome.devtools.inspectedWindow.tabId });
        });
    }
);
