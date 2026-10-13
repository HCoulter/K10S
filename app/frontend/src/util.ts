import {ResourceInfo} from "./types";

export const FAVORITES = [
    "pods", "deployments.apps", "statefulsets.apps", "daemonsets.apps", "replicasets.apps",
    "jobs.batch", "cronjobs.batch", "services", "ingresses.networking.k8s.io", "configmaps",
    "secrets", "persistentvolumeclaims", "persistentvolumes", "nodes", "namespaces", "events",
];

// k9s aliases that aren't API short names.
const EXTRA_ALIASES: Record<string, string> = {
    dp: "deployments.apps", sec: "secrets", job: "jobs.batch", cj: "cronjobs.batch",
    ing: "ingresses.networking.k8s.io", ev: "events", sa: "serviceaccounts", crd: "customresourcedefinitions.apiextensions.k8s.io",
};

export const RESTARTABLE = new Set(["deployments.apps", "statefulsets.apps", "daemonsets.apps"]);
export const SCALABLE = new Set(["deployments.apps", "statefulsets.apps", "replicasets.apps"]);
export const HAS_PODS = new Set([
    "deployments.apps", "statefulsets.apps", "daemonsets.apps", "replicasets.apps", "jobs.batch", "services",
]);

/** Plural display name: Pod → Pods, Ingress → Ingresses, NetworkPolicy → NetworkPolicies. */
export function plural(r: ResourceInfo) {
    const k = r.kind;
    if (/(ss|sh|ch|x)$/.test(k)) return k + "es";
    if (/[^aeiou]y$/.test(k)) return k.slice(0, -1) + "ies";
    if (k.endsWith("s")) return k;
    return k + "s";
}

/** Resolve what the user typed in the command bar (pods, po, deploy, Deployment, deployments.apps). */
export function resolveResource(input: string, resources: ResourceInfo[]): ResourceInfo | undefined {
    const q = input.trim().toLowerCase();
    if (!q) return undefined;
    const alias = EXTRA_ALIASES[q];
    return resources.find(r => r.key === (alias ?? q))
        ?? resources.find(r => r.resource === q || r.kind.toLowerCase() === q || r.shortNames?.includes(q))
        ?? resources.find(r => r.resource === q + "s" || r.resource === q + "es")
        ?? resources.find(r => r.resource.startsWith(q));
}

export function matchesResource(input: string, r: ResourceInfo): boolean {
    const q = input.trim().toLowerCase();
    return !q || r.key.includes(q) || r.kind.toLowerCase().includes(q) || !!r.shortNames?.some(s => s.startsWith(q));
}

/** Parse k8s-style ages ("2y343d", "7d16h", "28m", "45s") to seconds. */
export function ageSeconds(s: string): number {
    const re = /(\d+)([ydhms])/g;
    const mult: Record<string, number> = {y: 31536000, d: 86400, h: 3600, m: 60, s: 1};
    let total = 0, matched = false, m;
    while ((m = re.exec(s))) {
        total += Number(m[1]) * mult[m[2]];
        matched = true;
    }
    return matched ? total : NaN;
}

export function compareCells(a: string, b: string, colName: string): number {
    if (colName.toLowerCase() === "age" || colName.toLowerCase().startsWith("last")) {
        const x = ageSeconds(a), y = ageSeconds(b);
        if (!isNaN(x) && !isNaN(y)) return x - y;
    }
    const na = parseFloat(a), nb = parseFloat(b);
    if (!isNaN(na) && !isNaN(nb) && /^[\d.]/.test(a) && /^[\d.]/.test(b)) return na - nb;
    return a.localeCompare(b, undefined, {numeric: true});
}

const OK = new Set(["running", "succeeded", "completed", "ready", "active", "bound", "true", "available", "complete"]);
const WARN = new Set(["pending", "containercreating", "terminating", "podinitializing", "schedulingdisabled", "unknown", "suspended", "released"]);

export function statusTone(value: string): "ok" | "warn" | "bad" | "" {
    const v = value.toLowerCase();
    if (!v || v === "<none>") return "";
    if (OK.has(v)) return "ok";
    if (WARN.has(v) || v.startsWith("init:") || v.includes("schedulingdisabled")) return "warn";
    if (v.startsWith("ready")) return v.includes("schedulingdisabled") ? "warn" : "ok";
    return "bad";
}

/** "1/2" ready counts that don't match are flagged. */
export function readyTone(value: string): "ok" | "warn" | "" {
    const m = /^(\d+)\/(\d+)$/.exec(value);
    if (!m) return "";
    return m[1] === m[2] ? "" : "warn";
}

export function errText(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

export function load<T>(key: string, fallback: T): T {
    try {
        const v = localStorage.getItem("k10s:" + key);
        return v === null ? fallback : JSON.parse(v);
    } catch {
        return fallback;
    }
}

export function save(key: string, value: unknown) {
    try {
        localStorage.setItem("k10s:" + key, JSON.stringify(value));
    } catch {
        // storage unavailable: settings just won't persist
    }
}

export function isTyping(e: KeyboardEvent) {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return false;
    return (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable
        || !!t.closest(".cm-editor") || !!t.closest(".xterm"));
}
