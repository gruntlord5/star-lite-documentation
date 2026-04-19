/**
 * DocsDB — Production Durable Object database
 *
 * Single persistent DO with embedded SQLite for zero-latency queries.
 * Based on EmDash's PreviewDB pattern but designed for production use:
 * - No TTL/expiry
 * - Full read/write support
 * - Single named instance ("production")
 */

import { DurableObject } from "cloudflare:workers";

export interface Env {
	DB: D1Database;
	[key: string]: unknown;
}

export interface QueryResult {
	rows: Record<string, unknown>[];
	changes?: number;
}

export interface BatchStatement {
	sql: string;
	params?: unknown[];
}

const READ_PREFIXES = ["SELECT", "PRAGMA", "EXPLAIN", "WITH"];

export class DocsDB extends DurableObject<Env> {
	#backupEnabled: boolean | null = null;
	#backupCheckedAt = 0;
	#syncing = false;

	setSyncing(syncing: boolean): void {
		this.#syncing = syncing;
	}

	#isBackupEnabled(): boolean {
		// Cache for 60s, read directly from own SQLite (zero RPC)
		if (this.#backupEnabled !== null && Date.now() - this.#backupCheckedAt < 60_000) {
			return this.#backupEnabled;
		}
		try {
			for (const row of this.ctx.storage.sql.exec(
				"SELECT value FROM options WHERE name = 'site:backupToD1Enabled'"
			)) {
				this.#backupEnabled = JSON.parse(String((row as any).value)) === true;
				this.#backupCheckedAt = Date.now();
				return this.#backupEnabled;
			}
		} catch {}
		this.#backupEnabled = false;
		this.#backupCheckedAt = Date.now();
		return false;
	}

	#mirrorToD1(sql: string, params?: unknown[]): void {
		if (this.#syncing) return;
		if (!this.#isBackupEnabled()) return;
		const db = this.env.DB;
		if (!db) return;
		try {
			const stmt = params?.length
				? db.prepare(sql).bind(...params)
				: db.prepare(sql);
			this.ctx.waitUntil(
				db.batch([
					db.prepare("PRAGMA defer_foreign_keys = ON"),
					stmt,
				]).then((results: any) => {
					const meta = results?.[1]?.meta;
					const changed = meta?.changes ?? meta?.rows_written ?? '?';
					console.log(`D1 mirror (${changed} changes): ${sql.substring(0, 80)}`);
				}).catch((e: Error) => {
					console.error(`D1 MIRROR FAILED: ${e.message} — SQL: ${sql.substring(0, 120)}`);
				})
			);
		} catch (e) {
			console.error("D1 mirror error:", (e as Error).message);
		}
	}

	/**
	 * Execute a single SQL statement via RPC.
	 */
	query(sql: string, params?: unknown[]): QueryResult {
		const cursor = params?.length
			? this.ctx.storage.sql.exec(sql, ...params)
			: this.ctx.storage.sql.exec(sql);

		const rows: Record<string, unknown>[] = [];
		for (const row of cursor) {
			rows.push(row as Record<string, unknown>);
		}

		const isRead = READ_PREFIXES.some((p) => sql.trimStart().toUpperCase().startsWith(p));

		// Mirror writes to D1
		if (!isRead) {
			this.#mirrorToD1(sql, params);
		}

		return {
			rows,
			changes: isRead ? undefined : cursor.rowsWritten,
		};
	}

	/**
	 * Execute multiple statements in a single synchronous transaction.
	 */
	batch(statements: BatchStatement[]): QueryResult[] {
		const results: QueryResult[] = [];
		this.ctx.storage.transactionSync(() => {
			for (const stmt of statements) {
				results.push(this.query(stmt.sql, stmt.params));
			}
		});
		return results;
	}

	/**
	 * Execute multiple independent queries in a single RPC call.
	 */
	multiQuery(queries: Array<{ sql: string; params?: unknown[] }>): QueryResult[] {
		return queries.map(q => this.query(q.sql, q.params));
	}

	/**
	 * Get all init data in one RPC — replaces migrations check, schema check,
	 * setup check, and user count that EmDash normally does in separate queries.
	 */
	getInitData(): {
		collectionCount: number;
		setupComplete: boolean;
		userCount: number;
		migrationNames: string[];
	} {
		const sql = this.ctx.storage.sql;

		let collectionCount = 0;
		try {
			for (const row of sql.exec("SELECT COUNT(*) as c FROM _emdash_collections")) {
				collectionCount = Number((row as any).c);
			}
		} catch {}

		let setupComplete = false;
		try {
			for (const row of sql.exec("SELECT value FROM options WHERE name = 'emdash:setup_complete'")) {
				try { setupComplete = JSON.parse(String((row as any).value)) === true; } catch {}
			}
		} catch {}

		let userCount = 0;
		try {
			for (const row of sql.exec("SELECT COUNT(*) as c FROM users")) {
				userCount = Number((row as any).c);
			}
		} catch {}

		const migrationNames: string[] = [];
		try {
			for (const row of sql.exec("SELECT name FROM _emdash_migrations ORDER BY name")) {
				migrationNames.push(String((row as any).name));
			}
		} catch {}

		return { collectionCount, setupComplete, userCount, migrationNames };
	}

	/**
	 * Get everything needed to render a page in ONE RPC call.
	 * - Settings + menu (layout)
	 * - Page or post content (by slug and collection)
	 * - Widget areas
	 * - Taxonomy terms for the entry
	 * - Bylines
	 */
	getFullPage(opts: {
		menuName: string;
		collection?: string;
		slug?: string;
		widgetAreas?: string[];
		includeRecentPosts?: number;
		includeDownloadCounts?: boolean;
	}): {
		settings: Record<string, string>;
		menuItems: Array<Record<string, unknown>>;
		entry: Record<string, unknown> | null;
		terms: Array<Record<string, unknown>>;
		bylines: Array<Record<string, unknown>>;
		widgets: Record<string, Array<Record<string, unknown>>>;
		recentPosts: Array<Record<string, unknown>>;
		downloadCounts: Record<number, number>;
		allDownloads: Array<Record<string, unknown>>;
		taxonomyTerms: Record<string, Array<Record<string, unknown>>>;
	} {
		const sql = this.ctx.storage.sql;

		// Settings
		const settings: Record<string, string> = {};
		for (const row of sql.exec("SELECT name, value FROM options")) {
			const r = row as Record<string, unknown>;
			const key = String(r.name || '').replace('emdash:', '');
			try { settings[key] = JSON.parse(String(r.value || '')); } catch { settings[key] = String(r.value || ''); }
		}

		// Menu
		let menuId: string | null = null;
		for (const row of sql.exec("SELECT id FROM _emdash_menus WHERE name = ?", opts.menuName)) {
			menuId = String((row as Record<string, unknown>).id);
		}
		const menuItems: Array<Record<string, unknown>> = [];
		if (menuId) {
			for (const row of sql.exec(
				"SELECT id, parent_id, sort_order, type, custom_url, label, target FROM _emdash_menu_items WHERE menu_id = ? ORDER BY sort_order", menuId
			)) {
				menuItems.push(row as Record<string, unknown>);
			}
		}

		// Entry
		let entry: Record<string, unknown> | null = null;
		let entryDbId: string | null = null;
		if (opts.collection && opts.slug) {
			const table = `ec_${opts.collection}`;
			for (const row of sql.exec(
				`SELECT * FROM "${table}" WHERE slug = ? AND deleted_at IS NULL AND status = 'published' LIMIT 1`, opts.slug
			)) {
				entry = row as Record<string, unknown>;
				entryDbId = String(entry.id);
			}
		}

		// Taxonomy terms for entry
		const terms: Array<Record<string, unknown>> = [];
		if (entryDbId && opts.collection) {
			for (const row of sql.exec(
				`SELECT t.id, t.name, t.slug, t.label FROM content_taxonomies ct
				 JOIN taxonomies t ON t.id = ct.taxonomy_id
				 WHERE ct.collection = ? AND ct.entry_id = ?`,
				opts.collection, entryDbId
			)) {
				terms.push(row as Record<string, unknown>);
			}
		}

		// Bylines for entry
		const bylines: Array<Record<string, unknown>> = [];
		if (entryDbId && opts.collection) {
			const collSlug = opts.collection;
			for (const row of sql.exec(
				`SELECT b.id, b.slug, b.display_name, b.bio, b.avatar_media_id, b.website_url, b.is_guest, cb.role_label, cb.sort_order
				 FROM _emdash_content_bylines cb
				 JOIN _emdash_bylines b ON b.id = cb.byline_id
				 WHERE cb.collection_slug = ? AND cb.content_id = ?
				 ORDER BY cb.sort_order`, collSlug, entryDbId
			)) {
				bylines.push(row as Record<string, unknown>);
			}
		}

		// Widget areas
		const widgets: Record<string, Array<Record<string, unknown>>> = {};
		for (const areaName of opts.widgetAreas || []) {
			widgets[areaName] = [];
			let areaId: string | null = null;
			for (const row of sql.exec("SELECT id FROM _emdash_widget_areas WHERE name = ?", areaName)) {
				areaId = String((row as Record<string, unknown>).id);
			}
			if (areaId) {
				for (const row of sql.exec(
					"SELECT * FROM _emdash_widgets WHERE area_id = ? ORDER BY sort_order", areaId
				)) {
					widgets[areaName].push(row as Record<string, unknown>);
				}
			}
		}

		// Recent posts (for blogLatest block)
		const recentPosts: Array<Record<string, unknown>> = [];
		if (opts.includeRecentPosts) {
			for (const row of sql.exec(
				`SELECT id, slug, title, excerpt, published_at, content FROM ec_posts
				 WHERE deleted_at IS NULL AND status = 'published'
				 ORDER BY published_at DESC LIMIT ?`, opts.includeRecentPosts
			)) {
				recentPosts.push(row as Record<string, unknown>);
			}
		}

		// Download counts and full download list (for download blocks)
		const downloadCounts: Record<number, number> = {};
		const allDownloads: Array<Record<string, unknown>> = [];
		if (opts.includeDownloadCounts) {
			try {
				for (const row of sql.exec("SELECT id, title, download_count FROM downloads ORDER BY download_count DESC")) {
					const r = row as Record<string, unknown>;
					downloadCounts[Number(r.id)] = Number(r.download_count);
					allDownloads.push(r);
				}
			} catch {}
		}

		// Taxonomy terms with counts (for category/tag widgets)
		const taxonomyTerms: Record<string, Array<Record<string, unknown>>> = {};
		if (opts.widgetAreas?.length) {
			for (const taxName of ['category', 'tag']) {
				const termRows: Array<Record<string, unknown>> = [];
				for (const row of sql.exec(
					`SELECT t.id, t.name, t.slug, t.label,
					  (SELECT COUNT(*) FROM content_taxonomies ct WHERE ct.taxonomy_id = t.id) as count
					 FROM taxonomies t WHERE t.name = ? ORDER BY t.label ASC`, taxName
				)) {
					termRows.push(row as Record<string, unknown>);
				}
				taxonomyTerms[taxName] = termRows;
			}
		}

		return { settings, menuItems, entry, terms, bylines, widgets, recentPosts, downloadCounts, allDownloads, taxonomyTerms };
	}

	/**
	 * Get posts filtered by taxonomy term, plus layout data, in one RPC.
	 */
	getListPage(opts: {
		menuName: string;
		taxonomy?: string;
		termSlug?: string;
		collection?: string;
		limit?: number;
		offset?: number;
	}): {
		settings: Record<string, string>;
		menuItems: Array<Record<string, unknown>>;
		term: Record<string, unknown> | null;
		entries: Array<Record<string, unknown>>;
		entryTerms: Record<string, Array<Record<string, unknown>>>;
	} {
		const sql = this.ctx.storage.sql;

		// Settings
		const settings: Record<string, string> = {};
		for (const row of sql.exec("SELECT name, value FROM options")) {
			const r = row as Record<string, unknown>;
			const key = String(r.name || '').replace('emdash:', '');
			try { settings[key] = JSON.parse(String(r.value || '')); } catch { settings[key] = String(r.value || ''); }
		}

		// Menu
		let menuId: string | null = null;
		for (const row of sql.exec("SELECT id FROM _emdash_menus WHERE name = ?", opts.menuName)) {
			menuId = String((row as Record<string, unknown>).id);
		}
		const menuItems: Array<Record<string, unknown>> = [];
		if (menuId) {
			for (const row of sql.exec(
				"SELECT id, parent_id, sort_order, type, custom_url, label, target FROM _emdash_menu_items WHERE menu_id = ? ORDER BY sort_order", menuId
			)) { menuItems.push(row as Record<string, unknown>); }
		}

		// Term info
		let term: Record<string, unknown> | null = null;
		if (opts.taxonomy && opts.termSlug) {
			for (const row of sql.exec(
				"SELECT * FROM taxonomies WHERE name = ? AND slug = ?", opts.taxonomy, opts.termSlug
			)) { term = row as Record<string, unknown>; }
		}

		// Entries
		const coll = opts.collection || 'posts';
		const table = `ec_${coll}`;
		const limit = opts.limit || 20;
		let entries: Array<Record<string, unknown>> = [];

		if (term) {
			// Filter by taxonomy term
			for (const row of sql.exec(
				`SELECT e.* FROM "${table}" e
				 JOIN content_taxonomies ct ON ct.entry_id = e.id AND ct.collection = ?
				 JOIN taxonomies t ON t.id = ct.taxonomy_id AND t.slug = ?
				 WHERE e.deleted_at IS NULL AND e.status = 'published'
				 ORDER BY e.published_at DESC LIMIT ?`,
				coll, opts.termSlug!, limit
			)) { entries.push(row as Record<string, unknown>); }
		} else {
			for (const row of sql.exec(
				`SELECT * FROM "${table}" WHERE deleted_at IS NULL AND status = 'published' ORDER BY published_at DESC LIMIT ?`, limit
			)) { entries.push(row as Record<string, unknown>); }
		}

		// Batch fetch terms for all entries
		const entryTerms: Record<string, Array<Record<string, unknown>>> = {};
		const entryIds = entries.map(e => String(e.id));
		if (entryIds.length > 0) {
			for (const row of sql.exec(
				`SELECT ct.entry_id, t.id, t.name, t.slug, t.label
				 FROM content_taxonomies ct
				 JOIN taxonomies t ON t.id = ct.taxonomy_id
				 WHERE ct.collection = ? AND ct.entry_id IN (${entryIds.map(() => '?').join(',')})`,
				coll, ...entryIds
			)) {
				const r = row as Record<string, unknown>;
				const eid = String(r.entry_id);
				if (!entryTerms[eid]) entryTerms[eid] = [];
				entryTerms[eid].push(r);
			}
		}

		return { settings, menuItems, term, entries, entryTerms };
	}

	/**
	 * Import SQL dump into the DO database.
	 * Used for initial data migration from D1.
	 */
	/**
	 * Export all tables as an array of { table, rows } for syncing to D1.
	 * Skips FTS virtual tables and internal SQLite tables.
	 */
	exportTables(): Array<{ table: string; schema: string; rows: Record<string, unknown>[] }> {
		const sql = this.ctx.storage.sql;
		const tables: Array<{ table: string; schema: string; rows: Record<string, unknown>[] }> = [];

		// Get all table names and their CREATE statements
		for (const row of sql.exec("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '%_fts%' AND name NOT LIKE '%_fts_content%' AND name NOT LIKE '%_segments%' AND name NOT LIKE '%_segdir%' AND name NOT LIKE '%_docsize%' AND name NOT LIKE '%_stat%' AND name NOT LIKE '%_idx%' AND name NOT LIKE '%_fts_config%' ORDER BY name")) {
			const r = row as Record<string, unknown>;
			const tableName = String(r.name);
			const schema = String(r.sql);

			const rows: Record<string, unknown>[] = [];
			try {
				for (const dataRow of sql.exec(`SELECT * FROM "${tableName}"`)) {
					rows.push(dataRow as Record<string, unknown>);
				}
			} catch {}

			tables.push({ table: tableName, schema, rows });
		}

		return tables;
	}

	importSql(sql: string): { tables: number } {
		const statements = sql.split(';').filter(s => s.trim());
		let tables = 0;
		this.ctx.storage.transactionSync(() => {
			for (const stmt of statements) {
				const trimmed = stmt.trim();
				if (!trimmed) continue;
				try {
					this.ctx.storage.sql.exec(trimmed);
					if (trimmed.toUpperCase().startsWith('CREATE TABLE')) tables++;
				} catch (e) {
					console.error(`SQL error: ${(e as Error).message}\nStatement: ${trimmed.substring(0, 100)}`);
				}
			}
		});
		return { tables };
	}
}
