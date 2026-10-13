package main

import (
	"context"
	"strings"
	"testing"
)

// Read-only smoke test against the current kube context.
func TestSmoke(t *testing.T) {
	a := NewApp()
	a.startup(context.Background())
	kc, err := a.GetContexts()
	if err != nil {
		t.Fatal(err)
	}
	k := kc.Current
	res, err := a.ListResources(k)
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("resources=%d", len(res))
	for _, key := range []string{"pods", "deployments.apps", "nodes", "services", "cronjobs.batch"} {
		tb, err := a.ListTable(k, key, "", "", "")
		if err != nil {
			t.Fatalf("%s: %v", key, err)
		}
		var cols []string
		for _, c := range tb.Columns {
			cols = append(cols, c.Name)
		}
		t.Logf("%s rows=%d metrics=%v cols=%s", key, len(tb.Rows), tb.Metrics, strings.Join(cols, ","))
		if len(tb.Rows) == 0 {
			continue
		}
		r := tb.Rows[0]
		t.Logf("  first: %s/%s %v", r.Namespace, r.Name, r.Cells)
		if _, err := a.GetYAML(k, key, r.Namespace, r.Name, false); err != nil {
			t.Errorf("yaml %s: %v", key, err)
		}
		d, err := a.Describe(k, key, r.Namespace, r.Name)
		if err != nil {
			t.Errorf("describe %s: %v", key, err)
		} else {
			t.Logf("  describe: %d bytes", len(d))
		}
		if _, err := a.GetEvents(k, r.Namespace, r.UID); err != nil {
			t.Errorf("events %s: %v", key, err)
		}
		if key != "pods" && key != "cronjobs.batch" {
			dr, err := a.DrillDown(k, key, r.Namespace, r.Name)
			if err != nil {
				t.Errorf("drill %s: %v", key, err)
			} else {
				pt, _ := a.ListTable(k, dr.Key, dr.Namespace, dr.LabelSelector, dr.FieldSelector)
				t.Logf("  drill %+v -> %d pods", dr, len(pt.Rows))
			}
		}
		if key == "deployments.apps" {
			ci, err := a.GetContainers(k, key, r.Namespace, r.Name)
			t.Logf("  containers %+v %v", ci, err)
			c, _ := a.cluster(k)
			lines := make(chan LogLine, 100)
			go func() {
				a.streamLog(context.Background(), c, r.Namespace, ci.Pods[0], ci.Containers[len(ci.Containers)-1].Name, LogOptions{TailLines: 3}, lines)
				close(lines)
			}()
			for l := range lines {
				t.Logf("  log: %.100s", l.Text)
			}
			ports, err := a.GetPorts(k, key, r.Namespace, r.Name)
			t.Logf("  ports %+v %v", ports, err)
		}
	}
	if err := a.DeleteObject(k, "pods", "x", "y", false); err != errReadOnly {
		t.Errorf("read-only guard failed: %v", err)
	}
}
