/* globals describe, it */
'use strict';
const assert = require('assert');
const {seedProject, at} = require('./fixtures');
const {useTestDatabases, createCloner, runClone, quiet, dryRunLines} = require('./helper');

describe('A source that changes while it is read', function() {
  const dbs = useTestDatabases();

  it('Should never write a document it could not read in full', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));
    // Every submission changed, so every one of them has to be read in full.
    await dbs.src.collection('submissions').updateMany({}, {$set: {modified: at(900)}});

    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    const cloner = createCloner({updateExistingSubmissions: true});

    // Delete one submission from the source in between reading the timestamps and reading the data,
    // which is what a live source does on its own.
    const sourceReader = cloner.sourceReader.bind(cloner);
    let removed = null;
    cloner.sourceReader = (collection, chunk) => {
      const reader = sourceReader(collection, chunk);
      return async(projected) => {
        if (!removed && collection === 'src.submissions') {
          removed = projected._id;
          await dbs.src.collection('submissions').deleteOne({_id: removed});
        }
        return reader(projected);
      };
    };
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      console.error = consoleError;
      cloner.destroy();
    }

    const written = await dbs.dst.findOne('submissions', {_id: removed});
    assert.ok(written, 'The record the first clone wrote should still be there.');
    assert.ok(written.data && written.data.firstName,
      'It must not be replaced by a document holding only its timestamps.');
    assert.equal(cloner.vanished, 1, 'The skipped record should be counted.');
    assert.ok(errors.some((line) => /no longer in the source/.test(line)),
      'The operator should be told the record disappeared.');
  });

  it('Should keep the other records of the batch when one disappears', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 4});
    await quiet(() => runClone({}));
    await dbs.src.collection('submissions').updateMany({},
      {$set: {'data.firstName': 'Changed', modified: at(900)}});

    const cloner = createCloner({updateExistingSubmissions: true});
    const sourceReader = cloner.sourceReader.bind(cloner);
    let removed = false;
    cloner.sourceReader = (collection, chunk) => {
      const reader = sourceReader(collection, chunk);
      return async(projected) => {
        if (!removed && collection === 'src.submissions') {
          removed = true;
          await dbs.src.collection('submissions').deleteOne({_id: seed.submissions[0]._id});
        }
        return reader(projected);
      };
    };
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }

    for (const sub of seed.submissions.slice(1)) {
      const cloned = await dbs.dst.findOne('submissions', {_id: sub._id});
      assert.equal(cloned.data.firstName, 'Changed',
        'The rest of the batch should be cloned normally.');
    }
  });

  it('Should save the resume point when the clone is aborted', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 4});
    const cloner = createCloner({batchSize: 2});

    // Fail part way through, the way a dropped connection would.
    let seen = 0;
    const writeItem = cloner.writeItem.bind(cloner);
    cloner.writeItem = async(collection, srcItem, updatedItem, destItem) => {
      if (collection === 'submissions' && ++seen > 4) {
        const error = new Error('the source went away');
        error.fatal = true;
        throw error;
      }
      return writeItem(collection, srcItem, updatedItem, destItem);
    };

    await assert.rejects(() => quiet(() => cloner.clone()), /went away/);

    const fs = require('fs');
    assert.equal(fs.existsSync('clonestate.json'), true,
      'An aborted clone must leave its resume point behind.');
    const state = JSON.parse(fs.readFileSync('clonestate.json', 'utf8'));
    assert.ok(Object.keys(state).some((key) => key.startsWith('src.')),
      `The state should name what it was walking, got ${JSON.stringify(state)}`);
    assert.equal(seed.forms.length, 2);
  });

  it('Should keep the dry run report of an aborted run', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 3});
    const cloner = createCloner({dryRun: true, extra: true});

    let seen = 0;
    const dryRunLog = cloner.dryRunLog.bind(cloner);
    cloner.dryRunLog = (operation, id, context) => {
      dryRunLog(operation, id, context);
      if (++seen === 4) {
        const error = new Error('interrupted');
        error.fatal = true;
        throw error;
      }
    };

    await assert.rejects(() => quiet(() => cloner.clone()), /interrupted/);

    const lines = dryRunLines() || [];
    assert.ok(lines.length >= 4,
      `What was found before the failure should be on disk, got ${lines.length} lines.`);
    assert.equal(seed.submissions.length, 6);
  });
});
