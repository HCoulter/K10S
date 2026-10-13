import {useCallback, useEffect, useMemo, useRef, useState} from 'react';
import './App.css';
import {
    Cordon, DeleteObject, DrillDown, GetContexts, GetNamespaces, GetReadOnly, ListPortForwards, ListResources,
    ListTable, RolloutRestart, Scale, SetReadOnly, StopWatch, SuspendCronJob, TriggerCronJob, WatchResource,
} from "../wailsjs/go/main/App";
import {EventsOn} from "../wailsjs/runtime/runtime";
import {Column, DetailTab, ResourceInfo, Selected, Table, View} from "./types";
import {compareCells, errText, HAS_PODS, isTyping, load, plural, RESTARTABLE, save, SCALABLE} from "./util";
import {Sidebar} from "./components/Sidebar";
import {DisplayTable, ResourceTable} from "./components/ResourceTable";
import {Action, DetailPanel} from "./components/DetailPanel";
import {CommandPalette} from "./components/CommandPalette";
import {useDialogs} from "./components/Dialogs";
import {Forward, ForwardsList, StartForward} from "./components/PortForwards";
import {Help} from "./components/Help";
import {Tooltip} from "./components/Tooltip";

const LOGGABLE = new Set(["pods", "deployments.apps", "statefulsets.apps", "daemonsets.apps", "replicasets.apps", "jobs.batch", "services"]);
const FORWARDABLE = new Set(["pods", "services", "deployments.apps", "statefulsets.apps", "daemonsets.apps", "replicasets.apps"]);
const TYPE_TO_DELETE = new Set(["namespaces", "nodes", "persistentvolumes", "persistentvolumeclaims", "customresourcedefinitions.apiextensions.k8s.io"]);

interface Toast {
    id: number;
    msg: string;
    tone: "ok" | "bad";
}

function App() {
    const [contexts, setContexts] = useState<string[]>([]);
    const [kubeContext, setKubeContext] = useState("");
    const [namespaces, setNamespaces] = useState<string[]>([]);
    const [namespace, setNamespaceState] = useState("");
    const [resources, setResources] = useState<ResourceInfo[]>([]);
    const [readOnly, setReadOnlyState] = useState(true);

    const [stack, setStack] = useState<View[]>([{key: load("lastResource", "pods")}]);
    const view = stack[stack.length - 1];
    const [table, setTable] = useState<Table | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [updated, setUpdated] = useState<Date | null>(null);

    const [filter, setFilter] = useState("");
    const [sort, setSort] = useState<{ col: number; desc: boolean } | null>(null);
    const [wide, setWide] = useState<boolean>(load("wide", false));
    const [cursor, setCursor] = useState(0);
    const [selected, setSelected] = useState<Selected | null>(null);
    const [tab, setTab] = useState<DetailTab>("overview");
    const [maximized, setMaximized] = useState(false);
    const [editRequest, setEditRequest] = useState(0);
    const [panelWidth, setPanelWidth] = useState<number>(load("panelWidth", 560));

    const [palette, setPalette] = useState(false);
    const [help, setHelp] = useState(false);
    const [forwards, setForwards] = useState<Forward[]>([]);
    const [showForwards, setShowForwards] = useState(false);
    const [forwardTarget, setForwardTarget] = useState<Selected | null>(null);
    const [toasts, setToasts] = useState<Toast[]>([]);
    const dialogs = useDialogs();
    const filterRef = useRef<HTMLInputElement>(null);

    const toast = useCallback((msg: string, tone: "ok" | "bad" = "ok") => {
        const id = Date.now() + Math.random();
        setToasts(t => [...t, {id, msg, tone}]);
        setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), tone === "bad" ? 7000 : 3500);
    }, []);

    const resource = useMemo(() => resources.find(r => r.key === view.key), [resources, view.key]);
    const effectiveNs = view.namespace ?? (resource?.namespaced === false ? "" : namespace);

    // --- bootstrapping & context switching ---------------------------------

    useEffect(() => {
        GetReadOnly().then(setReadOnlyState);
        refreshForwards();
        GetContexts()
            .then(c => {
                setContexts(c.contexts ?? []);
                const saved = load<string>("context", "");
                setKubeContext((c.contexts ?? []).includes(saved) ? saved : c.current);
            })
            .catch(e => setError(errText(e)));
        return EventsOn("portforward:ended", () => refreshForwards());
    }, []);

    useEffect(() => {
        if (!kubeContext) return;
        save("context", kubeContext);
        setSelected(null);
        setResources([]);
        setTable(null);
        setNamespaceState(load<Record<string, string>>("namespaces", {})[kubeContext] ?? "");
        setStack(s => [{key: s[0].key}]);
        GetNamespaces(kubeContext).then(ns => setNamespaces(ns ?? [])).catch(() => setNamespaces([]));
        ListResources(kubeContext)
            .then(rs => setResources((rs ?? []) as ResourceInfo[]))
            .catch(e => setError(errText(e)));
    }, [kubeContext]);

    // Fall back to pods if the remembered resource doesn't exist on this cluster.
    useEffect(() => {
        if (resources.length && !resource) setStack([{key: "pods"}]);
    }, [resources, resource]);

    const setNamespace = (ns: string) => {
        setNamespaceState(ns);
        const all = load<Record<string, string>>("namespaces", {});
        save("namespaces", {...all, [kubeContext]: ns});
        setStack(s => [{key: s[0].key}]);
    };

    const refreshForwards = () => ListPortForwards().then(f => setForwards((f ?? []) as Forward[]));

    // --- loading the current view ------------------------------------------

    const reqSeq = useRef(0);
    const reload = useCallback(() => {
        if (!kubeContext || !resource) return;
        const seq = ++reqSeq.current;
        setLoading(true);
        ListTable(kubeContext, view.key, effectiveNs, view.labelSelector ?? "", view.fieldSelector ?? "")
            .then(t => {
                if (seq !== reqSeq.current) return;
                setTable(t as Table);
                setError("");
                setUpdated(new Date());
            })
            .catch(e => seq === reqSeq.current && setError(errText(e)))
            .finally(() => seq === reqSeq.current && setLoading(false));
    }, [kubeContext, resource, view, effectiveNs]);

    useEffect(() => {
        setTable(null);
        setCursor(0);
        setSort(null);
        reload();
        if (!kubeContext || !resource) return;
        save("lastResource", stack[0].key);
        WatchResource(kubeContext, view.key, effectiveNs, view.labelSelector ?? "", view.fieldSelector ?? "").catch(() => undefined);
        const off = EventsOn("resource:changed", (key: string) => key === view.key && reload());
        const poll = setInterval(reload, 15000); // keeps ages fresh and covers non-watchable resources
        return () => {
            off();
            clearInterval(poll);
            StopWatch();
        };
    }, [reload]);

    // --- table shaping -----------------------------------------------------

    const display = useMemo<DisplayTable>(() => {
        if (!table) return {columns: [], cellIndex: [], rows: []};
        const columns: Column[] = [];
        const cellIndex: number[] = [];
        if (resource?.namespaced && !effectiveNs) {
            columns.push({name: "Namespace", type: "string", priority: 0, description: ""});
            cellIndex.push(-1);
        }
        table.columns.forEach((c, i) => {
            if (wide || c.priority === 0) {
                columns.push(c);
                cellIndex.push(i);
            }
        });
        const q = filter.trim().toLowerCase();
        let rows = q
            ? table.rows.filter(r => (r.namespace + " " + r.cells.join(" ")).toLowerCase().includes(q))
            : table.rows.slice();
        if (sort && columns[sort.col]) {
            const idx = cellIndex[sort.col];
            const name = columns[sort.col].name;
            const get = (r: typeof rows[0]) => idx === -1 ? r.namespace : r.cells[idx] ?? "";
            rows.sort((a, b) => compareCells(get(a), get(b), name) * (sort.desc ? -1 : 1));
        }
        return {columns, cellIndex, rows};
    }, [table, wide, filter, sort, resource, effectiveNs]);

    useEffect(() => {
        setCursor(c => Math.min(c, Math.max(display.rows.length - 1, 0)));
    }, [display.rows.length]);

    // Keep the panel on the same object across refreshes; follow the cursor when it moves.
    const rowAt = (i: number) => display.rows[i];
    const selectRow = (i: number, open = true) => {
        setCursor(i);
        const r = rowAt(i);
        if (r && (open || selected)) {
            setSelected({key: view.key, name: r.name, namespace: r.namespace, uid: r.uid});
        }
    };
    const selectedRow = useMemo(
        () => selected && table?.rows.find(r => r.uid === selected.uid),
        [selected, table]);

    // --- actions -----------------------------------------------------------

    const unlock = async () => {
        const ok = await dialogs.confirm({
            title: "Allow changes?",
            body: <>K10S is read-only. Unlocking allows edits, deletes, restarts, scaling and shells on <b>{kubeContext}</b>.
                Every change still asks for confirmation.</>,
            confirmText: "Unlock", danger: true,
        });
        if (ok) {
            await SetReadOnly(false);
            setReadOnlyState(false);
        }
        return ok;
    };

    const toggleReadOnly = async () => {
        if (readOnly) await unlock();
        else {
            await SetReadOnly(true);
            setReadOnlyState(true);
        }
    };

    const mutate = async (fn: () => Promise<void>) => {
        if (readOnly && !(await unlock())) return;
        try {
            await fn();
        } catch (e) {
            toast(errText(e), "bad");
        }
    };

    const drill = async (i: number) => {
        const r = rowAt(i);
        if (!r) return;
        if (!(HAS_PODS.has(view.key) || view.key === "nodes" || view.key === "namespaces")) {
            selectRow(i);
            return;
        }
        try {
            const d = await DrillDown(kubeContext, view.key, r.namespace, r.name);
            setSelected(null);
            setFilter("");
            setStack(s => [...s, {key: d.key, namespace: d.namespace || (view.key === "nodes" ? "" : undefined), labelSelector: d.labelSelector, fieldSelector: d.fieldSelector, title: d.title}]);
        } catch (e) {
            toast(errText(e), "bad");
        }
    };

    const kind = resource?.kind ?? view.key;

    const actionsFor = (sel: Selected | null): Action[] => {
        if (!sel) return [];
        const k = sel.key;
        const label = `${kind.toLowerCase()} ${sel.name}`;
        const out: Action[] = [];
        if (HAS_PODS.has(k) || k === "nodes") {
            const i = display.rows.findIndex(r => r.uid === sel.uid);
            out.push({id: "drill", label: k === "nodes" ? "Show pods on node" : "Show pods", hotkey: "↵", run: () => drill(i)});
        }
        if (LOGGABLE.has(k)) out.push({id: "logs", label: "Logs", hotkey: "l", run: () => setTab("logs")});
        if (k === "pods") out.push({id: "shell", label: "Shell", hotkey: "s", run: () => (readOnly ? mutate(async () => setTab("shell")) : setTab("shell"))});
        if (FORWARDABLE.has(k)) out.push({id: "pf", label: "Port-forward", hotkey: "⇧F", run: () => setForwardTarget(sel)});
        out.push({id: "edit", label: "Edit YAML", hotkey: "e", run: () => mutate(async () => { setTab("yaml"); setEditRequest(n => n + 1); })});
        if (RESTARTABLE.has(k)) out.push({
            id: "restart", label: "Rollout restart", hotkey: "r", run: () => mutate(async () => {
                if (await dialogs.confirm({title: `Restart ${label}?`, body: "Pods are replaced using the rollout strategy.", confirmText: "Restart", danger: true})) {
                    await RolloutRestart(kubeContext, k, sel.namespace, sel.name);
                    toast(`Restarted ${sel.name}`);
                }
            }),
        });
        if (SCALABLE.has(k)) out.push({
            id: "scale", label: "Scale", hotkey: "⇧S", run: () => mutate(async () => {
                // Deployments/StatefulSets show "ready/desired"; ReplicaSets show desired directly.
                const c1 = selectedRow?.cells[1] ?? "1";
                const cur = c1.includes("/") ? c1.split("/")[1] : c1;
                const v = await dialogs.prompt({title: `Scale ${label}`, body: "Number of replicas", initial: cur, inputType: "number", confirmText: "Scale"});
                if (v === null || v === "") return;
                const n = Number(v);
                if (!Number.isInteger(n) || n < 0) throw new Error("Replicas must be a whole number ≥ 0");
                await Scale(kubeContext, k, sel.namespace, sel.name, n);
                toast(`Scaled ${sel.name} to ${n}`);
            }),
        });
        if (k === "cronjobs.batch") {
            const suspended = selectedRow?.cells[3] === "True";
            out.push({
                id: "trigger", label: "Trigger now", hotkey: "t", run: () => mutate(async () => {
                    if (await dialogs.confirm({title: `Trigger ${label}?`, body: "Creates a Job from the CronJob template right now.", confirmText: "Trigger", danger: true})) {
                        toast(`Created job ${await TriggerCronJob(kubeContext, sel.namespace, sel.name)}`);
                    }
                }),
            });
            out.push({
                id: "suspend", label: suspended ? "Resume" : "Suspend", hotkey: "", run: () => mutate(async () => {
                    if (await dialogs.confirm({title: `${suspended ? "Resume" : "Suspend"} ${label}?`, confirmText: suspended ? "Resume" : "Suspend", danger: true})) {
                        await SuspendCronJob(kubeContext, sel.namespace, sel.name, !suspended);
                        toast(`${suspended ? "Resumed" : "Suspended"} ${sel.name}`);
                    }
                }),
            });
        }
        if (k === "nodes") {
            const cordoned = (selectedRow?.cells[1] ?? "").includes("SchedulingDisabled");
            out.push({
                id: "cordon", label: cordoned ? "Uncordon" : "Cordon", hotkey: "c", run: () => mutate(async () => {
                    if (await dialogs.confirm({title: `${cordoned ? "Uncordon" : "Cordon"} node ${sel.name}?`,
                        body: cordoned ? "New pods can be scheduled on it again." : "No new pods will be scheduled on it. Existing pods keep running.",
                        confirmText: cordoned ? "Uncordon" : "Cordon", danger: true})) {
                        await Cordon(kubeContext, sel.name, !cordoned);
                        toast(`${cordoned ? "Uncordoned" : "Cordoned"} ${sel.name}`);
                    }
                }),
            });
        }
        out.push({
            id: "delete", label: "Delete", hotkey: "⌃D", danger: true, run: () => mutate(async () => {
                if (await dialogs.confirm({
                    title: `Delete ${label}?`, body: <>This deletes it from <b>{kubeContext}</b>{sel.namespace && <> in <b>{sel.namespace}</b></>}.</>,
                    confirmText: "Delete", danger: true, typeToConfirm: TYPE_TO_DELETE.has(k) ? sel.name : undefined,
                })) {
                    await DeleteObject(kubeContext, k, sel.namespace, sel.name, false);
                    toast(`Deleted ${sel.name}`);
                }
            }),
        });
        if (k === "pods") out.push({
            id: "kill", label: "Kill (force)", hotkey: "⌃K", danger: true, run: () => mutate(async () => {
                if (await dialogs.confirm({title: `Force-kill pod ${sel.name}?`, body: "Deletes immediately with no grace period.", confirmText: "Kill", danger: true})) {
                    await DeleteObject(kubeContext, k, sel.namespace, sel.name, true);
                    toast(`Killed ${sel.name}`);
                }
            }),
        });
        return out;
    };

    const actions = actionsFor(selected);

    // --- keyboard ----------------------------------------------------------

    const keyState = useRef({display, cursor, selected, actions, filter, stack});
    keyState.current = {display, cursor, selected, actions, filter, stack};
    const modalOpen = palette || help || showForwards || !!forwardTarget || dialogs.open;

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (modalOpen) return;
            const s = keyState.current;
            const run = (id: string) => s.actions.find(a => a.id === id)?.run();
            if (e.key === "Escape") {
                if (isTyping(e)) (e.target as HTMLElement).blur();
                if (s.filter) setFilter("");
                else if (s.selected) { setSelected(null); setMaximized(false); }
                else if (s.stack.length > 1) setStack(st => st.slice(0, -1));
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "r") { e.preventDefault(); reload(); return; }
            if (isTyping(e)) return;
            if (e.ctrlKey && e.key.toLowerCase() === "d") { e.preventDefault(); run("delete"); return; }
            if (e.ctrlKey && e.key.toLowerCase() === "k") { e.preventDefault(); run("kill"); return; }
            if (e.metaKey || e.ctrlKey || e.altKey) return;
            const n = s.display.rows.length;
            const move = (i: number) => { e.preventDefault(); if (n) selectRow(Math.max(0, Math.min(n - 1, i)), false); };
            switch (e.key) {
                case ":": e.preventDefault(); setPalette(true); break;
                case "/": e.preventDefault(); filterRef.current?.focus(); break;
                case "?": setHelp(true); break;
                case "ArrowDown": case "j": move(s.cursor + 1); break;
                case "ArrowUp": case "k": move(s.cursor - 1); break;
                case "g": move(0); break;
                case "G": move(n - 1); break;
                case "PageDown": move(s.cursor + 20); break;
                case "PageUp": move(s.cursor - 20); break;
                case "Enter": drill(s.cursor); break;
                case "0": setNamespace(""); break;
                case "w": setWide(w => { save("wide", !w); return !w; }); break;
                case "m": if (s.selected) setMaximized(x => !x); break;
                default: {
                    const tabKeys: Record<string, DetailTab> = {o: "overview", y: "yaml", d: "describe", v: "events", l: "logs"};
                    const openOn = (t: DetailTab) => { if (!s.selected) selectRow(s.cursor); setTab(t); };
                    if (tabKeys[e.key]) { openOn(tabKeys[e.key]); break; }
                    const r = s.display.rows[s.cursor];
                    if (!r) break;
                    const sel = s.selected ?? {key: view.key, name: r.name, namespace: r.namespace, uid: r.uid};
                    if (!s.selected) setSelected(sel);
                    const acts = actionsFor(sel);
                    const byKey: Record<string, string> = {s: "shell", e: "edit", F: "pf", r: "restart", S: "scale", t: "trigger", c: "cordon"};
                    if (e.key === "x" && sel.key === "secrets") { setTab("overview"); break; }
                    const id = byKey[e.key];
                    if (id) { e.preventDefault(); acts.find(a => a.id === id)?.run(); }
                }
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    // --- resizable panel ---------------------------------------------------

    const startResize = (e: React.MouseEvent) => {
        e.preventDefault();
        const startX = e.clientX, startW = panelWidth;
        let w = startW;
        const onMove = (ev: MouseEvent) => {
            w = Math.max(360, Math.min(window.innerWidth - 480, startW + startX - ev.clientX));
            setPanelWidth(w);
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
            save("panelWidth", w);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };

    // --- render ------------------------------------------------------------

    const crumbs = stack.map((v, i) => {
        const r = resources.find(x => x.key === v.key);
        const name = r ? plural(r) : v.key;
        return {label: v.title ? `${name} · ${v.title}` : name, i};
    });

    return (
        <div className="shell">
            <Sidebar contexts={contexts} kubeContext={kubeContext} onContext={setKubeContext}
                     namespaces={namespaces} namespace={namespace} onNamespace={setNamespace}
                     resources={resources} activeKey={stack[0].key}
                     onResource={key => { setSelected(null); setFilter(""); setStack([{key}]); }}
                     readOnly={readOnly} onToggleReadOnly={toggleReadOnly}
                     forwardCount={forwards.length} onShowForwards={() => { refreshForwards(); setShowForwards(true); }}
                     onHelp={() => setHelp(true)}/>

            <main className="content">
                <header className="toolbar">
                    <div className="crumbs">
                        {crumbs.map(c => (
                            <span key={c.i} className={c.i === crumbs.length - 1 ? "crumb current" : "crumb"}
                                  onClick={() => { setSelected(null); setStack(s => s.slice(0, c.i + 1)); }}>
                                {c.label}
                            </span>
                        ))}
                        <span className="count">{display.rows.length}{table && filter ? ` of ${table.rows.length}` : ""}</span>
                        {resource?.namespaced && !view.namespace && <span className="ns-tag">{namespace || "all namespaces"}</span>}
                    </div>
                    <input ref={filterRef} className="filter" placeholder="Filter  /" value={filter}
                           onChange={e => { setFilter(e.target.value); setCursor(0); }} autoComplete="off" spellCheck={false}
                           onKeyDown={e => { if (e.key === "Enter" || e.key === "ArrowDown") { e.currentTarget.blur(); } }}/>
                    <button className={"toggle" + (wide ? " on" : "")} data-tip="Show all columns (w)"
                            onClick={() => setWide(w => { save("wide", !w); return !w; })}>Wide</button>
                    <button onClick={reload} disabled={loading} data-tip="Refresh (⌘R)" aria-label="Refresh">{loading ? "…" : "↻"}</button>
                    <button onClick={() => setPalette(true)} data-tip="Command bar (:)" aria-label="Command bar">:</button>
                </header>
                {error && <div className="error">{error}</div>}
                <ResourceTable table={display} cursor={cursor} sort={sort} loading={loading || !table}
                               empty={filter ? "No rows match the filter" : `No ${resource ? plural(resource).toLowerCase() : "items"} found`}
                               onSort={col => setSort(s => s?.col === col ? (s.desc ? null : {col, desc: true}) : {col, desc: false})}
                               onCursor={i => selectRow(i)} onOpen={drill}/>
                <footer className="statusbar">
                    <span>{kubeContext}</span>
                    <span className={readOnly ? "" : "warn-text"}>{readOnly ? "read-only" : "changes allowed"}</span>
                    {table?.metrics && <span>metrics-server ✓</span>}
                    <span className="spacer"/>
                    {updated && <span>updated {updated.toLocaleTimeString()}</span>}
                    <span>press <kbd>?</kbd> for shortcuts</span>
                </footer>
            </main>

            {selected && (
                <>
                    {!maximized && <div className="resizer" onMouseDown={startResize}/>}
                    <div className="detail-wrap" style={maximized ? undefined : {width: panelWidth}}>
                        <DetailPanel key={selected.uid} kubeContext={kubeContext} sel={selected} kind={kind} row={selectedRow ?? undefined}
                                     tab={tab} onTab={setTab} editRequest={editRequest} actions={actions} readOnly={readOnly}
                                     maximized={maximized} onMaximize={() => setMaximized(m => !m)}
                                     onClose={() => { setSelected(null); setMaximized(false); }}
                                     confirm={dialogs.confirm} toast={toast}/>
                    </div>
                </>
            )}

            {palette && <CommandPalette resources={resources} contexts={contexts} namespaces={namespaces}
                                        onResource={key => { setSelected(null); setFilter(""); setStack([{key}]); }}
                                        onContext={setKubeContext} onNamespace={setNamespace} onClose={() => setPalette(false)}/>}
            {help && <Help onClose={() => setHelp(false)}/>}
            {showForwards && <ForwardsList forwards={forwards} onChange={refreshForwards} onClose={() => setShowForwards(false)}/>}
            {forwardTarget && <StartForward kubeContext={kubeContext} sel={forwardTarget} onClose={() => setForwardTarget(null)}
                                            onDone={f => { setForwardTarget(null); refreshForwards(); toast(`Forwarding localhost:${f.localPort} → ${f.pod}:${f.remotePort}`); }}/>}
            {dialogs.element}
            <Tooltip/>
            <div className="toasts">
                {toasts.map(t => <div key={t.id} className={"toast " + t.tone}>{t.msg}</div>)}
            </div>
        </div>
    );
}

export default App
