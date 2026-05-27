document.addEventListener('DOMContentLoaded', () => {
    const demoToggle = document.getElementById('demoToggle');
    const domainFrom = document.getElementById('domainFrom');
    const domainTo = document.getElementById('domainTo');
    const btnAdd = document.getElementById('btnAdd');
    const mappingList = document.getElementById('mappingList');

    let mappings = [];
    let isDemoMode = false;

    // Load initial state
    chrome.storage.local.get(['demoModeEnabled', 'domainMappings'], (result) => {
        isDemoMode = result.demoModeEnabled || false;
        mappings = result.domainMappings || [];
        
        demoToggle.checked = isDemoMode;
        renderMappings();
    });

    // Toggle demo mode
    demoToggle.addEventListener('change', () => {
        isDemoMode = demoToggle.checked;
        chrome.storage.local.set({ demoModeEnabled: isDemoMode });
    });

    // Add mapping
    btnAdd.addEventListener('click', () => {
        const fromVal = domainFrom.value.trim();
        const toVal = domainTo.value.trim();

        if (!fromVal || !toVal) {
            alert("원본 도메인과 타겟 도메인을 모두 입력해주세요.");
            return;
        }

        // Check duplicates
        if (mappings.find(m => m.from === fromVal)) {
            alert("이미 등록된 원본 도메인입니다.");
            return;
        }

        mappings.push({ from: fromVal, to: toVal });
        chrome.storage.local.set({ domainMappings: mappings }, () => {
            domainFrom.value = '';
            domainTo.value = '';
            renderMappings();
        });
    });

    // Delete mapping
    window.deleteMapping = function(index) {
        mappings.splice(index, 1);
        chrome.storage.local.set({ domainMappings: mappings }, () => {
            renderMappings();
        });
    };

    function renderMappings() {
        mappingList.innerHTML = '';
        
        if (mappings.length === 0) {
            mappingList.innerHTML = '<div class="empty-state">등록된 도메인이 없습니다.</div>';
            return;
        }

        mappings.forEach((m, index) => {
            const item = document.createElement('div');
            item.className = 'mapping-item';
            
            item.innerHTML = `
                <div class="mapping-info">
                    <div class="domain-from">${m.from}</div>
                    <div class="arrow">⬇</div>
                    <div class="domain-to">${m.to}</div>
                </div>
                <button class="btn-delete" onclick="deleteMapping(${index})" title="삭제">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="3 6 5 6 21 6"></polyline>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                        <line x1="10" y1="11" x2="10" y2="17"></line>
                        <line x1="14" y1="11" x2="14" y2="17"></line>
                    </svg>
                </button>
            `;
            mappingList.appendChild(item);
        });
    }
});
