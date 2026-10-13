import {useEffect, useMemo, useRef, useState} from "react";
import {ResourceInfo} from "../types";
import {matchesResource, plural} from "../util";

interface Props {
    resources: ResourceInfo[];
    contexts: string[];
    namespaces: string[];
    onResource: (key: string) => void;
    onContext: (c: string) => void;
    onNamespace: (ns: string) => void;
    onClose: () => void;
}

interface Item {
    label: string;
    hint: string;
    run: () => void;
}

/** k9s-style ":" command bar: `pods`, `deploy`, `ctx <name>`, `ns <name>`. */
export function CommandPalette(p: Props) {
    const [q, setQ] = useState("");
    const [idx, setIdx] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => inputRef.current?.focus(), []);

    const items = useMemo<Item[]>(() => {
        const [cmd, ...rest] = q.trim().split(/\s+/);
        const arg = rest.join(" ").toLowerCase();
        if (cmd === "ctx" || cmd === "context") {
            return p.contexts.filter(c => c.toLowerCase().includes(arg))
                .map(c => ({label: c, hint: "context", run: () => p.onContext(c)}));
        }
        if (cmd === "ns" || cmd === "namespace") {
            return [{name: "", label: "All namespaces"}, ...p.namespaces.map(n => ({name: n, label: n}))]
                .filter(n => n.label.toLowerCase().includes(arg))
                .map(n => ({label: n.label, hint: "namespace", run: () => p.onNamespace(n.name)}));
        }
        const exact = (r: ResourceInfo) => r.resource === q || r.shortNames?.includes(q) || r.kind.toLowerCase() === q;
        const res = p.resources.filter(r => matchesResource(q, r))
            .sort((a, b) => Number(exact(b)) - Number(exact(a)) || a.resource.length - b.resource.length)
            .slice(0, 50)
            .map(r => ({
                label: plural(r),
                hint: [r.key, ...(r.shortNames ?? [])].join(" · "),
                run: () => p.onResource(r.key),
            }));
        const extra: Item[] = [];
        if ("ctx".startsWith(q) || "context".startsWith(q)) extra.push({label: "ctx …", hint: "switch context", run: () => setQ("ctx ")});
        if ("ns".startsWith(q) || "namespace".startsWith(q)) extra.push({label: "ns …", hint: "switch namespace", run: () => setQ("ns ")});
        return q ? [...res, ...extra] : [...extra, ...res];
    }, [q, p]);

    useEffect(() => setIdx(0), [q]);

    const choose = (i: number) => {
        const it = items[i];
        if (!it) return;
        it.run();
        if (!it.label.endsWith("…")) p.onClose();
    };

    return (
        <div className="modal-backdrop top" onMouseDown={p.onClose}>
            <div className="palette" onMouseDown={e => e.stopPropagation()}>
                <div className="palette-input">
                    <span className="colon">:</span>
                    <input ref={inputRef} value={q} placeholder="pods, deploy, svc, ctx <name>, ns <name>…"
                           onChange={e => setQ(e.target.value)} autoComplete="off" spellCheck={false}
                           onKeyDown={e => {
                               e.stopPropagation();
                               if (e.key === "Escape") p.onClose();
                               else if (e.key === "ArrowDown") { setIdx(i => Math.min(i + 1, items.length - 1)); e.preventDefault(); }
                               else if (e.key === "ArrowUp") { setIdx(i => Math.max(i - 1, 0)); e.preventDefault(); }
                               else if (e.key === "Enter") choose(idx);
                               else if (e.key === "Tab" && items[idx]) { e.preventDefault(); setQ(items[idx].label.replace(" …", " ").toLowerCase()); }
                           }}/>
                </div>
                <ul>
                    {items.map((it, i) => (
                        <li key={it.label + it.hint} className={i === idx ? "active" : ""}
                            onMouseEnter={() => setIdx(i)} onClick={() => choose(i)}>
                            <span>{it.label}</span><span className="muted small">{it.hint}</span>
                        </li>
                    ))}
                    {items.length === 0 && <li className="muted">No matches</li>}
                </ul>
            </div>
        </div>
    );
}
