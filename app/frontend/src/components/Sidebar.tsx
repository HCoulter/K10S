import {useMemo, useState} from "react";
import {ResourceInfo} from "../types";
import {FAVORITES, matchesResource, plural} from "../util";
import logo from "../assets/logo.png";

interface Props {
    contexts: string[];
    kubeContext: string;
    onContext: (c: string) => void;
    namespaces: string[];
    namespace: string;
    onNamespace: (ns: string) => void;
    resources: ResourceInfo[];
    activeKey: string;
    onResource: (key: string) => void;
    readOnly: boolean;
    onToggleReadOnly: () => void;
    forwardCount: number;
    onShowForwards: () => void;
    onHelp: () => void;
}

export function Sidebar(p: Props) {
    const [query, setQuery] = useState("");
    const [showAll, setShowAll] = useState(false);

    const favorites = useMemo(
        () => FAVORITES.map(k => p.resources.find(r => r.key === k)).filter(Boolean) as ResourceInfo[],
        [p.resources]);

    const groups = useMemo(() => {
        const m = new Map<string, ResourceInfo[]>();
        for (const r of p.resources) {
            if (!matchesResource(query, r)) continue;
            const g = r.group || "core";
            m.set(g, [...(m.get(g) ?? []), r]);
        }
        return [...m.entries()].sort(([a], [b]) => (a === "core" ? -1 : b === "core" ? 1 : a.localeCompare(b)));
    }, [p.resources, query]);

    const item = (r: ResourceInfo) => (
        <li key={r.key} className={p.activeKey === r.key ? "active" : ""} onClick={() => p.onResource(r.key)}
            data-tip={r.key}>
            {plural(r)}
        </li>
    );

    return (
        <aside className="sidebar">
            <div className="brand-row">
                <div className="brand"><img src={logo} alt=""/><span>K<span className="ten">10</span>S</span></div>
                <button className="icon" data-tip="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts" onClick={p.onHelp}>?</button>
            </div>

            <label>Context</label>
            <select value={p.kubeContext} onChange={e => p.onContext(e.target.value)}>
                {p.contexts.map(c => <option key={c} value={c}>{c}</option>)}
            </select>

            <label>Namespace</label>
            <select value={p.namespace} onChange={e => p.onNamespace(e.target.value)}>
                <option value="">All namespaces</option>
                {p.namespaces.map(ns => <option key={ns} value={ns}>{ns}</option>)}
            </select>

            <button className={"lock " + (p.readOnly ? "locked" : "unlocked")} onClick={p.onToggleReadOnly}
                    data-tip="Read-only blocks edits, deletes, restarts, scaling and shells">
                {p.readOnly ? "🔒 Read-only" : "🔓 Changes allowed"}
            </button>

            <div className="nav">
                <label>Resources</label>
                <ul className="nav-list">{favorites.map(item)}</ul>

                <label className="clickable" onClick={() => setShowAll(!showAll)}>
                    {showAll ? "▾" : "▸"} All resources ({p.resources.length})
                </label>
                {showAll && (
                    <>
                        <input className="nav-filter" placeholder="Find resource…" value={query}
                               onChange={e => setQuery(e.target.value)}/>
                        {groups.map(([g, rs]) => (
                            <div key={g}>
                                <div className="group-name">{g}</div>
                                <ul className="nav-list">{rs.map(item)}</ul>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <button className="forwards" onClick={p.onShowForwards}>
                Port-forwards <span className="badge">{p.forwardCount}</span>
            </button>
        </aside>
    );
}
