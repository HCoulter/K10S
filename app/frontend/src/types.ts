export interface ResourceInfo {
    key: string;
    group: string;
    version: string;
    resource: string;
    kind: string;
    namespaced: boolean;
    shortNames?: string[];
    verbs?: string[];
}

export interface Column {
    name: string;
    type: string;
    priority: number;
    description: string;
}

export interface Row {
    name: string;
    namespace: string;
    uid: string;
    cells: string[];
    labels?: Record<string, string>;
    created: string;
}

export interface Table {
    columns: Column[];
    rows: Row[];
    metrics: boolean;
}

/** A view on the navigation stack: a resource list, optionally scoped by a drill-down. */
export interface View {
    key: string;
    namespace?: string; // overrides the global namespace when set (drill-downs)
    labelSelector?: string;
    fieldSelector?: string;
    title?: string;
}

export interface Selected {
    key: string;
    name: string;
    namespace: string;
    uid: string;
}

export type DetailTab = "overview" | "yaml" | "describe" | "events" | "logs" | "shell";
