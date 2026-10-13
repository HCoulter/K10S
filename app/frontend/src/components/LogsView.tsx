import {useEffect, useLayoutEffect, useMemo, useRef, useState} from "react";
import {GetContainers, StartLogs, StopLogs} from "../../wailsjs/go/main/App";
import {EventsOn} from "../../wailsjs/runtime/runtime";
import {Selected} from "../types";
import {errText} from "../util";

interface LogLine {
    pod: string;
    container: string;
    text: string;
}

interface ContainerInfo {
    name: string;
    init: boolean;
}

const MAX_LINES = 20000;
const TAILS = [100, 500, 1000, 5000, -1];

export function LogsView({kubeContext, sel}: { kubeContext: string; sel: Selected }) {
    const [containers, setContainers] = useState<ContainerInfo[]>([]);
    const [podCount, setPodCount] = useState(0);
    const [container, setContainer] = useState<string | null>(null);
    const [follow, setFollow] = useState(true);
    const [previous, setPrevious] = useState(false);
    const [timestamps, setTimestamps] = useState(false);
    const [tail, setTail] = useState(500);
    const [wrap, setWrap] = useState(true);
    const [search, setSearch] = useState("");
    const [lines, setLines] = useState<LogLine[]>([]);
    const [status, setStatus] = useState("");
    const [error, setError] = useState("");
    const [pinned, setPinned] = useState(true);
    const boxRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setContainer(null);
        GetContainers(kubeContext, sel.key, sel.namespace, sel.name)
            .then(info => {
                const cs = (info.containers ?? []) as ContainerInfo[];
                setContainers(cs);
                setPodCount(info.pods?.length ?? 0);
                // Default to the first app container on single pods, like k9s; all containers otherwise.
                const main = cs.find(c => !c.init);
                setContainer(sel.key === "pods" && main && cs.filter(c => !c.init).length === 1 ? main.name : "");
            })
            .catch(e => setError(errText(e)));
    }, [kubeContext, sel.key, sel.namespace, sel.name]);

    useEffect(() => {
        if (container === null) return;
        let id = "";
        let cancelled = false;
        const offs: (() => void)[] = [];
        setLines([]);
        setError("");
        setStatus("Connecting…");
        StartLogs(kubeContext, sel.key, sel.namespace, sel.name, {
            container, follow, previous, timestamps, tailLines: tail, sinceSeconds: 0,
        }).then(sid => {
            if (cancelled) {
                StopLogs(sid);
                return;
            }
            id = sid;
            setStatus(follow ? "Streaming" : "Loaded");
            offs.push(EventsOn("logs:" + sid, (batch: LogLine[]) =>
                setLines(prev => {
                    const next = prev.concat(batch);
                    return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
                })));
            offs.push(EventsOn("logs:" + sid + ":end", () => setStatus(follow ? "Stream ended" : "Loaded")));
        }).catch(e => {
            setError(errText(e));
            setStatus("");
        });
        return () => {
            cancelled = true;
            offs.forEach(off => off());
            if (id) StopLogs(id);
        };
    }, [kubeContext, sel.key, sel.namespace, sel.name, container, follow, previous, timestamps, tail]);

    const multi = podCount > 1 || container === "";
    const shown = useMemo(() => {
        const q = search.toLowerCase();
        const fmt = (l: LogLine) => (multi ? `[${podCount > 1 ? l.pod + "/" : ""}${l.container}] ` : "") + l.text;
        const all = lines.map(fmt);
        return q ? all.filter(l => l.toLowerCase().includes(q)) : all;
    }, [lines, search, multi, podCount]);

    useLayoutEffect(() => {
        const el = boxRef.current;
        if (el && pinned) el.scrollTop = el.scrollHeight;
    }, [shown, pinned]);

    const copy = () => navigator.clipboard?.writeText(shown.join("\n"));

    return (
        <div className="logs">
            <div className="logs-bar">
                <select value={container ?? ""} onChange={e => setContainer(e.target.value)} data-tip="Container">
                    <option value="">All containers</option>
                    {containers.map(c => <option key={c.name} value={c.name}>{c.name}{c.init ? " (init)" : ""}</option>)}
                </select>
                <select value={tail} onChange={e => setTail(Number(e.target.value))} data-tip="Lines from the end">
                    {TAILS.map(t => <option key={t} value={t}>{t < 0 ? "All lines" : `Last ${t}`}</option>)}
                </select>
                <Toggle on={follow} set={setFollow} label="Follow"/>
                <Toggle on={previous} set={setPrevious} label="Previous"/>
                <Toggle on={timestamps} set={setTimestamps} label="Timestamps"/>
                <Toggle on={wrap} set={setWrap} label="Wrap"/>
                <input className="logs-search" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)}/>
                <button onClick={() => setLines([])} data-tip="Clear">Clear</button>
                <button onClick={copy} data-tip="Copy visible lines">Copy</button>
                <span className="muted small">{status}{lines.length ? ` · ${shown.length} lines` : ""}</span>
            </div>
            {error && <div className="error">{error}</div>}
            <div ref={boxRef} className={"log-box" + (wrap ? " wrap" : "")}
                 onScroll={e => {
                     const el = e.currentTarget;
                     setPinned(el.scrollHeight - el.scrollTop - el.clientHeight < 30);
                 }}>
                <pre>{shown.join("\n")}</pre>
                {!shown.length && !error && <div className="empty">{status === "Connecting…" ? "Waiting for logs…" : "No log lines"}</div>}
            </div>
        </div>
    );
}

function Toggle({on, set, label}: { on: boolean; set: (v: boolean) => void; label: string }) {
    return <button className={"toggle" + (on ? " on" : "")} onClick={() => set(!on)}>{label}</button>;
}
