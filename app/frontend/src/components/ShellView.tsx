import {useEffect, useRef, useState} from "react";
import {Terminal} from "@xterm/xterm";
import {FitAddon} from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import {GetContainers, ShellInput, ShellResize, StartShell, StopShell} from "../../wailsjs/go/main/App";
import {EventsOn} from "../../wailsjs/runtime/runtime";
import {Selected} from "../types";
import {errText} from "../util";

function b64ToBytes(b64: string) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

export function ShellView({kubeContext, sel, readOnly}: { kubeContext: string; sel: Selected; readOnly: boolean }) {
    const [pods, setPods] = useState<string[]>([]);
    const [containers, setContainers] = useState<string[]>([]);
    const [pod, setPod] = useState("");
    const [container, setContainer] = useState("");
    const [session, setSession] = useState(0); // bump to reconnect
    const [state, setState] = useState("");
    const hostRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        GetContainers(kubeContext, sel.key, sel.namespace, sel.name).then(info => {
            const cs = (info.containers ?? []).filter(c => !c.init).map(c => c.name);
            setPods(info.pods ?? []);
            setPod(info.pods?.[0] ?? "");
            setContainers(cs);
            setContainer(cs[0] ?? "");
        }).catch(e => setState(errText(e)));
    }, [kubeContext, sel.key, sel.namespace, sel.name]);

    useEffect(() => {
        if (!pod || !container || readOnly || !hostRef.current) return;
        const term = new Terminal({
            cursorBlink: true, fontSize: 12.5, fontFamily: "SF Mono, Menlo, monospace",
            theme: {background: "#050c18", foreground: "#e8f1ff", cursor: "#06d5f7", selectionBackground: "#326edc73", blue: "#326edc", cyan: "#06d5f7", brightBlue: "#5b8ff0", brightCyan: "#5fe6fb"}, scrollback: 5000,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        fit.fit();
        term.focus();

        let id = "";
        let closed = false;
        const offs: (() => void)[] = [];
        setState("Connecting…");
        StartShell(kubeContext, sel.namespace, pod, container, term.cols, term.rows).then(sid => {
            if (closed) {
                StopShell(sid);
                return;
            }
            id = sid;
            setState("Connected");
            offs.push(EventsOn("shell:" + sid, (b64: string) => term.write(b64ToBytes(b64))));
            offs.push(EventsOn("shell:" + sid + ":exit", (msg: string) => {
                term.write(`\r\n\x1b[90m[session ended${msg ? ": " + msg : ""}]\x1b[0m\r\n`);
                setState("Disconnected");
            }));
        }).catch(e => {
            term.write(`\x1b[31m${errText(e)}\x1b[0m\r\n`);
            setState("Failed");
        });
        const dataSub = term.onData(d => id && ShellInput(id, d));
        const resizeSub = term.onResize(({cols, rows}) => id && ShellResize(id, cols, rows));
        const ro = new ResizeObserver(() => fit.fit());
        ro.observe(hostRef.current);

        return () => {
            closed = true;
            ro.disconnect();
            dataSub.dispose();
            resizeSub.dispose();
            offs.forEach(off => off());
            if (id) StopShell(id);
            term.dispose();
        };
    }, [kubeContext, sel.namespace, pod, container, session, readOnly]);

    if (readOnly) {
        return <div className="empty">Shell access is disabled in read-only mode. Unlock changes in the sidebar to open a shell.</div>;
    }

    return (
        <div className="shell-view">
            <div className="logs-bar">
                {pods.length > 1 && (
                    <select value={pod} onChange={e => setPod(e.target.value)} data-tip="Pod">
                        {pods.map(p => <option key={p}>{p}</option>)}
                    </select>
                )}
                <select value={container} onChange={e => setContainer(e.target.value)} data-tip="Container">
                    {containers.map(c => <option key={c}>{c}</option>)}
                </select>
                <button onClick={() => setSession(s => s + 1)}>Reconnect</button>
                <span className="muted small">{state}</span>
            </div>
            <div className="term-host" ref={hostRef}/>
        </div>
    );
}
