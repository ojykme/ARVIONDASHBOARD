let imageData = [];
let devtoolsTabId=-1;
let imageDataMap = new Map(); // devtoolsTabId를 키로, imageData 배열을 값으로 저장하는 Map

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
      case "devtoolsTabId":
          // 이미 데이터가 있으면 초기화하지 않음 (재오픈 시 데이터 보존)
          if (!imageDataMap.has(message.tabId)) {
              imageDataMap.set(message.tabId, []);
          }
          devtoolsTabId = message.tabId;
          break;
      case "devtoolsClosed":
          // panel.onHidden은 다른 DevTools 탭으로 이동할 때도 발생하므로
          // 데이터를 삭제하지 않음 → 패널로 돌아왔을 때 데이터 복원
          console.log("[ARVION] DevTools panel hidden (not deleted) for Tab:", message.tabId);
          break;
      case "devtoolsOpened":
          console.log("[ARVION] DevTools opened for Tab ID:", message.tabId);
          break;
      case "getInitialData": {
          // 패널이 재오픈될 때 해당 탭의 기존 데이터 복원
          const tabId = message.tabId;
          const existingData = imageDataMap.get(tabId) || [];
          sendResponse({ data: existingData });
          return true;
      }
      default:
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
  let targetTabId = details.tabId;

  // 동영상(미디어) Range 요청 등 브라우저 백그라운드 페치 시 tabId가 -1로 들어올 수 있음.
  // 이 경우, 모니터링 중인 탭(Map에 등록된 첫 번째 탭)으로 강제 할당하여 대시보드에 표시되게 우회.
  if (targetTabId === -1) {
      if (imageDataMap.size > 0) {
          targetTabId = Array.from(imageDataMap.keys())[0];
      } else {
          targetTabId = "global_media"; // 확장이 새로고침되어 Map이 비어있는 경우 방어코드
      }
  }

  // 익스텐션 자체 페이지(view.html 등)에서 발생한 fetch는 무시 (미리보기 fetch가 데이터를 오염시키는 것 방지)
  if (details.initiator && details.initiator.startsWith('chrome-extension://')) return;

  // 탭 ID가 Map에 없더라도(확장 리로드 등) 에러 없이 초기화하여 데이터 수집을 보장
  if (!imageDataMap.has(targetTabId)) {
      imageDataMap.set(targetTabId, []);
  }

  const headers = details.responseHeaders || [];
  const headerObj = {};
  headers.forEach(header => headerObj[header.name.toLowerCase()] = header.value);

  // x-arvionstream-version 또는 x-image-processed 헤더가 있어야만 분석 대상
  if (!headerObj["x-arvionstream-version"] && !headerObj["x-image-processed"]) return;

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

  let imageData = imageDataMap.get(targetTabId) || [];

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

  imageDataMap.set(targetTabId, imageData);
  chrome.runtime.sendMessage({ type: "newData", data: imageData, tabId: targetTabId }, () => void chrome.runtime.lastError);

}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

// webNavigation.onCommitted: F5 새로고침, URL 이동 모두 정확히 감지
// frameId === 0 = 메인 프레임만 (iframe, 이미지 등 서브리소스 이벤트 제외)
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  const tabId = details.tabId;
  imageDataMap.set(tabId, []); // 해당 탭 데이터 초기화
  chrome.runtime.sendMessage({ type: "resetTable", tabId }, () => void chrome.runtime.lastError);
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

// 디버그 및 데모 모드 상태 변경 감지
chrome.storage.onChanged.addListener((changes) => {
    // 디버그 모드 감지 (이전 호환성)
    if (changes.debugMode) {
        if (changes.debugMode.newValue) {
            enableDebugMode();
        } else {
            disableDebugMode();
        }
    }

    // B2B 데모 매핑 변경 감지
    if (changes.demoModeEnabled || changes.domainMappings) {
        chrome.storage.local.get(['demoModeEnabled', 'domainMappings'], (result) => {
            const isEnabled = result.demoModeEnabled || false;
            const mappings = result.domainMappings || [];
            updateDemoRedirectRules(isEnabled, mappings);
        });
    }
});

function updateDemoRedirectRules(isEnabled, mappings) {
    // 이전 데모 규칙들을 먼저 전부 지움 (ID 10 ~ 100로 예약)
    const oldRuleIds = Array.from({ length: 90 }, (_, i) => i + 10);
    
    if (!isEnabled || mappings.length === 0) {
        chrome.declarativeNetRequest.updateDynamicRules({
            removeRuleIds: oldRuleIds,
            addRules: []
        });
        return;
    }

    const newRules = mappings.map((m, index) => {
        return {
            id: 10 + index, // 고유 ID 할당 (10부터 시작)
            priority: 2,
            action: {
                type: "redirect",
                redirect: {
                    transform: { host: m.to }
                }
            },
            condition: {
                urlFilter: `*://${m.from}/*`,
                resourceTypes: ["main_frame", "sub_frame", "stylesheet", "script", "image", "font", "object", "xmlhttprequest", "media", "websocket", "other"]
            }
        };
    });

    chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: oldRuleIds,
        addRules: newRules
    }, () => {
        if (chrome.runtime.lastError) {
            console.error("Error setting B2B demo rules:", chrome.runtime.lastError);
        } else {
            console.log(`B2B Demo rules updated. Active mappings: ${newRules.length}`);
        }
    });
}

// 확장 시작 시 Arvion 헤더 규칙 및 데모 규칙 초기화
ensureArvionHeader();
chrome.storage.local.get(['demoModeEnabled', 'domainMappings'], (result) => {
    const isEnabled = result.demoModeEnabled || false;
    const mappings = result.domainMappings || [];
    updateDemoRedirectRules(isEnabled, mappings);
});
