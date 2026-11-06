package http

import (
	"log"
	"net/http"
	"time"
)

// Middleware는 핸들러를 감싸 앞뒤로 동작을 끼워 넣는다.
type Middleware func(http.Handler) http.Handler

// Chain은 나열한 순서대로 미들웨어를 감싼다. 첫 번째가 가장 바깥이다.
func Chain(h http.Handler, mws ...Middleware) http.Handler {
	for i := len(mws) - 1; i >= 0; i-- {
		h = mws[i](h)
	}
	return h
}

// LoggingMiddleware는 요청 경로, 상태 코드, 처리 시간을 한 줄로 남긴다.
func LoggingMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d %s", r.Method, r.URL.Path, rec.status, time.Since(start))
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (s *statusRecorder) WriteHeader(code int) {
	s.status = code
	s.ResponseWriter.WriteHeader(code)
}
