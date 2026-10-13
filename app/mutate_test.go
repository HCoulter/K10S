package main

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

// Exercises every mutating action. Only runs against a throwaway cluster:
// K10S_TEST_KUBECONFIG=<kind kubeconfig> go test -run TestMutations
func TestMutations(t *testing.T) {
	kc := os.Getenv("K10S_TEST_KUBECONFIG")
	if kc == "" {
		t.Skip("set K10S_TEST_KUBECONFIG to a disposable cluster")
	}
	t.Setenv("KUBECONFIG", kc)
	a := NewApp()
	a.startup(context.Background())
	ctxs, err := a.GetContexts()
	if err != nil || !strings.HasPrefix(ctxs.Current, "kind-") {
		t.Fatalf("refusing to run outside a kind cluster: %v %v", ctxs.Current, err)
	}
	k := ctxs.Current

	if err := a.Scale(k, "deployments.apps", "default", "web", 3); err != errReadOnly {
		t.Fatalf("expected read-only error, got %v", err)
	}
	a.SetReadOnly(false)

	must := func(name string, err error) {
		t.Helper()
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
	}
	must("scale", a.Scale(k, "deployments.apps", "default", "web", 3))
	must("restart", a.RolloutRestart(k, "deployments.apps", "default", "web"))
	y, err := a.GetYAML(k, "deployments.apps", "default", "web", false)
	must("yaml", err)
	if !strings.Contains(y, "replicas: 3") || !strings.Contains(y, "restartedAt") {
		t.Fatalf("scale/restart not reflected in YAML")
	}
	edited := strings.Replace(y, "labels:\n    app: web", "labels:\n    app: web\n    edited-by: k10s", 1)
	must("apply", a.ApplyYAML(k, "deployments.apps", "default", "web", edited))
	if err := a.ApplyYAML(k, "deployments.apps", "default", "web", strings.Replace(y, "name: web", "name: other", 1)); err == nil {
		t.Fatalf("rename via edit should be rejected")
	}
	tb, err := a.ListTable(k, "deployments.apps", "default", "edited-by=k10s", "")
	must("list labelled", err)
	if len(tb.Rows) != 1 {
		t.Fatalf("edit not applied")
	}

	job, err := a.TriggerCronJob(k, "default", "tick")
	must("trigger", err)
	t.Logf("triggered %s", job)
	must("suspend", a.SuspendCronJob(k, "default", "tick", true))

	nodes, err := a.ListTable(k, "nodes", "", "", "")
	must("nodes", err)
	node := nodes.Rows[0].Name
	must("cordon", a.Cordon(k, node, true))
	nodes, _ = a.ListTable(k, "nodes", "", "", "")
	if !strings.Contains(nodes.Rows[0].Cells[1], "SchedulingDisabled") {
		t.Fatalf("cordon not reflected: %v", nodes.Rows[0].Cells)
	}
	must("uncordon", a.Cordon(k, node, false))

	sec, err := a.DecodeSecret(k, "default", "demo")
	must("secret", err)
	if sec["password"] != "example" {
		t.Fatalf("secret decode wrong: %v", sec)
	}

	pods, err := a.ListTable(k, "pods", "default", "app=web", "")
	must("pods", err)
	victim := pods.Rows[0].Name
	must("kill", a.DeleteObject(k, "pods", "default", victim, true))
	time.Sleep(2 * time.Second)
	if _, _, _, err := a.getObject(k, "pods", "default", victim); err == nil {
		t.Fatalf("pod %s still exists after kill", victim)
	}
	must("delete job", a.DeleteObject(k, "jobs.batch", "default", job, false))
}
