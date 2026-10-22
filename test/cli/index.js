/* globals describe, it, before, beforeEach */
'use strict';
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {execFileSync} = require('child_process');
const {Command} = require('commander');
const {parse} = require('csv-parse');
const {transform} = require('stream-transform');

// The commands colour their output through the String extensions index.js loads.
require('colors');

const root = path.resolve(__dirname, '../..');
const pkg = require(path.join(root, 'package.json'));

// What each stubbed step of a command was called with.
let calls = [];

/**
 * Replace a module with a stub before the commands require it.
 * @param {string} relative - The module, relative to the root of the project.
 * @param {*} exports - What the module should export.
 */
function stub(relative, exports) {
  const file = require.resolve(path.join(root, relative));
  require.cache[file] = {id: file, filename: file, loaded: true, exports};
}

/**
 * A stubbed command step that records the options it was handed.
 * @param {string} name - The name of the step.
 */
function step(name) {
  return (options, next) => {
    calls.push({name, options});
    next();
  };
}

/**
 * Run the command line against a fresh program, resolving once the command is done.
 * @param {...string} args - The command line arguments.
 */
function run(...args) {
  return new Promise((resolve, reject) => {
    const program = new Command();
    program.exitOverride();
    program.configureOutput({writeOut: () => {}, writeErr: () => {}});
    require(path.join(root, 'commands/commands'))(program, (err) => (err ? reject(err) : resolve()));
    program.parseAsync(['node', 'formio', ...args]).then(() => {
      // The clone and rekey commands are not run through a series, so they are done once the action is.
      if (['clone', 'rekey'].includes(args[0])) {
        resolve();
      }
    }, reject);
  });
}

describe('Command line', function() {
  before('Stub out everything that talks to a server', function() {
    stub('src/authenticate.js', (config) => (options, next) => {
      calls.push({name: 'authenticate', config, options});
      next();
    });
    stub('src/deploy.js', step('deploy'));
    stub('src/copy.js', step('copy'));
    stub('src/migrate.js', step('migrate'));
    stub('src/submissions.js', step('submissions'));
    stub('src/clone.js', async(source, destination, options) => {
      calls.push({name: 'clone', source, destination, options});
    });
    stub('src/rekey.js', async(mongoUrl, options) => {
      calls.push({name: 'rekey', mongoUrl, options});
    });
  });

  beforeEach(function() {
    calls = [];
  });

  describe('clone', function() {
    it('Should hand every option to the cloner', async function() {
      await run('clone', 'mongodb://src', 'mongodb://dst',
        '--src-project', 'aaa',
        '--dst-project', 'bbb',
        '--dry-run',
        '--extra',
        '--batch-size', '50',
        '--max-batch-bytes', '1024',
        '--no-update-existing',
        '--update-existing-submissions',
        '--deleted-after', '5',
        '--include-form-revisions',
        '--src-db-secret', 'one',
        '--dst-db-secret', 'two',
        '-a');

      assert.equal(calls.length, 1);
      const {source, destination, options} = calls[0];
      assert.equal(source, 'mongodb://src');
      assert.equal(destination, 'mongodb://dst');
      assert.equal(options.srcProject, 'aaa');
      assert.equal(options.dstProject, 'bbb');
      assert.equal(options.dryRun, true);
      assert.equal(options.extra, true);
      assert.equal(options.batchSize, '50');
      assert.equal(options.maxBatchBytes, '1024');
      assert.equal(options.updateExisting, false);
      assert.equal(options.updateExistingSubmissions, true);
      assert.equal(options.deletedAfter, '5');
      assert.equal(options.includeFormRevisions, true);
      assert.equal(options.srcDbSecret, 'one');
      assert.equal(options.dstDbSecret, 'two');
      assert.equal(options.all, true);
    });

    it('Should use the defaults when no options are given', async function() {
      await run('clone', 'mongodb://src', 'mongodb://dst');
      const {options} = calls[0];
      assert.equal(options.updateExisting, true, 'Existing projects and forms are updated by default.');
      assert.equal(options.dryRun, false);
      assert.equal(options.all, false);
      assert.equal(options.submissionsOnly, false);
    });

    it('Should require a source and a destination', async function() {
      await assert.rejects(() => run('clone', 'mongodb://src'), /missing required argument/);
    });
  });

  describe('rekey', function() {
    it('Should hand every option to the re-key', async function() {
      await run('rekey', 'mongodb://db',
        '--new-db-secret', 'new',
        '--old-db-secret', 'old1',
        '--old-db-secret', 'old2',
        '--project', 'aaa,bbb',
        '--dry-run',
        '--no-submission-revisions',
        '--batch-size', '50',
        '--ca', 'ca.pem',
        '--cert', 'cert.pem');

      assert.equal(calls.length, 1);
      const {mongoUrl, options} = calls[0];
      assert.equal(mongoUrl, 'mongodb://db');
      assert.equal(options.newDbSecret, 'new');
      assert.deepEqual(options.oldDbSecret, ['old1', 'old2']);
      assert.equal(options.project, 'aaa,bbb');
      assert.equal(options.dryRun, true);
      assert.equal(options.submissionRevisions, false);
      assert.equal(options.batchSize, '50');
      assert.equal(options.ca, 'ca.pem');
      assert.equal(options.cert, 'cert.pem');
    });

    it('Should use the defaults when no options are given', async function() {
      await run('rekey', 'mongodb://db', '--new-db-secret', 'new');
      const {options} = calls[0];
      assert.deepEqual(options.oldDbSecret, []);
      assert.equal(options.dryRun, false);
      assert.equal(options.submissionRevisions, true);
    });

    it('Should require the new secret', async function() {
      await assert.rejects(() => run('rekey', 'mongodb://db'), /required option '--new-db-secret <secret>'/);
    });
  });

  describe('commands run as a series', function() {
    it('Should hand the options and arguments of deploy to every step', async function() {
      await run('deploy', 'https://src.example.com', 'https://dst.example.com',
        '--key', 'k', '--src-admin-key', 's', '--dst-admin-key', 'd');

      assert.deepEqual(calls.map((call) => call.name), ['authenticate', 'deploy']);
      const options = calls[1].options;
      assert.equal(calls[0].options, options, 'Every step shares one options object.');
      assert.deepEqual(options.params, ['https://src.example.com', 'https://dst.example.com']);
      assert.equal(options.key, 'k');
      assert.equal(options.srcAdminKey, 's');
      assert.equal(options.dstAdminKey, 'd');
      assert.deepEqual(calls[0].config, {src: 0, dst: 1});
    });

    it('Should parse copy', async function() {
      await run('copy', 'form', 'https://src.example.com/a', 'https://dst.example.com/b', '--full', '-k', 'key');
      const options = calls[1].options;
      assert.equal(calls[1].name, 'copy');
      assert.deepEqual(options.params, ['form', 'https://src.example.com/a', 'https://dst.example.com/b']);
      assert.equal(options.full, true);
      assert.equal(options.key, 'key');
    });

    it('Should parse migrate', async function() {
      await run('migrate', 'input.csv', 'transform.js', 'https://dst.example.com/form',
        '--delete-after', '2022-05-30T12:00:00.000Z', '--start-with', 'abc');
      const options = calls[1].options;
      assert.equal(calls[1].name, 'migrate');
      assert.deepEqual(options.params, ['input.csv', 'transform.js', 'https://dst.example.com/form']);
      assert.equal(options.deleteAfter, '2022-05-30T12:00:00.000Z');
      assert.equal(options.startWith, 'abc');
    });

    it('Should parse submissions, with and without its optional argument', async function() {
      await run('submissions', 'https://src.example.com/form', '--admin-key', 'a', '-h', 'host.example.com');
      let options = calls[1].options;
      assert.equal(calls[1].name, 'submissions');
      assert.deepEqual(options.params, ['https://src.example.com/form', undefined]);
      assert.equal(options.adminKey, 'a');
      assert.equal(options.host, 'host.example.com');

      calls = [];
      await run('submissions', 'https://src.example.com/form', 'each.js');
      options = calls[1].options;
      assert.deepEqual(options.params, ['https://src.example.com/form', 'each.js']);
    });

    it('Should pass a failing step on as the error of the command', async function() {
      stub('src/deploy.js', (options, next) => next(new Error('the deploy failed')));
      try {
        await assert.rejects(() => run('deploy', 'a', 'b'), /the deploy failed/);
      }
      finally {
        stub('src/deploy.js', step('deploy'));
      }
    });
  });

  describe('the formio executable', function() {
    /**
     * Run the real executable.
     * @param {...string} args - The command line arguments.
     */
    function formio(...args) {
      return execFileSync(process.execPath, [path.join(root, 'bin/formio'), ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
      });
    }

    it('Should print its version', function() {
      assert.match(formio('--version'), new RegExp(pkg.version.replace(/\./g, '\\.')));
    });

    it('Should describe the options of every command', function() {
      assert.match(formio('clone', '--help'), /--dry-run/);
      assert.match(formio('deploy', '--help'), /--src-admin-key/);
      assert.match(formio('copy', '--help'), /--full/);
      assert.match(formio('migrate', '--help'), /--delete-before/);
      assert.match(formio('submissions', '--help'), /--admin-key/);
      assert.match(formio('rekey', '--help'), /--old-db-secret/);
    });
  });

  describe('modules', function() {
    it('Should load every command implementation', function() {
      const files = [
        'src/migrate.js', 'src/submissions.js', 'src/copy.js', 'src/deploy.js', 'src/clone.js', 'src/rekey.js'
      ];
      for (const file of files) {
        const resolved = require.resolve(path.join(root, file));
        const cached = require.cache[resolved];
        delete require.cache[resolved];
        try {
          assert.equal(typeof require(resolved), 'function', `${file} should export a function.`);
        }
        finally {
          require.cache[resolved] = cached;
        }
      }
    });

    it('Should read a CSV file the way migrate does', async function() {
      const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cli-test-')), 'input.csv');
      fs.writeFileSync(file, 'first, last\n Ada ,Lovelace\nGrace,  Hopper \n');
      const records = [];
      try {
        await new Promise((resolve, reject) => {
          fs.createReadStream(file)
            .pipe(parse({ltrim: true, rtrim: true}))
            .pipe(transform((record, next) => {
              records.push(record);
              next(null, record);
            }))
            .on('error', reject)
            .on('finish', resolve)
            .resume();
        });
      }
      finally {
        fs.rmSync(path.dirname(file), {recursive: true, force: true});
      }
      assert.deepEqual(records, [['first', 'last'], ['Ada', 'Lovelace'], ['Grace', 'Hopper']]);
    });

    it('Should transform records synchronously the way submissions does', async function() {
      const output = [];
      await new Promise((resolve, reject) => {
        const stream = transform((record) => `${record.id}\n`);
        stream.on('data', (chunk) => output.push(String(chunk)));
        stream.on('error', reject);
        stream.on('end', resolve);
        stream.write({id: 1});
        stream.write({id: 2});
        stream.end();
      });
      assert.deepEqual(output, ['1\n', '2\n']);
    });
  });
});
