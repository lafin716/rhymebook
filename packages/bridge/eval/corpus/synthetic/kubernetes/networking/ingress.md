# 쿠버네티스 인그레스 (Ingress)

인그레스는 클러스터 바깥에서 들어오는 HTTP·HTTPS 요청을 호스트 이름과 경로에 따라 여러 서비스로 나눠 보내는 입구 규칙이다.
한 개의 로드밸런서 주소로 여러 서비스를 노출할 때 쓴다.

## 핵심 필드
- `ingressClassName`: 어느 인그레스 컨트롤러가 이 규칙을 처리할지 고른다.
- `pathType`: `Prefix`, `Exact`, `ImplementationSpecific` 중 하나. 경로를 어떻게 맞출지 정한다.
- `tls`: 호스트 이름별 인증서 시크릿을 지정한다.

## 예시
규칙 하나는 호스트 `shop.example.com`의 `/api` 접두 요청을 `api-service:8080`으로 보낸다.
`pathType: Prefix`이면 `/api/orders`도 같은 서비스로 간다.

## 주의
인그레스 자체는 아무 일도 하지 않는다. 컨트롤러(nginx, traefik 등)가 설치되어 있어야 규칙이 적용된다.
