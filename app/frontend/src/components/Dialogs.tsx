import {ReactNode, useCallback, useEffect, useRef, useState} from "react";

interface ConfirmOpts {
    title: string;
    body?: ReactNode;
    confirmText?: string;
    danger?: boolean;
    /** Require typing this text (e.g. the resource name) before confirming. */
    typeToConfirm?: string;
}

interface PromptOpts {
    title: string;
    body?: ReactNode;
    initial?: string;
    confirmText?: string;
    inputType?: "text" | "number";
}

type Pending =
    | { kind: "confirm"; opts: ConfirmOpts; resolve: (v: boolean) => void }
    | { kind: "prompt"; opts: PromptOpts; resolve: (v: string | null) => void };

/** Promise-based confirm/prompt dialogs. Render `element` once near the root. */
export function useDialogs() {
    const [pending, setPending] = useState<Pending | null>(null);

    const confirm = useCallback((opts: ConfirmOpts) =>
        new Promise<boolean>(resolve => setPending({kind: "confirm", opts, resolve})), []);
    const prompt = useCallback((opts: PromptOpts) =>
        new Promise<string | null>(resolve => setPending({kind: "prompt", opts, resolve})), []);

    const element = pending ? <Dialog pending={pending} done={() => setPending(null)}/> : null;
    return {confirm, prompt, element, open: !!pending};
}

function Dialog({pending, done}: { pending: Pending; done: () => void }) {
    const isPrompt = pending.kind === "prompt";
    const opts = pending.opts;
    const [value, setValue] = useState(isPrompt ? (pending.opts as PromptOpts).initial ?? "" : "");
    const inputRef = useRef<HTMLInputElement>(null);
    const okRef = useRef<HTMLButtonElement>(null);
    const typeTo = !isPrompt ? (opts as ConfirmOpts).typeToConfirm : undefined;
    const canConfirm = !typeTo || value === typeTo;

    useEffect(() => {
        (inputRef.current ?? okRef.current)?.focus();
        inputRef.current?.select();
    }, []);

    const finish = (ok: boolean) => {
        if (pending.kind === "confirm") pending.resolve(ok && canConfirm);
        else pending.resolve(ok ? value : null);
        done();
    };

    return (
        <div className="modal-backdrop" onMouseDown={() => finish(false)}>
            <div className="modal" onMouseDown={e => e.stopPropagation()}
                 onKeyDown={e => {
                     if (e.key === "Escape") finish(false);
                     if (e.key === "Enter" && canConfirm) finish(true);
                     e.stopPropagation();
                 }}>
                <h3>{opts.title}</h3>
                {opts.body && <div className="modal-body">{opts.body}</div>}
                {typeTo && <p className="muted small">Type <code>{typeTo}</code> to confirm.</p>}
                {(isPrompt || typeTo) && (
                    <input ref={inputRef} value={value} onChange={e => setValue(e.target.value)}
                           type={isPrompt ? (opts as PromptOpts).inputType ?? "text" : "text"} autoComplete="off"/>
                )}
                <div className="modal-actions">
                    <button onClick={() => finish(false)}>Cancel</button>
                    <button ref={okRef} className={(opts as ConfirmOpts).danger ? "danger" : "primary"}
                            disabled={!canConfirm} onClick={() => finish(true)}>
                        {opts.confirmText ?? "OK"}
                    </button>
                </div>
            </div>
        </div>
    );
}
