/* globals describe, it */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {execFileSync} = require('child_process');
const {ObjectId} = require('mongodb');
const {seedProject, at, submission} = require('./fixtures');
const {useTestDatabases, runClone, quiet, cloneStateExists, writeCloneState, SRC_URI, DST_URI} = require('./helper');

describe('Clone state', function() {
  const dbs = useTestDatabases();

  it('Should not leave a clone state file behind after a successful clone', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 2});

    await quiet(() => runClone({}));

    assert.equal(cloneStateExists(), false,
      'clonestate.json should be removed once the clone completes.');
  });

  it('Should resume from a clone state written by a previous run', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    for (const minutes of [100, 101, 102]) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: `Sub ${minutes}`},
        created: at(minutes),
        modified: at(minutes)
      }));
    }
    writeCloneState({[`src.submissions:${seed.forms[0]._id}`]: at(101).toISOString()});

    await quiet(() => runClone({}));

    const names = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
    assert.deepEqual(names, ['Sub 102'], 'Only documents after the saved state should be cloned.');
  });

  it('Should not skip documents that share the creation date of the last cloned document', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    // Two submissions created in the very same millisecond.
    const ids = [new ObjectId('000000000000000000000001'), new ObjectId('000000000000000000000002')];
    for (const id of ids) {
      await dbs.src.insert('submissions', submission({
        _id: id,
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: `Sub ${id.toString().slice(-1)}`},
        created: at(100),
        modified: at(100)
      }));
    }
    // The previous run stopped right after the first of the two.
    writeCloneState({
      [`src.submissions:${seed.forms[0]._id}`]: {created: at(100).toISOString(), _id: ids[0].toString()}
    });

    await quiet(() => runClone({}));

    const names = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
    assert.deepEqual(names, ['Sub 2'],
      'The second document of the same millisecond must still be cloned.');
  });

  it('Should resume an interrupted clone without losing or duplicating submissions', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    for (let i = 0; i < 20; i++) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: `Sub ${i}`},
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }

    // Interrupt the clone part way through, the way a killed process would.
    const script = `
      const Cloner = require(${JSON.stringify(path.resolve(__dirname, '../../src/Cloner'))});
      process.stdout.write = () => true;
      const cloner = new Cloner(${JSON.stringify(SRC_URI)}, ${JSON.stringify(DST_URI)}, {batchSize: 2});
      let seen = 0;
      cloner.clone(null, async (collection, src, update, dest) => {
        if (collection === 'submissions' && ++seen >= 5) {
          process.exit(0);
        }
      }).catch(() => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', script], {cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe'});

    assert.equal(cloneStateExists(), true, 'An interrupted clone should leave its state behind.');
    const partial = await dbs.dst.count('submissions');
    assert.ok(partial > 0 && partial < 20, `Expected a partial clone, got ${partial}.`);

    await quiet(() => runClone({}));

    const submissions = await dbs.dst.all('submissions');
    assert.equal(submissions.length, 20, 'Every submission should be cloned exactly once.');
    const names = submissions.map((sub) => sub.data.firstName).sort();
    assert.equal(new Set(names).size, 20, 'There should be no duplicates.');
    assert.equal(cloneStateExists(), false);
  });

  it('Should ignore a resume point that does not belong to anything being cloned', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
    // A state file from an older version, or naming a form that no longer exists, must never cause
    // documents to be skipped.
    writeCloneState({
      'src.submissions': at(500).toISOString(),
      [`src.submissions:${new ObjectId()}`]: at(500).toISOString()
    });

    await quiet(() => runClone({}));

    assert.equal(await dbs.dst.count('submissions'), 4,
      'Every submission should still be cloned.');
    assert.equal(seed.forms.length, 2);
  });

  it('Should keep one resume point per form', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
    // Only the submissions of the second form have already been cloned.
    writeCloneState({[`src.submissions:${seed.forms[1]._id}`]: at(500).toISOString()});

    await quiet(() => runClone({}));

    const forms = {};
    for (const sub of await dbs.dst.all('submissions')) {
      forms[sub.form.toString()] = (forms[sub.form.toString()] || 0) + 1;
    }
    assert.equal(forms[seed.forms[0]._id.toString()], 2,
      'The first form should not be affected by the resume point of the second.');
    assert.equal(forms[seed.forms[1]._id.toString()], undefined,
      'The second form should resume past its submissions.');
  });

  it('Should not write a clone state file when the clone succeeds', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});

    const script = `
      const Cloner = require(${JSON.stringify(path.resolve(__dirname, '../../src/Cloner'))});
      process.stdout.write = () => true;
      console.log = () => {};
      const cloner = new Cloner(${JSON.stringify(SRC_URI)}, ${JSON.stringify(DST_URI)}, {});
      cloner.clone().then(() => process.exit(0)).catch(() => process.exit(1));
    `;
    execFileSync(process.execPath, ['-e', script], {cwd: process.cwd(), encoding: 'utf8', stdio: 'pipe'});

    assert.equal(fs.existsSync(path.join(process.cwd(), 'clonestate.json')), false,
      'The exit handler must not recreate the state file after a successful clone.');
  });
});
