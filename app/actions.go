package main

import (
	"encoding/json"
	"fmt"
	"time"

	batchv1 "k8s.io/api/batch/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/types"
)

func (a *App) mergePatch(kubeContext, key, ns, name string, patch map[string]interface{}) error {
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
	body, err := json.Marshal(patch)
	if err != nil {
		return err
	}
	ctx, cancel := a.timeout()
	defer cancel()
	_, err = c.dyn.Resource(ri.gvr()).Namespace(ns).Patch(ctx, name, types.MergePatchType, body, metav1.PatchOptions{FieldManager: "k10s"})
	return err
}

// RolloutRestart restarts a deployment, statefulset or daemonset (`kubectl rollout restart`).
func (a *App) RolloutRestart(kubeContext, key, ns, name string) error {
	switch key {
	case "deployments.apps", "statefulsets.apps", "daemonsets.apps":
	default:
		return fmt.Errorf("restart isn't supported for %s", key)
	}
	return a.mergePatch(kubeContext, key, ns, name, map[string]interface{}{
		"spec": map[string]interface{}{"template": map[string]interface{}{"metadata": map[string]interface{}{
			"annotations": map[string]string{"kubectl.kubernetes.io/restartedAt": time.Now().Format(time.RFC3339)},
		}}},
	})
}

// Scale sets spec.replicas on a deployment, statefulset or replicaset.
func (a *App) Scale(kubeContext, key, ns, name string, replicas int) error {
	switch key {
	case "deployments.apps", "statefulsets.apps", "replicasets.apps":
	default:
		return fmt.Errorf("scale isn't supported for %s", key)
	}
	if replicas < 0 {
		return fmt.Errorf("replicas must be 0 or more")
	}
	return a.mergePatch(kubeContext, key, ns, name, map[string]interface{}{
		"spec": map[string]interface{}{"replicas": replicas},
	})
}

// Cordon marks a node (un)schedulable.
func (a *App) Cordon(kubeContext, name string, cordon bool) error {
	return a.mergePatch(kubeContext, "nodes", "", name, map[string]interface{}{
		"spec": map[string]interface{}{"unschedulable": cordon},
	})
}

// SuspendCronJob pauses or resumes a cronjob.
func (a *App) SuspendCronJob(kubeContext, ns, name string, suspend bool) error {
	return a.mergePatch(kubeContext, "cronjobs.batch", ns, name, map[string]interface{}{
		"spec": map[string]interface{}{"suspend": suspend},
	})
}

// TriggerCronJob creates a Job from a CronJob's template (`kubectl create job --from=cronjob/x`).
func (a *App) TriggerCronJob(kubeContext, ns, name string) (string, error) {
	if err := a.guard(); err != nil {
		return "", err
	}
	c, err := a.cluster(kubeContext)
	if err != nil {
		return "", err
	}
	ctx, cancel := a.timeout()
	defer cancel()
	cj, err := c.cs.BatchV1().CronJobs(ns).Get(ctx, name, metav1.GetOptions{})
	if err != nil {
		return "", err
	}
	jobName := fmt.Sprintf("%s-manual-%d", name, time.Now().Unix()%100000)
	if len(jobName) > 63 {
		jobName = jobName[len(jobName)-63:]
	}
	annotations := map[string]string{"cronjob.kubernetes.io/instantiate": "manual"}
	for k, v := range cj.Spec.JobTemplate.Annotations {
		annotations[k] = v
	}
	isController := true
	job := &batchv1.Job{
		ObjectMeta: metav1.ObjectMeta{
			Name:        jobName,
			Namespace:   ns,
			Labels:      cj.Spec.JobTemplate.Labels,
			Annotations: annotations,
			OwnerReferences: []metav1.OwnerReference{{
				APIVersion: "batch/v1", Kind: "CronJob", Name: cj.Name, UID: cj.UID, Controller: &isController,
			}},
		},
		Spec: cj.Spec.JobTemplate.Spec,
	}
	_, err = c.cs.BatchV1().Jobs(ns).Create(ctx, job, metav1.CreateOptions{FieldManager: "k10s"})
	return jobName, err
}
