export const getEditorSelectionRange = (editorEl, fallbackLength = 0) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editorEl?.contains(selection.anchorNode)) {
    return { start: fallbackLength, end: fallbackLength };
  }

  const range = selection.getRangeAt(0);
  const startRange = range.cloneRange();
  startRange.selectNodeContents(editorEl);
  startRange.setEnd(range.startContainer, range.startOffset);

  const endRange = range.cloneRange();
  endRange.selectNodeContents(editorEl);
  endRange.setEnd(range.endContainer, range.endOffset);

  return {
    start: startRange.toString().length,
    end: endRange.toString().length
  };
};

export const getSelectedTextFromEditor = (editorEl) => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !editorEl?.contains(selection.anchorNode)) return '';
  return selection.toString().trim();
};

export const focusEditorTextRange = (editorEl, start, end = start) => {
  if (!editorEl) return;
  editorEl.focus();
  const range = document.createRange();
  const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  let consumed = 0;
  let startNode = null;
  let endNode = null;
  let startOffset = 0;
  let endOffset = 0;
  while (node) {
    const nextConsumed = consumed + node.textContent.length;
    if (!startNode && start <= nextConsumed) {
      startNode = node;
      startOffset = Math.max(0, start - consumed);
    }
    if (!endNode && end <= nextConsumed) {
      endNode = node;
      endOffset = Math.max(0, end - consumed);
      break;
    }
    consumed = nextConsumed;
    node = walker.nextNode();
  }
  if (!startNode || !endNode) return;
  range.setStart(startNode, startOffset);
  range.setEnd(endNode, endOffset);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
};
