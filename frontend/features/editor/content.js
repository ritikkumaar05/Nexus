export const sanitizeEditorStyle = (style = '') => {
  const allowed = [];
  style.split(';').forEach((rule) => {
    const [rawName, rawValue] = rule.split(':');
    const name = rawName?.trim().toLowerCase();
    const value = rawValue?.trim();
    if (!name || !value) return;
    if (!['color', 'background-color', 'font-weight', 'font-style', 'text-decoration', 'text-decoration-line'].includes(name)) return;
    if (/^(#[0-9a-f]{3,8}|rgb(a)?\([^)]+\)|hsl(a)?\([^)]+\)|[a-z-]+)$/i.test(value)) {
      allowed.push(`${name}: ${value}`);
    }
  });
  return allowed.join('; ');
};

export const normalizeBrowserEditorMarkup = (root) => {
  root.querySelectorAll('font[color]').forEach((fontNode) => {
    const color = fontNode.getAttribute('color');
    const span = document.createElement('span');
    span.setAttribute('style', `color: ${color}`);
    while (fontNode.firstChild) span.appendChild(fontNode.firstChild);
    fontNode.replaceWith(span);
  });
};

export const sanitizeEditorHtml = (html = '') => {
  const template = document.createElement('template');
  template.innerHTML = String(html || '');
  normalizeBrowserEditorMarkup(template.content);
  const allowedTags = new Set(['P', 'DIV', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'STRIKE', 'SPAN', 'MARK', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'PRE', 'CODE', 'HR', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'A', 'IMG', 'H1', 'H2', 'H3', 'DETAILS', 'SUMMARY', 'FIGURE', 'FIGCAPTION', 'SUP', 'SUB', 'INPUT']);
  const allowedAttrs = new Set(['href', 'src', 'alt', 'title', 'style', 'class', 'target', 'rel', 'type', 'checked', 'disabled']);
  template.content.querySelectorAll('*').forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(document.createTextNode(node.textContent || ''));
      return;
    }
    [...node.attributes].forEach((attr) => {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on') || !allowedAttrs.has(name)) {
        node.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src') && /^(javascript|data:text\/html)/i.test(attr.value.trim())) {
        node.removeAttribute(attr.name);
        return;
      }
      if (name === 'style') {
        const nextStyle = sanitizeEditorStyle(attr.value);
        if (nextStyle) node.setAttribute('style', nextStyle);
        else node.removeAttribute('style');
      }
    });
    if (node.tagName === 'INPUT') {
      if (node.getAttribute('type') !== 'checkbox') node.remove();
      else node.setAttribute('disabled', '');
    }
    if (node.tagName === 'A') {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  return template.innerHTML;
};

export const htmlToPlainText = (html = '') => {
  if (!html) return '';
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  return parsed.body?.textContent || '';
};

export const getEditorStudyStats = ({
  text = '',
  scrollHeight = 0,
  clientHeight = 0,
  scrollTop = 0
} = {}) => {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const readTime = Math.max(1, Math.ceil(words / 220));
  const maxScroll = Math.max(1, (scrollHeight || 0) - (clientHeight || 0));
  const progress = !text.trim() ? 0 : Math.min(100, Math.max(0, Math.round(((scrollTop || 0) / maxScroll) * 100)));
  return { words, readTime, progress };
};
