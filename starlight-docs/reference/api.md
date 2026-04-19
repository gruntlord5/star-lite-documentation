---
title: API Reference
description: Exported functions and types from the star-lite-docs package.
---

All public exports are available from the `star-lite-docs` package entry point. Astro components use subpath imports.

## Integration

### `starLiteDocs(options?)`

The main Astro integration. Injects routes, middleware, Expressive Code, and the virtual config module.

```ts
import { starLiteDocs } from "star-lite-docs";

starLiteDocs({
  title: "My Docs",
  sidebar: [{ label: "Guide", items: [{ label: "Intro", link: "/intro" }] }],
  expressiveCode: { /* AstroExpressiveCodeOptions */ },
});
```

Also available as the default export, so `astro add star-lite-docs` can locate it automatically.

### `starLiteBlocks()`

Returns an emdash `PluginDescriptor` that registers Star-Lite's block types in the admin UI.

```ts
import { starLiteBlocks } from "star-lite-docs";

emdash({
  plugins: [starLiteBlocks()],
});
```

## Runtime helpers

### `preprocessBlocks(ptBlocks)`

Normalizes Portable Text blocks for rendering: converts headings to HTML with TOC anchors, converts `---` to `<hr>`, converts markdown images to `docs.image` blocks, converts markdown tables to HTML, and wraps standard text blocks as `docs.html`.

Returns `{ blocks, headings }` where `headings` is an array of `{ depth, slug, text }` for table of contents.

### `preprocessImages(ptBlocks)`

Image-only subset of `preprocessBlocks`. Converts standalone `![alt](url)` blocks to `docs.image` blocks. Mutates the array in place.

### `loadSidebarFromMenu(name?)`

Loads sidebar configuration from an emdash menu. Defaults to `"docs-sidebar"`. Returns a `SidebarConfig[]` array.

Top-level items with children become sidebar groups. Top-level items without children become lone links in an implicit root group.

### `ensurePagesCollection(db)`

Idempotent bootstrap function from `src/bootstrap.ts`. Merges the default seed with any user seed, applies collections/fields/content, and creates the `docs-sidebar` menu if absent. Skips after the first successful call.

Note: the runtime middleware uses an inline reimplementation in `virtual:star-lite-docs/data` (which loads the user seed via `virtual:emdash/seed` instead of the filesystem). This export is the file-based version for programmatic use.

### `defaultSeed`

The `SeedFile` object shipped by the plugin. Contains the `pages` collection definition, `docs-sidebar` menu, and welcome page content.

### `buildSidebar(config)`

Converts flat `SidebarConfig[]` into the tree structure (`SidebarEntry[]`) the Sidebar component needs.

### `markCurrent(entries, currentPath)`

Returns a new `SidebarEntry[]` tree with `isCurrent: true` set on the entry matching the given path.

## Types

```ts
import type {
  StarLiteDocsOptions,
  StarLiteDocsConfig,
  SidebarConfig,
  SidebarEntry,
  SidebarLink,
  SidebarGroup,
} from "star-lite-docs";
```

### `StarLiteDocsOptions`

Options for the `starLiteDocs()` integration:

- `title?: string` — fallback site title
- `sidebar?: SidebarConfig[]` — static sidebar (omit for menu-driven)
- `expressiveCode?: AstroExpressiveCodeOptions | false`

### `SidebarConfig`

```ts
interface SidebarConfig {
  label: string;
  link?: string;
  items?: SidebarConfig[];
}
```

### `SidebarEntry`

Union of `SidebarLink | SidebarGroup`, used by the Sidebar component.

## Subpath imports

Astro components cannot be imported from the main entry point (Node can't parse `.astro` files at config load time). Use subpath imports instead:

```ts
import DocsLayout from "star-lite-docs/layout";
```

Available subpaths:

| Import | Description |
| --- | --- |
| `star-lite-docs/layout` | `DocsLayout.astro` — the full themed shell |
| `star-lite-docs/blocks` | Block component map |
| `star-lite-docs/seed` | `defaultSeed` |
| `star-lite-docs/integration` | `starLiteDocs` integration |
| `star-lite-docs/emdash-plugin` | `starLiteBlocks` plugin descriptor |
