package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"sort"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/util/intstr"
	"k8s.io/client-go/tools/portforward"
	"k8s.io/client-go/transport/spdy"
)

type portForward struct {
	info PortForward
	stop chan struct{}
}

type PortForward struct {
	ID         string `json:"id"`
	Context    string `json:"context"`
	Namespace  string `json:"namespace"`
	Target     string `json:"target"`
	Pod        string `json:"pod"`
	LocalPort  int    `json:"localPort"`
	RemotePort int    `json:"remotePort"`
}

type PortOption struct {
	Port  int    `json:"port"`
	Label string `json:"label"`
}

// GetPorts suggests forwardable ports for pods, services and workloads.
func (a *App) GetPorts(kubeContext, key, ns, name string) ([]PortOption, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, err
	}
	if key == "services" {
		ctx, cancel := a.timeout()
		defer cancel()
		svc, err := c.cs.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		var out []PortOption
		for _, p := range svc.Spec.Ports {
			out = append(out, PortOption{Port: int(p.Port), Label: fmt.Sprintf("%s %d→%s", p.Name, p.Port, p.TargetPort.String())})
		}
		return out, nil
	}
	pods, err := a.podsFor(c, key, ns, name)
	if err != nil || len(pods) == 0 {
		return nil, err
	}
	var out []PortOption
	for _, ct := range pods[0].Spec.Containers {
		for _, p := range ct.Ports {
			out = append(out, PortOption{Port: int(p.ContainerPort), Label: fmt.Sprintf("%s/%s %d", ct.Name, p.Name, p.ContainerPort)})
		}
	}
	return out, nil
}

// StartPortForward forwards localhost:localPort to a pod (resolving services
// and workloads to a running pod). localPort 0 picks a free port.
func (a *App) StartPortForward(kubeContext, key, ns, name string, localPort, remotePort int) (PortForward, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return PortForward{}, err
	}
	targetPort := intstr.FromInt32(int32(remotePort))
	if key == "services" {
		ctx, cancel := a.timeout()
		svc, err := c.cs.CoreV1().Services(ns).Get(ctx, name, metav1.GetOptions{})
		cancel()
		if err != nil {
			return PortForward{}, err
		}
		for _, p := range svc.Spec.Ports {
			if int(p.Port) == remotePort && (p.TargetPort.IntValue() != 0 || p.TargetPort.StrVal != "") {
				targetPort = p.TargetPort
			}
		}
	}
	pods, err := a.podsFor(c, key, ns, name)
	if err != nil {
		return PortForward{}, err
	}
	var pod *corev1.Pod
	for i := range pods {
		if pods[i].Status.Phase == corev1.PodRunning && pods[i].DeletionTimestamp == nil {
			pod = &pods[i]
			break
		}
	}
	if pod == nil {
		return PortForward{}, fmt.Errorf("no running pod found for %s/%s", key, name)
	}
	podPort, err := resolvePort(pod, targetPort)
	if err != nil {
		return PortForward{}, err
	}

	transport, upgrader, err := spdy.RoundTripperFor(c.cfg)
	if err != nil {
		return PortForward{}, err
	}
	url := c.cs.CoreV1().RESTClient().Post().Resource("pods").Namespace(ns).Name(pod.Name).SubResource("portforward").URL()
	dialer := spdy.NewDialer(upgrader, &http.Client{Transport: transport}, "POST", url)
	stop, ready := make(chan struct{}), make(chan struct{})
	fw, err := portforward.NewOnAddresses(dialer, []string{"127.0.0.1"},
		[]string{fmt.Sprintf("%d:%d", localPort, podPort)}, stop, ready, io.Discard, io.Discard)
	if err != nil {
		return PortForward{}, err
	}
	errCh := make(chan error, 1)
	id := shortID()
	go func() {
		errCh <- fw.ForwardPorts()
	}()
	select {
	case <-ready:
	case err := <-errCh:
		return PortForward{}, err
	case <-a.ctx.Done():
		return PortForward{}, context.Canceled
	}
	ports, err := fw.GetPorts()
	if err != nil || len(ports) == 0 {
		close(stop)
		return PortForward{}, fmt.Errorf("port-forward started but no local port was bound")
	}
	info := PortForward{ID: id, Context: kubeContext, Namespace: ns, Target: key + "/" + name, Pod: pod.Name,
		LocalPort: int(ports[0].Local), RemotePort: podPort}
	a.mu.Lock()
	a.forwards[id] = &portForward{info: info, stop: stop}
	a.mu.Unlock()
	go func() {
		<-errCh
		a.mu.Lock()
		_, still := a.forwards[id]
		delete(a.forwards, id)
		a.mu.Unlock()
		if still {
			runtime.EventsEmit(a.ctx, "portforward:ended", id)
		}
	}()
	return info, nil
}

func resolvePort(pod *corev1.Pod, p intstr.IntOrString) (int, error) {
	if p.Type == intstr.Int {
		return p.IntValue(), nil
	}
	for _, ct := range pod.Spec.Containers {
		for _, cp := range ct.Ports {
			if cp.Name == p.StrVal {
				return int(cp.ContainerPort), nil
			}
		}
	}
	return 0, fmt.Errorf("named port %q not found on pod %s", p.StrVal, pod.Name)
}

func (a *App) ListPortForwards() []PortForward {
	a.mu.Lock()
	defer a.mu.Unlock()
	out := make([]PortForward, 0, len(a.forwards))
	for _, f := range a.forwards {
		out = append(out, f.info)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].LocalPort < out[j].LocalPort })
	return out
}

func (a *App) StopPortForward(id string) {
	a.mu.Lock()
	f, ok := a.forwards[id]
	delete(a.forwards, id)
	a.mu.Unlock()
	if ok {
		close(f.stop)
	}
}
