const sourceLimit = 50_000;
const editor = document.getElementById('playground-source');
const exampleSelect = document.getElementById('playground-example');
const checkButton = document.getElementById('playground-check');
const runButton = document.getElementById('playground-run');
const functionSelect = document.getElementById('playground-function');
const argsInput = document.getElementById('playground-args');
const runOutput = document.getElementById('playground-run-output');
const copyContextButton = document.getElementById('playground-copy-context');
const downloadSourceButton = document.getElementById('playground-download-source');
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
let latestContext;

const setStatus = (message) => { status.textContent = message; };

function selectPanel(name) {
  for (const button of tabButtons) {
    const selected = button.dataset.playgroundPanel === name;
    button.setAttribute('aria-pressed', String(selected));
  }
  for (const [id, panel] of panels) panel.hidden = id !== name;
}

function showJson(element, value) {
  element.textContent = value ? JSON.stringify(value, (_key, item) => typeof item === 'bigint' ? item.toString() : item, 2) : 'No typed IR is available until the source checks successfully.';
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
  worker = new Worker('/playground-worker.js', { name: 'bmec-local-playground' });
  worker.addEventListener('message', (event) => {
    const message = event.data;
    if (message.type === 'ready') {
      if (!checking) {
        checkButton.disabled = false;
        setStatus('Compiler ready · source stays in this browser');
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
    if (message.type === 'run-result') {
      runButton.disabled = false;
      const output = message.ok
        ? JSON.stringify(message.value, (_key, value) => typeof value === 'bigint' ? value.toString() : value, 2)
        : `Run stopped\n${message.message}`;
      runOutput.textContent = output;
      summary.textContent = message.ok ? 'Function returned a value.' : 'Function could not run.';
      setStatus(message.ok ? 'Run complete · local pure-function runner' : 'Run stopped · see the explanation below');
      selectPanel('result');
      return;
    }
    runButton.disabled = true;
    if (message.type === 'error') {
      setStatus(message.message);
      summary.textContent = 'The source was not checked.';
      return;
    }
    const errors = message.diagnostics.length;
    summary.textContent = errors
      ? `${errors} diagnostic${errors === 1 ? '' : 's'} found. Fix the source before running a function.`
      : 'Source checks successfully. Choose a function and run it locally.';
    renderDiagnostics(message.diagnostics);
    showJson(irPanel, message.ir);
    showJson(contextPanel, message.context);
    latestContext = message.context;
    copyContextButton.disabled = !latestContext;
    functionSelect.replaceChildren();
    for (const fn of Array.isArray(message.functions) ? message.functions : []) {
      const option = document.createElement('option');
      option.value = fn.id;
      option.textContent = `${fn.name}(${fn.parameters.map(parameter => `${parameter.name}: ${parameter.type}`).join(', ')})`;
      option.dataset.functionName = fn.name;
      functionSelect.append(option);
    }
    const hasFunctions = functionSelect.options.length > 0;
    functionSelect.disabled = errors > 0 || !hasFunctions;
    runButton.disabled = errors > 0 || !hasFunctions;
    if (!errors && !hasFunctions) runOutput.textContent = 'This source has no runnable functions yet. Add a pure function declaration to run it here.';
    setStatus(errors ? `Check complete · ${errors} diagnostic${errors === 1 ? '' : 's'}` : 'Check complete · 0 diagnostics');
  });
  worker.addEventListener('error', () => {
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    runButton.disabled = true;
    setStatus('The local compiler stopped unexpectedly. Your source was not sent to a server.');
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
  runButton.disabled = true;
  functionSelect.disabled = true;
  createWorker();
  nextId += 1;
  checkButton.disabled = true;
  setStatus('Checking locally in your browser…');
  summary.textContent = 'Checking with BMEC in a short-lived browser worker. No source is uploaded.';
  selectPanel('result');
  worker.postMessage({ type: 'check', id: nextId, source });
  activeTimer = setTimeout(() => {
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    runButton.disabled = true;
    setStatus('This check reached its 2-second limit. Shorten the source and try again.');
    summary.textContent = 'The timed-out worker was stopped. No server request was made.';
  }, 2_000);
}

function runFunction() {
  const source = editor.value;
  if (source.length > sourceLimit) return setStatus(`Source is over the ${sourceLimit.toLocaleString()}-character limit.`);
  if (!knowledgeIndex) return setStatus('The local compiler is not ready. Reload this page to try again.');
  let args;
  try {
    args = JSON.parse(argsInput.value);
    if (!Array.isArray(args)) throw new Error('Arguments must be a JSON array.');
  } catch (error) {
    argsInput.focus();
    return setStatus(error instanceof Error ? error.message : 'Arguments must be a JSON array.');
  }
  const selected = functionSelect.selectedOptions[0];
  if (!selected?.dataset.functionName) return setStatus('Check the source and choose a function first.');
  checking = true;
  createWorker();
  nextId += 1;
  checkButton.disabled = true;
  runButton.disabled = true;
  setStatus('Running a bounded pure function locally…');
  summary.textContent = `Running ${selected.dataset.functionName} in an isolated worker. No host capabilities are provided.`;
  runOutput.textContent = 'Running…';
  selectPanel('result');
  worker.postMessage({ type: 'run', id: nextId, source, functionName: selected.dataset.functionName, args });
  activeTimer = setTimeout(() => {
    disposeWorker();
    checking = false;
    checkButton.disabled = false;
    runButton.disabled = false;
    setStatus('This run reached its 2-second limit. The worker was stopped; shorten the program and try again.');
    runOutput.textContent = 'Execution stopped at the 2-second time limit.';
    summary.textContent = 'The worker was stopped before it could return.';
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
      const queryExample = new URLSearchParams(location.search).get('example');
      const initial = sourceExamples.find(item => item.id === queryExample || item.name === queryExample) ?? sourceExamples[0];
      editor.value = initial.source;
      exampleSelect.value = initial.id;
      exampleSelect.addEventListener('change', () => {
        const selected = sourceExamples.find((item) => item.id === exampleSelect.value);
        if (selected) editor.value = selected.source;
        editor.focus();
        invalidateCheck();
        setStatus('Example loaded · select Check, then run a function');
      });
    }
  } catch {
    setStatus('Examples are unavailable. You can still write BMEC source in the editor.');
  }
}

function invalidateCheck() {
  runButton.disabled = true;
  functionSelect.disabled = true;
  functionSelect.replaceChildren(new Option('Check source first', ''));
  copyContextButton.disabled = true;
  latestContext = undefined;
  runOutput.textContent = 'Run the updated source after checking it.';
}

async function copyAIContext() {
  if (!latestContext) return;
  const prompt = [
    'Help me make a small change in BMEC.',
    'Use the attached compiler-generated context as the authority for syntax, types, capabilities, and limits.',
    'Explain compiler diagnostics by code. Make the smallest useful change. Do not assume this browser runner can use files, network, databases, or host capabilities.',
    '',
    JSON.stringify(latestContext, null, 2),
  ].join('\n');
  try {
    await navigator.clipboard.writeText(prompt);
    setStatus('Compiler context copied · paste it into your coding assistant');
    copyContextButton.textContent = 'Copied for AI';
    setTimeout(() => { copyContextButton.textContent = 'Copy context for AI'; }, 1800);
  } catch {
    selectPanel('context');
    setStatus('Clipboard is unavailable · open AI context and copy it manually');
  }
}

function downloadSource() {
  const blob = new Blob([editor.value], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'main.bmec';
  link.click();
  URL.revokeObjectURL(url);
  setStatus('Downloaded main.bmec to this device');
}

async function start() {
  for (const button of tabButtons) button.addEventListener('click', () => selectPanel(button.dataset.playgroundPanel));
  checkButton.addEventListener('click', runCheck);
  runButton.addEventListener('click', runFunction);
  copyContextButton.addEventListener('click', copyAIContext);
  downloadSourceButton.addEventListener('click', downloadSource);
  editor.addEventListener('input', invalidateCheck);
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
  argsInput.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') runFunction();
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
