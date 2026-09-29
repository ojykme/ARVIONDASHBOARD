# ARVION BMT Dashboard

> **ARVION CDN** 성능을 고객사 현장에서 즉시 증명하는 **B2B 세일즈 엔지니어용 크롬 익스텐션**

---

## 🚀 핵심 기능

### 1. Zero-Config B2B 데모 모드 (네트워크 리다이렉트)
소스코드 수정 ❌ | DNS 변경 ❌ | 그냥 켜면 됨 ✅

- 익스텐션 팝업에서 **원본 도메인 → ARVION CDN 도메인** 매핑을 즉석으로 등록
- Chrome의 `declarativeNetRequest` API를 이용하여 **네트워크 레벨(통신 단)에서 무손실 리다이렉트**
- 고객사 사이트의 HTML 소스는 단 1줄도 건드리지 않음
- 매핑 저장/삭제, 마스터 ON/OFF 스위치 지원

```
[영업 미팅 현장 시나리오]

기존: "DNS CNAME 돌리고, 소스 수정해야 테스트 가능합니다..."
     → 고객: "너무 복잡해서 못 하겠네요 😓"

ARVION: 익스텐션 팝업 열고 도메인 입력 → 켜기(ON) 클릭 → 고객사 사이트 새로고침
       → 고객: "아무것도 안 건드렸는데 이미지가 이렇게 빨라졌어요?! 😲"
```

### 2. 실시간 트래픽 모니터링 (DevTools 대시보드)
- `F12` DevTools → **ARVION DASHBOARD** 패널에서 확인
- **이미지 / 동영상** 전체 지원 (206 Partial Content Range 요청 포함)
- 원본 사이즈 vs 압축 사이즈 실시간 계산 및 **절감률(%) 표시**
- S3/Edge 캐시 히트 상태, 처리 시간, 버전 정보 한눈에 확인
- 미디어 클릭 시 **내장 뷰어/플레이어로 미리보기**

---

## 🛠 사용 방법

### 배포 ZIP 만들기

고객사 전달용 ZIP은 프로젝트 전체를 직접 압축하지 말고, 아래 스크립트로 만듭니다. 실행에 필요한
확장 프로그램 파일만 담고 테스트, 문서, Git 파일, `.DS_Store`는 제외합니다.

```bash
bash scripts/package-extension.sh
```

생성 결과는 `dist/ARVION-BMT-Dashboard-<version>.zip`입니다. ZIP을 풀면 생기는
`ARVION-BMT-Dashboard-<version>` 폴더가 Chrome에서 선택할 폴더입니다.

Windows PowerShell에서는 다음을 사용합니다.

```powershell
.\scripts\package-extension.ps1
```

### ZIP 설치 방법

1. 전달받은 ZIP의 압축을 풉니다. ZIP 파일 자체는 Chrome에 직접 추가할 수 없습니다.
2. Chrome 주소창에 `chrome://extensions`를 입력합니다.
3. 오른쪽 위의 **개발자 모드**를 켭니다.
4. **압축해제된 확장 프로그램을 로드합니다**를 누릅니다.
5. 압축을 푼 `ARVION-BMT-Dashboard-<version>` 폴더를 선택합니다. `manifest.json`이 바로 보이는 폴더여야 합니다.
6. 퍼즐 메뉴에서 ARVION BMT Dashboard를 고정하고, 아이콘을 눌러 매핑을 추가합니다.

업데이트 때는 새 ZIP을 풀고 `chrome://extensions`에서 기존 확장 프로그램의 **새로고침**을 누르거나,
새로 푼 폴더를 다시 로드합니다. 매핑을 수정한 뒤에는 대상 쇼핑몰 페이지를 새로고침합니다.

### 데모 모드 (트래픽 리다이렉트)
1. 크롬 툴바에서 ARVION 아이콘 클릭
2. **원본 도메인** (고객사) 입력: `img.customer.com`
3. **타겟 도메인** (ARVION CDN) 입력: `customer.cdn.arvioncore.com`
4. `도메인 매핑 추가` 버튼 클릭
5. **데모 모드 스위치 ON** → 고객사 사이트 새로고침

원본 도메인에는 쇼핑몰 주소가 아니라 DevTools Network에서 확인한 **실제 이미지 호스트명**을 입력합니다.
예를 들어 `spdy-flexg-main.flexgate.co.kr`을 `spdy-flexg-main2.flexgate.co.kr`로,
`spdy-flexg-ha.flexgate.co.kr`을 `spdy-flexg-ha2.flexgate.co.kr`로 매핑할 수 있습니다.

매핑을 적용한 뒤 이미지 동작을 확인할 수 있는 사이트 예시는 다음과 같습니다.

- `https://www.subuhae.com/`
- `https://www.jecheolbabsang.com/`
- `https://www.miminemarket.com/`
- `https://www.tong-susan.com/`
- `https://www.goldhome.co.kr/`

### 대시보드 모니터링
1. `F12` → `ARVION DASHBOARD` 탭으로 이동
2. ARVION CDN을 통과하는 모든 미디어 트래픽이 실시간으로 쌓임
3. 각 행을 클릭하면 미디어 미리보기 및 전체 헤더 정보 확인 가능

---

## 🔒 보안 및 개인정보

- `declarativeNetRequest`: 사용자가 직접 입력한 매핑에 따라 리다이렉트만 수행
- `webRequest`: ARVION 응답 헤더를 분석하여 대시보드에 표시 (읽기 전용)
- **외부 서버로 전송되는 데이터 없음** — 모든 처리는 브라우저 내부에서만 이루어짐

---

## 🏗 프로젝트 구조

```
ARVIONDASH/
├── src/
│   ├── background/
│   │   └── background.js     # 네트워크 모니터링 + DNR 리다이렉트 엔진
│   ├── popup/
│   │   ├── popup.html        # B2B 데모 모드 팝업 UI
│   │   ├── popup.js          # 도메인 매핑 CRUD + 스토리지 연동
│   │   └── style.css         # 다크 테마 팝업 스타일
│   ├── dashboard/
│   │   └── view.js           # DevTools 대시보드 UI
│   └── devtools/
│       └── devtools.js       # DevTools 패널 등록
├── manifest.json
├── app_store_description.md  # 크롬 웹 스토어 심사용 설명 (영문)
└── README.md
```

---

## 📦 크롬 웹 스토어 등록

`app_store_description.md` 파일에 영문 심사용 설명이 준비되어 있습니다.
해당 내용을 그대로 복사하여 웹 스토어 등록 페이지의 설명란에 붙여넣으시면 됩니다.

---

*Powered by ARVION — The Intelligent Media CDN*
