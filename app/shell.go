package main

import (
	"context"
	"encoding/base64"
	"io"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	corev1 "k8s.io/api/core/v1"
	"k8s.io/apimachinery/pkg/util/httpstream"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/tools/remotecommand"
)

type shellSession struct {
	stdin  *io.PipeWriter
	input  chan []byte
	sizes  chan remotecommand.TerminalSize
	cancel context.CancelFunc
	once   sync.Once
}

func (s *shellSession) close() {
	s.once.Do(func() {
		s.cancel()
		s.stdin.Close()
	})
}

// Next implements remotecommand.TerminalSizeQueue.
type sizeQueue chan remotecommand.TerminalSize

func (q sizeQueue) Next() *remotecommand.TerminalSize {
	sz, ok := <-q
	if !ok {
		return nil
	}
	return &sz
}

type eventWriter struct {
	a     *App
	event string
}

func (w eventWriter) Write(p []byte) (int, error) {
	runtime.EventsEmit(w.a.ctx, w.event, base64.StdEncoding.EncodeToString(p))
	return len(p), nil
}

// StartShell opens an interactive TTY in a container (bash if present, else sh).
// Output arrives as base64 "shell:<id>" events; "shell:<id>:exit" fires on exit.
func (a *App) StartShell(kubeContext, ns, pod, container string, cols, rows int) (string, error) {
	if err := a.guard(); err != nil {
		return "", err
	}
	c, err := a.cluster(kubeContext)
	if err != nil {
		return "", err
	}
	req := c.cs.CoreV1().RESTClient().Post().Resource("pods").Namespace(ns).Name(pod).SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: container,
			Command:   []string{"/bin/sh", "-c", "command -v bash >/dev/null 2>&1 && exec bash || exec sh"},
			Stdin:     true,
			Stdout:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	spdy, err := remotecommand.NewSPDYExecutor(c.cfg, "POST", req.URL())
	if err != nil {
		return "", err
	}
	ws, err := remotecommand.NewWebSocketExecutor(c.cfg, "GET", req.URL().String())
	if err != nil {
		return "", err
	}
	exec, err := remotecommand.NewFallbackExecutor(ws, spdy, func(err error) bool {
		return httpstream.IsUpgradeFailure(err) || httpstream.IsHTTPSProxyError(err)
	})
	if err != nil {
		return "", err
	}

	id := shortID()
	ctx, cancel := context.WithCancel(a.ctx)
	pr, pw := io.Pipe()
	sizes := make(sizeQueue, 4)
	sizes <- remotecommand.TerminalSize{Width: uint16(cols), Height: uint16(rows)}
	s := &shellSession{stdin: pw, input: make(chan []byte, 256), sizes: sizes, cancel: cancel}
	// One writer goroutine keeps keystrokes in order.
	go func() {
		for {
			select {
			case b := <-s.input:
				if _, err := pw.Write(b); err != nil {
					return
				}
			case <-ctx.Done():
				return
			}
		}
	}()
	a.mu.Lock()
	a.shells[id] = s
	a.mu.Unlock()

	go func() {
		err := exec.StreamWithContext(ctx, remotecommand.StreamOptions{
			Stdin:             pr,
			Stdout:            eventWriter{a, "shell:" + id},
			Tty:               true,
			TerminalSizeQueue: sizes,
		})
		msg := ""
		if err != nil && ctx.Err() == nil {
			msg = err.Error()
		}
		runtime.EventsEmit(a.ctx, "shell:"+id+":exit", msg)
		a.StopShell(id)
	}()
	return id, nil
}

// ShellInput sends keystrokes to a shell.
func (a *App) ShellInput(id, data string) {
	a.mu.Lock()
	s, ok := a.shells[id]
	a.mu.Unlock()
	if ok {
		select {
		case s.input <- []byte(data):
		default: // drop input if the remote end is wedged
		}
	}
}

// ShellResize updates the remote TTY size.
func (a *App) ShellResize(id string, cols, rows int) {
	a.mu.Lock()
	s, ok := a.shells[id]
	a.mu.Unlock()
	if !ok {
		return
	}
	select {
	case s.sizes <- remotecommand.TerminalSize{Width: uint16(cols), Height: uint16(rows)}:
	default:
	}
}

// StopShell closes a shell session.
func (a *App) StopShell(id string) {
	a.mu.Lock()
	s, ok := a.shells[id]
	delete(a.shells, id)
	a.mu.Unlock()
	if ok {
		s.close()
	}
}
