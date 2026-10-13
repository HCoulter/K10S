export namespace main {
	
	export class Column {
	    name: string;
	    type: string;
	    priority: number;
	    description: string;
	
	    static createFrom(source: any = {}) {
	        return new Column(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.type = source["type"];
	        this.priority = source["priority"];
	        this.description = source["description"];
	    }
	}
	export class ContainerInfo {
	    name: string;
	    image: string;
	    init: boolean;
	    ports: number[];
	
	    static createFrom(source: any = {}) {
	        return new ContainerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.image = source["image"];
	        this.init = source["init"];
	        this.ports = source["ports"];
	    }
	}
	export class Drill {
	    key: string;
	    namespace: string;
	    labelSelector: string;
	    fieldSelector: string;
	    title: string;
	
	    static createFrom(source: any = {}) {
	        return new Drill(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.namespace = source["namespace"];
	        this.labelSelector = source["labelSelector"];
	        this.fieldSelector = source["fieldSelector"];
	        this.title = source["title"];
	    }
	}
	export class Event {
	    type: string;
	    reason: string;
	    message: string;
	    count: number;
	    source: string;
	    last: string;
	    object: string;
	
	    static createFrom(source: any = {}) {
	        return new Event(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.reason = source["reason"];
	        this.message = source["message"];
	        this.count = source["count"];
	        this.source = source["source"];
	        this.last = source["last"];
	        this.object = source["object"];
	    }
	}
	export class KubeContexts {
	    current: string;
	    contexts: string[];
	
	    static createFrom(source: any = {}) {
	        return new KubeContexts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.current = source["current"];
	        this.contexts = source["contexts"];
	    }
	}
	export class LogOptions {
	    container: string;
	    follow: boolean;
	    previous: boolean;
	    timestamps: boolean;
	    tailLines: number;
	    sinceSeconds: number;
	
	    static createFrom(source: any = {}) {
	        return new LogOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.container = source["container"];
	        this.follow = source["follow"];
	        this.previous = source["previous"];
	        this.timestamps = source["timestamps"];
	        this.tailLines = source["tailLines"];
	        this.sinceSeconds = source["sinceSeconds"];
	    }
	}
	export class PodsInfo {
	    pods: string[];
	    containers: ContainerInfo[];
	
	    static createFrom(source: any = {}) {
	        return new PodsInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.pods = source["pods"];
	        this.containers = this.convertValues(source["containers"], ContainerInfo);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class PortForward {
	    id: string;
	    context: string;
	    namespace: string;
	    target: string;
	    pod: string;
	    localPort: number;
	    remotePort: number;
	
	    static createFrom(source: any = {}) {
	        return new PortForward(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.id = source["id"];
	        this.context = source["context"];
	        this.namespace = source["namespace"];
	        this.target = source["target"];
	        this.pod = source["pod"];
	        this.localPort = source["localPort"];
	        this.remotePort = source["remotePort"];
	    }
	}
	export class PortOption {
	    port: number;
	    label: string;
	
	    static createFrom(source: any = {}) {
	        return new PortOption(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.port = source["port"];
	        this.label = source["label"];
	    }
	}
	export class ResourceInfo {
	    key: string;
	    group: string;
	    version: string;
	    resource: string;
	    kind: string;
	    namespaced: boolean;
	    shortNames: string[];
	    verbs: string[];
	
	    static createFrom(source: any = {}) {
	        return new ResourceInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.key = source["key"];
	        this.group = source["group"];
	        this.version = source["version"];
	        this.resource = source["resource"];
	        this.kind = source["kind"];
	        this.namespaced = source["namespaced"];
	        this.shortNames = source["shortNames"];
	        this.verbs = source["verbs"];
	    }
	}
	export class Row {
	    name: string;
	    namespace: string;
	    uid: string;
	    cells: string[];
	    labels: Record<string, string>;
	    created: string;
	
	    static createFrom(source: any = {}) {
	        return new Row(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.name = source["name"];
	        this.namespace = source["namespace"];
	        this.uid = source["uid"];
	        this.cells = source["cells"];
	        this.labels = source["labels"];
	        this.created = source["created"];
	    }
	}
	export class Table {
	    columns: Column[];
	    rows: Row[];
	    metrics: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Table(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.columns = this.convertValues(source["columns"], Column);
	        this.rows = this.convertValues(source["rows"], Row);
	        this.metrics = source["metrics"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

