import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";
import type { DocsDB } from "../do-database/do-class.ts";

export const prerender = false;

export const GET: APIRoute = async () => {
	const d1 = (env as any).DB as D1Database;
	const doNs = (env as any).DOCS_DB as DurableObjectNamespace<DocsDB>;
	const stub = doNs.get(doNs.idFromName("production")) as any;

	// Get all tables from D1
	const { results: tables } = await d1
		.prepare(
			"SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' AND name NOT LIKE '%_fts%' AND sql IS NOT NULL ORDER BY name",
		)
		.all();

	// Build SQL: create tables then insert rows
	const statements: string[] = [];
	statements.push("PRAGMA defer_foreign_keys = ON");

	// Drop existing tables in reverse order (children first)
	for (const t of [...tables].reverse()) {
		statements.push(`DROP TABLE IF EXISTS "${t.name}"`);
	}

	// Create tables
	for (const t of tables) {
		statements.push(String(t.sql));
	}

	// Insert data table by table
	let totalRows = 0;
	for (const t of tables) {
		const { results: rows } = await d1
			.prepare(`SELECT * FROM "${t.name}"`)
			.all();
		for (const row of rows) {
			const cols = Object.keys(row);
			const vals = cols.map((c) => {
				const v = row[c];
				if (v === null) return "NULL";
				if (typeof v === "number") return String(v);
				return `'${String(v).replace(/'/g, "''")}'`;
			});
			statements.push(
				`INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${vals.join(",")})`,
			);
			totalRows++;
		}
	}

	const sql = statements.join(";\n") + ";";
	const result = await stub.importSql(sql);

	return new Response(
		JSON.stringify({
			ok: true,
			tables: tables.length,
			tablesCreated: result.tables,
			rowsCopied: totalRows,
		}),
		{ headers: { "Content-Type": "application/json" } },
	);
};
