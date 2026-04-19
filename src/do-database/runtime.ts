/**
 * DO database — RUNTIME ENTRY
 *
 * Creates a Kysely dialect backed by the DocsDB Durable Object.
 * Loaded at runtime via virtual module.
 *
 * This module imports from cloudflare:workers — do NOT import at config time.
 */

import { env } from "cloudflare:workers";
import type { Dialect } from "kysely";

import type { DocsDB } from "./do-class.js";
import { DODialect, setMigrationDb } from "./do-dialect.js";
import type { DOStub } from "./do-dialect.js";
import type { DODatabaseConfig } from "./index.js";

export { setMigrationDb };

export function createDialect(config: DODatabaseConfig): Dialect {
	const binding = config.binding;
	const name = config.name || "production";

	const ns = (env as Record<string, unknown>)[binding];

	if (!ns) {
		throw new Error(
			`Durable Object binding "${binding}" not found in environment. ` +
				`Check your wrangler.jsonc configuration.`,
		);
	}

	const namespace = ns as DurableObjectNamespace<DocsDB>;
	const id = config.id
		? namespace.idFromString(config.id)
		: namespace.idFromName(name);

	const getStub = (): DOStub => {
		const stub = namespace.get(id);
		return stub as unknown as DOStub;
	};

	return new DODialect({ getStub });
}

export { DocsDB } from "./do-class.js";
