const SECTIONS: [string, [string, string][]][] = [
    ["Navigation", [
        [":", "Command bar: jump to a resource (pods, deploy, svc…), ctx <name>, ns <name>"],
        ["/", "Filter rows"],
        ["↑ ↓ / j k", "Move selection"],
        ["g / G", "First / last row"],
        ["Enter", "Drill down (deployment → pods, node → pods) or open a pod"],
        ["Esc", "Close panel, clear filter, or go back"],
        ["0", "All namespaces"],
        ["w", "Toggle wide columns"],
        ["Ctrl+R", "Refresh"],
    ]],
    ["Inspect", [
        ["o", "Overview"],
        ["y", "YAML"],
        ["d", "Describe"],
        ["v", "Events"],
        ["l", "Logs"],
        ["x", "Decode secret"],
        ["m", "Maximize / restore panel"],
    ]],
    ["Act (when unlocked)", [
        ["e", "Edit YAML"],
        ["s", "Shell into a pod"],
        ["Shift+F", "Port-forward"],
        ["r", "Rollout restart"],
        ["Shift+S", "Scale"],
        ["t", "Trigger a CronJob"],
        ["c", "Cordon / uncordon a node"],
        ["Ctrl+D", "Delete"],
        ["Ctrl+K", "Kill (force delete)"],
    ]],
];

export function Help({onClose}: { onClose: () => void }) {
    return (
        <div className="modal-backdrop" onMouseDown={onClose}>
            <div className="modal wide" onMouseDown={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape" || e.key === "?") onClose(); e.stopPropagation(); }}
                 tabIndex={-1} ref={el => el?.focus()}>
                <h3>Keyboard shortcuts</h3>
                <div className="help-grid">
                    {SECTIONS.map(([title, keys]) => (
                        <section key={title}>
                            <h4>{title}</h4>
                            <dl>
                                {keys.map(([k, d]) => <div key={k} className="help-row"><dt><kbd>{k}</kbd></dt><dd>{d}</dd></div>)}
                            </dl>
                        </section>
                    ))}
                </div>
                <div className="modal-actions"><button onClick={onClose}>Close</button></div>
            </div>
        </div>
    );
}
