document.addEventListener("DOMContentLoaded", () => {
    const demoToggle = document.getElementById("demoToggle");
    const domainFrom = document.getElementById("domainFrom");
    const domainTo = document.getElementById("domainTo");
    const btnAdd = document.getElementById("btnAdd");
    const mappingList = document.getElementById("mappingList");

    let mappings = [];
    let isDemoMode = false;

    chrome.storage.local.get(["demoModeEnabled", "domainMappings"], (result) => {
        isDemoMode = result.demoModeEnabled === true;
        mappings = Array.isArray(result.domainMappings) ? result.domainMappings : [];

        demoToggle.checked = isDemoMode;
        renderMappings();
    });

    demoToggle.addEventListener("change", () => {
        isDemoMode = demoToggle.checked;
        chrome.storage.local.set({ demoModeEnabled: isDemoMode });
    });

    btnAdd.addEventListener("click", () => {
        const fromVal = domainFrom.value.trim().toLowerCase();
        const toVal = domainTo.value.trim().toLowerCase();

        if (!isValidHostname(fromVal) || !isValidHostname(toVal)) {
            alert("원본 도메인과 대상 도메인을 올바른 hostname 형식으로 입력해 주세요.");
            return;
        }

        if (mappings.some((mapping) => mapping.from === fromVal)) {
            alert("이미 등록된 원본 도메인입니다.");
            return;
        }

        mappings.push({ from: fromVal, to: toVal });
        chrome.storage.local.set({ domainMappings: mappings }, () => {
            if (chrome.runtime.lastError) {
                alert("도메인 매핑 저장에 실패했습니다.");
                return;
            }

            domainFrom.value = "";
            domainTo.value = "";
            renderMappings();
        });
    });

    function isValidHostname(value) {
        if (!value || value.length > 253 || /[\s/?#:@]/.test(value)) return false;

        try {
            const hostname = new URL(`https://${value}`).hostname;
            return hostname === value && hostname.includes(".");
        } catch (error) {
            return false;
        }
    }

    function deleteMapping(index) {
        if (!Number.isInteger(index) || index < 0 || index >= mappings.length) return;

        mappings.splice(index, 1);
        chrome.storage.local.set({ domainMappings: mappings }, () => {
            if (chrome.runtime.lastError) {
                alert("도메인 매핑 삭제에 실패했습니다.");
                return;
            }

            renderMappings();
        });
    }

    function renderMappings() {
        mappingList.replaceChildren();

        if (mappings.length === 0) {
            const emptyState = document.createElement("div");
            emptyState.className = "empty-state";
            emptyState.textContent = "등록된 도메인이 없습니다.";
            mappingList.appendChild(emptyState);
            return;
        }

        mappings.forEach((mapping, index) => {
            const item = document.createElement("div");
            item.className = "mapping-item";

            const info = document.createElement("div");
            info.className = "mapping-info";

            const from = document.createElement("div");
            from.className = "domain-from";
            from.textContent = mapping.from;

            const arrow = document.createElement("div");
            arrow.className = "arrow";
            arrow.textContent = "→";

            const to = document.createElement("div");
            to.className = "domain-to";
            to.textContent = mapping.to;

            info.append(from, arrow, to);

            const deleteButton = document.createElement("button");
            deleteButton.type = "button";
            deleteButton.className = "btn-delete";
            deleteButton.title = "삭제";
            deleteButton.setAttribute("aria-label", `${mapping.from} 매핑 삭제`);
            deleteButton.addEventListener("click", () => deleteMapping(index));
            deleteButton.innerHTML = `
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                </svg>
            `;

            item.append(info, deleteButton);
            mappingList.appendChild(item);
        });
    }
});
