/* globals describe, it */
'use strict';
const assert = require('assert');
const {execFileSync} = require('child_process');
const path = require('path');
const {ObjectId} = require('mongodb');
const {seedProject, at, project, submission} = require('./fixtures');
const {useTestDatabases, runClone, createCloner, quiet, SRC_URI, DST_URI} = require('./helper');

describe('Error handling', function() {
  const dbs = useTestDatabases();

  it('Should reject when no source is provided', async function() {
    await assert.rejects(
      () => quiet(() => runClone({}, '', DST_URI)),
      /Source should be provided/
    );
  });

  it('Should reject when the source and destination are the same', async function() {
    await assert.rejects(
      () => quiet(() => runClone({}, SRC_URI, SRC_URI)),
      /cannot be the same/
    );
  });

  it('Should reject when cloning from an API without a key', async function() {
    await assert.rejects(
      () => quiet(() => runClone({apiSource: true}, 'http://localhost:9/project', DST_URI)),
      /API Key/
    );
  });

  it('Should surface the real error for an invalid connection string', async function() {
    await assert.rejects(
      () => quiet(() => runClone({}, 'not-a-mongo-uri', DST_URI)),
      /Could not connect to database/
    );
  });

  it('Should not crash the process when the source cannot be reached', function() {
    // A failed connection used to leave an unhandled TypeError in the exit handler, which hid the
    // real error from the user.
    const script = `
      const Cloner = require(${JSON.stringify(path.resolve(__dirname, '../../src/Cloner'))});
      const cloner = new Cloner('not-a-mongo-uri', ${JSON.stringify(DST_URI)}, {});
      cloner.clone().catch((err) => {
        console.log('CLONE_ERROR: ' + err.message);
        process.exit(0);
      });
    `;
    const output = execFileSync(process.execPath, ['-e', script], {encoding: 'utf8', stdio: 'pipe'});
    assert.match(output, /CLONE_ERROR: Could not connect to database/);
    assert.doesNotMatch(output, /TypeError/, 'The exit handler must not throw.');
    assert.doesNotMatch(output, /Cannot read properties of null/);
  });

  it('Should reject when the destination project does not exist', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});

    await assert.rejects(
      () => quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: new ObjectId().toString()
      })),
      /Destination project not found/
    );
  });

  it('Should continue cloning when a single submission fails to write', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    // Pre-create one of the submissions in the destination with a different creation date, so the
    // date based filter does not skip it and the insert collides.
    await dbs.dst.insert('projects', project(Object.assign({}, seed.project)));
    await dbs.dst.insert('submissions', submission(Object.assign({}, seed.submissions[1], {
      created: at(1),
      modified: at(1),
      data: {firstName: 'Pre-existing'}
    })));

    await quiet(() => runClone({}));

    const submissions = await dbs.dst.all('submissions');
    assert.equal(submissions.length, 3, 'Every source submission should be present exactly once.');
    const ids = submissions.map((sub) => sub._id.toString()).sort();
    assert.deepEqual(ids, seed.submissions.map((sub) => sub._id.toString()).sort());
  });

  it('Should recover from a corrupt clone state file', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 2});
    require('fs').writeFileSync('clonestate.json', '{not valid json');

    await quiet(() => runClone({}));

    assert.equal(await dbs.dst.count('submissions'), 2);
  });

  it('Should report a clear error when the source project id is not a valid id', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

    await assert.rejects(
      () => quiet(() => runClone({
        srcProject: 'not-an-object-id',
        dstProject: destProject._id.toString()
      })),
      /valid|ObjectId|id/i
    );
  });

  describe('When the destination rejects the writes', function() {
    /**
     * Replace the destination submissions collection with one that rejects every document the
     * cloner will try to write.
     */
    async function rejectSubmissionWrites() {
      try {
        await dbs.dst.db.collection('submissions').drop();
      }
      catch (err) {
        // It may not exist yet.
      }
      await dbs.dst.db.createCollection('submissions', {
        validator: {$jsonSchema: {bsonType: 'object', required: ['mustHave']}}
      });
    }

    async function acceptSubmissionWrites() {
      await dbs.dst.db.command({collMod: 'submissions', validator: {}});
    }

    it('Should fail the clone instead of reporting success', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 3});
      await rejectSubmissionWrites();

      await assert.rejects(
        () => quiet(() => runClone({})),
        /could not be written/
      );

      assert.equal(await dbs.dst.count('submissions'), 0);
      await acceptSubmissionWrites();
    });

    it('Should not record progress for documents that were never written', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 3});
      await rejectSubmissionWrites();

      await assert.rejects(() => quiet(() => runClone({})));

      // The resume point must never move past a document that was lost: with nothing written,
      // there is no progress to record at all.
      const fs = require('fs');
      const state = fs.existsSync('clonestate.json')
        ? JSON.parse(fs.readFileSync('clonestate.json', 'utf8'))
        : {};
      const submissionProgress = Object.keys(state).filter((key) => key.startsWith('src.submissions'));
      assert.deepEqual(submissionProgress, [],
        'No submission progress should be recorded when every write failed.');
    });

    it('Should clone the lost documents when it is run again', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 3});
      await rejectSubmissionWrites();
      await assert.rejects(() => quiet(() => runClone({})));

      await acceptSubmissionWrites();
      await quiet(() => runClone({}));

      assert.equal(await dbs.dst.count('submissions'), 3,
        'Retrying should write every document that was lost.');
    });

    it('Should retry lost submissions that are older than the ones that were written', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      for (const [minutes, firstName] of [[1, 'Rejected'], [2, 'Accepted'], [3, 'Accepted']]) {
        await dbs.src.insert('submissions', submission({
          form: seed.forms[0]._id,
          project: seed.project._id,
          data: {firstName},
          created: at(minutes),
          modified: at(minutes)
        }));
      }
      // Only the oldest submission is rejected, so newer ones land in the destination.
      try {
        await dbs.dst.db.collection('submissions').drop();
      }
      catch (err) {
        // It may not exist yet.
      }
      await dbs.dst.db.createCollection('submissions', {
        validator: {'data.firstName': {$ne: 'Rejected'}}
      });

      await assert.rejects(() => quiet(() => runClone({batchSize: 1})), /could not be written/);
      assert.equal(await dbs.dst.count('submissions'), 2);

      await acceptSubmissionWrites();
      await quiet(() => runClone({batchSize: 1}));

      assert.equal(await dbs.dst.count('submissions'), 3,
        'The submission that was lost should be written when the clone is run again.');
    });

    it('Should still clone the collections that do write', async function() {
      await seedProject(dbs.src, {forms: 2, submissions: 1});
      await rejectSubmissionWrites();

      await assert.rejects(() => quiet(() => runClone({})));

      assert.equal(await dbs.dst.count('forms'), 2, 'Forms should still be cloned.');
      assert.equal(await dbs.dst.count('roles'), 3);
      await acceptSubmissionWrites();
    });
  });

  it('Should expose a destroy method that removes the exit handler', async function() {
    const before = process.listenerCount('exit');
    const cloner = createCloner({});
    assert.equal(process.listenerCount('exit'), before + 1);
    cloner.destroy();
    assert.equal(process.listenerCount('exit'), before,
      'destroy() should remove the listener the constructor added.');
  });
});
