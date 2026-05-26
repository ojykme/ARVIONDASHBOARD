document.addEventListener("DOMContentLoaded", () => {
  const tableBody = document.querySelector("#data-table tbody");
  const statsContainer = document.getElementById("statsContainer");
  const filterButtons = Array.from(document.querySelectorAll(".filter-btn"));
  const refreshButton = document.getElementById("refreshButton");
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

  function formatBytes(value) {
    const bytes = Number(value);
    if (!Number.isFinite(bytes) || bytes <= 0) return "N/A";
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
    return cleaned || "N/A";
  }

  function getShortenedUrl(url) {
    if (!url) return "N/A";
    const max = 70;
    return url.length > max ? `${url.slice(0, max)}…` : url;
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
    toast.textContent = message;
    toast.classList.add("visible");
    clearTimeout(showToast.timeout);
    showToast.timeout = setTimeout(() => {
      toast.classList.remove("visible");
    }, 2500);
  }

  function renderStats(items) {
    const rows = items.length;
    const originalTotal = items.reduce((acc, item) => acc + (Number(item.originalSize) || 0), 0);
    const compressedTotal = items.reduce((acc, item) => acc + (Number(item.compressedSize) || 0), 0);
    const hits = items.filter(item => String(item.cacheStatus || item.cache || item.status || item.state || "").toLowerCase().includes("hit")).length;
    const hitRate = rows ? `${Math.round((hits / rows) * 100)}%` : "N/A";
    const savings = originalTotal > 0 ? Math.max(0, (1 - compressedTotal / originalTotal) * 100) : 0;
    const savedBandwidth = originalTotal > 0 ? originalTotal - compressedTotal : 0;

    statsContainer.innerHTML = `
      <div class="stat-card">
        <span class="stat-title">요청 건수</span>
        <strong>${rows.toLocaleString()}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-title">오리진 이미지 총 사이즈</span>
        <strong>${formatBytes(originalTotal)}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-title">평균 절감율</span>
        <strong>${rows ? `${savings.toFixed(1)}%` : "N/A"}</strong>
      </div>
      <div class="stat-card">
        <span class="stat-title">총 절감 대역폭</span>
        <strong>${formatBytes(savedBandwidth)}</strong>
      </div>
    `;
  }

  function renderTable(items) {
    tableBody.innerHTML = "";
    const rows = sortData(getFilteredData(items));

    rows.forEach((item, index) => {
      const row = tableBody.insertRow();
      row.dataset.index = index;
      row.dataset.url = item.url || "";

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
        <td class="num">${formatBytes(originalSize)}</td>
        <td class="num">${formatBytes(compressedSize)}</td>
        <td class="num"><span class="${savings >= 0 ? "positive" : "negative"}">${savings !== null ? `${savings.toFixed(1)}%` : "N/A"}</span></td>
        <td class="num">${formatTime(item.processingTime)}</td>
        <td>${normalizeFormat(item.originalFormat)}</td>
        <td>${convertedFormat}</td>
        <td><span class="${statusClass}">${normalizedStatus.toUpperCase()}</span></td>
      `;
    });
  }

  function createChart(items) {
    const filtered = getFilteredData(items).slice(0, 24);
    const labels = filtered.map(item => extractFilename(item.url));
    const originalSizes = filtered.map(item => Number(item.originalSize) || 0);
    const compressedSizes = filtered.map(item => Number(item.compressedSize) || 0);

    const data = {
      labels,
      datasets: [
        {
          label: "원본 사이즈",
          data: originalSizes,
          backgroundColor: "rgba(37, 99, 235, 0.65)",
          borderColor: "rgba(37, 99, 235, 1)",
          borderWidth: 1,
          borderRadius: 6,
        },
        {
          label: "압축 사이즈",
          data: compressedSizes,
          backgroundColor: "rgba(16, 185, 129, 0.65)",
          borderColor: "rgba(16, 185, 129, 1)",
          borderWidth: 1,
          borderRadius: 6,
        }
      ]
    };

    const options = {
      indexAxis: "y",
      maintainAspectRatio: false,
      responsive: true,
      plugins: {
        legend: {
          position: "bottom",
          labels: { usePointStyle: true, pointStyle: "circle" }
        },
        tooltip: {
          callbacks: {
            label: context => `${context.dataset.label}: ${formatBytes(context.parsed.x)}`
          }
        }
      },
      scales: {
        x: {
          beginAtZero: true,
          ticks: { callback: value => formatBytes(value) },
          grid: { color: "rgba(148, 163, 184, 0.25)" }
        },
        y: { grid: { display: false } }
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

  function buildModalContent(item) {
    const originalUrl = item.originUrl || item.url;
    const compressedUrl = item.url;
    const originalSize = formatBytes(Number(item.originalSize) || 0);
    const compressedSize = formatBytes(Number(item.compressedSize) || 0);

    const savingsPercent = computeSavingsPercent(item.originalSize, item.compressedSize, item.compressionRatio);
    const savingsLabel = savingsPercent !== null ? `${savingsPercent.toFixed(1)}%` : "N/A";
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
          <span class="meta-label">절감율</span>
          <span class="meta-value ${savingsClass}">${savingsLabel}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">원본 크기</span>
          <span class="meta-value">${originalSize}</span>
        </div>
        <div class="meta-item">
          <span class="meta-label">압축 크기</span>
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
            <div class="image-loader"></div>
          </div>
        </div>
        <div class="img-box">
          <div class="img-header">
            <h3>압축 이미지</h3>
            <div class="preview-controls">
              <button class="preview-btn" type="button" data-action="fit">전체 보기</button>
              <button class="preview-btn" type="button" data-action="actual">원본 크기</button>
            </div>
          </div>
          <div class="image-preview">
            <img class="modal-image" src="" alt="Compressed Image Preview" />
            <div class="image-loader"></div>
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

    function clamp() {
      const visibleWidth = previewWrapper.clientWidth;
      const visibleHeight = previewWrapper.clientHeight;
      const imageRect = imageElement.getBoundingClientRect();
      const scaledWidth = imageRect.width * state.scale;
      const scaledHeight = imageRect.height * state.scale;
      const minX = Math.min(0, visibleWidth - scaledWidth);
      const minY = Math.min(0, visibleHeight - scaledHeight);

      state.translateX = Math.max(minX, Math.min(0, state.translateX));
      state.translateY = Math.max(minY, Math.min(0, state.translateY));
    }

    function resetPreview() {
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      updateTransform();
    }

    function fitPreview() {
      imageElement.style.width = "100%";
      imageElement.style.maxWidth = "100%";
      state.displayMode = "fit";
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      updateTransform();
    }

    function actualPreview() {
      imageElement.style.width = "auto";
      imageElement.style.maxWidth = "none";
      state.displayMode = "actual";
      state.scale = 1;
      state.translateX = 0;
      state.translateY = 0;
      updateTransform();
    }

    imageElement.style.transformOrigin = "top left";
    imageElement.style.cursor = "grab";
    imageElement.style.transition = "transform 0.1s ease";

    previewWrapper.addEventListener("wheel", event => {
      if (!imageElement.naturalWidth || !imageElement.naturalHeight) return;
      event.preventDefault();
      const delta = event.deltaY > 0 ? -0.1 : 0.1;
      const prevScale = state.scale;
      state.scale = Math.min(3, Math.max(0.5, state.scale + delta));
      const wrapperRect = previewWrapper.getBoundingClientRect();
      const offsetX = event.clientX - wrapperRect.left;
      const offsetY = event.clientY - wrapperRect.top;
      const ratio = state.scale / prevScale;
      state.translateX = (state.translateX - offsetX) * ratio + offsetX;
      state.translateY = (state.translateY - offsetY) * ratio + offsetY;
      clamp();
      updateTransform();
    }, { passive: false });

    imageElement.addEventListener("pointerdown", event => {
      const imageRect = imageElement.getBoundingClientRect();
      const canDrag = state.scale > 1 || imageRect.width > previewWrapper.clientWidth || imageRect.height > previewWrapper.clientHeight;
      if (!canDrag) return;

      state.dragging = true;
      state.startX = event.clientX;
      state.startY = event.clientY;
      state.originX = state.translateX;
      state.originY = state.translateY;
      imageElement.style.cursor = "grabbing";
      imageElement.setPointerCapture(event.pointerId);
    });

    imageElement.addEventListener("pointermove", event => {
      if (!state.dragging) return;
      event.preventDefault();
      state.translateX = state.originX + (event.clientX - state.startX);
      state.translateY = state.originY + (event.clientY - state.startY);
      clamp();
      updateTransform();
    });

    imageElement.addEventListener("pointerup", () => {
      state.dragging = false;
      imageElement.style.cursor = "grab";
    });

    imageElement.addEventListener("pointercancel", () => {
      state.dragging = false;
      imageElement.style.cursor = "grab";
    });

    imageElement.addEventListener("dblclick", () => {
      if (state.displayMode === "actual") {
        fitPreview();
      } else {
        resetPreview();
      }
    });

    return { fitPreview, actualPreview, resetPreview };
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

        await new Promise(resolve => {
          imageElement.onload = () => {
            if (previewWrapper) previewWrapper.classList.add('loaded');
            if (previewApi) {
              previewApi.fitPreview();
            }
            resolve();
          };
          imageElement.onerror = () => {
            if (previewWrapper) previewWrapper.classList.add('loaded');
            resolve();
          };
          imageElement.src = URL.createObjectURL(blob);
        });
      } catch (error) {
        imageElement.alt = "이미지 로드 실패";
        imageElement.src = "";
        if (previewWrapper) previewWrapper.classList.add('loaded');
      }
    }

    const originalWrapper = originalImg ? originalImg.closest('.image-preview') : null;
    const compressedWrapper = compressedImg ? compressedImg.closest('.image-preview') : null;
    const originalPreview = originalWrapper && originalImg ? initializeImagePreview(originalWrapper, originalImg) : null;
    const compressedPreview = compressedWrapper && compressedImg ? initializeImagePreview(compressedWrapper, compressedImg) : null;

    if (originalWrapper) {
      originalWrapper.querySelectorAll('.preview-btn').forEach(button => {
        button.addEventListener('click', () => {
          const action = button.dataset.action;
          if (action === 'fit' && originalPreview) originalPreview.fitPreview();
          if (action === 'actual' && originalPreview) originalPreview.actualPreview();
        });
      });
    }

    if (compressedWrapper) {
      compressedWrapper.querySelectorAll('.preview-btn').forEach(button => {
        button.addEventListener('click', () => {
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

  tableBody.addEventListener("click", event => {
    const link = event.target.closest("a.url-link");
    if (!link) return;
    event.preventDefault();

    const row = event.target.closest("tr");
    const index = Number(row.dataset.index);
    const item = sortData(getFilteredData(currentData))[index];
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

  filterButtons.forEach(button => {
    button.addEventListener("click", () => {
      currentFilter = button.dataset.filter || "all";
      updateDashboard(currentData, "필터 적용 중...");
    });
  });

  refreshButton.addEventListener("click", () => {
    updateDashboard(currentData, "데이터 새로 고침 중...");
  });

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
        showToast("화면 렌더링 중 오류가 발생했습니다.");
      } finally {
        if (showOverlay) hideLoading();
        if (toastMessage) showToast(toastMessage);
      }
    });
  }

  if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.onMessage) {
    chrome.runtime.onMessage.addListener(message => {
      if (message.type === "newData") {
        updateDashboard(message.data, null, false, "데이터를 모두 불러왔습니다.");
      }
      if (message.type === "resetTable") {
        currentData = [];
        renderTable(currentData);
        renderStats(currentData);
        if (chartInstance) chartInstance.destroy();
      }
    });
  }

  attachSorting();
  updateDashboard([]);
});
