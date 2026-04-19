/**
 * Durable Object database adapter for EmDash
 *
 * Config-time entry — imported in astro.config.mjs
 *
 * Usage:
 *   import { doDatabase } from './src/do-database/index.ts';
 *
 *   emdash({
 *     database: doDatabase({ binding: "GRUNTMODS_DB" }),
 *   })
 */

export interface DODatabaseConfig {
	/** Durable Object binding name */
	binding: string;
	/** DO instance name — used with idFromName (default: "production") */
	name?: string;
	/** DO instance ID hex string — used with idFromString (takes precedence over name) */
	id?: string;
}

export function doDatabase(config: DODatabaseConfig) {
	return {
		entrypoint: new URL("./runtime.ts", import.meta.url).pathname,
		config,
		type: "sqlite" as const,
	};
}
