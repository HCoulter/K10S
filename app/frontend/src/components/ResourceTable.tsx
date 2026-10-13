import {useEffect, useRef} from "react";
import {Column, Row} from "../types";
import {readyTone, statusTone} from "../util";

export interface DisplayTable {
    columns: Column[];
    /** Index into row.cells for each displayed column; -1 = namespace. */
    cellIndex: number[];
    rows: Row[];
}

interface Props {
    table: DisplayTable;
    cursor: number;
    sort: { col: number; desc: boolean } | null;
    onSort: (col: number) => void;
    onCursor: (i: number) => void;
    onOpen: (i: number) => void;
    loading: boolean;
    empty: string;
}

function cell(r: Row, idx: number) {
    return idx === -1 ? r.namespace : r.cells[idx] ?? "";
}

export function ResourceTable({table, cursor, sort, onSort, onCursor, onOpen, loading, empty}: Props) {
    const bodyRef = useRef<HTMLTableSectionElement>(null);

    useEffect(() => {
        const tr = bodyRef.current?.children[cursor] as HTMLElement | undefined;
        tr?.scrollIntoView({block: "nearest"});
    }, [cursor]);

    return (
        <div className="table-wrap">
            <table>
                <thead>
                <tr>
                    {table.columns.map((c, i) => (
                        <th key={c.name + i} data-tip={c.description} onClick={() => onSort(i)}>
                            {c.name}
                            {sort?.col === i && <span className="sort">{sort.desc ? " ↓" : " ↑"}</span>}
                        </th>
                    ))}
                </tr>
                </thead>
                <tbody ref={bodyRef}>
                {table.rows.map((r, ri) => (
                    <tr key={r.uid || r.namespace + "/" + r.name} className={ri === cursor ? "selected" : ""}
                        onClick={() => onCursor(ri)} onDoubleClick={() => onOpen(ri)}>
                        {table.columns.map((c, ci) => {
                            const v = cell(r, table.cellIndex[ci]);
                            const name = c.name.toLowerCase();
                            if (name === "status" || name === "phase") {
                                const tone = statusTone(v);
                                return <td key={ci}>{v && <span className={"pill " + tone}>{v}</span>}</td>;
                            }
                            if (name === "ready") return <td key={ci} className={readyTone(v)}>{v}</td>;
                            if (name === "type" && (v === "Warning" || v === "Normal")) {
                                return <td key={ci}><span className={"pill " + (v === "Warning" ? "warn" : "")}>{v}</span></td>;
                            }
                            return <td key={ci} className={ci === 0 ? "" : "muted-cell"} data-tip={v.length > 60 ? v : undefined}>{v}</td>;
                        })}
                    </tr>
                ))}
                </tbody>
            </table>
            {!loading && table.rows.length === 0 && <div className="empty">{empty}</div>}
        </div>
    );
}
