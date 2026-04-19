#!/usr/bin/env bun
/**
 * Reads Starlight MDX/MD docs from starlight-docs/ and generates
 * .emdash/seed.json with Portable Text blocks + sidebar menu.
 */
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const DOCS_DIR = join(import.meta.dirname, "starlight-docs");
const OUT = join(import.meta.dirname, ".emdash", "seed.json");

let keyIdx = 0;
const key = () => `k${keyIdx++}`;

// ── Collect files ──────────────────────────────────────────────

function walk(dir) {
  const results = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walk(full));
    else if (/\.(mdx?|md)$/.test(entry.name)) results.push(full);
  }
  return results;
}

const files = walk(DOCS_DIR).sort();

// ── Frontmatter ────────────────────────────────────────────────

function parseFrontmatter(raw) {
  const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { attrs: {}, body: raw };
  const attrs = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w[\w-]*):\s*(.+)/);
    if (kv) attrs[kv[1]] = kv[2].replace(/^["']|["']$/g, "");
  }
  return { attrs, body: raw.slice(m[0].length).trimStart() };
}

// ── Inline parser ──────────────────────────────────────────────

function parseInline(text) {
  const spans = [];
  const markDefs = [];
  // bold, code, links, italic
  const regex = /(\*\*(.+?)\*\*)|(`([^`]+)`)|(\[([^\]]*)\]\(([^)]+)\))|(\*([^*]+)\*)|(_([^_]+)_)/g;
  let lastIdx = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIdx) {
      spans.push({ _type: "span", _key: key(), text: text.slice(lastIdx, match.index), marks: [] });
    }
    if (match[2]) {
      spans.push({ _type: "span", _key: key(), text: match[2], marks: ["strong"] });
    } else if (match[4]) {
      spans.push({ _type: "span", _key: key(), text: match[4], marks: ["code"] });
    } else if (match[6] !== undefined) {
      const linkKey = key();
      markDefs.push({ _key: linkKey, _type: "link", href: match[7] });
      spans.push({ _type: "span", _key: key(), text: match[6], marks: [linkKey] });
    } else if (match[9]) {
      spans.push({ _type: "span", _key: key(), text: match[9], marks: ["em"] });
    } else if (match[11]) {
      spans.push({ _type: "span", _key: key(), text: match[11], marks: ["em"] });
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < text.length) {
    spans.push({ _type: "span", _key: key(), text: text.slice(lastIdx), marks: [] });
  }
  if (spans.length === 0) {
    spans.push({ _type: "span", _key: key(), text, marks: [] });
  }

  return { spans, markDefs };
}

// ── Strip / preprocess MDX lines ───────────────────────────────

function stripMdx(body) {
  const lines = body.split("\n");
  const out = [];
  let skip = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip import statements
    if (trimmed.startsWith("import ")) continue;

    // Skip custom non-star-lite components we can't convert
    // (Preview, Fragment, SidebarPreview, TestimonialGrid, Testimonial, AboutAstro, Since)
    if (/^<(Preview|Fragment|SidebarPreview|TestimonialGrid|Testimonial|AboutAstro|Since)\b/.test(trimmed)) {
      skip = true;
      if (trimmed.endsWith("/>")) { skip = false; continue; }
      continue;
    }
    if (skip) {
      if (/^<\/(Preview|Fragment|SidebarPreview|TestimonialGrid|Testimonial|AboutAstro|Since)>/.test(trimmed)) {
        skip = false;
      }
      continue;
    }

    out.push(line);
  }

  return out;
}

// ── MDX to Portable Text blocks ────────────────────────────────

function mdxToBlocks(lines) {
  const blocks = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Skip blank lines
    if (!trimmed) { i++; continue; }

    // ── Fenced code blocks ──
    if (trimmed.startsWith("```") || trimmed.startsWith("````")) {
      const fence = trimmed.startsWith("````") ? "````" : "```";
      const lang = trimmed.slice(fence.length).replace(/\s.*/, "").trim();
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) {
        codeLines.push(lines[i]);
        i++;
      }
      i++; // skip closing fence
      blocks.push({ _type: "code", _key: key(), language: lang || "text", code: codeLines.join("\n") });
      continue;
    }

    // ── ::: admonitions (:::tip[title], :::note, :::caution, :::danger) ──
    const asideMatch = trimmed.match(/^:::(tip|note|caution|danger)(?:\[([^\]]*)\])?/);
    if (asideMatch) {
      const type = asideMatch[1];
      const title = asideMatch[2] || "";
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(":::")) {
        contentLines.push(lines[i]);
        i++;
      }
      i++; // skip closing :::
      blocks.push({
        _type: "star-lite.aside",
        _key: key(),
        type,
        title,
        content: contentLines.join("\n").trim(),
      });
      continue;
    }

    // ── <Aside> component ──
    const asideCompMatch = trimmed.match(/^<Aside\s*(.*?)>/);
    if (asideCompMatch) {
      const propsStr = asideCompMatch[1];
      const type = propsStr.match(/type="(\w+)"/)?.[1] || "note";
      const title = propsStr.match(/title="([^"]+)"/)?.[1] || "";
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</Aside>")) {
        contentLines.push(lines[i]);
        i++;
      }
      i++; // skip </Aside>
      blocks.push({
        _type: "star-lite.aside",
        _key: key(),
        type,
        title,
        content: contentLines.join("\n").trim(),
      });
      continue;
    }

    // ── <Tabs> ──
    if (trimmed.startsWith("<Tabs")) {
      const tabs = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</Tabs>")) {
        const tabMatch = lines[i].trim().match(/^<TabItem\s+label="([^"]+)".*?>/);
        if (tabMatch) {
          const label = tabMatch[1];
          const tabContent = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith("</TabItem>")) {
            tabContent.push(lines[i]);
            i++;
          }
          i++; // skip </TabItem>
          tabs.push({ label, content: tabContent.join("\n").trim() });
        } else {
          i++;
        }
      }
      i++; // skip </Tabs>
      if (tabs.length > 0) {
        blocks.push({
          _type: "star-lite.tabs",
          _key: key(),
          tabsJson: JSON.stringify(tabs),
        });
      }
      continue;
    }

    // ── <CardGrid> ──
    if (trimmed.startsWith("<CardGrid")) {
      const cards = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</CardGrid>")) {
        const cardLine = lines[i].trim();
        const cardMatch = cardLine.match(/^<Card\s+(.*?)>/);
        if (cardMatch) {
          const title = cardMatch[1].match(/title="([^"]+)"/)?.[1] || "";
          const icon = cardMatch[1].match(/icon="([^"]+)"/)?.[1] || "";
          const contentLines = [];
          i++;
          while (i < lines.length && !lines[i].trim().startsWith("</Card>")) {
            contentLines.push(lines[i]);
            i++;
          }
          i++; // skip </Card>
          cards.push({ title, icon, content: contentLines.join("\n").trim() });
        } else {
          i++;
        }
      }
      i++; // skip </CardGrid>
      if (cards.length > 0) {
        blocks.push({
          _type: "star-lite.cardGrid",
          _key: key(),
          cardsJson: JSON.stringify(cards),
        });
      }
      continue;
    }

    // ── Standalone <Card> (outside CardGrid) ──
    const cardMatch = trimmed.match(/^<Card\s+(.*?)>/);
    if (cardMatch && !trimmed.endsWith("/>")) {
      const title = cardMatch[1].match(/title="([^"]+)"/)?.[1] || "";
      const icon = cardMatch[1].match(/icon="([^"]+)"/)?.[1] || "";
      const contentLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</Card>")) {
        contentLines.push(lines[i]);
        i++;
      }
      i++; // skip </Card>
      blocks.push({
        _type: "star-lite.card",
        _key: key(),
        title,
        icon,
        content: contentLines.join("\n").trim(),
      });
      continue;
    }

    // ── <LinkCard> (self-closing) ──
    const linkCardMatch = trimmed.match(/^<LinkCard\s+(.*?)\/>/);
    if (linkCardMatch) {
      const title = linkCardMatch[1].match(/title="([^"]+)"/)?.[1] || "";
      const href = linkCardMatch[1].match(/href="([^"]+)"/)?.[1] || "";
      const description = linkCardMatch[1].match(/description="([^"]+)"/)?.[1] || "";
      blocks.push({
        _type: "star-lite.linkCard",
        _key: key(),
        title,
        href,
        description,
      });
      i++;
      continue;
    }

    // ── <FileTree> ──
    if (trimmed.startsWith("<FileTree>") || trimmed.startsWith("<FileTree ")) {
      const treeLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</FileTree>")) {
        treeLines.push(lines[i]);
        i++;
      }
      i++; // skip </FileTree>
      blocks.push({
        _type: "star-lite.fileTree",
        _key: key(),
        treeHtml: treeLines.join("\n").trim(),
      });
      continue;
    }

    // ── <Steps> ──
    if (trimmed.startsWith("<Steps>") || trimmed.startsWith("<Steps ")) {
      const stepLines = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("</Steps>")) {
        stepLines.push(lines[i]);
        i++;
      }
      i++; // skip </Steps>
      // Parse numbered steps
      const steps = [];
      let currentStep = [];
      for (const sl of stepLines) {
        const stepMatch = sl.match(/^\d+\.\s+(.+)/);
        if (stepMatch) {
          if (currentStep.length) steps.push({ content: currentStep.join("\n").trim() });
          currentStep = [stepMatch[1]];
        } else if (sl.trim()) {
          currentStep.push(sl);
        }
      }
      if (currentStep.length) steps.push({ content: currentStep.join("\n").trim() });
      if (steps.length > 0) {
        blocks.push({
          _type: "star-lite.steps",
          _key: key(),
          stepsJson: JSON.stringify(steps),
        });
      }
      continue;
    }

    // ── <LinkButton> ──
    const linkBtnMatch = trimmed.match(/^<LinkButton\s+(.*?)>(.*?)<\/LinkButton>/);
    if (linkBtnMatch) {
      const href = linkBtnMatch[1].match(/href="([^"]+)"/)?.[1] || "";
      const icon = linkBtnMatch[1].match(/icon="([^"]+)"/)?.[1] || "";
      const variant = linkBtnMatch[1].match(/variant="([^"]+)"/)?.[1] || "primary";
      blocks.push({
        _type: "star-lite.linkButton",
        _key: key(),
        text: linkBtnMatch[2].trim(),
        href,
        icon,
        variant,
      });
      i++;
      continue;
    }

    // ── Skip remaining self-closing JSX tags we don't handle ──
    if (/^<[A-Z][\w.]*\s.*\/>$/.test(trimmed) || /^<[A-Z][\w.]*\s*\/>$/.test(trimmed)) {
      i++;
      continue;
    }

    // ── Skip opening+closing JSX block tags we don't handle ──
    if (/^<[A-Z][\w.]*[\s>]/.test(trimmed) && !trimmed.startsWith("<Tab") && !trimmed.startsWith("<Card") && !trimmed.startsWith("<File") && !trimmed.startsWith("<Step") && !trimmed.startsWith("<Link") && !trimmed.startsWith("<Aside") && !trimmed.startsWith("<Badge")) {
      // Find matching close tag
      const tagName = trimmed.match(/^<([A-Z][\w.]*)/)?.[1];
      if (tagName) {
        let depth = 1;
        i++;
        while (i < lines.length && depth > 0) {
          const t = lines[i].trim();
          if (t.startsWith(`<${tagName}`) && !t.endsWith("/>")) depth++;
          if (t.startsWith(`</${tagName}>`)) depth--;
          i++;
        }
        continue;
      }
    }

    // ── Headings ──
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const { spans, markDefs } = parseInline(headingMatch[2]);
      blocks.push({ _type: "block", _key: key(), style: `h${level}`, markDefs, children: spans });
      i++;
      continue;
    }

    // ── Blockquotes ──
    if (trimmed.startsWith("> ")) {
      const quoteLines = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      // Check for [!TIP] / [!NOTE] style callouts
      const calloutMatch = quoteLines[0]?.match(/^\[!(TIP|NOTE|CAUTION|DANGER|WARNING|IMPORTANT)\]/i);
      if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase() === "warning" ? "caution"
          : calloutMatch[1].toLowerCase() === "important" ? "tip"
          : calloutMatch[1].toLowerCase();
        quoteLines.shift();
        blocks.push({
          _type: "star-lite.aside",
          _key: key(),
          type,
          title: "",
          content: quoteLines.join("\n").trim(),
        });
      } else {
        const { spans, markDefs } = parseInline(quoteLines.join(" "));
        blocks.push({ _type: "block", _key: key(), style: "blockquote", markDefs, children: spans });
      }
      continue;
    }

    // ── Bullet lists ──
    if (/^\s*[-*]\s/.test(line)) {
      while (i < lines.length && /^\s*[-*]\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*[-*]\s+/, "");
        const { spans, markDefs } = parseInline(text);
        blocks.push({ _type: "block", _key: key(), style: "normal", listItem: "bullet", level: 1, markDefs, children: spans });
        i++;
      }
      continue;
    }

    // ── Numbered lists ──
    if (/^\s*\d+\.\s/.test(line)) {
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i])) {
        const text = lines[i].replace(/^\s*\d+\.\s+/, "");
        const { spans, markDefs } = parseInline(text);
        blocks.push({ _type: "block", _key: key(), style: "normal", listItem: "number", level: 1, markDefs, children: spans });
        i++;
      }
      continue;
    }

    // ── Tables ──
    if (trimmed.includes("|") && lines[i + 1]?.trim().match(/^\|[\s-|:]+\|$/)) {
      const tableLines = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        tableLines.push(lines[i].trim());
        i++;
      }
      if (tableLines.length >= 2) {
        const parseRow = (l) => l.split("|").slice(1, -1).map((c) => c.trim());
        const headers = parseRow(tableLines[0]);
        const rows = tableLines.slice(2).map(parseRow);
        let html = "<table><thead><tr>" + headers.map((h) => `<th>${h}</th>`).join("") + "</tr></thead><tbody>";
        for (const row of rows) {
          html += "<tr>" + row.map((c) => `<td>${c}</td>`).join("") + "</tr>";
        }
        html += "</tbody></table>";
        blocks.push({ _type: "docs.html", _key: key(), html });
      }
      continue;
    }

    // ── Horizontal rule ──
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      blocks.push({ _type: "docs.html", _key: key(), html: "<hr />" });
      i++;
      continue;
    }

    // ── Normal paragraph ──
    // Gather consecutive non-blank, non-special lines
    const paraLines = [];
    while (i < lines.length && lines[i].trim() && !lines[i].trim().startsWith("#") && !lines[i].trim().startsWith("```") && !lines[i].trim().startsWith(":::") && !lines[i].trim().startsWith("<") && !lines[i].trim().startsWith("> ") && !/^\s*[-*]\s/.test(lines[i]) && !/^\s*\d+\.\s/.test(lines[i]) && !/^(-{3,}|\*{3,}|_{3,})$/.test(lines[i].trim())) {
      paraLines.push(lines[i].trim());
      i++;
    }
    if (paraLines.length > 0) {
      const { spans, markDefs } = parseInline(paraLines.join(" "));
      blocks.push({ _type: "block", _key: key(), style: "normal", markDefs, children: spans });
      continue;
    }

    // Fallback: skip unrecognized line
    i++;
  }

  return blocks;
}

// ── Process files ──────────────────────────────────────────────

const pages = [];
const sidebarGroups = {
  "": [],          // root-level pages
  "guides": [],
  "components": [],
  "reference": [],
};

for (const file of files) {
  const rel = relative(DOCS_DIR, file);
  const slug = rel.replace(/\.(mdx?|md)$/, "").replace(/\\/g, "/");

  // Skip 404
  if (slug === "404") continue;

  const raw = readFileSync(file, "utf-8");
  const { attrs, body } = parseFrontmatter(raw);
  const title = attrs.title || slug.split("/").pop();

  // Determine slug for emdash (index → "index", others keep path)
  const pageSlug = slug === "index" ? "index" : slug;

  const lines = stripMdx(body);
  const blocks = mdxToBlocks(lines);

  // Handle hero pages (index.mdx has hero in frontmatter)
  let content = blocks;
  if (attrs.template === "splash" || slug === "index") {
    const heroBlock = {
      _type: "docs.hero",
      _key: key(),
      tagline: "The Starlight documentation experience, powered by EmDash CMS. Edit docs visually in the browser.",
      imageSrc: "/houston.webp",
      imageAlt: "Houston",
      actionsJson: JSON.stringify([
        { text: "Get Started", link: "/getting-started", icon: "right-arrow", variant: "primary" },
        { text: "View on GitHub", link: "https://github.com/gruntlord5/star-lite-docs", icon: "github", variant: "secondary" },
      ]),
    };
    content = [heroBlock, ...blocks];
  }

  pages.push({
    id: pageSlug.replace(/\//g, "-"),
    slug: pageSlug,
    status: "published",
    data: { title, content },
  });

  // Build sidebar
  const dir = slug.includes("/") ? slug.split("/")[0] : "";
  const label = title;
  const link = "/" + pageSlug;
  if (slug !== "index" && sidebarGroups[dir] !== undefined) {
    sidebarGroups[dir].push({ type: "custom", label, url: link });
  }
}

// ── Build sidebar menu ─────────────────────────────────────────

const menuItems = [];

// Root pages first
const rootOrder = ["getting-started", "manual-setup", "deploy"];
for (const name of rootOrder) {
  const item = sidebarGroups[""].find((p) => p.url === "/" + name);
  if (item) menuItems.push(item);
}

// Then groups
const groupOrder = [
  { key: "guides", label: "Guides" },
  { key: "components", label: "Components" },
  { key: "reference", label: "Reference" },
];
for (const { key: gk, label } of groupOrder) {
  const items = sidebarGroups[gk];
  if (items.length > 0) {
    menuItems.push({
      type: "custom",
      label,
      url: "",
      children: items,
    });
  }
}

// ── Write seed ─────────────────────────────────────────────────

const seed = {
  version: "1",
  meta: {
    name: "star-lite-documentation",
    description: "Star-Lite Docs documentation site.",
  },
  menus: [
    {
      name: "docs-sidebar",
      label: "Docs sidebar",
      items: menuItems,
    },
  ],
  content: {
    pages,
  },
};

mkdirSync(join(import.meta.dirname, ".emdash"), { recursive: true });
writeFileSync(OUT, JSON.stringify(seed, null, 2));

console.log(`Generated seed with ${pages.length} pages → ${OUT}`);
console.log(`Sidebar: ${menuItems.length} top-level items`);
