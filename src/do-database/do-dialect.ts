/**
 * Kysely dialect for DocsDB Durable Object
 *
 * Proxies all queries to the DO via RPC.
 */

import type {
	CompiledQuery,
	DatabaseConnection,
	DatabaseIntrospector,
	Dialect,
	Driver,
	Kysely,
	QueryResult,
} from "kysely";
import { SqliteAdapter, SqliteIntrospector, SqliteQueryCompiler } from "kysely";

import type { QueryResult as DOQueryResult } from "./do-class.js";

export interface DOStub {
	query(sql: string, params?: unknown[]): Promise<DOQueryResult>;
}

export interface DODialectConfig {
	getStub: () => DOStub;
}

export function setMigrationDb(_db: any): void {}

export class DODialect implements Dialect {
	readonly #config: DODialectConfig;

	constructor(config: DODialectConfig) {
		this.#config = config;
	}

	createAdapter(): SqliteAdapter {
		return new SqliteAdapter();
	}

	createDriver(): Driver {
		return new DODriver(this.#config);
	}

	createQueryCompiler(): SqliteQueryCompiler {
		return new SqliteQueryCompiler();
	}

	createIntrospector(db: Kysely<any>): DatabaseIntrospector {
		return new SqliteIntrospector(db);
	}
}

class DODriver implements Driver {
	readonly #config: DODialectConfig;

	constructor(config: DODialectConfig) {
		this.#config = config;
	}

	async init(): Promise<void> {}

	async acquireConnection(): Promise<DatabaseConnection> {
		return new DOConnection(this.#config.getStub());
	}

	async beginTransaction(): Promise<void> {}
	async commitTransaction(): Promise<void> {}
	async rollbackTransaction(): Promise<void> {}
	async releaseConnection(): Promise<void> {}
	async destroy(): Promise<void> {}
}

class DOConnection implements DatabaseConnection {
	readonly #stub: DOStub;

	constructor(stub: DOStub) {
		this.#stub = stub;
	}

	async executeQuery<O>(compiledQuery: CompiledQuery): Promise<QueryResult<O>> {
		const result = await this.#stub.query(
			compiledQuery.sql,
			compiledQuery.parameters as unknown[],
		);

		return {
			rows: result.rows as O[],
			numAffectedRows: result.changes !== undefined ? BigInt(result.changes) : undefined,
		};
	}

	async *streamQuery<O>(): AsyncIterableIterator<QueryResult<O>> {
		throw new Error("DO dialect does not support streaming");
	}
}
