# Arvion 응답 상태 계약

대시보드는 특정 CDN이나 인프라 이름에 의존하지 않고 다음 세 층을 구분해 표시한다.

| 필드 | 의미 | 예시 |
| --- | --- | --- |
| `X-Arvion-Delivery` | Arvion이 최종적으로 응답을 전달한 방식 | `HIT-QUICK`, `HIT-ASYNC`, `BYPASS`, `FALLBACK`, `ERROR` |
| `X-Arvion-Cache-Source` | 응답 데이터의 내부 출처 | `REDIS`, `S3`, `ORIGIN`, `FALLBACK`, `BYPASS` |
| `X-Cache` / `Age` / `Via` | 앞단 CDN/프록시의 상태 | 공급자별 원문 보존 |
| `X-Arvionstream-Version` | 응답을 생성한 Core 버전 | `1.3.9` |

대시보드는 새 헤더를 우선 사용하고, 구버전 Core의 `X-ARVION-Cache` 값은 호환 변환한다. 따라서 특정 사업자나 로드밸런서의 상태를 Arvion 내부 상태로 오인하지 않는다.

Worker 상태는 요청 메타데이터(`request_id`, `trace_id`, `job_id`, `tenant_slug`, `route_domain`)와 별도로 `job_status`를 기록한다. 사용자 IP는 작업 payload에 넣지 않고 요청 로그·감사 로그의 신뢰된 프록시 경계에서 관리한다.
