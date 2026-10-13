package main

import (
	"bufio"
	"context"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	corev1 "k8s.io/api/core/v1"
)

type LogOptions struct {
	Container    string `json:"container"` // empty = all containers
	Follow       bool   `json:"follow"`
	Previous     bool   `json:"previous"`
	Timestamps   bool   `json:"timestamps"`
	TailLines    int64  `json:"tailLines"`
	SinceSeconds int64  `json:"sinceSeconds"`
}

type LogLine struct {
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Text      string `json:"text"`
}

// StartLogs streams logs for a pod, or for every pod behind a workload/service.
// Lines arrive as batched "logs:<id>" events; "logs:<id>:end" fires when all streams close.
func (a *App) StartLogs(kubeContext, key, ns, name string, opts LogOptions) (string, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return "", err
	}
	pods, err := a.podsFor(c, key, ns, name)
	if err != nil {
		return "", err
	}
	id := shortID()
	ctx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	a.logs[id] = cancel
	a.mu.Unlock()

	lines := make(chan LogLine, 1024)
	var wg sync.WaitGroup
	for _, p := range pods {
		for _, ct := range containersOf(p, opts.Container) {
			wg.Add(1)
			go func(pod, container string) {
				defer wg.Done()
				a.streamLog(ctx, c, ns, pod, container, opts, lines)
			}(p.Name, ct)
		}
	}
	go func() {
		wg.Wait()
		close(lines)
	}()
	go a.flushLogs(id, lines)
	return id, nil
}

func containersOf(p corev1.Pod, only string) []string {
	if only != "" {
		return []string{only}
	}
	var out []string
	for _, ct := range p.Spec.InitContainers {
		out = append(out, ct.Name)
	}
	for _, ct := range p.Spec.Containers {
		out = append(out, ct.Name)
	}
	return out
}

func (a *App) streamLog(ctx context.Context, c *cluster, ns, pod, container string, opts LogOptions, out chan<- LogLine) {
	po := &corev1.PodLogOptions{
		Container:  container,
		Follow:     opts.Follow,
		Previous:   opts.Previous,
		Timestamps: opts.Timestamps,
	}
	if opts.TailLines > 0 {
		po.TailLines = &opts.TailLines
	}
	if opts.SinceSeconds > 0 {
		po.SinceSeconds = &opts.SinceSeconds
	}
	rc, err := c.cs.CoreV1().Pods(ns).GetLogs(pod, po).Stream(ctx)
	if err != nil {
		select {
		case out <- LogLine{Pod: pod, Container: container, Text: "⚠ " + err.Error()}:
		case <-ctx.Done():
		}
		return
	}
	defer rc.Close()
	sc := bufio.NewScanner(rc)
	sc.Buffer(make([]byte, 64*1024), 1024*1024)
	for sc.Scan() {
		select {
		case out <- LogLine{Pod: pod, Container: container, Text: sc.Text()}:
		case <-ctx.Done():
			return
		}
	}
}

// flushLogs batches lines so a chatty pod doesn't flood the UI with events.
func (a *App) flushLogs(id string, lines <-chan LogLine) {
	tick := time.NewTicker(150 * time.Millisecond)
	defer tick.Stop()
	var batch []LogLine
	flush := func() {
		if len(batch) > 0 {
			runtime.EventsEmit(a.ctx, "logs:"+id, batch)
			batch = nil
		}
	}
	for {
		select {
		case l, ok := <-lines:
			if !ok {
				flush()
				runtime.EventsEmit(a.ctx, "logs:"+id+":end")
				a.StopLogs(id)
				return
			}
			batch = append(batch, l)
			if len(batch) >= 2000 {
				flush()
			}
		case <-tick.C:
			flush()
		}
	}
}

// StopLogs cancels a log stream.
func (a *App) StopLogs(id string) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if cancel, ok := a.logs[id]; ok {
		cancel()
		delete(a.logs, id)
	}
}
