document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#data-table tbody");
  const statsContainer = document.getElementById("statsContainer");
  const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
  const refreshButton = document.getElementById("refreshButton");
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  const modal = document.getElementById("imageViewer");
  const modalContent = document.getElementById("modalContent");
  const closeButton = modal.querySelector(".close");
  const loadingOverlay = document.getElementById("loadingOverlay");
  const toast = document.getElementById("toast");
  const chartCanvas = document.getElementById("imageChart");

  let currentFilter = "all";
  let sortColumn = "url";
  let sortDir = "asc";
  let currentData = [];
  let chartInstance = null;
  let previewCleanup = () => {};
  const comparisonModes = new Set(["split", "original", "optimized", "slider"]);
  let preferredComparisonMode = "split";
  let comparisonPreferenceEdited = false;
  const comparisonPreferenceReady = new Promise(resolve => {
    const restore = value => {
      if (!comparisonPreferenceEdited && comparisonModes.has(value)) preferredComparisonMode = value;
      resolve();
    };
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.get(["comparisonMode"], result => {
          restore(chrome.runtime.lastError ? null : result?.comparisonMode);
        });
      } else restore(localStorage.getItem("comparisonMode"));
    } catch { restore(null); }
  });
  function saveComparisonMode(value) {
    if (!comparisonModes.has(value)) return;
    preferredComparisonMode = value;
    comparisonPreferenceEdited = true;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        chrome.storage.local.set({ comparisonMode: value }, () => {
          if (chrome.runtime.lastError) showToast("비교 방식 저장에 실패했습니다. 현재 화면에서는 유지됩니다.");
        });
      } else localStorage.setItem("comparisonMode", value);
    } catch { showToast("비교 방식 저장에 실패했습니다. 현재 화면에서는 유지됩니다."); }
  }
  let pendingData = null;
  let lastReceived = 0;
  let highlightIncoming = false;
  let statsFrame = 0;
  const displayedStats = {};
  let currentTheme = "dark"; // Default Theme

  // SVG Icons
  const SUN_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>`;
  const MOON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>`;

  /* ================= 테마 관리 로직 ================= */
  function applyTheme(theme) {
    currentTheme = theme;
    document.documentElement.setAttribute("data-theme", theme);
    if (themeToggleBtn) {
      themeToggleBtn.innerHTML = theme === "light" ? MOON_SVG : SUN_SVG;
    }
    // 차트 컬러 테마도 실시간 동기화
    if (chartInstance && currentData.length > 0) {
      createChart(currentData);
    }
  }

  function toggleTheme() {
    const nextTheme = currentTheme === "dark" ? "light" : "dark";
    applyTheme(nextTheme);

    // 스토어 규정을 준수하여 chrome.storage.local 우선 사용, 로컬 fallback 마련
    if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ appTheme: nextTheme });
    } else {
      localStorage.setItem("appTheme", nextTheme);
    }
  }

  // 테마 초기화 로드
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get(["appTheme"], (result) => {
      if (result && result.appTheme) {
        applyTheme(result.appTheme);
      } else {
        applyTheme("dark");
      }
    });
  } else {
    const savedTheme = localStorage.getItem("appTheme") || "dark";
    applyTheme(savedTheme);
  }

  if (themeToggleBtn) {
    themeToggleBtn.addEventListener("click", toggleTheme);
  }

  /* ================= 유틸리티 함수 ================= */
  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 Bytes";
    const units = ["Bytes", "KB", "MB", "GB"];
    let index = 0;
    let result = bytes;

    while (result >= 1024 && index < units.length - 1) {
      result /= 1024;
      index += 1;
    }

    return `${result.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${units[index]}`;
  }

  function formatTime(value) {
    const ms = Number(String(value).replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(ms) || ms < 0) return "N/A";

    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const seconds = Math.floor((ms % 60_000) / 1000);
    const milliseconds = Math.floor(ms % 1000);

    const parts = [];
    if (hours) parts.push(`${hours}h`);
    if (minutes) parts.push(`${minutes}m`);
    if (seconds) parts.push(`${seconds}s`);
    if (!parts.length || milliseconds) parts.push(`${milliseconds}ms`);

    return parts.join(" ");
  }

  function normalizeFormat(format) {
    if (!format || typeof format !== "string") return "N/A";
    const cleaned = format.replace(/^(image|video)\//i, "").trim();
    return cleaned.toUpperCase() || "N/A";
  }

  function getShortenedUrl(url) {
    if (!url) return "N/A";
    try {
      const parsed = new URL(url);
      let shortUrl = parsed.pathname + parsed.search;
      const max = 60;
      if (shortUrl.length > max) {
        shortUrl = "…" + shortUrl.slice(-max);
      }
      return shortUrl || "/";
    } catch (error) {
      const max = 60;
      return url.length > max ? `…${url.slice(-max)}` : url;
    }
  }

  function computeSavingsPercent(originalSize, compressedSize, ratioFallback) {
    const original = Number(originalSize);
    const compressed = Number(compressedSize);
    if (Number.isFinite(original) && original > 0 && Number.isFinite(compressed)) {
      return (1 - compressed / original) * 100;
    }

    const ratio = Number(String(ratioFallback).replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(ratio)) {
      return ratio > 1 ? ratio : ratio * 100;
    }

    return null;
  }

  function extractFilename(url) {
    try {
      return new URL(url).pathname.split("/").filter(Boolean).pop() || url;
    } catch (error) {
      return url;
    }
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getSafeExternalUrl(value) {
    try {
      const url = new URL(String(value));
      return /^https?:$/.test(url.protocol) ? url.href : "";
    } catch (error) {
      return "";
    }
  }

  function getLogUrl(value) {
    try {
      const url = new URL(String(value));
      return `${url.origin}${url.pathname}`;
    } catch (error) {
      return "N/A";
    }
  }

  function compareValues(a, b, key) {
    const numericKeys = ["originalSize", "compressedSize", "processingTime"];
    const left = a[key];
    const right = b[key];

    if (numericKeys.includes(key)) {
      return (Number(left) || 0) - (Number(right) || 0);
    }

    return String(left || "").localeCompare(String(right || ""), undefined, { numeric: true });
  }

  function sortData(items) {
    return [...items].sort((a, b) => {
      const comparison = compareValues(a, b, sortColumn);
      return sortDir === "asc" ? comparison : -comparison;
    });
  }

  function getFilteredData(items) {
    return items.filter(item => {
      const status = String(item.cacheStatus ?? "").toLowerCase();
      if (currentFilter === "hit") return status.includes("hit");
      if (currentFilter === "miss") return status.includes("miss");
      return true;
    });
  }

  function renderFilterButtons() {
    filterButtons.forEach(button => {
      button.classList.toggle("active", button.dataset.filter === currentFilter);
    });
  }

  function attachSorting() {
    document.querySelectorAll("#data-table th.sortable").forEach(header => {
      header.addEventListener("click", () => {
        const column = header.dataset.sort;
        if (!column) return;

        if (sortColumn === column) {
          sortDir = sortDir === "asc" ? "desc" : "asc";
        } else {
          sortColumn = column;
          sortDir = "asc";
        }

        document.querySelectorAll("#data-table th.sortable").forEach(th => {
          th.classList.remove("sorted-asc", "sorted-desc");
        });
        header.classList.add(sortDir === "asc" ? "sorted-asc" : "sorted-desc");
        renderTable(currentData);
      });
    });
  }

  function showLoading(message = "데이터 로드 중...") {
    if (!loadingOverlay) return;
    loadingOverlay.querySelector(".loading-message").textContent = message;
    loadingOverlay.classList.add("visible");
    loadingOverlay.setAttribute("aria-hidden", "false");
  }

  function hideLoading() {
    if (!loadingOverlay) return;
    loadingOverlay.classList.remove("visible");
    loadingOverlay.setAttribute("aria-hidden", "true");
  }

  function showToast(message) {
    if (!toast || !message) return;
    toast.querySelector(".toast-text").textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2800);
  }

  /* ================= 통계 카드 렌더링 ================= */
  function renderStats(items) {
    const rows = items.length;
    const originalTotal = items.reduce((acc, item) => acc + (Number(item.originalSize) || 0), 0);
    const compressedTotal = items.reduce((acc, item) => acc + (Number(item.compressedSize) || 0), 0);
    const hits = items.filter(item => String(item.cacheStatus ?? "").toLowerCase().includes("hit")).length;
    const hitRate = rows ? `${Math.round((hits / rows) * 100)}%` : "0%";
    const savings = originalTotal > 0 ? Math.max(0, (1 - compressedTotal / originalTotal) * 100) : 0;
    const savedBandwidth = originalTotal > 0 ? Math.max(0, originalTotal - compressedTotal) : 0;

    if (!statsContainer.children.length) statsContainer.innerHTML = `
      <div class="stat-card"><span class="stat-label">요청 건수 (캐시율)</span><span class="stat-value"><span data-stat="rows"></span> <small data-hit></small></span></div>
      <div class="stat-card"><span class="stat-label">오리진 미디어 총 용량</span>
        <div class="stat-values-row"><span class="stat-value" data-stat="original"></span><span class="stat-saved">절감량 <span data-stat="saved"></span></span></div>
        <div class="savings-meter" role="meter" aria-label="오리진 대비 절감 비율" aria-valuemin="0" aria-valuemax="100"><span></span></div>
      </div>
      <div class="stat-card"><span class="stat-label">평균 용량 절감율</span><span class="stat-value" data-stat="percent"></span></div>
      <div class="stat-card"><span class="stat-label">실제 전송량</span><span class="stat-value" data-stat="actual"></span></div>`;
    statsContainer.querySelector('[data-hit]').textContent = `(${hitRate})`;
    const meter = statsContainer.querySelector('.savings-meter');
    meter.setAttribute('aria-valuenow', savings.toFixed(1));
    meter.title = `실제 전송량 ${formatBytes(compressedTotal)} · 절감량 ${formatBytes(savedBandwidth)}`;
    meter.firstElementChild.style.width = `${savings}%`;
    cancelAnimationFrame(statsFrame);
    const targets = { rows, original: originalTotal, saved: savedBandwidth, percent: savings, actual: compressedTotal };
    const starts = { ...displayedStats };
    const start = performance.now();
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = [...statsContainer.querySelectorAll('[data-stat]')];
    function tick(now) {
      const progress = reduced ? 1 : Math.min(1, (now - start) / 300);
      for (const node of nodes) {
        const key = node.dataset.stat;
        const from = starts[key] ?? targets[key];
        const value = from + (targets[key] - from) * (1 - (1 - progress) ** 3);
        displayedStats[key] = value;
        node.textContent = key === 'percent' ? `${value.toFixed(1)}%` : key === 'rows' ? `${Math.round(value).toLocaleString()} 건` : formatBytes(value);
      }
      if (progress < 1) statsFrame = requestAnimationFrame(tick);
    }
    statsFrame = requestAnimationFrame(tick);
  }

  /* ================= 실시간 테이블 렌더링 ================= */
  function renderTable(items) {
    const existing = new Map([...tableBody.querySelectorAll("tr[data-url]")].map(row => [row.dataset.url, row]));
    const rows = sortData(getFilteredData(items));

    if (rows.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 48px; color: var(--text-muted); font-weight: 500;">
            실시간 캡처된 미디어 트래픽 리소스가 없습니다.
          </td>
        </tr>
      `;
      return;
    }

    if (!existing.size) tableBody.innerHTML = "";
    const retained = new Set();
    rows.forEach((item, index) => {
      const row = existing.get(item.url) || document.createElement("tr");
      retained.add(row);
      if (!existing.has(item.url) && highlightIncoming) row.classList.add("incoming-row");
      if (tableBody.children[index] !== row) tableBody.insertBefore(row, tableBody.children[index] || null);
      row.dataset.index = index;
      row.dataset.url = item.url || "";
      row.style.cursor = "pointer";

      const originalSize = Number(item.originalSize) || 0;
      const compressedSize = Number(item.compressedSize) || 0;
      const savings = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 10000) / 100 : null;
      const convertedFormat = normalizeFormat(item.convertedFormat || item.outputFormat || item.imageFormat || item.targetFormat);
      const statusText = item.cacheStatus ?? "N/A";
      const statusKey = String(statusText).toLowerCase();

      const statusClass = statusKey.includes("hit")
        ? "badge badge-success"
        : statusKey.includes("miss")
          ? "badge badge-danger"
          : statusKey.includes("cache") || statusKey.includes("stored") || statusKey.includes("ok")
            ? "badge badge-info"
            : statusKey.includes("pending") || statusKey.includes("processing") || statusKey.includes("waiting")
              ? "badge badge-warning"
              : statusKey.includes("error") || statusKey.includes("fail") || statusKey.includes("invalid")
                ? "badge badge-alert"
                : "badge badge-neutral";

      const markup = `
        <td><a class="url-link" href="${item.url || "#"}" target="_blank" rel="noopener noreferrer">${getShortenedUrl(item.url)}</a></td>
        <td class="num numeric">${formatBytes(originalSize)}</td>
        <td class="num numeric">${formatBytes(compressedSize)}</td>
        <td class="num numeric"><span class="${savings >= 0 ? "savings positive" : "savings negative"}">${savings !== null ? `${savings.toFixed(1)}%` : "0.0%"}</span></td>
        <td class="num numeric">${formatTime(item.processingTime)}</td>
        <td>${normalizeFormat(item.originalFormat)}</td>
        <td>${convertedFormat}</td>
        <td><span class="${statusClass}">${escapeHtml(statusText)}</span></td>
      `;
      if (row._markup !== markup) { row.innerHTML = markup; row._markup = markup; }
    });
    for (const row of existing.values()) if (!retained.has(row)) row.remove();
    highlightIncoming = false;
  }

  /* ================= 통계 차트(Chart.js) 렌더링 ================= */
  function createChart(items) {
    const filtered = getFilteredData(items).slice(0, 24);
    const labels = filtered.map(item => extractFilename(item.url));
    const originalSizes = filtered.map(item => Number(item.originalSize) || 0);
    const compressedSizes = filtered.map(item => Number(item.compressedSize) || 0);

    // 테마 컬러 변수에 맞게 라벨 컬러 커스터마이즈
    const gridColor = currentTheme === "light" ? "rgba(148, 163, 184, 0.15)" : "rgba(255, 255, 255, 0.08)";
    const labelColor = currentTheme === "light" ? "#475569" : "#94a3b8";

    const data = {
      labels,
      datasets: [
        {
          label: "원본 사이즈",
          data: originalSizes,
          backgroundColor: currentTheme === "light" ? "rgba(37, 99, 235, 0.75)" : "rgba(59, 130, 246, 0.7)",
          borderColor: currentTheme === "light" ? "rgba(37, 99, 235, 1)" : "rgba(59, 130, 246, 1)",
          borderWidth: 1,
          borderRadius: 4,
        },
        {
          label: "최적화 사이즈",
          data: compressedSizes,
          backgroundColor: "rgba(16, 185, 129, 0.75)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 1,
          borderRadius: 4,
        }
      ]
    };

    const options = {
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: {
            usePointStyle: true,
            pointStyle: "circle",
            color: labelColor,
            font: { weight: "600" }
          }
        },
        tooltip: {
          callbacks: {
            label: context => `${context.dataset.label}: ${formatBytes(context.parsed.y)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: labelColor }
        },
        y: {
          beginAtZero: true,
          ticks: {
            callback: value => formatBytes(value),
            color: labelColor
          },
          grid: { color: gridColor }
        }
      }
    };

    if (!chartCanvas) return;
    if (typeof Chart === "undefined") {
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      return;
    }

    if (chartInstance) {
      chartInstance.data = data;
      chartInstance.options = options;
      chartInstance.update();
      return;
    }

    chartInstance = new Chart(chartCanvas, {
      type: "bar",
      data,
      options
    });
  }

  /* ================= 상세 이미지 보기 및 줌 모달 로직 ================= */
  function buildModalContent(item) {
    const originalSize = formatBytes(Number(item.originalSize) || 0);
    const compressedSize = formatBytes(Number(item.compressedSize) || 0);
    const savingsPercent = computeSavingsPercent(item.originalSize, item.compressedSize, item.compressionRatio);
    const savingsLabel = savingsPercent !== null ? `${savingsPercent.toFixed(1)}%` : "0.0%";
    const savingsClass = savingsPercent >= 0 ? "savings positive" : "savings negative";
    const requestedUrl = item.url || "N/A";
    const originUrl = item.originUrl || requestedUrl;
    const safeOriginUrl = getSafeExternalUrl(originUrl);

    const isVideo = String(item.originalFormat).toLowerCase().includes("video") || 
                    String(item.convertedFormat || item.outputFormat || item.imageFormat || item.targetFormat).toLowerCase().includes("video");
    
    let mediaTag = '';
    if (isVideo) {
      mediaTag = `
        <div class="video-placeholder" style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; width:100%; color:var(--text-muted); text-align:center; padding:20px;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-bottom:12px; opacity:0.7;">
            <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"></rect>
            <line x1="7" y1="2" x2="7" y2="22"></line>
            <line x1="17" y1="2" x2="17" y2="22"></line>
            <line x1="2" y1="12" x2="22" y2="12"></line>
            <line x1="2" y1="7" x2="7" y2="7"></line>
            <line x1="2" y1="17" x2="7" y2="17"></line>
            <line x1="17" y1="17" x2="22" y2="17"></line>
            <line x1="17" y1="7" x2="22" y2="7"></line>
          </svg>
          <p style="font-size:0.9rem; margin-bottom:16px;">DevTools 보안 정책으로 인해<br>동영상은 새 탭에서만 재생할 수 있습니다.</p>
          <button class="preview-btn video-open-btn" data-src="" style="padding:10px 20px; background:var(--primary); color:var(--text-inverse); border:none; border-radius:8px; font-weight:700; cursor:pointer;">새 탭에서 동영상 보기</button>
        </div>
      `;
    } else {
      mediaTag = '<img class="modal-image" src="" alt="Preview" />';
    }

    return `
      <h2 class="modal-title" id="previewTitle">미디어 최적화 상세 비교</h2>
      <div class="viewer-toolbar">
        <select aria-label="비교 방식" id="compareMode" ${isVideo ? 'disabled' : ''}>
          <option value="split">좌우 비교</option><option value="original">원본 집중 보기</option>
          <option value="optimized">최적화 집중 보기</option><option value="slider" disabled>슬라이더 (이미지 로드 후 사용)</option>
        </select>
        <button type="button" data-view="fit">화면 맞춤</button>
        <button type="button" data-view="minus" aria-label="축소">−</button>
        <button type="button" data-view="1">100%</button><button type="button" data-view="2">200%</button>
        <button type="button" data-view="4">400%</button><button type="button" data-view="plus" aria-label="확대">+</button>
        <label><input id="syncPreview" type="checkbox" checked> 동기화</label>
        <button type="button" id="toggleInfo" aria-expanded="false">정보 보기</button>
        <button type="button" id="fullscreenPreview">전체화면</button>
      </div>
      <label class="wipe-control" hidden>원본 / 최적화 경계 <input type="range" min="0" max="100" value="50" aria-label="이미지 비교 경계"></label>
      <div class="image-meta">
        <div class="meta-item url-item">
          <span class="meta-label">요청 URL</span>
          <span class="meta-value url-value">${escapeHtml(requestedUrl)}</span>
        </div>
        <div class="meta-item url-item origin-url-item">
          <span class="meta-label">오리진 URL</span>
          <a class="meta-value url-value origin-url-value" href="${escapeHtml(safeOriginUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(originUrl)}</a>
        </div>
        <div class="meta-item">
          <span class="meta-label">원본 포맷</span>
          <span class="meta-value">${normalizeFormat(item.originalFormat)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">변환 포맷</span>
          <span class="meta-value">${normalizeFormat(item.convertedFormat || item.outputFormat || item.imageFormat || item.targetFormat)}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">절감 비율</span>
          <span class="meta-value ${savingsClass}">${savingsLabel}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">원본 크기</span>
          <span class="meta-value">${originalSize}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">최적화 크기</span>
          <span class="meta-value">${compressedSize}</span>
        </div>
      </div>
      <div class="comparison-wrapper">
        <div class="img-box">
          <div class="img-header">
            <h3>원본 ${isVideo ? '동영상' : '이미지'}</h3>
            <div class="preview-controls">
              <button class="preview-btn" type="button" data-action="fit">전체 보기</button>
              <button class="preview-btn" type="button" data-action="actual">원본 크기</button>
            </div>
          </div>
          <div class="image-preview">
            ${mediaTag}
            <div class="preview-error" role="alert" aria-live="polite">
              <strong class="preview-error-title">미리보기를 불러오지 못했습니다.</strong>
              <span class="preview-error-message">오리진 URL을 직접 열어 확인해 주세요.</span>
              <a class="preview-error-link" target="_blank" rel="noopener noreferrer">오리진 URL 열기</a>
            </div>
            <div class="image-loader"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="img-box">
          <div class="img-header">
            <h3>최적화 ${isVideo ? '동영상' : '이미지'}</h3>
            <div class="preview-controls">
              <button class="preview-btn" type="button" data-action="fit">전체 보기</button>
              <button class="preview-btn" type="button" data-action="actual">원본 크기</button>
            </div>
          </div>
          <div class="image-preview">
            ${mediaTag}
            <div class="preview-error" role="alert" aria-live="polite">
              <strong class="preview-error-title">미리보기를 불러오지 못했습니다.</strong>
              <span class="preview-error-message">오리진 URL을 직접 열어 확인해 주세요.</span>
              <a class="preview-error-link" target="_blank" rel="noopener noreferrer">오리진 URL 열기</a>
            </div>
            <div class="image-loader"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;
  }

  function initializeImagePreview(wrapper, image, onSync) {
    const controller = new AbortController();
    const state = { scale: 1, x: 0, y: 0, fit: true };
    let drag = null;
    const badge = document.createElement("output");
    badge.className = "zoom-badge";
    badge.setAttribute("aria-label", "현재 확대 배율");
    wrapper.append(badge);
    function paint(sync = true) {
      image.style.width = `${image.naturalWidth}px`;
      image.style.height = `${image.naturalHeight}px`;
      image.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`;
      badge.textContent = `${Math.round(state.scale * 100)}%`;
      if (sync && onSync) onSync(state.scale, state.x, state.y);
    }
    function fitPreview(sync = true) {
      if (!image.naturalWidth || !wrapper.clientWidth || !wrapper.clientHeight) return;
      state.fit = true;
      state.scale = Math.min(wrapper.clientWidth / image.naturalWidth, wrapper.clientHeight / image.naturalHeight, 1);
      state.x = state.y = 0;
      paint(sync);
    }
    function zoom(scale, x = 0, y = 0) {
      const next = Math.min(16, Math.max(0.01, scale));
      const ratio = next / state.scale;
      state.x = x - (x - state.x) * ratio;
      state.y = y - (y - state.y) * ratio;
      state.scale = next;
      state.fit = false;
      paint();
    }
    function setSyncState(scale, x, y) {
      Object.assign(state, { scale, x, y, fit: false });
      paint(false);
    }
    wrapper.addEventListener("wheel", event => {
      if (!image.naturalWidth) return;
      event.preventDefault();
      const rect = wrapper.getBoundingClientRect();
      zoom(state.scale * (event.deltaY > 0 ? 0.85 : 1 / 0.85), event.clientX - rect.left - rect.width / 2, event.clientY - rect.top - rect.height / 2);
    }, { passive: false, signal: controller.signal });
    wrapper.addEventListener("pointerdown", event => {
      if (event.button !== 0 || event.target.closest("a, button") || !image.naturalWidth) return;
      event.preventDefault();
      wrapper.setPointerCapture(event.pointerId);
      drag = { x: event.clientX, y: event.clientY, tx: state.x, ty: state.y };
    }, { signal: controller.signal });
    wrapper.addEventListener("pointermove", event => {
      if (!drag) return;
      state.x = drag.tx + event.clientX - drag.x;
      state.y = drag.ty + event.clientY - drag.y;
      state.fit = false;
      paint();
    }, { signal: controller.signal });
    for (const name of ["pointerup", "pointercancel", "lostpointercapture"]) {
      wrapper.addEventListener(name, () => { drag = null; }, { signal: controller.signal });
    }
    wrapper.addEventListener("dblclick", () => state.fit ? zoom(1) : fitPreview(), { signal: controller.signal });
    const observer = new ResizeObserver(() => { if (state.fit) fitPreview(false); });
    observer.observe(wrapper);
    return { fitPreview, actualPreview: () => zoom(1), zoom,
      step: factor => zoom(state.scale * factor), setSyncState,
      destroy: () => { controller.abort(); observer.disconnect(); } };
  }

  async function openPreview(item) {
    const previewId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    console.debug("[ARVION][preview:start]", {
      previewId,
      requestedUrl: getLogUrl(item.url),
      originUrl: getLogUrl(item.originUrl || item.url),
      originalFormat: item.originalFormat || "N/A",
      convertedFormat: item.convertedFormat || item.outputFormat || "N/A",
    });
    previewCleanup();
    modalContent.className = "info-collapsed";
    modalContent.innerHTML = buildModalContent(item);
    modalContent.querySelector("#toggleInfo").onclick = event => {
      const collapsed = modalContent.classList.toggle("info-collapsed");
      event.currentTarget.textContent = collapsed ? "정보 보기" : "정보 접기";
      event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
    };
    modalContent.querySelector("#fullscreenPreview").onclick = async () => {
      try {
        if (document.fullscreenElement === modal) await document.exitFullscreen();
        else await modal.requestFullscreen();
      } catch {
        modal.classList.toggle("expanded");
        showToast("브라우저 전체화면을 사용할 수 없어 패널 크기를 전환했습니다.");
      }
    };
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");
    modal.inert = false;
    closeButton.focus();

    const originalImg = modalContent.querySelectorAll(".modal-image")[0];
    const compressedImg = modalContent.querySelectorAll(".modal-image")[1];
    const originalUrl = getSafeExternalUrl(item.originUrl || item.url);
    const compressedUrl = getSafeExternalUrl(item.url);

    function showPreviewError(wrapper, src, message = "오리진 URL을 직접 열어 확인해 주세요.") {
      if (!wrapper) return;
      const errorPanel = wrapper.querySelector(".preview-error");
      const errorLink = wrapper.querySelector(".preview-error-link");
      if (errorPanel) errorPanel.classList.add("visible");
      if (wrapper) wrapper.classList.add("has-error", "loaded");
      if (errorLink && src && src !== "N/A") {
        errorLink.href = src;
        errorLink.textContent = "오리진 URL 열기";
      }
      const messageElement = wrapper.querySelector(".preview-error-message");
      if (messageElement) messageElement.textContent = message;
    }

    const originalWrapper = modalContent.querySelectorAll('.image-preview')[0];
    const compressedWrapper = modalContent.querySelectorAll('.image-preview')[1];
    
    const isVideo = String(item.originalFormat).toLowerCase().includes("video") || 
                    String(item.convertedFormat || item.outputFormat || item.imageFormat || item.targetFormat).toLowerCase().includes("video");

    // 비디오일 경우 처리 로직 (버튼 링크 연결 및 로더 제거)
    if (isVideo) {
      modalContent.querySelectorAll('[data-view], #syncPreview').forEach(control => { control.disabled = true; });
      if (originalWrapper) {
        originalWrapper.classList.add('loaded');
        const btn = originalWrapper.querySelector('.video-open-btn');
        if (btn) btn.onclick = () => window.open(originalUrl, '_blank');
      }
      if (compressedWrapper) {
        compressedWrapper.classList.add('loaded');
        const btn = compressedWrapper.querySelector('.video-open-btn');
        if (btn) btn.onclick = () => window.open(compressedUrl, '_blank');
      }
      // 동영상은 확대/축소 등 이미지 전용 기능을 사용하지 않음
      return;
    }

    async function loadImage(imageElement, src, previewApi) {
      const previewWrapper = imageElement.closest('.image-preview');
      const side = previewWrapper === originalWrapper ? "original" : "optimized";
      console.debug("[ARVION][preview:fetch:start]", {
        previewId,
        side,
        url: getLogUrl(src),
        mode: "cors",
      });
      if (previewWrapper) {
        previewWrapper.classList.remove('loaded', 'has-error');
        previewWrapper.querySelector('.preview-error')?.classList.remove('visible');
        const errorLink = previewWrapper.querySelector('.preview-error-link');
        if (errorLink) errorLink.href = '';
      }

      // DevTools 페이지의 fetch는 오리진의 CORS 정책에 막힐 수 있다.
      // host permission을 가진 확장 서비스 워커에서 가져와 data URL로 전달받는다.
      try {
        const response = await new Promise((resolve, reject) => {
          if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
            reject(new Error("Extension runtime is unavailable"));
            return;
          }

          chrome.runtime.sendMessage({ type: "fetchPreview", url: src }, (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            resolve(result);
          });
        });
        console.debug("[ARVION][preview:fetch:response]", {
          previewId,
          side,
          url: getLogUrl(src),
          status: response?.status ?? "N/A",
          statusText: response?.statusText || "N/A",
          redirected: response?.redirected ?? "N/A",
          finalUrl: getLogUrl(response?.finalUrl),
          contentType: response?.contentType || "N/A",
          contentLength: response?.contentLength || "N/A",
        });
        if (!response?.ok) {
          throw new Error(`Preview fetch failed (${response?.status || "unknown"}): ${response?.message || response?.statusText || "unknown"}`);
        }
        console.debug("[ARVION][preview:blob]", {
          previewId,
          side,
          type: response.contentType || "N/A",
          size: response.size || 0,
        });
        if (!imageElement.isConnected) return;
        const dataUrl = response.dataUrl;

        await new Promise(resolve => {
          let resolved = false;
          const handleLoad = () => {
            if (resolved) return;
            resolved = true;
            if (previewWrapper) previewWrapper.classList.add('loaded');
            if (previewApi) previewApi.fitPreview(false);
            console.debug("[ARVION][preview:image:load]", { previewId, side });
            resolve();
          };

          imageElement.onload = handleLoad;
          imageElement.onerror = (e) => {
            if (resolved) return;
            resolved = true;
            console.warn("[ARVION][preview:image:error]", {
              previewId,
              side,
              url: getLogUrl(src),
              error: e?.message || "image decode failed",
            });
            showPreviewError(previewWrapper, src, "응답이 이미지 형식이 아니거나 브라우저가 오리진 접근을 차단했습니다.");
            resolve();
          };
          
          imageElement.src = dataUrl;
        });
      } catch (error) {
        console.error("[ARVION][preview:fetch:error] " + JSON.stringify({
          previewId,
          side,
          url: getLogUrl(src),
          name: error?.name || "Error",
          message: error?.message || String(error),
        }));
        imageElement.alt = "미디어를 직접 불러올 수 없습니다.";
        imageElement.removeAttribute("src");
        showPreviewError(previewWrapper, src);
      }
    }

    let isSyncing = false;

    const originalPreview = originalWrapper && originalImg ? initializeImagePreview(originalWrapper, originalImg, (scale, tx, ty) => {
      if (isSyncing || !modalContent.querySelector("#syncPreview")?.checked) return;
      isSyncing = true;
      if (compressedPreview) compressedPreview.setSyncState(scale, tx, ty);
      isSyncing = false;
    }) : null;

    const compressedPreview = compressedWrapper && compressedImg ? initializeImagePreview(compressedWrapper, compressedImg, (scale, tx, ty) => {
      if (isSyncing || !modalContent.querySelector("#syncPreview")?.checked) return;
      isSyncing = true;
      if (originalPreview) originalPreview.setSyncState(scale, tx, ty);
      isSyncing = false;
    }) : null;

    const apis = [originalPreview, compressedPreview].filter(Boolean);
    const comparison = modalContent.querySelector(".comparison-wrapper");
    const mode = modalContent.querySelector("#compareMode");
    const sync = modalContent.querySelector("#syncPreview");
    const wipe = modalContent.querySelector(".wipe-control");
    let active = true;
    previewCleanup = () => { active = false; apis.forEach(api => api.destroy()); };
    function fitBoth() { apis.forEach(api => api.fitPreview(false)); }
    let modeSelected = false;
    function applyComparisonMode() {
      comparison.dataset.mode = mode.value;
      wipe.hidden = mode.value !== "slider";
      if (mode.value === "slider") sync.checked = true;
      sync.disabled = mode.value === "slider";
      requestAnimationFrame(fitBoth);
    }
    mode.onchange = () => {
      modeSelected = true;
      saveComparisonMode(mode.value);
      applyComparisonMode();
    };
    wipe.querySelector("input").oninput = event => comparison.style.setProperty("--wipe", `${event.target.value}%`);
    sync.onchange = () => { if (sync.checked) fitBoth(); };
    modalContent.querySelectorAll("[data-view]").forEach(button => {
      button.onclick = () => {
        const target = mode.value === "optimized" ? compressedPreview : originalPreview;
        if (!target) return;
        const action = button.dataset.view;
        if (action === "fit") fitBoth();
        else if (action === "minus") target.step(0.8);
        else if (action === "plus") target.step(1.25);
        else target.zoom(Number(action));
      };
    });
    await Promise.all([
      comparisonPreferenceReady,
      originalImg && loadImage(originalImg, originalUrl, originalPreview),
      compressedImg && loadImage(compressedImg, compressedUrl, compressedPreview),
    ]);
    if (!active) return;
    const sliderOption = mode.querySelector('[value="slider"]');
    const compatible = originalImg?.naturalWidth > 0 && originalImg.naturalWidth === compressedImg?.naturalWidth && originalImg.naturalHeight === compressedImg?.naturalHeight;
    sliderOption.disabled = !compatible;
    sliderOption.textContent = compatible ? "슬라이더 비교" : "슬라이더 (동일 해상도 필요)";
    if (!modeSelected) mode.value = preferredComparisonMode === "slider" && !compatible ? "split" : preferredComparisonMode;
    applyComparisonMode();
  }

  function closePreview() {
    previewCleanup();
    previewCleanup = () => {};
    if (document.fullscreenElement === modal) document.exitFullscreen().catch(() => {});
    modal.classList.remove("expanded");
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modal.inert = true;
    
    // 포커스를 잃게 만들어 에러 방지
    if (document.activeElement && modal.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    
    modalContent.querySelectorAll(".modal-image").forEach(media => {
      if (media.src && media.src.startsWith("blob:")) URL.revokeObjectURL(media.src);
    });
    modalContent.innerHTML = "";
    if (pendingData !== null) {
      const latest = pendingData;
      pendingData = null;
      updateDashboard(latest, null, false);
    }
  }

  // 테이블 행 및 링크 클릭 시 프리뷰 모달 열기
  tableBody.addEventListener("click", event => {
    const link = event.target.closest("a.url-link");
    if (link) {
      event.preventDefault(); // 새 창 열림을 방지하고 모달을 엽니다.
    }

    const row = event.target.closest("tr");
    if (!row || row.dataset.index === undefined) return;

    const index = Number(row.dataset.index);
    const filteredSorted = sortData(getFilteredData(currentData));
    const item = filteredSorted[index];
    if (!item) return;

    openPreview(item);
  });

  closeButton.addEventListener("click", closePreview);
  modal.addEventListener("click", event => {
    if (event.target === modal) closePreview();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !document.fullscreenElement) closePreview();
    if (event.key === "Tab" && modal.classList.contains("open")) {
      const controls = [...modal.querySelectorAll('button:not(:disabled), select:not(:disabled), input:not(:disabled), a[href]')]
        .filter(control => control.getClientRects().length);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });

  /* ================= 필터 및 새로고침 트리거 ================= */
  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter || "all";
      updateDashboard(currentData, "필터 적용 중...");
    });
  });

  if (refreshButton) {
    refreshButton.addEventListener("click", () => {
      try {
        if (typeof chrome !== "undefined" && chrome.runtime?.id) {
          chrome.runtime.sendMessage({ type: "refreshRequest" }, () => void chrome.runtime.lastError);
        }
      } catch (e) {
        // 익스텐션 컨텍스트 무효화 - 개발 중 익스텐션 리로드 시 정상 발생
      }
      updateDashboard(currentData, "데이터 갱신 중...", true, "화면 정보가 갱신되었습니다.");
    });
  }

  function updateDashboard(items, message = "데이터 로드 중...", showOverlay = true, toastMessage = null) {
    currentData = (Array.isArray(items) ? items : []).map(item => {
      let o = Number(item.originalSize) || 0;
      let c = Number(item.compressedSize) || 0;
      
      if (o > 0 && !c) {
        c = o;
      } else if (c > 0 && !o) {
        o = c;
      }
      
      return { ...item, originalSize: o, compressedSize: c };
    });
    if (showOverlay) showLoading(message);

    requestAnimationFrame(() => {
      try {
        renderFilterButtons();
        renderTable(currentData);
        renderStats(getFilteredData(currentData));
        createChart(currentData);
      } catch (error) {
        console.error("Dashboard render error:", error);
        showToast("대시보드 데이터를 그리는 중 오류가 발생했습니다.");
      } finally {
        if (showOverlay) hideLoading();
        if (toastMessage) showToast(toastMessage);
      }
    });
  }

  /* ================= 크롬 백그라운드 연동 ================= */
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.id && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(message => {
        // 현재 인스펙트 중인 탭의 데이터만 수신 (다른 탭에서 발생한 이벤트는 무시)
        if (message.tabId !== chrome.devtools.inspectedWindow.tabId) return;

        if (message.type === "newData") {
          // 미리보기 모달이 열려있는 동안에는 테이블 리렌더 스킵 (깜빡임/데이터 소실 방지)
          lastReceived = Date.now();
          updateReception();
          highlightIncoming = true;
          if (modal && modal.classList.contains("open")) { pendingData = message.data; return; }
          updateDashboard(message.data, null, false);
        }
        if (message.type === "resetTable") {
          pendingData = null;
          lastReceived = 0;
          updateReception();
          currentData = [];
          renderTable(currentData);
          renderStats(currentData);
          if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
          }
        }
      });

      // 최초 로드 시 백그라운드로 기존 데이터 요청 (해당 탭의 데이터만 명시적 요청)
      chrome.runtime.sendMessage({ type: "getInitialData", tabId: chrome.devtools.inspectedWindow.tabId }, (response) => {
        if (chrome.runtime.lastError) return; // 컨텍스트 무효화 시 무시
        if (response && response.data) {
          updateDashboard(response.data, null, false);
        }
      });
    }
  } catch (e) {
    // 익스텐션 컨텍스트 무효화 - 개발 중 리로드 시 정상 발생. DevTools를 재오픈하세요.
    console.warn('[ARVION] Extension context invalidated. DevTools를 닫았다가 다시 열어주세요.');
  }

  const reception = document.createElement("span");
  reception.className = "reception-status";
  document.querySelector(".dashboard-title").append(reception);
  function updateReception() {
    const seconds = Math.floor((Date.now() - lastReceived) / 1000);
    reception.textContent = lastReceived ? `마지막 수신 ${seconds}초 전` : "수신 대기";
    reception.classList.toggle("receiving", !!lastReceived && seconds < 2);
  }
  setInterval(updateReception, 1000);
  updateReception();
  document.addEventListener("fullscreenchange", () => {
    const button = modalContent.querySelector("#fullscreenPreview");
    if (button) button.textContent = document.fullscreenElement === modal ? "전체화면 종료" : "전체화면";
  });
  attachSorting();
  updateDashboard([]);
});
