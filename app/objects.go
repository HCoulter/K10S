package main

import (
	"context"
	"fmt"
	"sort"
	"strings"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/labels"
	"k8s.io/kubectl/pkg/describe"
	"sigs.k8s.io/yaml"
)

func (a *App) timeout() (context.Context, context.CancelFunc) {
	return context.WithTimeout(a.ctx, 20*time.Second)
}

func (a *App) getObject(kubeContext, key, ns, name string) (*cluster, ResourceInfo, *unstructured.Unstructured, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, ResourceInfo{}, nil, err
	}
	ri, err := c.resource(key)
	if err != nil {
		return nil, ResourceInfo{}, nil, err
	}
	ctx, cancel := a.timeout()
	defer cancel()
	obj, err := c.dyn.Resource(ri.gvr()).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	return c, ri, obj, err
}

// GetYAML returns the object as YAML; managed fields are hidden unless asked for.
func (a *App) GetYAML(kubeContext, key, ns, name string, showManaged bool) (string, error) {
	_, _, obj, err := a.getObject(kubeContext, key, ns, name)
	if err != nil {
		return "", err
	}
	if !showManaged {
		unstructured.RemoveNestedField(obj.Object, "metadata", "managedFields")
	}
	b, err := yaml.Marshal(obj.Object)
	return string(b), err
}

// ApplyYAML replaces the object with the edited YAML (like `kubectl edit`).
func (a *App) ApplyYAML(kubeContext, key, ns, name, doc string) error {
	if err := a.guard(); err != nil {
		return err
	}
	c, err := a.cluster(kubeContext)
	if err != nil {
		return err
	}
	ri, err := c.resource(key)
	if err != nil {
		return err
	}
	var m map[string]interface{}
	if err := yaml.Unmarshal([]byte(doc), &m); err != nil {
		return fmt.Errorf("invalid YAML: %w", err)
	}
	obj := &unstructured.Unstructured{Object: m}
	if obj.GetName() != name || (ri.Namespaced && obj.GetNamespace() != ns) {
		return fmt.Errorf("name/namespace can't be changed while editing (expected %s/%s)", ns, name)
	}
	ctx, cancel := a.timeout()
	defer cancel()
	_, err = c.dyn.Resource(ri.gvr()).Namespace(ns).Update(ctx, obj, metav1.UpdateOptions{FieldManager: "k10s"})
	return err
}

// DeleteObject deletes an object; force skips the grace period (k9s "kill").
func (a *App) DeleteObject(kubeContext, key, ns, name string, force bool) error {
	if err := a.guard(); err != nil {
		return err
	}
	c, err := a.cluster(kubeContext)
	if err != nil {
		return err
	}
	ri, err := c.resource(key)
	if err != nil {
		return err
	}
	prop := metav1.DeletePropagationBackground
	opts := metav1.DeleteOptions{PropagationPolicy: &prop}
	if force {
		zero := int64(0)
		opts.GracePeriodSeconds = &zero
	}
	ctx, cancel := a.timeout()
	defer cancel()
	return c.dyn.Resource(ri.gvr()).Namespace(ns).Delete(ctx, name, opts)
}

// Describe renders `kubectl describe` output for any resource.
func (a *App) Describe(kubeContext, key, ns, name string) (string, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return "", err
	}
	ri, err := c.resource(key)
	if err != nil {
		return "", err
	}
	d, ok := describe.DescriberFor(ri.groupKind(), c.cfg)
	if !ok {
		m, err := c.mapping(key)
		if err != nil {
			return "", err
		}
		if d, ok = describe.GenericDescriberFor(m, c.cfg); !ok {
			return "", fmt.Errorf("no describer for %s", ri.Kind)
		}
	}
	return d.Describe(ns, name, describe.DescriberSettings{ShowEvents: true, ChunkSize: 500})
}

type Event struct {
	Type    string `json:"type"`
	Reason  string `json:"reason"`
	Message string `json:"message"`
	Count   int32  `json:"count"`
	Source  string `json:"source"`
	Last    string `json:"last"`
	Object  string `json:"object"`
}

// GetEvents lists events for an object (by UID), or for a namespace when uid is empty.
func (a *App) GetEvents(kubeContext, ns, uid string) ([]Event, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.timeout()
	defer cancel()
	opts := metav1.ListOptions{}
	if uid != "" {
		opts.FieldSelector = "involvedObject.uid=" + uid
	}
	list, err := c.cs.CoreV1().Events(ns).List(ctx, opts)
	if err != nil {
		return nil, err
	}
	sort.Slice(list.Items, func(i, j int) bool { return eventTime(list.Items[i]).After(eventTime(list.Items[j])) })
	out := make([]Event, 0, len(list.Items))
	for _, e := range list.Items {
		src := e.Source.Component
		if src == "" {
			src = e.ReportingController
		}
		count := e.Count
		if count == 0 {
			count = 1
		}
		out = append(out, Event{
			Type: e.Type, Reason: e.Reason, Message: strings.TrimSpace(e.Message), Count: count, Source: src,
			Last:   humanAge(time.Since(eventTime(e))),
			Object: strings.ToLower(e.InvolvedObject.Kind) + "/" + e.InvolvedObject.Name,
		})
	}
	return out, nil
}

func eventTime(e corev1.Event) time.Time {
	switch {
	case !e.LastTimestamp.IsZero():
		return e.LastTimestamp.Time
	case !e.EventTime.IsZero():
		return e.EventTime.Time
	default:
		return e.CreationTimestamp.Time
	}
}

func humanAge(d time.Duration) string {
	switch {
	case d < time.Minute:
		return fmt.Sprintf("%ds", int(d.Seconds()))
	case d < time.Hour:
		return fmt.Sprintf("%dm", int(d.Minutes()))
	case d < 48*time.Hour:
		return fmt.Sprintf("%dh", int(d.Hours()))
	default:
		return fmt.Sprintf("%dd", int(d.Hours()/24))
	}
}

// Drill describes the pods behind a resource, for k9s-style "enter" navigation.
type Drill struct {
	Key           string `json:"key"`
	Namespace     string `json:"namespace"`
	LabelSelector string `json:"labelSelector"`
	FieldSelector string `json:"fieldSelector"`
	Title         string `json:"title"`
}

// DrillDown returns the pod (or job) query that lists what a resource owns.
// ok=false means the resource has nothing to drill into.
func (a *App) DrillDown(kubeContext, key, ns, name string) (Drill, error) {
	switch key {
	case "nodes":
		return Drill{Key: "pods", FieldSelector: "spec.nodeName=" + name, Title: "node/" + name}, nil
	case "namespaces":
		return Drill{Key: "pods", Namespace: name, Title: "ns/" + name}, nil
	case "cronjobs.batch":
		return Drill{}, fmt.Errorf("open a job from the Jobs view instead")
	}
	_, ri, obj, err := a.getObject(kubeContext, key, ns, name)
	if err != nil {
		return Drill{}, err
	}
	sel, err := selectorOf(obj)
	if err != nil {
		return Drill{}, err
	}
	return Drill{Key: "pods", Namespace: ns, LabelSelector: sel, Title: strings.ToLower(ri.Kind) + "/" + name}, nil
}

// selectorOf extracts the pod label selector from workloads and services.
func selectorOf(obj *unstructured.Unstructured) (string, error) {
	if m, found, _ := unstructured.NestedStringMap(obj.Object, "spec", "selector"); found && obj.GetKind() == "Service" {
		if len(m) == 0 {
			return "", fmt.Errorf("service has no selector")
		}
		return labels.SelectorFromSet(m).String(), nil
	}
	raw, found, _ := unstructured.NestedMap(obj.Object, "spec", "selector")
	if !found {
		return "", fmt.Errorf("%s has no pod selector", obj.GetKind())
	}
	var ls metav1.LabelSelector
	if err := runtimeFromMap(raw, &ls); err != nil {
		return "", err
	}
	s, err := metav1.LabelSelectorAsSelector(&ls)
	if err != nil {
		return "", err
	}
	return s.String(), nil
}

func runtimeFromMap(m map[string]interface{}, into interface{}) error {
	b, err := yaml.Marshal(m)
	if err != nil {
		return err
	}
	return yaml.Unmarshal(b, into)
}

// podsFor resolves a resource to the pods behind it.
func (a *App) podsFor(c *cluster, key, ns, name string) ([]corev1.Pod, error) {
	ctx, cancel := a.timeout()
	defer cancel()
	if key == "pods" {
		p, err := c.cs.CoreV1().Pods(ns).Get(ctx, name, metav1.GetOptions{})
		if err != nil {
			return nil, err
		}
		return []corev1.Pod{*p}, nil
	}
	ri, err := c.resource(key)
	if err != nil {
		return nil, err
	}
	obj, err := c.dyn.Resource(ri.gvr()).Namespace(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	sel, err := selectorOf(obj)
	if err != nil {
		return nil, err
	}
	list, err := c.cs.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{LabelSelector: sel})
	if err != nil {
		return nil, err
	}
	sort.Slice(list.Items, func(i, j int) bool { return list.Items[i].Name < list.Items[j].Name })
	return list.Items, nil
}

type ContainerInfo struct {
	Name  string `json:"name"`
	Image string `json:"image"`
	Init  bool   `json:"init"`
	Ports []int  `json:"ports"`
}

type PodsInfo struct {
	Pods       []string        `json:"pods"`
	Containers []ContainerInfo `json:"containers"`
}

// GetContainers lists the pods and container names behind a resource (for logs/shell pickers).
func (a *App) GetContainers(kubeContext, key, ns, name string) (PodsInfo, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return PodsInfo{}, err
	}
	pods, err := a.podsFor(c, key, ns, name)
	if err != nil {
		return PodsInfo{}, err
	}
	out := PodsInfo{}
	seen := map[string]bool{}
	for _, p := range pods {
		out.Pods = append(out.Pods, p.Name)
		add := func(ct corev1.Container, init bool) {
			if seen[ct.Name] {
				return
			}
			seen[ct.Name] = true
			ci := ContainerInfo{Name: ct.Name, Image: ct.Image, Init: init}
			for _, port := range ct.Ports {
				ci.Ports = append(ci.Ports, int(port.ContainerPort))
			}
			out.Containers = append(out.Containers, ci)
		}
		for _, ct := range p.Spec.InitContainers {
			add(ct, true)
		}
		for _, ct := range p.Spec.Containers {
			add(ct, false)
		}
	}
	return out, nil
}

// DecodeSecret returns a secret's data decoded to text (k9s "x").
func (a *App) DecodeSecret(kubeContext, ns, name string) (map[string]string, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, err
	}
	ctx, cancel := a.timeout()
	defer cancel()
	s, err := c.cs.CoreV1().Secrets(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return nil, err
	}
	out := make(map[string]string, len(s.Data))
	for k, v := range s.Data {
		out[k] = string(v)
	}
	return out, nil
}
