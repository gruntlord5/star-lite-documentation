// @ts-check
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import { r2 } from "@emdash-cms/cloudflare";
import { defineConfig } from "astro/config";
import emdash from "emdash/astro";
import { starLiteDocs, starLiteBlocks } from "star-lite-docs";
import { doDatabase } from "./src/do-database/index.ts";
import { discord } from "./src/auth/discord.ts";

export default defineConfig({
	output: "server",
	adapter: cloudflare(),
	integrations: [
		react(),
		starLiteDocs({
			title: "My Docs",
			expressiveCode: {
				shiki: { engine: "javascript" },
			},
		}),
		emdash({
			database: doDatabase({ binding: "DOCS_DB" }),
			storage: r2({ binding: "MEDIA" }),
			plugins: [starLiteBlocks()],
			authProviders: [discord()],
			auth: {
				secret: import.meta.env.EMDASH_AUTH_SECRET,
				passkeys: { rpName: "Star-Lite Docs" },
				oauth: {
					discord: {
						clientId: import.meta.env.DISCORD_CLIENT_ID,
						clientSecret: import.meta.env.DISCORD_CLIENT_SECRET,
					},
				},
			},
		}),
	],
	devToolbar: { enabled: false },
	vite: {
		optimizeDeps: {
			include: [
				'use-sync-external-store/shim',
				'use-sync-external-store/shim/with-selector',
				'emdash > use-sync-external-store/shim',
				'emdash > use-sync-external-store/shim/with-selector',
			],
		},
	},
});
