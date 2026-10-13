package main

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/watch"
)

// ResourceInfo describes one listable API resource.
type ResourceInfo struct {
	Key        string   `json:"key"`
	Group      string   `json:"group"`
	Version    string   `json:"version"`
	Resource   string   `json:"resource"`
	Kind       string   `json:"kind"`
	Namespaced bool     `json:"namespaced"`
	ShortNames []string `json:"shortNames"`
	Verbs      []string `json:"verbs"`
}

func (r ResourceInfo) gvr() schema.GroupVersionResource {
	return schema.GroupVersionResource{Group: r.Group, Version: r.Version, Resource: r.Resource}
}

func (r ResourceInfo) groupKind() schema.GroupKind {
	return schema.GroupKind{Group: r.Group, Kind: r.Kind}
}

func (r ResourceInfo) can(verb string) bool {
	for _, v := range r.Verbs {
		if v == verb {
			return true
		}
	}
	return false
}

func resourceKey(group, res string) string {
	if group == "" {
		return res
	}
	return res + "." + group
}

func listOpts() metav1.ListOptions {
	return metav1.ListOptions{}
}

func (c *cluster) resource(key string) (ResourceInfo, error) {
	if c.resources == nil {
		if _, err := c.loadResources(); err != nil {
			return ResourceInfo{}, err
		}
	}
	ri, ok := c.resources[key]
	if !ok {
		return ResourceInfo{}, fmt.Errorf("unknown resource %q", key)
	}
	return ri, nil
}

func (c *cluster) loadResources() ([]ResourceInfo, error) {
	lists, err := c.disc.ServerPreferredResources()
	// Partial discovery failures (e.g. a broken aggregated API) still return usable lists.
	if err != nil && len(lists) == 0 {
		return nil, err
	}
	out := []ResourceInfo{}
	byKey := map[string]ResourceInfo{}
	for _, l := range lists {
		gv, perr := schema.ParseGroupVersion(l.GroupVersion)
		if perr != nil {
			continue
		}
		for _, r := range l.APIResources {
			if strings.Contains(r.Name, "/") {
				continue
			}
			ri := ResourceInfo{
				Key:        resourceKey(gv.Group, r.Name),
				Group:      gv.Group,
				Version:    gv.Version,
				Resource:   r.Name,
				Kind:       r.Kind,
				Namespaced: r.Namespaced,
				ShortNames: r.ShortNames,
				Verbs:      r.Verbs,
			}
			if !ri.can("list") {
				continue
			}
			out = append(out, ri)
			byKey[ri.Key] = ri
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Key < out[j].Key })
	c.resources = byKey
	return out, nil
}

// ListResources returns every listable resource type, including CRDs.
func (a *App) ListResources(kubeContext string) ([]ResourceInfo, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, err
	}
	c.disc.Invalidate()
	return c.loadResources()
}

type Column struct {
	Name        string `json:"name"`
	Type        string `json:"type"`
	Priority    int32  `json:"priority"`
	Description string `json:"description"`
}

type Row struct {
	Name      string            `json:"name"`
	Namespace string            `json:"namespace"`
	UID       string            `json:"uid"`
	Cells     []string          `json:"cells"`
	Labels    map[string]string `json:"labels"`
	Created   string            `json:"created"`
}

type Table struct {
	Columns []Column `json:"columns"`
	Rows    []Row    `json:"rows"`
	Metrics bool     `json:"metrics"`
}

func apiPath(ri ResourceInfo, ns string) string {
	base := "/apis/" + ri.Group + "/" + ri.Version
	if ri.Group == "" {
		base = "/api/" + ri.Version
	}
	if ri.Namespaced && ns != "" {
		base += "/namespaces/" + ns
	}
	return base + "/" + ri.Resource
}

// ListTable lists a resource using the API server's Table format, so every
// resource (CRDs included) gets the same columns kubectl/k9s show.
func (a *App) ListTable(kubeContext, key, namespace, labelSelector, fieldSelector string) (Table, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return Table{}, err
	}
	ri, err := c.resource(key)
	if err != nil {
		return Table{}, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 20*time.Second)
	defer cancel()
	req := c.cs.Discovery().RESTClient().Get().AbsPath(apiPath(ri, namespace)).
		Param("includeObject", "Metadata").
		SetHeader("Accept", "application/json;as=Table;v=v1;g=meta.k8s.io,application/json")
	if labelSelector != "" {
		req = req.Param("labelSelector", labelSelector)
	}
	if fieldSelector != "" {
		req = req.Param("fieldSelector", fieldSelector)
	}
	raw, err := req.DoRaw(ctx)
	if err != nil {
		return Table{}, err
	}
	var t metav1.Table
	if err := json.Unmarshal(raw, &t); err != nil {
		return Table{}, err
	}
	out := Table{Rows: make([]Row, 0, len(t.Rows))}
	for _, cd := range t.ColumnDefinitions {
		out.Columns = append(out.Columns, Column{Name: cd.Name, Type: cd.Type, Priority: cd.Priority, Description: cd.Description})
	}
	for _, r := range t.Rows {
		row := Row{Cells: make([]string, len(r.Cells))}
		for i, cell := range r.Cells {
			row.Cells[i] = cellString(cell)
		}
		var m metav1.PartialObjectMetadata
		if len(r.Object.Raw) > 0 && json.Unmarshal(r.Object.Raw, &m) == nil {
			row.Name, row.Namespace, row.UID, row.Labels = m.Name, m.Namespace, string(m.UID), m.Labels
			row.Created = m.CreationTimestamp.Format(time.RFC3339)
		}
		out.Rows = append(out.Rows, row)
	}
	if ri.Key == "pods" || ri.Key == "nodes" {
		out.Metrics = a.mergeMetrics(ctx, c, ri, namespace, &out)
	}
	return out, nil
}

func cellString(v interface{}) string {
	switch x := v.(type) {
	case nil:
		return ""
	case string:
		return x
	case float64:
		if x == float64(int64(x)) {
			return fmt.Sprintf("%d", int64(x))
		}
		return fmt.Sprintf("%g", x)
	default:
		return fmt.Sprint(x)
	}
}

type metricsList struct {
	Items []struct {
		Metadata struct {
			Name      string `json:"name"`
			Namespace string `json:"namespace"`
		} `json:"metadata"`
		Usage      map[string]resource.Quantity `json:"usage"`
		Containers []struct {
			Usage map[string]resource.Quantity `json:"usage"`
		} `json:"containers"`
	} `json:"items"`
}

// mergeMetrics appends CPU/MEM columns from metrics-server when it is installed.
func (a *App) mergeMetrics(ctx context.Context, c *cluster, ri ResourceInfo, ns string, t *Table) bool {
	path := "/apis/metrics.k8s.io/v1beta1/" + ri.Resource
	if ri.Key == "pods" && ns != "" {
		path = "/apis/metrics.k8s.io/v1beta1/namespaces/" + ns + "/pods"
	}
	raw, err := c.cs.Discovery().RESTClient().Get().AbsPath(path).DoRaw(ctx)
	if err != nil {
		return false
	}
	var ml metricsList
	if json.Unmarshal(raw, &ml) != nil {
		return false
	}
	type usage struct{ cpu, mem int64 }
	byName := map[string]usage{}
	for _, it := range ml.Items {
		var u usage
		if it.Usage != nil {
			q := it.Usage["cpu"]
			m := it.Usage["memory"]
			u = usage{q.MilliValue(), m.Value()}
		}
		for _, ct := range it.Containers {
			q := ct.Usage["cpu"]
			m := ct.Usage["memory"]
			u.cpu += q.MilliValue()
			u.mem += m.Value()
		}
		byName[it.Metadata.Namespace+"/"+it.Metadata.Name] = u
	}
	t.Columns = append(t.Columns,
		Column{Name: "CPU", Type: "string", Description: "CPU usage (millicores) from metrics-server"},
		Column{Name: "MEM", Type: "string", Description: "Memory usage from metrics-server"})
	for i := range t.Rows {
		u, ok := byName[t.Rows[i].Namespace+"/"+t.Rows[i].Name]
		if !ok {
			t.Rows[i].Cells = append(t.Rows[i].Cells, "", "")
			continue
		}
		t.Rows[i].Cells = append(t.Rows[i].Cells, fmt.Sprintf("%dm", u.cpu), fmt.Sprintf("%dMi", u.mem/(1024*1024)))
	}
	return true
}

type watchSession struct {
	cancel context.CancelFunc
}

// WatchResource emits "resource:changed" (debounced) whenever the watched
// list changes. Only one watch is active at a time: the current view.
func (a *App) WatchResource(kubeContext, key, namespace, labelSelector, fieldSelector string) error {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return err
	}
	ri, err := c.resource(key)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(a.ctx)
	a.mu.Lock()
	if a.watch != nil {
		a.watch.cancel()
	}
	a.watch = &watchSession{cancel: cancel}
	a.mu.Unlock()

	if !ri.can("watch") {
		return nil
	}
	ns := namespace
	if !ri.Namespaced {
		ns = ""
	}
	go func() {
		for ctx.Err() == nil {
			w, err := c.dyn.Resource(ri.gvr()).Namespace(ns).Watch(ctx, metav1.ListOptions{
				LabelSelector: labelSelector, FieldSelector: fieldSelector, AllowWatchBookmarks: false,
			})
			if err != nil {
				select {
				case <-ctx.Done():
					return
				case <-time.After(5 * time.Second):
					continue
				}
			}
			a.pumpWatch(ctx, w, key)
			w.Stop()
		}
	}()
	return nil
}

func (a *App) pumpWatch(ctx context.Context, w watch.Interface, key string) {
	var pending <-chan time.Time
	start := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case ev, ok := <-w.ResultChan():
			if !ok {
				return
			}
			// A watch without a resourceVersion first replays the existing
			// list as ADDED events; the UI already has those rows.
			if ev.Type == watch.Added && time.Since(start) < 2*time.Second {
				continue
			}
			if pending == nil {
				pending = time.After(400 * time.Millisecond)
			}
		case <-pending:
			pending = nil
			runtime.EventsEmit(a.ctx, "resource:changed", key)
		}
	}
}

// StopWatch cancels the active watch.
func (a *App) StopWatch() {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.watch != nil {
		a.watch.cancel()
		a.watch = nil
	}
}
