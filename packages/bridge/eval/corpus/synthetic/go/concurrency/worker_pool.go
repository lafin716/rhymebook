package concurrency

import "sync"

// WorkerPool은 고정 개수의 고루틴(워커)이 작업 채널을 나눠 처리한다.
// 작업이 몰려도 고루틴이 무한히 늘어나지 않는다.
type WorkerPool struct {
	tasks chan func()
	wg    sync.WaitGroup
}

// NewWorkerPool은 workers개의 고루틴을 띄우고 queue 크기만큼 작업을 버퍼링한다.
func NewWorkerPool(workers, queue int) *WorkerPool {
	p := &WorkerPool{tasks: make(chan func(), queue)}
	for i := 0; i < workers; i++ {
		p.wg.Add(1)
		go func() {
			defer p.wg.Done()
			for task := range p.tasks {
				task()
			}
		}()
	}
	return p
}

// Submit은 작업을 큐에 넣는다. 큐가 가득 차면 빌 때까지 막힌다.
func (p *WorkerPool) Submit(task func()) {
	p.tasks <- task
}

// Close는 새 작업을 막고, 남은 작업이 끝날 때까지 기다린다.
func (p *WorkerPool) Close() {
	close(p.tasks)
	p.wg.Wait()
}
