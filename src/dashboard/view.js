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
    const cleaned = format.replace(/^image\//i, "").trim();
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
      const status = String(item.cacheStatus || item.cache || item.status || item.state || "").toLowerCase();
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
    const hits = items.filter(item => String(item.cacheStatus || item.cache || item.status || item.state || "").toLowerCase().includes("hit")).length;
    const hitRate = rows ? `${Math.round((hits / rows) * 100)}%` : "0%";
    const savings = originalTotal > 0 ? Math.max(0, (1 - compressedTotal / originalTotal) * 100) : 0;
    const savedBandwidth = originalTotal > 0 ? Math.max(0, originalTotal - compressedTotal) : 0;

    statsContainer.innerHTML = `
      <div class="stat-card">
        <span class="stat-label">요청 건수 (캐시율)</span>
        <span class="stat-value">${rows.toLocaleString()} 건 <span style="font-size: 0.95rem; color: var(--success); font-weight:700;">(${hitRate})</span></span>
      </div>
      <div class="stat-card">
        <span class="stat-label">오리진 이미지 총 용량</span>
        <span class="stat-value">${formatBytes(originalTotal)}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">평균 용량 절감율</span>
        <span class="stat-value">${rows ? `${savings.toFixed(1)}%` : "0.0%"}</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">누적 절감 전송량</span>
        <span class="stat-value" style="color: var(--success);">${formatBytes(savedBandwidth)} / <span style="font-size: 0.9em; color: var(--text-muted);">${formatBytes(compressedTotal)}</span></span>
      </div>
    `;
  }

  /* ================= 실시간 테이블 렌더링 ================= */
  function renderTable(items) {
    tableBody.innerHTML = "";
    const rows = sortData(getFilteredData(items));

    if (rows.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 48px; color: var(--text-muted); font-weight: 500;">
            실시간 캡처된 이미지 트래픽 리소스가 없습니다.
          </td>
        </tr>
      `;
      return;
    }

    rows.forEach((item, index) => {
      const row = tableBody.insertRow();
      row.dataset.index = index;
      row.dataset.url = item.url || "";
      row.style.cursor = "pointer";

      const originalSize = Number(item.originalSize) || 0;
      const compressedSize = Number(item.compressedSize) || 0;
      const savings = originalSize > 0 ? Math.round((1 - compressedSize / originalSize) * 10000) / 100 : null;
      const convertedFormat = normalizeFormat(item.convertedFormat || item.outputFormat || item.imageFormat || item.targetFormat);
      const status = item.cacheStatus || item.cache || item.status || item.state || "N/A";
      const normalizedStatus = String(status).trim();
      const statusKey = normalizedStatus.toLowerCase();
      
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

      row.innerHTML = `
        <td><a class="url-link" href="${item.url || "#"}" target="_blank" rel="noopener noreferrer">${getShortenedUrl(item.url)}</a></td>
        <td class="num numeric">${formatBytes(originalSize)}</td>
        <td class="num numeric">${formatBytes(compressedSize)}</td>
        <td class="num numeric"><span class="${savings >= 0 ? "savings positive" : "savings negative"}">${savings !== null ? `${savings.toFixed(1)}%` : "0.0%"}</span></td>
        <td class="num numeric">${formatTime(item.processingTime)}</td>
        <td>${normalizeFormat(item.originalFormat)}</td>
        <td>${convertedFormat}</td>
        <td><span class="${statusClass}">${normalizedStatus.toUpperCase()}</span></td>
      `;
    });
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

    return `
      <h2 class="modal-title">이미지 최적화 상세 비교</h2>
      <div class="image-meta">
        <div class="meta-item url-item">
          <span class="meta-label">요청 URL</span>
          <span class="meta-value url-value">${item.url || 'N/A'}</span>
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
            <h3>원본 이미지</h3>
            <div class="preview-controls">
              <button class="preview-btn" type="button" data-action="fit">전체 보기</button>
              <button class="preview-btn" type="button" data-action="actual">원본 크기</button>
            </div>
          </div>
          <div class="image-preview">
            <img class="modal-image" src="" alt="Original Image Preview" />
            <div class="image-loader"><div class="spinner"></div></div>
          </div>
        </div>
        <div class="img-box">
          <div class="img-header">
            <h3>최적화 이미지</h3>
            <div class="preview-controls">
              <button class="preview-btn" type="button" data-action="fit">전체 보기</button>
              <button class="preview-btn" type="button" data-action="actual">원본 크기</button>
            </div>
          </div>
          <div class="image-preview">
            <img class="modal-image" src="" alt="Compressed Image Preview" />
            <div class="image-loader"><div class="spinner"></div></div>
          </div>
        </div>
      </div>
    `;
  }

  function initializeImagePreview(previewWrapper, imageElement) {
    const state = {
      scale: 1,
      translateX: 0,
      translateY: 0,
      dragging: false,
      startX: 0,
      startY: 0,
      originX: 0,
      originY: 0,
      displayMode: "fit"
    };

    function updateTransform() {
      imageElement.style.transform = `translate(${state.translateX}px, ${state.translateY}px) scale(${state.scale})`;
    }

    function resetPreview(triggerSync = true) {
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      imageElement.style.transition = "transform 0.25s ease";
      updateTransform();
      setTimeout(() => { imageElement.style.transition = "none"; }, 250);
      if (triggerSync && onSync) {
        onSync(state.scale, state.translateX, state.translateY);
      }
    }

    function fitPreview(triggerSync = true) {
      imageElement.style.width = "100%";
      imageElement.style.maxWidth = "100%";
      imageElement.style.height = "auto";
      state.displayMode = "fit";
      resetPreview(triggerSync);
    }

    function actualPreview(triggerSync = true) {
      imageElement.style.width = "auto";
      imageElement.style.maxWidth = "none";
      imageElement.style.height = "auto";
      state.displayMode = "actual";
      resetPreview(triggerSync);
    }

    function setSyncState(scale, tx, ty) {
      state.scale = scale;
      state.translateX = tx;
      state.translateY = ty;
      updateTransform();
    }

    imageElement.style.transformOrigin = "center center";
    imageElement.style.cursor = "grab";

    previewWrapper.addEventListener("wheel", event => {
      if (!imageElement.naturalWidth || !imageElement.naturalHeight) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.15 : 0.15;
      const prevScale = state.scale;
      state.scale = Math.min(4, Math.max(0.5, state.scale + delta));

      const ratio = state.scale / prevScale;
      state.translateX *= ratio;
      state.translateY *= ratio;
      
      imageElement.style.transition = "transform 0.1s ease";
      updateTransform();
      if (onSync) {
        onSync(state.scale, state.translateX, state.translateY);
      }
    }, { passive: false });

    imageElement.addEventListener("mousedown", event => {
      event.preventDefault();
      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.originX = state.translateX;
      state.originY = state.translateY;
      imageElement.style.cursor = "grabbing";
    });

    window.addEventListener("mousemove", event => {
      if (!state.dragging) return;
      state.translateX = state.originX + (event.clientX - state.startX);
      state.translateY = state.originY + (event.clientY - state.startY);
      updateTransform();
      if (onSync) {
        onSync(state.scale, state.translateX, state.translateY);
      }
    });

    window.addEventListener("mouseup", () => {
      if (state.dragging) {
        state.dragging = false;
        imageElement.style.cursor = "grab";
      }
    });

    imageElement.addEventListener("dblclick", () => {
      if (state.displayMode === "actual") {
        fitPreview();
      } else {
        actualPreview();
      }
    });

    return { fitPreview, actualPreview, resetPreview, setSyncState };
  }

  async function openPreview(item) {
    modalContent.innerHTML = buildModalContent(item);
    modal.classList.add("open");
    modal.setAttribute("aria-hidden", "false");

    const originalImg = modalContent.querySelectorAll(".modal-image")[0];
    const compressedImg = modalContent.querySelectorAll(".modal-image")[1];
    const originalUrl = item.originUrl || item.url;
    const compressedUrl = item.url;

    async function loadImage(imageElement, src, previewApi) {
      const previewWrapper = imageElement.closest('.image-preview');
      if (previewWrapper) previewWrapper.classList.remove('loaded');

      try {
        const response = await fetch(src, { mode: 'cors' });
        if (!response.ok) throw new Error("Fetch failed");
        const blob = await response.blob();

        const dataUrl = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });

        await new Promise(resolve => {
          imageElement.onload = () => {
            if (previewWrapper) previewWrapper.classList.add('loaded');
            if (previewApi) {
              previewApi.fitPreview(false);
            }
            resolve();
          };
          imageElement.onerror = () => {
            if (previewWrapper) previewWrapper.classList.add('loaded');
            resolve();
          };
          imageElement.src = dataUrl;
        });
      } catch (error) {
        imageElement.alt = "이미지를 직접 불러올 수 없습니다. 우측 URL 링크를 사용하세요.";
        imageElement.src = "";
        if (previewWrapper) previewWrapper.classList.add('loaded');
      }
    }

    const originalWrapper = originalImg ? originalImg.closest('.image-preview') : null;
    const compressedWrapper = compressedImg ? compressedImg.closest('.image-preview') : null;

    let isSyncing = false;

    const originalPreview = originalWrapper && originalImg ? initializeImagePreview(originalWrapper, originalImg, (scale, tx, ty) => {
      if (isSyncing) return;
      isSyncing = true;
      if (compressedPreview) compressedPreview.setSyncState(scale, tx, ty);
      isSyncing = false;
    }) : null;

    const compressedPreview = compressedWrapper && compressedImg ? initializeImagePreview(compressedWrapper, compressedImg, (scale, tx, ty) => {
      if (isSyncing) return;
      isSyncing = true;
      if (originalPreview) originalPreview.setSyncState(scale, tx, ty);
      isSyncing = false;
    }) : null;

    if (originalWrapper) {
      originalWrapper.querySelectorAll('.preview-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = button.dataset.action;
          if (action === 'fit' && originalPreview) originalPreview.fitPreview();
          if (action === 'actual' && originalPreview) originalPreview.actualPreview();
        });
      });
    }

    if (compressedWrapper) {
      compressedWrapper.querySelectorAll('.preview-btn').forEach(button => {
        button.addEventListener('click', (e) => {
          e.stopPropagation();
          const action = button.dataset.action;
          if (action === 'fit' && compressedPreview) compressedPreview.fitPreview();
          if (action === 'actual' && compressedPreview) compressedPreview.actualPreview();
        });
      });
    }

    if (originalImg) await loadImage(originalImg, originalUrl, originalPreview);
    if (compressedImg) await loadImage(compressedImg, compressedUrl, compressedPreview);
  }

  function closePreview() {
    modal.classList.remove("open");
    modal.setAttribute("aria-hidden", "true");
    modalContent.querySelectorAll("img").forEach(img => {
      if (img.src && img.src.startsWith("blob:")) URL.revokeObjectURL(img.src);
    });
    modalContent.innerHTML = "";
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
    if (event.key === "Escape") closePreview();
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
      // 신선한 데이터를 강제로 새로 갱신 요청하기 위해 백그라운드에 메시지 송출 가능
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.sendMessage) {
        chrome.runtime.sendMessage({ type: "refreshRequest" });
      }
      updateDashboard(currentData, "데이터 갱신 중...", true, "화면 정보가 갱신되었습니다.");
    });
  }

  function updateDashboard(items, message = "데이터 로드 중...", showOverlay = true, toastMessage = null) {
    currentData = Array.isArray(items) ? items : [];
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
  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === "newData") {
        updateDashboard(message.data, null, false, "새로운 트래픽이 추가되었습니다.");
      }
      if (message.type === "resetTable") {
        currentData = [];
        renderTable(currentData);
        renderStats(currentData);
        if (chartInstance) {
          chartInstance.destroy();
          chartInstance = null;
        }
      }
    });

    // 최초 로드 시 백그라운드로 기존 데이터 요청
    chrome.runtime.sendMessage({ type: "getInitialData" }, (response) => {
      if (response && response.data) {
        updateDashboard(response.data, null, false);
      }
    });
  }

  attachSorting();
  updateDashboard([]);
});
