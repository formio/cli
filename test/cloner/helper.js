/* globals before, after, beforeEach */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Cloner = require('../../src/Cloner');
const {SRC_URI, DST_URI, TestDb} = require('./fixtures');

// The cloner reads and writes clonestate.json relative to the current working directory, so every
// suite runs inside a throw-away directory.
let originalCwd = null;
let workDir = null;

/**
 * Run the suite inside a temporary working directory, and connect to the source/destination test
 * databases. Returns an accessor object that is populated by the time the suite's tests run.
 */
function useTestDatabases() {
  const context = {src: null, dst: null, workDir: null};

  before('Connect to the test databases', async function() {
    originalCwd = process.cwd();
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cloner-test-'));
    process.chdir(workDir);
    context.workDir = workDir;
    context.src = await new TestDb(SRC_URI).connect();
    context.dst = await new TestDb(DST_URI).connect();
  });

  beforeEach('Clear the test databases', async function() {
    await context.src.reset();
    await context.dst.reset();
    fs.rmSync(path.join(workDir, 'clonestate.json'), {force: true});
  });

  after('Disconnect from the test databases', async function() {
    await context.src.close();
    await context.dst.close();
    process.chdir(originalCwd);
    fs.rmSync(workDir, {recursive: true, force: true});
  });

  return context;
}

/**
 * Create a cloner against the test databases without running it.
 * @param {object} options - The cloner options.
 * @param {string} source - An optional source override.
 * @param {string} destination - An optional destination override.
 */
function createCloner(options = {}, source = SRC_URI, destination = DST_URI) {
  return new Cloner(source, destination, options);
}

/**
 * Run a complete clone against the test databases.
 * @param {object} options - The cloner options.
 * @param {string} source - An optional source override.
 * @param {string} destination - An optional destination override.
 */
async function runClone(options = {}, source = SRC_URI, destination = DST_URI) {
  const cloner = createCloner(options, source, destination);
  try {
    await cloner.clone();
  }
  finally {
    if (typeof cloner.destroy === 'function') {
      cloner.destroy();
    }
  }
  return cloner;
}

// Everything the last quiet() run printed.
let captured = '';

/**
 * The report lines the last run printed.
 */
function dryRunLines() {
  return captured
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /^(Created|Updated|Extra) /.test(line));
}

/**
 * Everything the last run printed, verbatim.
 */
function capturedOutput() {
  return captured;
}

/**
 * Determine whether the clone state file exists in the working directory.
 */
function cloneStateExists() {
  return fs.existsSync(path.join(workDir, 'clonestate.json'));
}

/**
 * Write a clone state file, as an interrupted clone would leave behind.
 * @param {object} state - The clone state to write.
 */
function writeCloneState(state) {
  fs.writeFileSync(path.join(workDir, 'clonestate.json'), JSON.stringify(state, null, 2));
}

/**
 * Silence the cloner's progress output for the duration of a callback.
 * @param {Function} cb - The callback to run.
 */
async function quiet(cb) {
  const write = process.stdout.write;
  const log = console.log;
  captured = '';
  process.stdout.write = (text) => {
    captured += String(text);
    return true;
  };
  console.log = (...args) => {
    captured += `${args.join(' ')}\n`;
  };
  try {
    return await cb();
  }
  finally {
    process.stdout.write = write;
    console.log = log;
  }
}

module.exports = {
  useTestDatabases,
  createCloner,
  runClone,
  dryRunLines,
  capturedOutput,
  cloneStateExists,
  writeCloneState,
  quiet,
  SRC_URI,
  DST_URI
};
