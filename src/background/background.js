let imageData = [];
let devtoolsTabId=-1;
let imageDataMap = new Map(); // devtoolsTabId를 키로, imageData 배열을 값으로 저장하는 Map

chrome.runtime.onMessage.addListener((message) => {
  switch (message.type) {
      case "devtoolsTabId":
          imageDataMap.set(message.tabId, []); // 새 탭 ID에 대한 빈 배열 생성
          devtoolsTabId = message.tabId; // devtoolsTabId 업데이트 (필요한 경우)
          break;
      case "devtoolsClosed":
          imageDataMap.delete(message.tabId); // 탭 ID에 해당하는 데이터 삭제
          // devtoolsTabId = -1; // 필요 없음
          break;
      case "devtoolsOpened":
          console.log("DevTools opened for Tab ID:", message.tabId);
          break;
      default:
          console.warn("Unknown message type:", message.type);
          break;
  }

});
/*chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "loading" && tab.active) {
        imageData = [];
        chrome.runtime.sendMessage({ type: "newData", data: imageData });
    }
});*/

chrome.webRequest.onCompleted.addListener((details) => {
  if (!imageDataMap.has(details.tabId) || details.tabId === -1) return;

  const headers = details.responseHeaders || [];
  const headerObj = {};
  headers.forEach(header => headerObj[header.name.toLowerCase()] = header.value);

  // x-arvionstream-version 헤더가 있어야만 분석 대상
  if (!headerObj["x-arvionstream-version"]) return;

  const contentType = (headerObj["content-type"] || "").toLowerCase();
  const isMediaResource = details.type === "image" || details.type === "media" || /^image\//.test(contentType) || /^video\//.test(contentType);
  if (!isMediaResource) return;

  // 원본 도메인/URL 재구성
  let originUrl = "N/A";
  const originalDomain = headerObj["x-original-domain"];
  if (originalDomain) {
      try {
          const urlObj = new URL(details.url);
          if (/^https?:\/\//i.test(originalDomain)) {
              originUrl = originalDomain;
          } else {
              originUrl = `${urlObj.protocol}//${originalDomain}${urlObj.pathname}${urlObj.search}`;
          }
      } catch (e) {
          originUrl = originalDomain;
      }
  }

  let imageData = imageDataMap.get(details.tabId) || [];

  imageData.push({
      url: details.url,
      contentType: headerObj["content-type"] || "unknown",
      originalSize: headerObj["x-original-size"] || headerObj["x-original-content-length"] || headerObj["content-length"] || headerObj["content-range"] || "N/A",
      compressedSize: headerObj["x-output-size"] || headerObj["content-length"] || "N/A",
      compressionRatio: headerObj["x-compression-ratio"] || "N/A",
      processingTime: headerObj["x-processing-time"] || "N/A",
      originalFormat: headerObj["x-original-format"] || (headerObj["content-type"] ? headerObj["content-type"].split("/")[1] : "unknown"),
      convertedFormat: headerObj["x-output-format"] || headerObj["x-image-format"] || (headerObj["content-type"] ? headerObj["content-type"].split("/")[1] : "unknown"),
      originUrl,
      originalDomain: originalDomain || "N/A",
      streamVersion: headerObj["x-arvionstream-version"] || "N/A",
      cacheStatus: headerObj["x-cache"] || headerObj["x-cache-status"] || "N/A",
  });

  if (imageData.length > 1000) {
      imageData.shift();
  }

  imageDataMap.set(details.tabId, imageData);
  chrome.runtime.sendMessage({ type: "newData", data: imageData, tabId: details.tabId }, () => void chrome.runtime.lastError);

}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading') { // 페이지 로딩 시작 시
      imageDataMap.set(tabId, []); // 탭 ID에 해당하는 imageData 초기화
//      chrome.runtime.sendMessage({ type: "newData", data: [], tabId: tabId });
      chrome.runtime.sendMessage({ type: "resetTable", tabId }, () => void chrome.runtime.lastError);

  }
});


const DEBUG_RULE_ID = 1;
const ARVION_RULE_ID = 2;

// 항상 Arvion 헤더를 추가하는 규칙
function ensureArvionHeader() {
    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [
            {
                id: ARVION_RULE_ID,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    requestHeaders: [
                        {
                            header: "arvion",
                            operation: "set",
                            value: "1"
                        }
                    ]
                }, 
                condition: {
                    urlFilter: "*",
                    resourceTypes: ["image", "script", "stylesheet", "xmlhttprequest", "other"]
                }
            }
        ],
        removeRuleIds: [ARVION_RULE_ID]
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error setting Arvion header rule:", chrome.runtime.lastError);
        } else {
            console.log("Arvion header rule enabled.");
        }
    });
}

// 디버그 규칙 추가
function enableDebugMode() {
    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [
            {
                id: DEBUG_RULE_ID,
                priority: 1,
                action: {
                    type: "modifyHeaders",
                    requestHeaders: [
                        {
                            header: "X-FlextStream",
                            operation: "set",
                            value: "debug"
                        }
                    ]
                },
                condition: {
                    urlFilter: "*",
                    resourceTypes: ["image", "script", "stylesheet", "xmlhttprequest"] // 여기를 수정
                }
            }
        ],
        removeRuleIds: [DEBUG_RULE_ID]
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error enabling debug mode:", chrome.runtime.lastError);
        } else {
            console.log("Debug mode enabled.");
        }
    });
}

// 디버그 규칙 제거
function disableDebugMode() {
    chrome.declarativeNetRequest.updateDynamicRules({
        addRules: [],
        removeRuleIds: [DEBUG_RULE_ID]
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error disabling debug mode:", chrome.runtime.lastError);
        } else {
            console.log("Debug mode disabled.");
        }
    });
}

// 디버깅 모드 상태 변경 감지
chrome.storage.onChanged.addListener((changes) => {
    if (changes.debugMode) {
        if (changes.debugMode.newValue) {
            enableDebugMode();
        } else {
            disableDebugMode();
        }
    }
});

// 확장 시작 시 Arvion 헤더 규칙을 항상 적용
ensureArvionHeader();
