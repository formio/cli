/* globals describe, it, before, after, beforeEach */
'use strict';
const assert = require('assert');
const mongodb = require('mongodb');
const {seedProject, at, submission} = require('./fixtures');
const {useTestDatabases, runClone, quiet} = require('./helper');

/**
 * Record every find/findOne the driver performs, so that the tests can assert on what the cloner
 * actually asks the server for.
 */
function recordQueries() {
  const calls = [];
  const originalFind = mongodb.Collection.prototype.find;
  const originalFindOne = mongodb.Collection.prototype.findOne;

  mongodb.Collection.prototype.find = function(filter, options, ...rest) {
    const cursor = originalFind.call(this, filter, options, ...rest);
    const call = {
      type: 'find',
      collection: this.collectionName,
      db: this.dbName,
      filter,
      projection: (options && options.projection) || null
    };
    calls.push(call);
    const originalProject = cursor.project.bind(cursor);
    cursor.project = (projection) => {
      call.projection = projection;
      return originalProject(projection);
    };
    return cursor;
  };

  mongodb.Collection.prototype.findOne = function(filter, options, ...rest) {
    calls.push({
      type: 'findOne',
      collection: this.collectionName,
      db: this.dbName,
      filter,
      projection: (options && options.projection) || null
    });
    return originalFindOne.call(this, filter, options, ...rest);
  };

  return {
    calls,
    restore() {
      mongodb.Collection.prototype.find = originalFind;
      mongodb.Collection.prototype.findOne = originalFindOne;
    }
  };
}

/**
 * A payload big enough to make a full document fetch obvious.
 */
function bigImage(size = 200000) {
  return `data:image/png;base64,${'A'.repeat(size)}`;
}

describe('Destination lookups', function() {
  const dbs = useTestDatabases();
  let recorder = null;

  before(function() {
    recorder = recordQueries();
  });

  after(function() {
    recorder.restore();
  });

  beforeEach(function() {
    recorder.calls.length = 0;
  });

  /**
   * The lookups the cloner made against the destination submissions.
   */
  function destinationSubmissionLookups() {
    return recorder.calls.filter((call) =>
      call.collection.includes('submission') && call.db.endsWith('-dst'));
  }

  /**
   * The reads the cloner made against the source submissions.
   */
  function sourceSubmissionReads() {
    return recorder.calls.filter((call) =>
      call.collection === 'submissions' && call.db.endsWith('-src'));
  }

  it('Should only fetch the timestamps when checking for an existing submission', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
    await quiet(() => runClone({}));
    recorder.calls.length = 0;

    await dbs.src.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$set: {modified: at(900)}}
    );
    await quiet(() => runClone({updateExistingSubmissions: true}));

    const lookups = destinationSubmissionLookups();
    assert.ok(lookups.length > 0, 'The cloner should look the submissions up in the destination.');
    for (const lookup of lookups) {
      assert.deepEqual(lookup.projection, {_id: 1, created: 1, modified: 1},
        `A ${lookup.type} on ${lookup.collection} fetched whole documents.`);
    }
  });

  it('Should only fetch the timestamps when finding the last cloned submission', async function() {
    await seedProject(dbs.src, {forms: 2, submissions: 2});
    await quiet(() => runClone({}));
    recorder.calls.length = 0;

    await quiet(() => runClone({}));

    const lookups = destinationSubmissionLookups();
    assert.ok(lookups.length > 0);
    for (const lookup of lookups) {
      assert.deepEqual(lookup.projection, {_id: 1, created: 1, modified: 1});
    }
  });

  it('Should fetch whole documents for projects and forms, which are merged into the update', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});
    await quiet(() => runClone({}));
    recorder.calls.length = 0;

    await quiet(() => runClone({}));

    const formLookups = recorder.calls.filter((call) => call.collection === 'forms' && call.db.endsWith('-dst'));
    assert.ok(formLookups.length > 0);
    assert.ok(formLookups.every((call) => call.projection === null),
      'Forms are merged into the destination document, so they are fetched whole.');
  });

  it('Should clone submissions holding large base64 data', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    await dbs.src.insert('submissions', submission({
      form: seed.forms[0]._id,
      project: seed.project._id,
      data: {firstName: 'Big', signature: bigImage()},
      created: at(100),
      modified: at(100)
    }));

    await quiet(() => runClone({}));

    const cloned = (await dbs.dst.all('submissions'))[0];
    assert.equal(cloned.data.signature.length, bigImage().length,
      'The data must be cloned in full.');
  });

  it('Should update a changed submission without re-reading its data', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    const sub = await dbs.src.insert('submissions', submission({
      form: seed.forms[0]._id,
      project: seed.project._id,
      data: {firstName: 'Before', signature: bigImage()},
      created: at(100),
      modified: at(100)
    }));
    await quiet(() => runClone({}));

    await dbs.src.collection('submissions').updateOne(
      {_id: sub._id},
      {$set: {data: {firstName: 'After', signature: bigImage()}, modified: at(900)}}
    );

    await quiet(() => runClone({updateExistingSubmissions: true}));

    const cloned = (await dbs.dst.all('submissions'))[0];
    assert.equal(cloned.data.firstName, 'After');
    assert.equal(cloned.data.signature.length, bigImage().length);
  });

  it('Should keep destination only fields that the source does not have', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await quiet(() => runClone({}));
    await dbs.dst.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$set: {externalId: 'kept-by-the-destination'}}
    );

    await dbs.src.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$set: {data: {firstName: 'Changed'}, modified: at(900)}}
    );
    await quiet(() => runClone({updateExistingSubmissions: true}));

    const cloned = await dbs.dst.findOne('submissions', {_id: seed.submissions[0]._id});
    assert.equal(cloned.data.firstName, 'Changed');
    assert.equal(cloned.externalId, 'kept-by-the-destination',
      'Fields that only exist in the destination must not be removed.');
  });

  it('Should not wipe the destination roles when the source submission has none', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await quiet(() => runClone({}));
    const destRoles = (await dbs.dst.all('submissions'))[0].roles;
    assert.equal(destRoles.length, 1);

    // An old submission that predates the roles field, changed in the source.
    await dbs.src.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$unset: {roles: ''}, $set: {modified: at(900)}}
    );

    await quiet(() => runClone({updateExistingSubmissions: true}));

    const cloned = await dbs.dst.findOne('submissions', {_id: seed.submissions[0]._id});
    assert.equal(cloned.roles.length, 1, 'The destination roles should be left alone.');
    assert.equal(cloned.roles[0].toString(), destRoles[0].toString());
  });

  describe('Reading the source', function() {
    /**
     * Seed submissions carrying a payload, clone them, then change some of them.
     * @param {number} total - How many submissions to seed.
     * @param {number} changed - How many of them to change afterwards.
     */
    async function seedAndChange(total, changed) {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      const payload = bigImage(20000);
      for (let i = 0; i < total; i++) {
        await dbs.src.insert('submissions', submission({
          form: seed.forms[0]._id,
          project: seed.project._id,
          data: {firstName: `U${i}`, signature: payload},
          created: at(100 + i),
          modified: at(100 + i)
        }));
      }
      await quiet(() => runClone({}));
      const toChange = (await dbs.src.all('submissions')).slice(0, changed);
      for (const sub of toChange) {
        await dbs.src.collection('submissions').updateOne({_id: sub._id},
          {$set: {'data.firstName': 'CHANGED', modified: at(900)}});
      }
      return {seed, changed: toChange};
    }

    it('Should scan the source with only the timestamps', async function() {
      await seedAndChange(6, 0);
      recorder.calls.length = 0;

      await quiet(() => runClone({updateExistingSubmissions: true}));

      const scans = sourceSubmissionReads().filter((call) => !call.filter || !call.filter._id);
      assert.ok(scans.length > 0, 'The source should be scanned.');
      for (const scan of scans) {
        assert.deepEqual(scan.projection, {_id: 1, created: 1, modified: 1},
          'The scan of the source must not pull the submission data across.');
      }
    });

    it('Should read the data of only the submissions that changed', async function() {
      await seedAndChange(6, 2);
      recorder.calls.length = 0;

      await quiet(() => runClone({updateExistingSubmissions: true}));

      const fullReads = sourceSubmissionReads().filter((call) =>
        call.filter && call.filter._id && call.projection === null);
      assert.ok(fullReads.length > 0, 'The changed submissions have to be read in full.');
      const requested = fullReads.reduce((total, call) => total + call.filter._id.$in.length, 0);
      assert.equal(requested, 2,
        `Expected the data of 2 submissions to be read, got ${requested}.`);
    });

    it('Should read nothing at all when nothing changed', async function() {
      await seedAndChange(6, 0);
      recorder.calls.length = 0;

      await quiet(() => runClone({updateExistingSubmissions: true}));

      const fullReads = sourceSubmissionReads().filter((call) =>
        call.filter && call.filter._id && call.projection === null);
      assert.deepEqual(fullReads, [],
        'No submission data should be read when every submission is up to date.');
    });

    it('Should update the changed submissions completely', async function() {
      const {changed} = await seedAndChange(6, 2);

      await quiet(() => runClone({updateExistingSubmissions: true}));

      for (const sub of changed) {
        const cloned = await dbs.dst.findOne('submissions', {_id: sub._id});
        assert.equal(cloned.data.firstName, 'CHANGED');
        assert.equal(cloned.data.signature.length, bigImage(20000).length,
          'The whole document must be written, not the timestamps it was matched on.');
      }
      const untouched = await dbs.dst.findOne('submissions', {_id: (await dbs.src.all('submissions'))[5]._id});
      assert.equal(untouched.data.firstName, 'U5');
      assert.equal(untouched.data.signature.length, bigImage(20000).length);
    });

    it('Should read no submission data at all during a dry run', async function() {
      await seedAndChange(6, 3);
      recorder.calls.length = 0;

      await quiet(() => runClone({dryRun: true}));

      const fullReads = sourceSubmissionReads().filter((call) => call.projection === null);
      assert.deepEqual(fullReads, [],
        'A dry run only reports what it found, so it never needs the data.');
      const scans = sourceSubmissionReads().filter((call) => call.projection);
      assert.ok(scans.length > 0, 'It still has to scan the timestamps.');
    });

    it('Should still clone submission revisions of submissions that did not change', async function() {
      const {seed} = await seedAndChange(3, 0);
      for (const sub of await dbs.src.all('submissions')) {
        await dbs.src.insert('submissionrevisions', {
          _id: new (require('mongodb').ObjectId)(),
          _rid: sub._id,
          form: seed.forms[0]._id,
          project: seed.project._id,
          data: sub.data,
          deleted: null,
          created: at(100),
          modified: at(100)
        });
      }

      await quiet(() => runClone({updateExistingSubmissions: true, includeSubmissionRevisions: true}));

      assert.equal(await dbs.dst.count('submissionrevisions'), 3,
        'The revisions hang off every submission, not only the ones that changed.');
    });
  });

  it('Should only fetch the timestamps for submission revisions', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await dbs.src.insert('submissionrevisions', {
      _id: seed.submissions[0]._id,
      _rid: seed.submissions[0]._id,
      form: seed.forms[0]._id,
      project: seed.project._id,
      data: {signature: bigImage(1000)},
      deleted: null,
      created: at(100),
      modified: at(100)
    });
    await quiet(() => runClone({includeSubmissionRevisions: true}));
    recorder.calls.length = 0;

    await quiet(() => runClone({includeSubmissionRevisions: true, updateExistingSubmissions: true}));

    const lookups = recorder.calls.filter((call) =>
      call.collection === 'submissionrevisions' && call.db.endsWith('-dst'));
    assert.ok(lookups.length > 0);
    for (const lookup of lookups) {
      assert.deepEqual(lookup.projection, {_id: 1, created: 1, modified: 1});
    }
  });
});
