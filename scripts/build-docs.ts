#!/usr/bin/env tsx
/**
 * Build docs site from markdown files.
 *
 * Converts docs/*.md → site/docs/*.html with navigation,
 * syntax highlighting (via CSS), and consistent styling.
 *
 * Usage: npx tsx scripts/build-docs.ts
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DOCS_DIR = path.join(ROOT, 'docs');
const OUT_DIR = path.join(ROOT, 'site', 'docs');

interface DocPage {
  slug: string;
  title: string;
  order: number;
  content: string;
  filename: string;
}

// Navigation order
const NAV_ORDER: Record<string, { title: string; order: number }> = {
  'getting-started': { title: 'Getting Started', order: 0 },
  'API': { title: 'API Reference', order: 1 },
  'ARCHITECTURE': { title: 'Architecture', order: 2 },
  'MCP': { title: 'MCP Server', order: 3 },
  'AGENT_INTEGRATION': { title: 'Agent Integration', order: 4 },
};

/**
 * Simple markdown to HTML converter.
 * Handles: headings, code blocks, inline code, bold, italic, links, lists, tables, paragraphs.
 */
function markdownToHtml(md: string): string {
  const lines = md.split('\n');
  const html: string[] = [];
  let inCodeBlock = false;
  let codeBlockLang = '';
  let codeBuffer: string[] = [];
  let inList = false;
  let listType = 'ul';
  let inTable = false;
  let tableRows: string[] = [];

  const escapeHtml = (s: string) =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const processInline = (text: string): string => {
    return text
      // Links: [text](url)
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      // Bold: **text**
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      // Italic: *text* (but not **)
      .replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>')
      // Inline code: `text`
      .replace(/`([^`]+)`/g, '<code>$1</code>');
  };

  const closeList = () => {
    if (inList) {
      html.push(`</${listType}>`);
      inList = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      html.push('</tbody></table></div>');
      inTable = false;
      tableRows = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code blocks
    if (line.startsWith('```')) {
      if (inCodeBlock) {
        html.push(`<pre><code class="language-${codeBlockLang}">${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCodeBlock = false;
        codeBlockLang = '';
      } else {
        closeList();
        closeTable();
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim() || 'text';
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    // Empty line
    if (line.trim() === '') {
      closeList();
      closeTable();
      continue;
    }

    // Tables
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').slice(1, -1).map(c => c.trim());

      // Skip separator row (---|---)
      if (cells.every(c => /^[-:]+$/.test(c))) continue;

      if (!inTable) {
        closeList();
        inTable = true;
        tableRows = [];
        html.push('<div class="table-wrapper"><table>');
        // First row is header
        html.push('<thead><tr>');
        for (const cell of cells) {
          html.push(`<th>${processInline(cell)}</th>`);
        }
        html.push('</tr></thead><tbody>');
        continue;
      }

      html.push('<tr>');
      for (const cell of cells) {
        html.push(`<td>${processInline(cell)}</td>`);
      }
      html.push('</tr>');
      continue;
    }

    closeTable();

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const id = text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      html.push(`<h${level} id="${id}">${processInline(text)}</h${level}>`);
      continue;
    }

    // Unordered list items
    if (line.match(/^\s*[-*]\s+/)) {
      if (!inList || listType !== 'ul') {
        closeList();
        html.push('<ul>');
        inList = true;
        listType = 'ul';
      }
      html.push(`<li>${processInline(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }

    // Ordered list items
    if (line.match(/^\s*\d+\.\s+/)) {
      if (!inList || listType !== 'ol') {
        closeList();
        html.push('<ol>');
        inList = true;
        listType = 'ol';
      }
      html.push(`<li>${processInline(line.replace(/^\s*\d+\.\s+/, ''))}</li>`);
      continue;
    }

    // Horizontal rule
    if (line.match(/^---+$/)) {
      closeList();
      html.push('<hr>');
      continue;
    }

    // Paragraph
    closeList();
    html.push(`<p>${processInline(line)}</p>`);
  }

  closeList();
  closeTable();

  return html.join('\n');
}

/**
 * Generate HTML page from a doc.
 */
function generatePage(page: DocPage, allPages: DocPage[]): string {
  const bodyHtml = markdownToHtml(page.content);

  const nav = [...allPages]
    .sort((a, b) => a.order - b.order)
    .map(p => {
      const active = p.slug === page.slug ? ' class="active"' : '';
      return `<a href="/docs/${p.slug}.html"${active}>${p.title}</a>`;
    })
    .join('\n            ');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${page.title}: ThoughtLayer Docs</title>
  <meta name="description" content="ThoughtLayer documentation: ${page.title}">
  <link rel="icon" type="image/svg+xml" href="/favicon.svg">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #09090b;
      --text: #e4e4e7;
      --text-secondary: #71717a;
      --text-dim: #52525b;
      --accent: #a78bfa;
      --green: #4ade80;
      --surface: #18181b;
      --border: #27272a;
      --code-bg: #0f0f12;
      --mono: 'JetBrains Mono', monospace;
      --sans: 'Inter', -apple-system, system-ui, sans-serif;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: var(--sans);
      background: var(--bg);
      color: var(--text);
      line-height: 1.7;
      display: flex;
      min-height: 100vh;
    }

    /* Sidebar */
    .sidebar {
      width: 260px;
      background: var(--surface);
      border-right: 1px solid var(--border);
      padding: 2rem 1.5rem;
      position: fixed;
      top: 0;
      left: 0;
      bottom: 0;
      overflow-y: auto;
    }

    .sidebar .logo {
      font-size: 1.1rem;
      font-weight: 600;
      color: var(--accent);
      text-decoration: none;
      display: block;
      margin-bottom: 2rem;
    }

    .sidebar nav {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .sidebar nav a {
      color: var(--text-secondary);
      text-decoration: none;
      padding: 0.5rem 0.75rem;
      border-radius: 6px;
      font-size: 0.9rem;
      transition: all 0.15s;
    }

    .sidebar nav a:hover {
      color: var(--text);
      background: rgba(255, 255, 255, 0.05);
    }

    .sidebar nav a.active {
      color: var(--accent);
      background: rgba(167, 139, 250, 0.1);
    }

    .sidebar .back-link {
      margin-top: 2rem;
      padding-top: 1rem;
      border-top: 1px solid var(--border);
    }

    .sidebar .back-link a {
      color: var(--text-dim);
      text-decoration: none;
      font-size: 0.85rem;
    }

    .sidebar .back-link a:hover { color: var(--text-secondary); }

    /* Main content */
    .main {
      margin-left: 260px;
      padding: 3rem 4rem;
      max-width: 900px;
      width: 100%;
    }

    /* Typography */
    h1 { font-size: 2rem; font-weight: 600; margin-bottom: 1.5rem; color: var(--text); }
    h2 { font-size: 1.4rem; font-weight: 600; margin: 2.5rem 0 1rem; color: var(--text); border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
    h3 { font-size: 1.15rem; font-weight: 600; margin: 2rem 0 0.75rem; color: var(--text); }
    h4 { font-size: 1rem; font-weight: 600; margin: 1.5rem 0 0.5rem; color: var(--text-secondary); }

    p { margin-bottom: 1rem; color: var(--text-secondary); }
    strong { color: var(--text); font-weight: 500; }

    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    ul, ol { margin: 0 0 1rem 1.5rem; color: var(--text-secondary); }
    li { margin-bottom: 0.4rem; }

    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

    /* Code */
    code {
      font-family: var(--mono);
      font-size: 0.85em;
      background: var(--code-bg);
      padding: 0.2em 0.4em;
      border-radius: 4px;
      color: var(--accent);
    }

    pre {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1.25rem;
      overflow-x: auto;
      margin: 1rem 0 1.5rem;
    }

    pre code {
      background: none;
      padding: 0;
      font-size: 0.85rem;
      line-height: 1.6;
      color: var(--text-secondary);
    }

    /* Tables */
    .table-wrapper {
      overflow-x: auto;
      margin: 1rem 0 1.5rem;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 0.9rem;
    }

    th, td {
      padding: 0.6rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      color: var(--text);
      font-weight: 500;
      background: var(--surface);
    }

    td { color: var(--text-secondary); }

    /* Mobile */
    @media (max-width: 768px) {
      .sidebar {
        position: static;
        width: 100%;
        border-right: none;
        border-bottom: 1px solid var(--border);
        padding: 1rem;
      }

      .sidebar nav { flex-direction: row; flex-wrap: wrap; gap: 0.25rem; }

      .main {
        margin-left: 0;
        padding: 2rem 1.5rem;
      }
    }
  </style>
</head>
<body>
  <aside class="sidebar">
    <a href="/" class="logo">⚡ ThoughtLayer</a>
    <nav>
            ${nav}
    </nav>
    <div class="back-link">
      <a href="/">← Back to home</a><br>
      <a href="https://github.com/prasants/thoughtlayer">GitHub</a> ·
      <a href="https://www.npmjs.com/package/thoughtlayer">npm</a>
    </div>
  </aside>
  <main class="main">
    ${bodyHtml}
  </main>
</body>
</html>`;
}

// --- Main ---

// Create getting-started doc if it doesn't exist
const gettingStartedPath = path.join(DOCS_DIR, 'getting-started.md');
if (!fs.existsSync(gettingStartedPath)) {
  fs.writeFileSync(gettingStartedPath, `# Getting Started

## Install

\`\`\`bash
npm install -g thoughtlayer
\`\`\`

## Initialise a project

\`\`\`bash
cd your-project
thoughtlayer init
\`\`\`

This creates a \`.thoughtlayer/\` directory with a SQLite database and config.

**Auto-detection:** If [Ollama](https://ollama.com) is running locally with \`nomic-embed-text\`, ThoughtLayer uses it automatically. Otherwise, it falls back to OpenAI (requires \`OPENAI_API_KEY\`).

## Add knowledge

### From files (recommended)

\`\`\`bash
# Ingest a directory of markdown/text files
thoughtlayer ingest ./docs

# Watch for changes
thoughtlayer ingest ./docs --watch
\`\`\`

Files are tracked by content hash. Re-running \`ingest\` only processes changed files.

### Manual entries

\`\`\`bash
thoughtlayer add "PostgreSQL chosen for pgvector support" --domain architecture --importance 0.9
\`\`\`

### LLM-powered curate

\`\`\`bash
echo "We decided to use Hono because..." | thoughtlayer curate -
\`\`\`

Requires \`ANTHROPIC_API_KEY\` or \`OPENAI_API_KEY\`. The LLM extracts structured knowledge from raw text.

## Query

\`\`\`bash
# Semantic + keyword search (hybrid)
thoughtlayer query "how do we handle auth?"

# Keyword-only (no API key needed)
thoughtlayer search "authentication jwt"
\`\`\`

## Check status

\`\`\`bash
thoughtlayer health    # Knowledge health metrics
thoughtlayer status    # Ingestion status, tracked files
thoughtlayer list      # List entries
\`\`\`

## Use as MCP server

\`\`\`bash
thoughtlayer-mcp
\`\`\`

Exposes ThoughtLayer as a [Model Context Protocol](https://modelcontextprotocol.io) server. Any MCP-compatible client (Claude Desktop, Cursor, etc.) can query your knowledge base.

## Local embeddings (Ollama)

For fully offline operation:

\`\`\`bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull the embedding model
ollama pull nomic-embed-text

# Initialise with Ollama
thoughtlayer init --embedding-provider ollama
\`\`\`

ThoughtLayer auto-detects Ollama on \`localhost:11434\`. Set \`OLLAMA_HOST\` to override.

## Programmatic API

\`\`\`typescript
import { ThoughtLayer } from 'thoughtlayer';

const tl = ThoughtLayer.load('.');

// Add knowledge
await tl.add({
  domain: 'architecture',
  title: 'Database choice',
  content: 'PostgreSQL with pgvector for embeddings',
  importance: 0.9,
});

// Query
const results = await tl.query('what database do we use?');
console.log(results[0].entry.title); // "Database choice"

tl.close();
\`\`\`
`);
}

// Read all doc files
const docFiles = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md') && f !== 'STRIPE_SETUP.md');

const pages: DocPage[] = docFiles.map(filename => {
  const slug = path.basename(filename, '.md');
  const content = fs.readFileSync(path.join(DOCS_DIR, filename), 'utf-8');
  const nav = NAV_ORDER[slug];

  // Extract title from first heading
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = nav?.title ?? titleMatch?.[1] ?? slug;
  const order = nav?.order ?? 99;

  return { slug, title, order, content, filename };
});

// Build output
fs.mkdirSync(OUT_DIR, { recursive: true });

for (const page of pages) {
  const html = generatePage(page, pages);
  fs.writeFileSync(path.join(OUT_DIR, `${page.slug}.html`), html);
  console.log(`  ✅ ${page.slug}.html (${page.title})`);
}

// Generate index that redirects to getting-started
fs.writeFileSync(path.join(OUT_DIR, 'index.html'), `<!DOCTYPE html>
<html><head><meta http-equiv="refresh" content="0;url=/docs/getting-started.html"></head></html>`);

console.log(`\n📚 Built ${pages.length} doc pages → site/docs/`);
