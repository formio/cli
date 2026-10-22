/* globals describe, it */
'use strict';
const assert = require('assert');
const path = require('path');
const {execFileSync} = require('child_process');
const {seedProject, at, submission} = require('./fixtures');
const {useTestDatabases, runClone, quiet, cloneStateExists, SRC_URI, DST_URI} = require('./helper');

describe('Resuming across forms', function() {
  const dbs = useTestDatabases();

  /**
   * Seed forms whose submissions are interleaved in time: the later forms hold the older
   * submissions. A resume point that is not scoped to a single form would skip them.
   */
  async function seedInterleaved() {
    const seed = await seedProject(dbs.src, {forms: 3, submissions: 0});
    const created = [
      [300, 301, 302, 303, 304, 305], // first form: newest submissions
      [200, 201, 202, 203, 204, 205],
      [100, 101, 102, 103, 104, 105]  // last form: oldest submissions
    ];
    for (let f = 0; f < seed.forms.length; f++) {
      for (const minutes of created[f]) {
        await dbs.src.insert('submissions', submission({
          form: seed.forms[f]._id,
          project: seed.project._id,
          data: {firstName: `form${f + 1}-${minutes}`},
          created: at(minutes),
          modified: at(minutes)
        }));
      }
    }
    return seed;
  }

  it('Should not skip the submissions of later forms after an interrupted clone', async function() {
    await seedInterleaved();

    // Interrupt the clone part way through the second form.
    const script = `
      const Cloner = require(${JSON.stringify(path.resolve(__dirname, '../../src/Cloner'))});
      process.stdout.write = () => true;
      console.log = () => {};
      const cloner = new Cloner(${JSON.stringify(SRC_URI)}, ${JSON.stringify(DST_URI)}, {batchSize: 2});
      let seen = 0;
      cloner.clone(null, async (collection) => {
        if (collection === 'submissions' && ++seen >= 9) {
          process.exit(0);
        }
      }).catch(() => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', script], {cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe'});

    assert.equal(cloneStateExists(), true, 'The interrupted clone should have saved its state.');
    const partial = await dbs.dst.count('submissions');
    assert.ok(partial > 0 && partial < 18, `Expected a partial clone, got ${partial}.`);

    await quiet(() => runClone({}));

    const cloned = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName).sort();
    assert.equal(cloned.length, 18, `Every submission should be cloned, got ${cloned.length}.`);
    assert.equal(new Set(cloned).size, 18, 'There should be no duplicates.');
  });

  it('Should scope the saved resume point to a single form', async function() {
    const seed = await seedInterleaved();

    const script = `
      const Cloner = require(${JSON.stringify(path.resolve(__dirname, '../../src/Cloner'))});
      process.stdout.write = () => true;
      console.log = () => {};
      const cloner = new Cloner(${JSON.stringify(SRC_URI)}, ${JSON.stringify(DST_URI)}, {batchSize: 2});
      let seen = 0;
      cloner.clone(null, async (collection) => {
        if (collection === 'submissions' && ++seen >= 9) {
          process.exit(0);
        }
      }).catch(() => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', script], {cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe'});

    const state = JSON.parse(require('fs').readFileSync(path.join(process.cwd(), 'clonestate.json'), 'utf8'));
    const submissionKeys = Object.keys(state).filter((key) => key.startsWith('src.submissions'));
    assert.ok(submissionKeys.length > 0, 'The submission progress should be saved.');
    for (const key of submissionKeys) {
      assert.notEqual(key, 'src.submissions',
        'The resume point must be scoped to a form, not to the whole collection.');
      const formId = key.split(':')[1];
      assert.ok(seed.forms.some((frm) => frm._id.toString() === formId),
        `The resume point should name a form, got "${key}".`);
    }
  });

  it('Should resume the actions of a form without skipping other forms', async function() {
    const seed = await seedProject(dbs.src, {forms: 3, submissions: 1});
    await quiet(() => runClone({}));
    assert.equal(await dbs.dst.count('actions'), 3);

    // A stale resume point for one form must not hide the actions of the others.
    await dbs.dst.collection('actions').deleteMany({});
    await quiet(() => runClone({}));

    assert.equal(await dbs.dst.count('actions'), 3, 'Every action should be cloned again.');
    assert.equal(seed.forms.length, 3);
  });
});
