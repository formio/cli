/* globals describe, it, beforeEach, afterEach */
'use strict';
const assert = require('assert');
const {Collection} = require('mongodb');
const Progress = require('../../src/Progress');
const Cloner = require('../../src/Cloner');
const {seedProject} = require('./fixtures');
const {useTestDatabases, createCloner, runClone, quiet, capturedOutput} = require('./helper');

/**
 * A stream that records what is written to it.
 */
function stream(options = {}) {
  return Object.assign({
    chunks: [],
    columns: 120,
    write(text) {
      this.chunks.push(String(text));
      return true;
    },
    get output() {
      return this.chunks.join('');
    }
  }, options);
}

describe('Progress', function() {
  let now = 0;
  let realNow = null;

  beforeEach(function() {
    realNow = Date.now;
    now = 1000000;
    Date.now = () => now;
  });

  afterEach(function() {
    Date.now = realNow;
  });

  describe('in a terminal', function() {
    it('Should draw a bar with the percentage, the rate and the time left', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 200, stream: out, interactive: true});
      progress.tick();
      now += 10000;
      progress.tick(49);

      const line = out.chunks[out.chunks.length - 1];
      // eslint-disable-next-line no-control-regex
      assert.match(line, /^\r- Submissions: \[######-+\] 25% 50\/200 5\/s ETA 30s\x1b\[K$/);
    });

    it('Should not count the wait for the first document as part of the rate', function() {
      // A large form can take more than a minute to start: the source sorts it before handing over
      // the first submission. The rate that follows is what decides the time left.
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 70972, stream: out, interactive: true});
      now += 85000;
      for (let i = 0; i < 1200; i++) {
        progress.tick();
        now += 5;
      }
      const line = out.chunks[out.chunks.length - 1];
      assert.match(line, /\/70,972 200\/s ETA 5m 49s/, `Got ${JSON.stringify(line)}`);
    });

    it('Should follow how fast the clone is going now, not its average', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 100000, stream: out, interactive: true});
      for (let i = 0; i < 6000; i++) {
        progress.tick();
        now += 10;
      }
      for (let i = 0; i < 300; i++) {
        progress.tick();
        now += 100;
      }
      const line = out.chunks[out.chunks.length - 1];
      assert.match(line, / 10\/s /, `After 30s at 10/s the rate should be 10/s, got ${JSON.stringify(line)}`);
    });

    it('Should redraw at most ten times a second, however many documents there are', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 1000000, stream: out, interactive: true});
      for (let i = 0; i < 1000000; i++) {
        progress.tick();
        // A million documents in two seconds.
        now += 0.002;
      }
      const redraws = out.chunks.filter((chunk) => chunk.startsWith('\r')).length;
      assert.ok(redraws <= 21, `Expected about 20 redraws for 2 seconds, got ${redraws}.`);
      assert.ok(redraws >= 19, `Expected about 20 redraws for 2 seconds, got ${redraws}.`);
    });

    it('Should leave the final count on the line', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 3, stream: out, interactive: true});
      progress.tick();
      progress.tick();
      progress.tick();
      now += 65000;
      progress.done();
      assert.match(out.chunks[out.chunks.length - 1], /\[#{24}\] 100% 3\/3 in 1m 5s/);
    });

    it('Should never draw a line wider than the terminal', function() {
      const out = stream({columns: 30});
      const progress = new Progress('         - Submissions:', {total: 10, stream: out, interactive: true});
      progress.tick();
      const visible = out.chunks[out.chunks.length - 1].replace('\r', '').replace('\x1b[K', '');
      assert.ok(visible.length <= 29, `A line that wraps cannot be redrawn: ${JSON.stringify(visible)}`);
    });

    it('Should move to a new line when something else is written', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 10, stream: out, interactive: true});
      progress.tick();
      progress.interrupt();
      assert.equal(out.chunks[out.chunks.length - 1], '\n');
      now += 1;
      progress.tick();
      assert.ok(out.chunks[out.chunks.length - 1].startsWith('\r'), 'The line is drawn again straight away.');
    });

    it('Should show a running count when the total is not known', function() {
      const out = stream();
      const progress = new Progress('- Actions:', {stream: out, interactive: true});
      progress.tick(1234);
      // eslint-disable-next-line no-control-regex
      assert.match(out.chunks[out.chunks.length - 1], /\r- Actions: 1,234\x1b\[K/);
    });

    it('Should switch to a bar once the total is known', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {stream: out, interactive: true});
      progress.tick(10);
      assert.match(out.chunks[out.chunks.length - 1], /- Submissions: 10/);
      progress.setTotal(40);
      now += 1;
      progress.tick();
      assert.match(out.chunks[out.chunks.length - 1], /\[#{7}-{17}\] 27% 11\/40/,
        'The bar is drawn straight away rather than at the next redraw.');
    });

    it('Should show the count going past a total that grew while cloning', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 2, stream: out, interactive: true});
      progress.tick(3);
      progress.done();
      assert.match(out.chunks[out.chunks.length - 1], /100% 3\/2/);
    });
  });

  describe('in a log', function() {
    it('Should append the final count to the heading of a short collection', function() {
      const out = stream();
      const progress = new Progress('   - Roles:', {stream: out, interactive: false});
      progress.tick(3);
      progress.done();
      assert.equal(out.output, '\n   - Roles: 3');
    });

    it('Should write a line every thirty seconds, and never redraw', function() {
      const out = stream();
      const progress = new Progress('- Submissions:', {total: 100, stream: out, interactive: false});
      for (let i = 0; i < 100; i++) {
        progress.tick();
        now += 1000;
      }
      progress.done();
      assert.ok(!out.output.includes('\r'), 'A log cannot redraw a line.');
      const lines = out.output.split('\n').filter((line) => line);
      assert.equal(lines.length, 5,
        `Expected the heading, 3 progress lines and the result, got ${JSON.stringify(lines)}`);
      assert.match(lines[4], /100% 100\/100/);
    });
  });
});

describe('Clone progress', function() {
  const dbs = useTestDatabases();

  /**
   * Run a clone whose submission counts answer straight away, so that the bar does not depend on how
   * quickly the test database answers a count running in the background.
   * @param {object} options - The clone options.
   * @param {Function} counted - Called with the real count of every submissions query.
   */
  async function cloneWithInstantCounts(options, counted = () => {}) {
    const cloner = createCloner(options);
    const countSource = cloner.countSource.bind(cloner);
    const totals = [];
    cloner.countSource = (collection, query, timeout) => {
      if (collection !== 'src.submissions') {
        return countSource(collection, query, timeout);
      }
      const total = totals.shift();
      countSource(collection, query, timeout).then(counted);
      return Promise.resolve(total);
    };
    // The totals of the forms, in the order they are cloned.
    cloner.submissionTotals = totals;
    return cloner;
  }

  it('Should show where every project and form is, and a bar for their submissions', async function() {
    await seedProject(dbs.src, {forms: 2, submissions: 3});
    const cloner = await cloneWithInstantCounts({interactive: false});
    cloner.submissionTotals.push(3, 3);
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }

    const output = capturedOutput();
    assert.match(output, /- Project Test Project: \[1\/1\]/);
    // Every level of the clone is indented three more spaces than the one it belongs to.
    assert.match(output, /\n- Project Test Project: \[1\/1\]/);
    assert.match(output, /\n {3}- Roles: 3/);
    assert.match(output, /\n {3}- Form: Test Form 1 \(\w+\) \[1\/2\]/);
    assert.match(output, /\n {3}- Form: Test Form 2 \(\w+\) \[2\/2\]/);
    assert.match(output, /\n {6}- Submissions: /);
    assert.match(output, /\n {6}- Actions: 1/);
    assert.match(output, /\n {3}- Tags: 1/);
    assert.match(output, /- Submissions: \[#{24}\] 100% 3\/3/);
    assert.match(output, /- Roles: 3/);
    assert.match(output, /- Actions: 1/);
    assert.match(output, /- Tags: 1/);
  });

  it('Should only count the submissions that are left to clone', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));
    await dbs.src.insert('submissions', Object.assign({}, seed.submissions[2], {
      _id: undefined,
      created: new Date(seed.submissions[2].created.getTime() + 60000)
    }));

    const counts = [];
    const cloner = await cloneWithInstantCounts({interactive: false}, (count) => counts.push(count));
    try {
      await quiet(() => cloner.clone());
      await cloner.counting;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    finally {
      cloner.destroy();
    }
    assert.deepEqual(counts, [1], 'Only the one submission that is not cloned yet is left.');
  });

  it('Should redraw the progress in place in a terminal', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});
    const cloner = await cloneWithInstantCounts({interactive: true});
    cloner.submissionTotals.push(3);
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }

    // eslint-disable-next-line no-control-regex
    assert.match(capturedOutput(), /\r {6}- Submissions: \[#{24}\] 100% 3\/3\x1b\[K/);
  });

  it('Should not hold the clone up while it counts', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});
    const cloner = createCloner({interactive: false});
    // A count that never answers.
    cloner.countSource = (collection, query, timeout) => (collection === 'src.submissions'
      ? new Promise(() => {})
      : Cloner.prototype.countSource.call(cloner, collection, query, timeout));
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }
    assert.equal(await dbs.dst.count('submissions'), 3);
    assert.match(capturedOutput(), /- Submissions: 3/);
  });

  it('Should count one collection at a time', async function() {
    const cloner = createCloner({interactive: false});
    const counted = [];
    try {
      await quiet(async() => {
        await cloner.startProgress('first', () => {
          counted.push('first');
          return new Promise(() => {});
        });
        await new Promise((resolve) => setImmediate(resolve));
        await cloner.startProgress('second', () => {
          counted.push('second');
          return Promise.resolve(1);
        });
      });
    }
    finally {
      cloner.destroy();
    }
    assert.deepEqual(counted, ['first'], 'A count still running means the next collection is not counted.');
  });

  it('Should say once why the totals are off', async function() {
    await seedProject(dbs.src, {forms: 3, submissions: 2});
    const countDocuments = Collection.prototype.countDocuments;
    const counted = [];
    Collection.prototype.countDocuments = function() {
      counted.push(this.collectionName);
      if (this.collectionName === 'submissions') {
        return Promise.reject(Object.assign(new Error('operation exceeded time limit'), {code: 50}));
      }
      return countDocuments.apply(this, arguments);
    };
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      await quiet(() => runClone({interactive: false}));
    }
    finally {
      Collection.prototype.countDocuments = countDocuments;
      console.error = consoleError;
    }

    assert.equal(counted.filter((name) => name === 'submissions').length, 1,
      'A count that timed out is not tried again for every other form.');
    const reasons = errors.filter((line) => /Progress totals are off/.test(line));
    assert.equal(reasons.length, 1);
    assert.match(reasons[0], /counting the submissions took longer than 60s/);
    assert.match(reasons[0], /\{form: 1, project: 1, created: 1\}/);
    assert.match(capturedOutput(), /- Submissions: 2/);
    assert.equal(await dbs.dst.count('submissions'), 6);
  });

  it('Should show no progress during a dry run', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});

    await quiet(() => runClone({dryRun: true, interactive: true}));

    assert.doesNotMatch(capturedOutput(), /- Submissions:|\r/);
  });
});
