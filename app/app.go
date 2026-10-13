package main

import (
	"context"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/meta"
	"k8s.io/client-go/discovery"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/restmapper"
	"k8s.io/client-go/tools/clientcmd"
)

var errReadOnly = errors.New("K10S is in read-only mode: unlock it in the sidebar to make changes")

// App is bound to the frontend; its exported methods become JS functions.
type App struct {
	ctx context.Context

	mu       sync.Mutex
	clusters map[string]*cluster
	readOnly bool

	watch    *watchSession
	logs     map[string]context.CancelFunc
	shells   map[string]*shellSession
	forwards map[string]*portForward
}

func NewApp() *App {
	return &App{
		clusters: map[string]*cluster{},
		readOnly: true,
		logs:     map[string]context.CancelFunc{},
		shells:   map[string]*shellSession{},
		forwards: map[string]*portForward{},
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	// Apps launched from Finder get a minimal PATH, which breaks exec-based
	// kube auth plugins (gke-gcloud-auth-plugin, aws, kubelogin).
	extra := []string{"/opt/homebrew/bin", "/usr/local/bin", os.ExpandEnv("$HOME/google-cloud-sdk/bin"), "/opt/homebrew/share/google-cloud-sdk/bin"}
	os.Setenv("PATH", os.Getenv("PATH")+":"+strings.Join(extra, ":"))
}

func (a *App) shutdown(ctx context.Context) {
	a.mu.Lock()
	defer a.mu.Unlock()
	for _, cancel := range a.logs {
		cancel()
	}
	for _, s := range a.shells {
		s.close()
	}
	for _, f := range a.forwards {
		close(f.stop)
	}
	if a.watch != nil {
		a.watch.cancel()
	}
}

// cluster holds the clients for one kubeconfig context.
type cluster struct {
	name      string
	cfg       *rest.Config
	cs        *kubernetes.Clientset
	dyn       dynamic.Interface
	disc      discovery.CachedDiscoveryInterface
	mapper    *restmapper.DeferredDiscoveryRESTMapper
	resources map[string]ResourceInfo
}

func loadingRules() *clientcmd.ClientConfigLoadingRules {
	return clientcmd.NewDefaultClientConfigLoadingRules()
}

func (a *App) cluster(name string) (*cluster, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if c, ok := a.clusters[name]; ok {
		return c, nil
	}
	cfg, err := clientcmd.NewNonInteractiveDeferredLoadingClientConfig(
		loadingRules(),
		&clientcmd.ConfigOverrides{CurrentContext: name},
	).ClientConfig()
	if err != nil {
		return nil, err
	}
	cfg.QPS, cfg.Burst = 50, 100
	cs, err := kubernetes.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	dyn, err := dynamic.NewForConfig(cfg)
	if err != nil {
		return nil, err
	}
	disc := memory.NewMemCacheClient(cs.Discovery())
	c := &cluster{
		name:   name,
		cfg:    cfg,
		cs:     cs,
		dyn:    dyn,
		disc:   disc,
		mapper: restmapper.NewDeferredDiscoveryRESTMapper(disc),
	}
	a.clusters[name] = c
	return c, nil
}

func (a *App) guard() error {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.readOnly {
		return errReadOnly
	}
	return nil
}

func (a *App) GetReadOnly() bool {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.readOnly
}

func (a *App) SetReadOnly(ro bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.readOnly = ro
}

type KubeContexts struct {
	Current  string   `json:"current"`
	Contexts []string `json:"contexts"`
}

// GetContexts lists kubeconfig contexts and the current one.
func (a *App) GetContexts() (KubeContexts, error) {
	raw, err := loadingRules().Load()
	if err != nil {
		return KubeContexts{}, err
	}
	out := KubeContexts{Current: raw.CurrentContext}
	for name := range raw.Contexts {
		out.Contexts = append(out.Contexts, name)
	}
	sort.Strings(out.Contexts)
	return out, nil
}

// GetNamespaces lists namespace names for a context.
func (a *App) GetNamespaces(kubeContext string) ([]string, error) {
	c, err := a.cluster(kubeContext)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(a.ctx, 15*time.Second)
	defer cancel()
	list, err := c.cs.CoreV1().Namespaces().List(ctx, listOpts())
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(list.Items))
	for _, ns := range list.Items {
		names = append(names, ns.Name)
	}
	sort.Strings(names)
	return names, nil
}

// mapping resolves a resource key (e.g. "deployments.apps") to its REST mapping.
func (c *cluster) mapping(key string) (*meta.RESTMapping, error) {
	ri, err := c.resource(key)
	if err != nil {
		return nil, err
	}
	return c.mapper.RESTMapping(ri.groupKind(), ri.Version)
}

func shortID() string {
	return fmt.Sprintf("%x", time.Now().UnixNano())
}
