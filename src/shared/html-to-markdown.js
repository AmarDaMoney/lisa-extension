// LISA HTML-to-Markdown converter
// Shared utility for converting rendered AI chat HTML to clean markdown text.
// Used by platform parsers to extract structured text from DOM elements.

function htmlToMarkdown(node) {
  let result = '';
  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      result += child.textContent;
      continue;
    }
    if (child.nodeType !== Node.ELEMENT_NODE) continue;
    const tag = child.tagName.toLowerCase();
    const inner = htmlToMarkdown(child);
    if (!inner.trim()) continue;

    if (tag === 'pre') {
      const codeEl = child.querySelector('code');
      const lang = codeEl?.className?.match(/language-(\w+)/)?.[1] || '';
      const code = codeEl ? codeEl.textContent : child.textContent;
      result += '\n\n```' + lang + '\n' + code.trimEnd() + '\n```\n\n';
    } else if (tag === 'code') {
      result += '`' + child.textContent + '`';
    } else if (tag === 'strong' || tag === 'b') {
      result += '**' + inner.trim() + '**';
    } else if (tag === 'em' || tag === 'i') {
      result += '*' + inner.trim() + '*';
    } else if (tag.match(/^h[1-6]$/)) {
      const level = '#'.repeat(parseInt(tag[1]));
      result += '\n\n' + level + ' ' + inner.trim() + '\n\n';
    } else if (tag === 'li') {
      const parent = child.parentElement?.tagName?.toLowerCase();
      const prefix = parent === 'ol'
        ? ([...child.parentElement.children].indexOf(child) + 1) + '. '
        : '- ';
      result += prefix + inner.trim() + '\n';
    } else if (tag === 'ul' || tag === 'ol') {
      result += '\n' + inner + '\n';
    } else if (tag === 'p') {
      result += '\n\n' + inner.trim() + '\n\n';
    } else if (tag === 'div') {
      // Divs that contain block elements get block spacing;
      // inline-only divs get joined to surrounding text
      const hasBlock = child.querySelector('p, h1, h2, h3, h4, h5, h6, ul, ol, pre, blockquote, table, div');
      if (hasBlock) {
        result += '\n\n' + inner.trim() + '\n\n';
      } else {
        result += inner;
      }
    } else if (tag === 'br') {
      result += '\n';
    } else if (tag === 'a') {
      const href = child.getAttribute('href');
      result += href ? '[' + inner.trim() + '](' + href + ')' : inner;
    } else if (tag === 'blockquote') {
      result += '\n\n> ' + inner.trim().replace(/\n/g, '\n> ') + '\n\n';
    } else if (tag === 'table') {
      result += '\n\n' + tableToMarkdown(child) + '\n\n';
    } else if (tag === 'hr') {
      result += '\n\n---\n\n';
    } else {
      result += inner;
    }
  }
  return result;
}

function tableToMarkdown(table) {
  const rows = [...table.querySelectorAll('tr')];
  if (rows.length === 0) return '';
  const lines = [];
  rows.forEach((row, i) => {
    const cells = [...row.querySelectorAll('th, td')].map(c => c.textContent.trim());
    lines.push('| ' + cells.join(' | ') + ' |');
    if (i === 0) {
      lines.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    }
  });
  return lines.join('\n');
}

// Post-process: collapse fragmented lines within paragraphs, normalize whitespace
function cleanMarkdownText(raw) {
  let text = raw;
  // Normalize whitespace within lines (but not newlines)
  text = text.replace(/[^\S\n]+/g, ' ');
  // Collapse 3+ newlines to 2
  text = text.replace(/\n{3,}/g, '\n\n');
  // Join fragmented lines within paragraphs.
  // Split into lines, then rejoin lines that aren't markdown structure boundaries.
  const lines = text.split('\n');
  const joined = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    // Is this line a markdown structural element that must stay on its own line?
    const isStructural = /^(#{1,6} |[-*+] |\d+\. |> |```|\|.|---$|$)/.test(trimmed);
    if (isStructural || joined.length === 0) {
      joined.push(line);
      continue;
    }
    // Look at previous non-empty joined line
    const prev = joined[joined.length - 1].trim();
    const prevIsStructural = /^(#{1,6} |[-*+] |\d+\. |> |```|\|.|---$)/.test(prev);
    // Previous line ends with sentence-final punctuation → keep the break
    const prevEndsSentence = /[.!?:;]$/.test(prev);
    // Empty previous line → keep (paragraph boundary)
    if (prev === '' || prevIsStructural || prevEndsSentence) {
      joined.push(line);
    } else {
      // Mid-sentence fragment → join with space
      joined[joined.length - 1] = joined[joined.length - 1].trimEnd() + ' ' + trimmed;
    }
  }
  text = joined.join('\n');
  // Final cleanup: collapse remaining 3+ newlines
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

// Main entry: clone element, strip UI noise, convert to markdown
function extractAsMarkdown(element) {
  const clone = element.cloneNode(true);
  // Remove UI-only elements common across platforms
  clone.querySelectorAll(
    'button, svg, [role="button"], [class*="Attachment"], [class*="citation"], ' +
    '[class*="tooltip"], [class*="copy"], [class*="Copy"], [class*="action"]'
  ).forEach(el => el.remove());
  const raw = htmlToMarkdown(clone);
  return cleanMarkdownText(raw);
}

// Export for content script sharing
if (typeof window !== 'undefined') {
  window.__lisaHtmlToMarkdown = { extractAsMarkdown, htmlToMarkdown, cleanMarkdownText };
}
