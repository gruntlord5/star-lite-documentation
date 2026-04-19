---
title: Block Types Reference
description: Complete reference for all Star-Lite Docs block types and their fields.
---

Fields listed here are from the actual component Props interfaces in `src/blocks/`.

## Content blocks

### `docs.hero`

Splash hero with title, tagline, image, and action buttons. When any block on the page is a `docs.hero`, the layout switches to splash mode (no sidebar or TOC).

| Field | Type | Description |
| --- | --- | --- |
| `title` | string | Hero title (falls back to page title if empty) |
| `tagline` | string | Subtitle text below the title |
| `imageSrc` | string | Image URL |
| `imageAlt` | string | Image alt text |
| `actionsJson` | string | JSON array of `{ text, link, icon, variant }` objects |

Action variants: `primary`, `secondary`, `minimal`.

### `docs.image`

Standalone image block with optional link wrapper.

| Field | Type | Description |
| --- | --- | --- |
| `src` | string | Image URL |
| `alt` | string | Alt text |
| `href` | string | Optional link URL — wraps the image in an anchor |

### `docs.html`

Raw HTML passthrough. Also used internally for preprocessed text blocks, headings, and tables.

| Field | Type | Description |
| --- | --- | --- |
| `html` | string | Raw HTML content |

### `code`

Syntax-highlighted code block rendered by Expressive Code.

| Field | Type | Description |
| --- | --- | --- |
| `language` | string | Language identifier (e.g. `ts`, `bash`, `json`) |
| `code` | string | The code content |

## Component blocks

### `star-lite.tabs`

Tabbed content panels.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `tabsJson` | string | JSON array of `{ label, icon, content }` objects |

### `star-lite.card`

Content card with optional icon and color accent.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `title` | string | Card title |
| `icon` | string | Icon name from the icon set |
| `color` | string | Color: `purple`, `orange`, `green`, `red`, `blue` |
| `content` | string | Card body text |

### `star-lite.cardGrid`

Grid layout that arranges cards in columns.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `cardsJson` | string | JSON array of card objects |
| `stagger` | string | Stagger layout flag |

### `star-lite.linkCard`

Navigation card with title, description, and link.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `title` | string | Card title |
| `href` | string | Link URL |
| `description` | string | Description text |
| `target` | string | Link target (e.g. `_blank`) |

### `star-lite.aside`

Callout box in one of four variants.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `type` | string | `note`, `tip`, `caution`, or `danger` |
| `title` | string | Custom title (defaults to the capitalized type name) |
| `content` | string | Callout body text (rendered as markdown) |

### `star-lite.badge`

Inline status badge.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `text` | string | Badge text |
| `variant` | string | `default`, `note`, `tip`, `caution`, `danger`, or `success` |
| `size` | string | `small`, `medium`, or `large` |

### `star-lite.fileTree`

File and directory tree display.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `treeHtml` | string | Tree content as indented list text |

### `star-lite.icon`

Inline icon from the Star-Lite icon set.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `name` | string | Icon name (see [Icons Reference](/reference/icons)) |
| `label` | string | Accessible label |
| `color` | string | Icon color |
| `size` | string | Icon size |

### `star-lite.linkButton`

Styled link rendered as a pill button.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `text` | string | Button label |
| `href` | string | Link URL |
| `icon` | string | Icon name |
| `iconPlacement` | string | `start` or `end` (default: `end`) |
| `variant` | string | `primary`, `secondary`, or `minimal` |

### `star-lite.steps`

Numbered step-by-step instructions.

| Field | Type | Description |
| --- | --- | --- |
| `id` | string | Optional section ID |
| `start` | number | Starting step number (default: 1) |
| `stepsJson` | string | JSON array of `{ content }` objects |
