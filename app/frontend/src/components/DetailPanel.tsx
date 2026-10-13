import {useCallback, useEffect, useState} from "react";
import CodeMirror from "@uiw/react-codemirror";
import {yaml} from "@codemirror/lang-yaml";
import {oneDark} from "@codemirror/theme-one-dark";
import {EditorView} from "@codemirror/view";
import {ApplyYAML, DecodeSecret, Describe, GetEvents, GetYAML} from "../../wailsjs/go/main/App";
import {DetailTab, Row, Selected} from "../types";
import {errText} from "../util";
import {LogsView} from "./LogsView";
import {ShellView} from "./ShellView";

export interface Action {
    id: string;
    label: string;
    hotkey: string;
    danger?: boolean;
    run: () => void;
}

interface Props {
    kubeContext: string;
    sel: Selected;
    kind: string;
    row?: Row;
    tab: DetailTab;
    onTab: (t: DetailTab) => void;
    editRequest: number;
    actions: Action[];
    readOnly: boolean;
    maximized: boolean;
    onMaximize: () => void;
    onClose: () => void;
    confirm: (o: { title: string; body?: React.ReactNode; confirmText?: string; danger?: boolean }) => Promise<boolean>;
    toast: (msg: string, tone?: "ok" | "bad") => void;
}

// one-dark syntax colours on the K10S navy background.
const k10sEditor = EditorView.theme({
    "&": {backgroundColor: "var(--code-bg)"},
    ".cm-gutters": {backgroundColor: "var(--code-bg)", borderRight: "1px solid var(--border)", color: "var(--muted)"},
    ".cm-activeLine, .cm-activeLineGutter": {backgroundColor: "rgba(50, 110, 220, 0.12)"},
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {backgroundColor: "rgba(50, 110, 220, 0.4) !important"},
    ".cm-cursor": {borderLeftColor: "var(--accent)"},
}, {dark: true});

const LOGGABLE = new Set(["pods", "deployments.apps", "statefulsets.apps", "daemonsets.apps", "replicasets.apps", "jobs.batch", "services"]);

export function DetailPanel(p: Props) {
    const tabs: [DetailTab, string, string][] = [
        ["overview", "Overview", "o"],
        ["yaml", "YAML", "y"],
        ["describe", "Describe", "d"],
        ["events", "Events", "v"],
    ];
    if (LOGGABLE.has(p.sel.key)) tabs.push(["logs", "Logs", "l"]);
    if (p.sel.key === "pods") tabs.push(["shell", "Shell", "s"]);
    const tab = tabs.some(t => t[0] === p.tab) ? p.tab : "overview";

    return (
        <aside className={"detail" + (p.maximized ? " max" : "")}>
            <header className="detail-head">
                <div className="detail-title">
                    <span className="kind">{p.kind}</span>
                    <h2>{p.sel.name}</h2>
                    {p.sel.namespace && <span className="muted small">{p.sel.namespace}</span>}
                </div>
                <div className="detail-buttons">
                    <button className="icon" data-tip={p.maximized ? "Restore (m)" : "Maximize (m)"} aria-label={p.maximized ? "Restore" : "Maximize"} onClick={p.onMaximize}>{p.maximized ? "⤡" : "⤢"}</button>
                    <button className="icon" data-tip="Close (Esc)" aria-label="Close" onClick={p.onClose}>×</button>
                </div>
            </header>
            <nav className="tabs">
                {tabs.map(([id, label, key]) => (
                    <button key={id} className={tab === id ? "active" : ""} onClick={() => p.onTab(id)} data-tip={`Shortcut: ${key}`}>
                        {label}
                    </button>
                ))}
            </nav>
            <div className="detail-body">
                {tab === "overview" && <Overview {...p}/>}
                {tab === "yaml" && <YamlTab {...p}/>}
                {tab === "describe" && <DescribeTab {...p}/>}
                {tab === "events" && <EventsTab {...p}/>}
                {tab === "logs" && <LogsView kubeContext={p.kubeContext} sel={p.sel}/>}
                {tab === "shell" && <ShellView kubeContext={p.kubeContext} sel={p.sel} readOnly={p.readOnly}/>}
            </div>
        </aside>
    );
}

function Overview(p: Props) {
    const [secret, setSecret] = useState<Record<string, string> | null>(null);
    const [reveal, setReveal] = useState(false);
    useEffect(() => {
        setSecret(null);
        setReveal(false);
    }, [p.sel.uid]);

    const loadSecret = () => DecodeSecret(p.kubeContext, p.sel.namespace, p.sel.name)
        .then(s => {
            setSecret(s);
            setReveal(true);
        })
        .catch(e => p.toast(errText(e), "bad"));

    const labels = Object.entries(p.row?.labels ?? {});
    return (
        <div className="overview">
            <section>
                <h4>Actions</h4>
                <div className="action-grid">
                    {p.actions.map(a => (
                        <button key={a.id} className={a.danger ? "danger-outline" : ""} onClick={a.run}>
                            {a.label}<kbd>{a.hotkey}</kbd>
                        </button>
                    ))}
                </div>
            </section>
            {p.row && (
                <section>
                    <h4>Summary</h4>
                    <dl>
                        <dt>Kind</dt><dd>{p.kind}</dd>
                        <dt>Name</dt><dd>{p.sel.name}</dd>
                        {p.sel.namespace && <><dt>Namespace</dt><dd>{p.sel.namespace}</dd></>}
                        {p.row.created && <><dt>Created</dt><dd>{new Date(p.row.created).toLocaleString()}</dd></>}
                        <dt>UID</dt><dd className="mono small">{p.sel.uid}</dd>
                    </dl>
                </section>
            )}
            {labels.length > 0 && (
                <section>
                    <h4>Labels</h4>
                    <div className="chips">
                        {labels.map(([k, v]) => <span key={k} className="chip">{k}={v}</span>)}
                    </div>
                </section>
            )}
            {p.sel.key === "secrets" && (
                <section>
                    <h4>Data</h4>
                    {!reveal ? (
                        <button onClick={loadSecret}>Decode &amp; reveal values (x)</button>
                    ) : (
                        <>
                            <button onClick={() => setReveal(false)}>Hide</button>
                            <dl className="secret">
                                {Object.entries(secret ?? {}).map(([k, v]) => (
                                    <div key={k} className="secret-row">
                                        <dt>{k}</dt>
                                        <dd><pre>{v}</pre>
                                            <button className="small-btn" onClick={() => navigator.clipboard?.writeText(v)}>Copy</button></dd>
                                    </div>
                                ))}
                            </dl>
                        </>
                    )}
                </section>
            )}
        </div>
    );
}

function YamlTab(p: Props) {
    const [doc, setDoc] = useState("");
    const [draft, setDraft] = useState("");
    const [editing, setEditing] = useState(false);
    const [managed, setManaged] = useState(false);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    const load = useCallback(() => {
        setError("");
        GetYAML(p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name, managed)
            .then(y => {
                setDoc(y);
                setDraft(y);
            })
            .catch(e => setError(errText(e)));
    }, [p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name, managed]);

    useEffect(() => {
        setEditing(false);
        load();
    }, [load]);

    // "e" from the keyboard opens the editor.
    useEffect(() => {
        if (p.editRequest > 0 && !p.readOnly) setEditing(true);
    }, [p.editRequest, p.readOnly]);

    const apply = async () => {
        const ok = await p.confirm({
            title: `Apply changes to ${p.kind.toLowerCase()} ${p.sel.name}?`,
            body: <>This replaces the live object in <b>{p.kubeContext}</b>.</>,
            confirmText: "Apply", danger: true,
        });
        if (!ok) return;
        setBusy(true);
        try {
            await ApplyYAML(p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name, draft);
            p.toast("Applied");
            setEditing(false);
            load();
        } catch (e) {
            setError(errText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="yaml-tab">
            <div className="logs-bar">
                {!editing ? (
                    <>
                        <button onClick={() => setEditing(true)} disabled={p.readOnly}
                                data-tip={p.readOnly ? "Unlock changes to edit" : "Edit (e)"}>Edit</button>
                        <button onClick={load}>Reload</button>
                        <button className={"toggle" + (managed ? " on" : "")} onClick={() => setManaged(!managed)}>Managed fields</button>
                        <button onClick={() => navigator.clipboard?.writeText(doc)}>Copy</button>
                    </>
                ) : (
                    <>
                        <button className="primary" onClick={apply} disabled={busy || draft === doc}>Apply</button>
                        <button onClick={() => {
                            setDraft(doc);
                            setEditing(false);
                            setError("");
                        }}>Cancel</button>
                        <span className="muted small">Editing — changes aren't saved until you apply.</span>
                    </>
                )}
            </div>
            {error && <div className="error">{error}</div>}
            <div className="cm-host">
                <CodeMirror value={editing ? draft : doc} onChange={setDraft} editable={editing} readOnly={!editing}
                            extensions={[yaml(), k10sEditor]} theme={oneDark} height="100%" basicSetup={{foldGutter: true}}/>
            </div>
        </div>
    );
}

function DescribeTab(p: Props) {
    const [text, setText] = useState("");
    const [error, setError] = useState("");
    const load = useCallback(() => {
        setError("");
        Describe(p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name).then(setText).catch(e => setError(errText(e)));
    }, [p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name]);
    useEffect(load, [load]);
    return (
        <div className="describe">
            <div className="logs-bar">
                <button onClick={load}>Reload</button>
                <button onClick={() => navigator.clipboard?.writeText(text)}>Copy</button>
            </div>
            {error && <div className="error">{error}</div>}
            <pre className="describe-text">{text || (!error && "Loading…")}</pre>
        </div>
    );
}

interface Ev {
    type: string;
    reason: string;
    message: string;
    count: number;
    source: string;
    last: string;
}

function EventsTab(p: Props) {
    const [events, setEvents] = useState<Ev[] | null>(null);
    const [error, setError] = useState("");
    useEffect(() => {
        setEvents(null);
        GetEvents(p.kubeContext, p.sel.key === "namespaces" ? p.sel.name : p.sel.namespace, p.sel.key === "namespaces" ? "" : p.sel.uid)
            .then(e => setEvents(e ?? []))
            .catch(e => setError(errText(e)));
    }, [p.kubeContext, p.sel.key, p.sel.namespace, p.sel.name, p.sel.uid]);
    if (error) return <div className="error">{error}</div>;
    if (!events) return <div className="empty">Loading…</div>;
    if (!events.length) return <div className="empty">No recent events. Kubernetes keeps events for about an hour.</div>;
    return (
        <div className="table-wrap">
            <table>
                <thead><tr><th>Type</th><th>Reason</th><th>Last</th><th>Count</th><th>Message</th></tr></thead>
                <tbody>
                {events.map((e, i) => (
                    <tr key={i}>
                        <td><span className={"pill " + (e.type === "Warning" ? "warn" : "")}>{e.type}</span></td>
                        <td>{e.reason}</td>
                        <td>{e.last}</td>
                        <td>{e.count}</td>
                        <td className="wrap-cell">{e.message}</td>
                    </tr>
                ))}
                </tbody>
            </table>
        </div>
    );
}
