# OAuth PKCE 흐름

PKCE(Proof Key for Code Exchange)는 인증 코드를 가로채도 토큰으로 바꿀 수 없게 하는 확장이다.
브라우저나 모바일 앱처럼 비밀 값을 안전하게 숨길 수 없는 클라이언트에 필수로 쓴다.

## 순서
1. 클라이언트가 무작위 `code_verifier`를 만든다.
2. 그 값을 SHA-256으로 해시하고 base64url로 바꾼 `code_challenge`를 인증 요청에 함께 보낸다.
3. 인증 서버가 코드를 돌려주면, 클라이언트는 원래 `code_verifier`를 토큰 요청에 넣는다.
4. 서버는 verifier를 해시해 처음 받은 challenge와 맞는지 확인한다.

## 왜 안전한가
공격자는 코드만 훔쳐서는 verifier를 모르므로 토큰을 받을 수 없다. `code_challenge_method=S256`을 쓰고 `plain`은 피한다.
