'use strict';

const readline = require('node:readline');

const c = {
  reset: '\x1b[0m',
  dim: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  bold: '\x1b[1m',
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
function paint(color, str) {
  return useColor ? color + str + c.reset : str;
}

function isInteractive() {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY);
}

// One shared readline interface with a persistent line queue. `readline`'s
// `question()` only captures a line while its transient listener is attached,
// so piped input emitted between two awaited prompts is lost. Buffering every
// line into a queue makes reads reliable for interactive TTYs and pipes alike.
let rl = null;
let muted = false;
let ended = false;
const queue = [];
let waiter = null;

function getRl() {
  if (rl) return rl;
  rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  });
  // Suppress echo while reading secrets.
  rl._writeToOutput = (str) => {
    if (!muted) rl.output.write(str);
  };
  rl.on('line', (line) => {
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    ended = true;
    if (waiter) {
      const w = waiter;
      waiter = null;
      w(null);
    }
  });
  rl.on('SIGINT', () => {
    close();
    process.stdout.write('\n');
    process.exit(130);
  });
  return rl;
}

function nextLine() {
  return new Promise((resolve) => {
    if (queue.length) return resolve(queue.shift());
    if (ended) return resolve(null);
    waiter = resolve;
  });
}

function close() {
  if (rl) {
    rl.close();
    rl = null;
  }
}

async function ask(query, { defaultValue = '' } = {}) {
  getRl();
  const suffix = defaultValue ? paint(c.dim, ` (${defaultValue})`) : '';
  process.stdout.write(`${query}${suffix}: `);
  const line = await nextLine();
  if (line === null) return defaultValue; // EOF
  const val = line.trim();
  return val === '' ? defaultValue : val;
}

// Hidden input for secrets (echo suppressed on a TTY; unavoidable on a pipe).
async function askSecret(query) {
  getRl();
  process.stdout.write(`${query}: `);
  muted = true;
  const line = await nextLine();
  muted = false;
  process.stdout.write('\n');
  return line === null ? '' : line.trim();
}

async function confirm(query, { defaultValue = true } = {}) {
  const hint = defaultValue ? 'Y/n' : 'y/N';
  const answer = (await ask(`${query} ${paint(c.dim, '[' + hint + ']')}`)).toLowerCase();
  if (answer === '') return defaultValue;
  return answer === 'y' || answer === 'yes';
}

// Numbered single-choice menu. Reliable across every terminal and on pipes.
// choices: [{ name, value, hint }]
async function select(message, choices) {
  process.stdout.write(paint(c.bold, message) + '\n');
  choices.forEach((choice, i) => {
    const hint = choice.hint ? paint(c.dim, `  (${choice.hint})`) : '';
    process.stdout.write(`  ${paint(c.cyan, String(i + 1))}) ${choice.name}${hint}\n`);
  });
  for (;;) {
    const answer = await ask('Enter number', { defaultValue: '1' });
    const n = parseInt(answer, 10);
    if (!Number.isNaN(n) && n >= 1 && n <= choices.length) {
      return choices[n - 1].value;
    }
    process.stdout.write(paint(c.red, `  Please enter 1-${choices.length}.\n`));
  }
}

module.exports = { ask, askSecret, confirm, select, isInteractive, close, paint, colors: c };
