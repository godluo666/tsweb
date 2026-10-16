const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const inlineTags = { b: 'strong', i: 'em', u: 'u', s: 's' };
const alignments = new Set(['center', 'left', 'right']);
const unquote = value => value.trim().replace(/^(["'])(.*)\1$/, '$2');

function linkTarget(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
  } catch {}
  return null;
}

function wrap(frame, content, source) {
  const html = frame.parts.join('');
  if (inlineTags[frame.tag]) return `<${inlineTags[frame.tag]}>${html}</${inlineTags[frame.tag]}>`;
  if (alignments.has(frame.tag)) return `<span class="bb-align bb-${frame.tag}">${html}</span>`;
  if (frame.tag === 'color') return `<span style="color:${frame.value}">${html}</span>`;
  const href = linkTarget(frame.value ?? source.slice(frame.start, content.index).trim());
  return href ? `<a href="${escape(href)}" target="_blank" rel="noopener noreferrer">${html}</a>` : `${escape(frame.open)}${html}${escape(content[0])}`;
}

export function renderBBCode(value) {
  const source = String(value).replace(/\r\n?/g, '\n');
  const stack = [{ parts: [] }];
  const tags = /\[(\/?)(b|i|u|s|center|left|right|color|url)(?:=([^\]\n]*))?\]/gi;
  let position = 0;
  for (const match of source.matchAll(tags)) {
    let current = stack.at(-1);
    current.parts.push(escape(source.slice(position, match.index)));
    position = match.index + match[0].length;
    const tag = match[2].toLowerCase();
    const parameter = match[3] === undefined ? undefined : unquote(match[3]);
    if (match[1]) {
      if (current.tag === tag && parameter === undefined) {
        stack.pop();
        stack.at(-1).parts.push(wrap(current, match, source));
      } else current.parts.push(escape(match[0]));
    } else {
      const valid = tag === 'color'
        ? parameter !== undefined && /^(?:[a-z]+|#(?:[a-f\d]{3,4}|[a-f\d]{6}|[a-f\d]{8}))$/i.test(parameter)
        : tag === 'url' || parameter === undefined;
      if (valid) stack.push({ tag, value: parameter, open: match[0], start: position, parts: [] });
      else current.parts.push(escape(match[0]));
    }
  }
  stack.at(-1).parts.push(escape(source.slice(position)));
  while (stack.length > 1) {
    const frame = stack.pop();
    stack.at(-1).parts.push(escape(frame.open), ...frame.parts);
  }
  return stack[0].parts.join('');
}
