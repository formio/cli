/* globals describe, it */
'use strict';
const assert = require('assert');
const {seedProject, at, submission} = require('./fixtures');
const {useTestDatabases, createCloner, runClone, quiet} = require('./helper');

describe('Memory bounds', function() {
  const dbs = useTestDatabases();

  /**
   * Clone while watching what the cloner holds on to.
   */
  async function cloneWatching(options) {
    const cloner = createCloner(options);
    const peak = {chunk: 0, chunkBytes: 0, cached: 0, queued: 0, queuedBytes: 0, state: 0};
    const readChunk = cloner.readChunk.bind(cloner);
    cloner.readChunk = async(cursor, needsLookup) => {
      const chunk = await readChunk(cursor, needsLookup);
      peak.chunk = Math.max(peak.chunk, chunk.length);
      peak.chunkBytes = Math.max(peak.chunkBytes,
        chunk.reduce((total, doc) => total + cloner.documentSize(doc), 0));
      return chunk;
    };
    const queueWrite = cloner.queueWrite.bind(cloner);
    cloner.queueWrite = async(collection, operation, bytes) => {
      await queueWrite(collection, operation, bytes);
      peak.queued = Math.max(peak.queued, cloner.pendingWrites);
      peak.queuedBytes = Math.max(peak.queuedBytes, cloner.pendingBytes);
      let cached = 0;
      cloner.destCaches.forEach((cache) => {
        cached += cache.size;
      });
      peak.cached = Math.max(peak.cached, cached);
      peak.state = Math.max(peak.state, Object.keys(cloner.cloneState).length);
    };
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }
    return peak;
  }

  it('Should never hold more than the batch size in memory', async function() {
    await seedProject(dbs.src, {forms: 3, submissions: 40});

    const peak = await cloneWatching({batchSize: 10});

    assert.ok(peak.chunk <= 10, `Read ${peak.chunk} documents at once, expected at most 10.`);
    assert.ok(peak.queued <= 10, `Queued ${peak.queued} writes, expected at most 10.`);
    assert.ok(peak.cached <= 10, `Cached ${peak.cached} documents, expected at most 10.`);
  });

  it('Should cap the batch by bytes, not only by document count', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    const blob = 'A'.repeat(100 * 1024);
    for (let i = 0; i < 40; i++) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: `U${i}`, blob},
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }

    // A generous document count, but a small byte budget: the bytes must win, both for what is read
    // and for what is queued to be written.
    const peak = await cloneWatching({
      batchSize: 1000,
      maxBatchBytes: 512 * 1024,
      updateExistingSubmissions: true
    });

    assert.ok(peak.queuedBytes <= 1024 * 1024,
      `Held ${(peak.queuedBytes / 1024).toFixed(0)}KB of writes, expected the byte cap to flush sooner.`);
    assert.ok(peak.queued < 40, `Queued ${peak.queued} writes, expected the byte cap to flush first.`);
    assert.ok(peak.chunkBytes <= 1024 * 1024,
      `Read ${(peak.chunkBytes / 1024).toFixed(0)}KB of documents at once, expected the byte cap to stop sooner.`);
  });

  it('Should not grow what it holds as the database grows', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    for (let i = 0; i < 20; i++) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }
    const small = await cloneWatching({batchSize: 25, updateExistingSubmissions: true});

    await dbs.dst.reset();
    for (let i = 20; i < 200; i++) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }
    const large = await cloneWatching({batchSize: 25, updateExistingSubmissions: true});

    assert.equal(large.chunk <= 25, true, `Read ${large.chunk} documents at once with 10x the data.`);
    assert.equal(large.cached <= 25, true, `Cached ${large.cached} documents with 10x the data.`);
    assert.ok(large.chunk <= Math.max(small.chunk, 25),
      'What is held in memory must not grow with the size of the database.');
  });

  it('Should size the reads of changed documents by their bytes', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    const blob = 'A'.repeat(100 * 1024);
    for (let i = 0; i < 20; i++) {
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: `U${i}`, blob},
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }
    await quiet(() => runClone({}));
    // Every submission changed, so every one of them has to be read in full.
    await dbs.src.collection('submissions').updateMany({}, {$set: {modified: at(900)}});

    const fetches = [];
    const cloner = createCloner({updateExistingSubmissions: true, maxBatchBytes: 256 * 1024});
    const sourceReader = cloner.sourceReader.bind(cloner);
    cloner.sourceReader = (collection, chunk) => {
      const reader = sourceReader(collection, chunk);
      return async(projected) => {
        const before = cloner.fullFetchSize;
        const doc = await reader(projected);
        if (cloner.fullFetchSize !== before) {
          fetches.push(cloner.fullFetchSize);
        }
        return doc;
      };
    };
    try {
      await quiet(() => cloner.clone());
    }
    finally {
      cloner.destroy();
    }

    assert.ok(fetches.length > 0, 'The changed documents should have been read in groups.');
    for (const size of fetches) {
      assert.ok(size <= 4,
        `A group of ${size} documents of 100KB does not fit in a 256KB budget.`);
    }
    assert.equal(await dbs.dst.count('submissions'), 20);
  });

  it('Should keep only the resume points of what is being walked', async function() {
    await seedProject(dbs.src, {forms: 25, submissions: 4});

    const peak = await cloneWatching({batchSize: 10});

    assert.ok(peak.state <= 5,
      `Kept ${peak.state} resume points at once, expected a handful regardless of the form count.`);
  });
});
