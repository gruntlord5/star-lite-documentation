import type { DocsDB } from "./src/do-database/do-class.ts";

interface Env {
	DB: D1Database;
	MEDIA: R2Bucket;
	DOCS_DB: DurableObjectNamespace<DocsDB>;
}
