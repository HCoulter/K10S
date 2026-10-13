import {useEffect, useState} from "react";
import {GetPorts, StartPortForward, StopPortForward} from "../../wailsjs/go/main/App";
import {BrowserOpenURL} from "../../wailsjs/runtime/runtime";
import {Selected} from "../types";
import {errText} from "../util";

export interface Forward {
    id: string;
    context: string;
    namespace: string;
    target: string;
    pod: string;
    localPort: number;
    remotePort: number;
}

export function ForwardsList({forwards, onChange, onClose}: { forwards: Forward[]; onChange: () => void; onClose: () => void }) {
    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div className="modal wide" onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") onClose(); e.stopPropagation(); }}>
                <h3>Port-forwards</h3>
                {forwards.length === 0 ? (
                    <p className="muted">No active port-forwards. Select a pod, service or workload and press <kbd>Shift+F</kbd>.</p>
                ) : (
                    <table>
                        <thead><tr><th>Local</th><th>Target</th><th>Pod</th><th>Context</th><th/></tr></thead>
                        <tbody>
                        {forwards.map(f => (
                            <tr key={f.id}>
                                <td><a href="#" onClick={e => { e.preventDefault(); BrowserOpenURL(`http://localhost:${f.localPort}`); }}>
                                    localhost:{f.localPort}</a> → {f.remotePort}</td>
                                <td>{f.namespace}/{f.target}</td>
                                <td className="muted">{f.pod}</td>
                                <td className="muted small">{f.context}</td>
                                <td><button onClick={() => StopPortForward(f.id).then(onChange)}>Stop</button></td>
                            </tr>
                        ))}
                        </tbody>
                    </table>
                )}
                <div className="modal-actions"><button autoFocus onClick={onClose}>Close</button></div>
            </div>
        </div>
    );
}

interface Opt {
    port: number;
    label: string;
}

export function StartForward({kubeContext, sel, onDone, onClose}: {
    kubeContext: string; sel: Selected; onDone: (f: Forward) => void; onClose: () => void;
}) {
    const [opts, setOpts] = useState<Opt[]>([]);
    const [remote, setRemote] = useState("");
    const [local, setLocal] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        GetPorts(kubeContext, sel.key, sel.namespace, sel.name).then(o => {
            setOpts(o ?? []);
            if (o?.[0]) {
                setRemote(String(o[0].port));
                setLocal(String(o[0].port));
            }
        }).catch(e => setError(errText(e)));
    }, [kubeContext, sel]);

    const start = async () => {
        setBusy(true);
        setError("");
        try {
            const f = await StartPortForward(kubeContext, sel.key, sel.namespace, sel.name, Number(local) || 0, Number(remote));
            onDone(f);
        } catch (e) {
            setError(errText(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div className="modal" onMouseDown={e => e.stopPropagation()}
                 onKeyDown={e => { if (e.key === "Escape") onClose(); if (e.key === "Enter" && remote) start(); e.stopPropagation(); }}>
                <h3>Port-forward {sel.name}</h3>
                {opts.length > 0 && (
                    <div className="chips">
                        {opts.map(o => (
                            <button key={o.label} className={"chip" + (String(o.port) === remote ? " on" : "")}
                                    onClick={() => { setRemote(String(o.port)); setLocal(String(o.port)); }}>{o.label}</button>
                        ))}
                    </div>
                )}
                <div className="form-row">
                    <label>Remote port<input autoFocus value={remote} onChange={e => setRemote(e.target.value)} inputMode="numeric"/></label>
                    <label>Local port<input value={local} placeholder="auto" onChange={e => setLocal(e.target.value)} inputMode="numeric"/></label>
                </div>
                {error && <div className="error">{error}</div>}
                <div className="modal-actions">
                    <button onClick={onClose}>Cancel</button>
                    <button className="primary" disabled={!remote || busy} onClick={start}>{busy ? "Starting…" : "Start"}</button>
                </div>
            </div>
        </div>
    );
}
