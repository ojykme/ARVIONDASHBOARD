let imageData = [];
let devtoolsTabId=-1;
let imageDataMap = new Map(); // devtoolsTabId를 키로, imageData 배열을 값으로 저장하는 Map

function logNetworkEvent(event, details, extra = {}) {
  let url = details?.url || "N/A";
  try {
    const parsed = new URL(url);
    url = `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    // URL 파싱 실패 시에도 requestId와 이벤트는 남긴다.
  }

  console.debug(`[ARVION][${event}]`, {
    requestId: details?.requestId || "N/A",
    tabId: details?.tabId ?? "N/A",
    type: details?.type || "N/A",
    initiator: details?.initiator || "N/A",
    url,
    ...extra,
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

// Reserve a distinct ID before either concurrent preview request awaits rule creation.
let nextPreviewRuleId = 1000;

async function fetchPreviewResource(url) {
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (error) {
    throw new Error("Invalid preview URL");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Preview URL must use http or https");
  }

  const ruleId = nextPreviewRuleId++;
  const allowRule = {
    id: ruleId,
    priority: 100,
    action: { type: "allow" },
    condition: {
      requestDomains: [parsedUrl.hostname],
      tabIds: [chrome.tabs.TAB_ID_NONE],
      resourceTypes: ["xmlhttprequest"],
    },
  };

  await updatePreviewRule({ addRules: [allowRule], removeRuleIds: [ruleId] });
  console.debug("[ARVION][preview:rule]", {
    action: "allow",
    ruleId,
    requestDomain: parsedUrl.hostname,
    resourceType: "xmlhttprequest",
    tabId: chrome.tabs.TAB_ID_NONE,
  });

  try {
    const response = await fetch(parsedUrl.href, { redirect: "follow" });
    const buffer = await response.arrayBuffer();
    const contentType = response.headers.get("content-type") || "application/octet-stream";

    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      redirected: response.redirected,
      finalUrl: response.url,
      contentType,
      contentLength: response.headers.get("content-length") || "N/A",
      size: buffer.byteLength,
      dataUrl: `data:${contentType};base64,${arrayBufferToBase64(buffer)}`,
    };
  } finally {
    await updatePreviewRule({ addRules: [], removeRuleIds: [ruleId] });
    console.debug("[ARVION][preview:rule]", { action: "remove", ruleId });
  }
}

function updatePreviewRule(options) {
  return new Promise((resolve, reject) => {
    chrome.declarativeNetRequest.updateSessionRules(options, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve();
    });
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {
      case "fetchPreview":
          fetchPreviewResource(message.url)
              .then(sendResponse)
              .catch(error => sendResponse({
                  ok: false,
                  error: error?.name || "Error",
                  message: error?.message || String(error),
              }));
          return true;
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

// Capture response headers before long-running video/Range transfers complete.
chrome.webRequest.onResponseStarted.addListener((details) => {
  let targetTabId = details.tabId;

  if (details.initiator?.startsWith("chrome-extension://") || details.type === "image" || details.type === "media") {
    const headers = details.responseHeaders || [];
    const headerObj = {};
    headers.forEach(header => headerObj[header.name.toLowerCase()] = header.value);
    logNetworkEvent("completed", details, {
      statusCode: details.statusCode ?? "N/A",
      contentType: headerObj["content-type"] || "N/A",
      contentLength: headerObj["content-length"] || "N/A",
      originalDomain: headerObj["x-original-domain"] || "N/A",
      arvionVersion: headerObj["x-arvionstream-version"] || "N/A",
    });
  }

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


  const contentType = (headerObj["content-type"] || "").toLowerCase();
  const cacheStatus = headerObj["x-arvion-cache"] || headerObj["x-cache"] || headerObj["x-cache-status"] || "N/A";
  const hasArvionMetadata = Boolean(
    headerObj["x-arvion-cache"] ||
    headerObj["x-arvion-job-id"] ||
    headerObj["x-original-size"]
  );
  if (!headerObj["x-arvionstream-version"] && !headerObj["x-image-processed"] && !hasArvionMetadata) return;
  const isMediaResource = details.type === "image" || details.type === "media" || /^image\//.test(contentType) || /^video\//.test(contentType);
  if (!isMediaResource && !hasArvionMetadata) return;

  // 원본 도메인/URL 재구성
  // 원본 도메인 헤더가 없는 bypass 응답도 미리보기 가능하도록 요청 URL을 fallback으로 사용한다.
  let originUrl = details.url;
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

  const isVideo = /^video\//.test(contentType) || /\.(mp4|webm|mov|m4v|ogv)(?:[?#]|$)/i.test(details.url);
  const rangeTotal = /^bytes\s+\d+-\d+\/(\d+)$/i.exec(headerObj["content-range"] || "")?.[1];
  const resourceSize = rangeTotal || headerObj["content-length"] || "N/A";
  const entry = {
      url: details.url,
      contentType: headerObj["content-type"] || "unknown",
      originalSize: headerObj["x-original-size"] || headerObj["x-original-content-length"] || resourceSize,
      compressedSize: headerObj["x-output-size"] || resourceSize,
      compressionRatio: headerObj["x-compression-ratio"] || "N/A",
      processingTime: headerObj["x-processing-time"] || "N/A",
      originalFormat: headerObj["x-original-format"] || (headerObj["content-type"] ? headerObj["content-type"].split("/")[1] : "unknown"),
      convertedFormat: headerObj["x-output-format"] || headerObj["x-image-format"] || (headerObj["content-type"] ? headerObj["content-type"].split("/")[1] : "unknown"),
      originUrl,
      originalDomain: originalDomain || "N/A",
      streamVersion: headerObj["x-arvionstream-version"] || "N/A",
      // HIT-S3는 비동기 저장이 완료된 결과를 S3 캐시에서 제공한 상태다.
      // 서버가 보낸 캐시 상태 문자열을 축약하거나 정규화하지 않고 그대로 전달한다.
      cacheStatus,
      jobId: headerObj["x-arvion-job-id"] || "N/A",
      cacheControl: headerObj["cache-control"] || "N/A",
  };

  // Range/seek requests describe the same video, not additional full files.
  // Keep distinct response states and representations (including queued responses).
  const videoKey = isVideo ? JSON.stringify([
    entry.url, entry.originUrl, entry.cacheStatus, entry.originalSize,
    entry.compressedSize, entry.originalFormat, entry.convertedFormat,
    headerObj["etag"] || headerObj["last-modified"] || "",
  ]) : null;
  const previousIndex = videoKey === null ? -1 : imageData.findIndex(row => row.videoKey === videoKey);
  if (previousIndex >= 0) {
    imageData[previousIndex] = { ...entry, videoKey, requestCount: (imageData[previousIndex].requestCount || 1) + 1 };
  } else {
    imageData.push({ ...entry, ...(isVideo ? { videoKey, requestCount: 1 } : {}) });
  }

  if (imageData.length > 1000) {
      imageData.shift();
  }

  imageDataMap.set(targetTabId, imageData);
  chrome.runtime.sendMessage({ type: "newData", data: imageData, tabId: targetTabId }, () => void chrome.runtime.lastError);

}, { urls: ["<all_urls>"] }, ["responseHeaders"]);

// webNavigation.onCommitted: F5 새로고침, URL 이동 모두 정확히 감지
// frameId === 0 = 메인 프레임만 (iframe, 이미지 등 서브리소스 이벤트 제외)
chrome.webRequest.onBeforeRedirect.addListener((details) => {
  let redirectUrl = details.redirectUrl || "N/A";
  try {
    const parsed = new URL(redirectUrl);
    redirectUrl = `${parsed.origin}${parsed.pathname}`;
  } catch (error) {
    // Keep the source request log even if redirectUrl is malformed.
  }

  logNetworkEvent("redirect", details, {
    redirectUrl,
    statusCode: details.statusCode ?? "N/A",
    responseHeaders: details.responseHeaders?.filter((header) =>
      ["location", "content-type", "x-original-domain"].includes(header.name.toLowerCase())
    ) || [],
  });
}, { urls: ["<all_urls>"] });

chrome.webRequest.onErrorOccurred.addListener((details) => {
  if (details.type !== "image" && details.type !== "media" && !details.initiator?.startsWith("chrome-extension://")) return;
  logNetworkEvent("error", details, { error: details.error || "N/A" });
}, { urls: ["<all_urls>"] });

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
                // DevTools 미리보기는 chrome-extension:// initiator로 원본을
                // 직접 요청해야 하므로 B2B redirect를 재적용하지 않는다.
                // 일반 고객 페이지에서 발생한 요청에는 기존 redirect를 유지한다.
                excludedInitiatorDomains: [chrome.runtime.id],
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
