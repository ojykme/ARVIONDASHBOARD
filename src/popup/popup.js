document.addEventListener("DOMContentLoaded", () => {
    const toggle = document.getElementById("debugToggle");

    // 초기 상태 로드
    chrome.storage.local.get("debugMode", (result) => {
        toggle.checked = result.debugMode || false;
    });

    // 토글 상태 변경
    toggle.addEventListener("change", () => {
        const debugMode = toggle.checked;
        chrome.storage.local.set({ debugMode });
        console.log(`Debug Mode: ${debugMode}`);
            // 현재 탭 새로고침
        chrome.tabs.reload(); // 또는 chrome.tabs.update({ url: chrome.tabs.getCurrent().url });

    });
});
