const sourceLimit = 50_000;
const editor = document.getElementById('playground-source');
const exampleSelect = document.getElementById('playground-example');
const checkButton = document.getElementById('playground-check');
const status = document.getElementById('playground-status');
const summary = document.getElementById('playground-summary');
const diagnosticsPanel = document.getElementById('playground-diagnostics');
const irPanel = document.getElementById('playground-ir');
const contextPanel = document.getElementById('playground-context');
const tabButtons = [...document.querySelectorAll('[data-playground-panel]')];
const panels = new Map([
  ['result', document.getElementById('playground-result-panel')],
  ['diagnostics', diagnosticsPanel],
  ['ir', irPanel],
  ['context', contextPanel],
]);

let worker;
let knowledgeIndex;
let nextId = 0;
let activeTimer;
let checking = false;

const setStatus = (message) => {
  status.textContent = message;
};

function selectPanel(name) {
  for (const button of tabButtons) {
    const selected = button.dataset.playgroundPanel === name;
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const [id, panel] of panels) panel.hidden = id !== name;
}

function showJson(element, value) {
  element.textContent = value ? JSON.stringify(value, null, 2) : 'No typed IR is available until the source checks successfully.';
}

function renderDiagnostics(items) {
  diagnosticsPanel.replaceChildren();
  if (!items.length) {
    diagnosticsPanel.append(document.createTextNode('No diagnostics. The source checks successfully.'));
    return;
  }
  const list = document.createElement('ol');
  list.className = 'playground-diagnostic-list';
  for (const item of items) {
    const row = document.createElement('li');
    const heading = document.createElement('strong');
    heading.textContent = `${item.code} · line ${item.line}, column ${item.column}`;
    const message = document.createElement('p');
    message.textContent = item.message;
    row.append(heading, message);
    for (const suggestion of item.suggestions ?? []) {
      const hint = document.createElement('p');
      hint.className = 'playground-hint';
      hint.textContent = `Hint: ${suggestion}`;
      row.append(hint);
    }
    list.append(row);
  }
  diagnosticsPanel.append(list);
}

function disposeWorker() {
  if (activeTimer) clearTimeout(activeTimer);
  activeTimer = undefined;
  worker?.terminate();
  worker = undefined;
}

function createWorker() {
  disposeWorker();
  worker = new Worker('/playground-worker.js', { name: 'bmec-source-checker' });
  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'ready') {
      if (!checking) {
        checkButton.disabled = false;
        setStatus('Ready · source stays in this browser');
      }
      return;
    }
    if (message.type === 'error' && message.id === undefined) {
      setStatus(message.message);
      return;
    }
    if (message.id !== nextId) return;
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    if (message.type === 'error') {
      setStatus(message.message);
      summary.textContent = 'The source was not checked.';
      return;
    }
    const errors = message.diagnostics.length;
    summary.textContent = errors
      ? `${errors} diagnostic${errors === 1 ? '' : 's'} found. BMEC source is checked, never executed.`
      : 'Source checks successfully. BMEC function bodies are not executed here.';
    renderDiagnostics(message.diagnostics);
    showJson(irPanel, message.ir);
    showJson(contextPanel, message.context);
    setStatus(errors ? `Check complete · ${errors} diagnostic${errors === 1 ? '' : 's'}` : 'Check complete · 0 diagnostics');
  });
  worker.addEventListener('error', () => {
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    setStatus('The local checker stopped unexpectedly. Your source was not sent to a server.');
  }, { once: true });
  worker.postMessage({ type: 'init', index: knowledgeIndex });
}

function runCheck() {
  const source = editor.value;
  if (source.length > sourceLimit) {
    setStatus(`Source is over the ${sourceLimit.toLocaleString()}-character limit.`);
    editor.focus();
    return;
  }
  if (!knowledgeIndex) {
    setStatus('The local compiler is not ready. Reload this page to try again.');
    return;
  }

  checking = true;
  createWorker();
  nextId += 1;
  checkButton.disabled = true;
  setStatus('Checking locally in your browser…');
  summary.textContent = 'Working in a short-lived browser worker. No source is uploaded.';
  selectPanel('result');
  worker.postMessage({ type: 'check', id: nextId, source });
  activeTimer = setTimeout(() => {
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    setStatus('This check reached its 2-second limit. Shorten the source and try again.');
    summary.textContent = 'The timed-out worker was stopped. No server request was made.';
  }, 2_000);
}

async function loadExamples() {
  try {
    const response = await fetch('/ai/examples.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Examples are unavailable.');
    const catalog = await response.json();
    const sourceExamples = catalog.examples.filter((item) => typeof item.title === 'string' && typeof item.source === 'string');
    for (const item of sourceExamples) {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.title;
      exampleSelect.append(option);
    }
    if (sourceExamples.length) {
      exampleSelect.disabled = false;
      editor.value = sourceExamples[0].source;
      exampleSelect.addEventListener('change', () => {
        const selected = sourceExamples.find((item) => item.id === exampleSelect.value);
        if (selected) editor.value = selected.source;
        editor.focus();
        setStatus('Example loaded · select Check to inspect it');
      });
    }
  } catch {
    setStatus('Examples are unavailable. You can still write BMEC source in the editor.');
  }
}

async function start() {
  for (const button of tabButtons) button.addEventListener('click', () => selectPanel(button.dataset.playgroundPanel));
  checkButton.addEventListener('click', runCheck);
  editor.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      runCheck();
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      editor.setRangeText('  ', start, end, 'end');
    }
  });
  await loadExamples();
  try {
    const response = await fetch('/ai/knowledge-index.json', { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Knowledge index is unavailable.');
    knowledgeIndex = await response.json();
    if (knowledgeIndex.schemaVersion !== 'bmec.knowledge-index.v1') throw new Error('Knowledge index version is unsupported.');
    createWorker();
  } catch {
    setStatus('The local compiler could not load BMEC knowledge. Reload this page to try again.');
  }
}

start();
