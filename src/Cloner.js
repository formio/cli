'use strict';
/* eslint-disable max-depth */
const {MongoClient, ObjectId, BSON} = require('mongodb');
const fs = require('fs');
const _ = require('lodash');
const encryption = require('./encryption');
const {redact, tlsOptions, submissionCollectionName} = require('./db');
const {createHmac} = require('node:crypto');
const fetch = require('./fetch');
const Progress = require('./Progress');

// The destination documents of these collections are only used to compare the created and modified
// timestamps against the source, so only those fields are fetched. Submission data can hold large
// payloads (base64 encoded files and images) that would otherwise be streamed to the CLI for every
// single document only to be thrown away.
const TIMESTAMP_ONLY_COLLECTIONS = ['submissions', 'submissionrevisions'];
const TIMESTAMP_FIELDS = {_id: 1, created: 1, modified: 1};

// How many bytes of documents are held in memory before they are written out. Submissions can carry
// multi megabyte payloads, so the batches are capped by size as well as by count.
const MAX_BATCH_BYTES = 8 * 1024 * 1024;

// Everything else hangs off of these, so they are written as soon as they are cloned: the roles,
// forms and submissions of a project (or the submissions of a form) must never be cloned for a
// parent that did not make it into the destination.
const PARENT_COLLECTIONS = ['projects', 'forms'];

// The same programming error (a broken callback) on this many documents in a row stops the clone,
// rather than being reported once for every document of the project.
const MAX_REPEATED_ERRORS = 5;

// How long, at most, the counts behind the progress may take. The position of a project or form is
// counted before it is cloned, so that count is kept short. The documents a progress bar is measured
// against are counted in the background while the clone carries on, so that count can take longer.
const POSITION_COUNT_TIMEOUT = 2000;
const BAR_COUNT_TIMEOUT = 60000;

/**
 * Split a comma separated list of ids, ignoring the spaces around them.
 * @param {string} value - The comma separated list.
 */
function idList(value) {
  return String(value || '').split(',').map((id) => id.trim()).filter((id) => id);
}

class Cloner {
  /**
   * @param {*} srcPath - The source connection string.
   * @param {*} mongoDest - The destination mongo connection string.
   * @param {*} options - The options for the cloner.
   * @param {*} options.srcCa - The source CA file.
   * @param {*} options.srcCert - The source certificate file.
   * @param {*} options.srcDbSecret - The source database secret.
   * @param {*} options.dstCa - The destination CA file.
   * @param {*} options.dstCert - The destination certificate file.
   * @param {*} options.dstDbSecret - The destination database secret.
   * @param {*} options.all - Clone all data including deleted data.
   * @param {*} options.project - The source project to clone.
   * @param {*} options.srcProject - Alias for options.project.
   * @param {*} options.dstProject - The destination project to clone to.
   * @param {*} options.deletedAfter - Clone only data deleted after a certain date.
   * @param {*} options.createdAfter - Clone only data created after a certain date.
   * @param {*} options.modifiedAfter - Clone only data modified after a certain date.
   * @param {*} options.deleteSubmissions - Delete the submissions of a form before cloning it.
   * @param {*} options.includeFormRevisions - Include form revisions when cloning forms.
   * @param {*} options.includeSubmissionRevisions - Include submission revisions when cloning submissions.
   * @param {*} options.updateExistingSubmissions - Update existing submissions when found in the destination (performs a complete re-clone).
   * @param {*} options.forms - A comma-separated value of all the Form ID's you wish to clone. If included, then only the provided forms will be cloned.
   * @param {*} options.exclude - A comma-separated value of all the Form ID's you wish to exclude from cloning.
   * @param {*} options.submissionsOnly - Only clone submissions.
   * @param {*} options.apiSource - Flag to define if we need to clone from an API.
   * @param {*} options.key - API Key to be used to authenticate in source.
   * @param {*} options.limit - Parameter passed to the URL query when fetching from the API, limits the amount of records returned at once.
   * @param {*} options.dryRun - Change nothing. Compare the source against the destination and report what is missing or out of date.
   * @param {*} options.extra - With a dry run, report each affected submission rather than only the counts.
   * @param {*} options.updateExisting - Update the projects and forms that already exist in the destination (defaults to true).
   * @param {*} options.batchSize - The number of documents written to the destination at a time (defaults to 1000).
   */
  constructor(srcPath, mongoDest = '', options = {}) {
    this.srcPath = srcPath;
    this.mongoDest = mongoDest;
    this.beforeAll = null;
    this.afterAll = null;
    this.defaultSaltLength = 40;
    this.options = options;
    this.src = null;
    this.dest = null;
    this.cloneState = {};
    this.exclude = idList(this.options.exclude);
    // Existing projects and forms are updated unless they explicitly ask us not to.
    this.updateExisting = this.options.updateExisting !== false;

    // Writes are batched per destination collection instead of being sent one document at a time.
    this.writeBuffer = {};
    this.writeBufferSize = Math.max(parseInt(this.options.batchSize, 10) || 1000, 1);
    this.maxBatchBytes = Math.max(parseInt(this.options.maxBatchBytes, 10) || MAX_BATCH_BYTES, 1024);

    // Destination documents fetched ahead of time, one cache per collection so that a nested
    // iteration (the revisions of a submission) does not throw away the cache of its parent.
    this.destCaches = new Map();

    // Documents that could not be written. A clone that failed to write must not report success,
    // and must not advance the resume point past the documents it lost.
    this.writeFailures = 0;
    this.writeFailed = false;

    // Documents that could not be cloned because cloning them threw.
    this.documentFailures = 0;
    this.repeatedError = null;

    // The projects whose encrypted settings could not be read, and the ones left out because of it.
    this.undecryptable = new Set();
    this.skippedProjects = new Set();

    // The progress of the current run. It is only committed to the clone state once the pending
    // writes have actually been flushed, so that an interrupted clone never skips a document that
    // was queued but never written.
    this.pendingState = {};

    // Nested iterations that have finished, but whose writes are only flushed with their parent's.
    this.completedState = new Set();

    // The progress line being drawn, if any. In a terminal it is redrawn in place, so anything else
    // written while it is shown has to end it first.
    this.activeProgress = null;
    this.interactive = (typeof this.options.interactive === 'boolean')
      ? this.options.interactive
      : !!process.stdout.isTTY;

    this.initDryRun();
    this.initApiSource();
    this.loadCloneState();
    this.listen();
  }

  /**
   * Save the resume point when the process exits or is interrupted. Without a handler of its own,
   * a SIGINT (Ctrl+C) or SIGTERM kills the process without ever emitting "exit".
   */
  listen() {
    if (this.exitHandler) {
      return;
    }
    this.exitHandler = this.saveCloneState.bind(this);
    this.signalHandler = (signal) => {
      this.saveCloneState();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.on('exit', this.exitHandler);
    process.on('SIGINT', this.signalHandler);
    process.on('SIGTERM', this.signalHandler);
  }

  /**
   * Persist the state of an interrupted clone so that it can be resumed.
   *
   * This runs from the process exit handler, so it has to be completely synchronous: anything
   * awaited inside of an exit handler is dropped when the process exits.
   */
  saveCloneState() {
    if (this.dryRun) {
      // A dry run should not alter the clone state of a real clone.
      this.flushDryRunSync();
      return;
    }
    this.persistCloneState();
  }

  /**
   * Write the clone state to disk when it changed, or remove the file once there is nothing left
   * to resume.
   */
  persistCloneState() {
    const state = Object.keys(this.cloneState).length ? JSON.stringify(this.cloneState, null, 2) : null;
    if (state === this.savedState) {
      return;
    }
    try {
      if (state) {
        fs.writeFileSync('clonestate.json', state);
      }
      else {
        fs.rmSync('clonestate.json', {force: true});
      }
      this.savedState = state;
    }
    catch (err) {
      // This runs from the exit handler: a failure to save the resume point must not replace the
      // error the clone is already reporting.
      this.error(`Could not save the clone state: ${err.message}`);
    }
  }

  /**
   * Release the resources this cloner holds onto. Safe to call more than once.
   */
  destroy() {
    if (this.exitHandler) {
      process.removeListener('exit', this.exitHandler);
      process.removeListener('SIGINT', this.signalHandler);
      process.removeListener('SIGTERM', this.signalHandler);
      this.exitHandler = null;
      this.signalHandler = null;
    }
  }

  /**
   * Prepare the dry run file, if this is a dry run.
   */
  initDryRun() {
    this.dryRun = !!this.options.dryRun;
    this.dryRunBuffer = [];

    // Lines are written out in batches rather than one at a time, so that a run reporting millions
    // of records is not one write per record.
    this.dryRunFlushSize = 500;
    this.dryRunTotals = {};
  }

  /**
   * Prepare the API client, if the source is an API.
   */
  initApiSource() {
    if (!this.options.apiSource) {
      return;
    }
    if (!this.options.key) {
      throw new Error('An API Key should be provided via --key option to clone from the API.');
    }
    this.requestHeaders = {
      'x-raw-data-access': createHmac('sha256', this.options.key).digest('hex')
    };
    this.fetch = fetch({
      key: this.options.key,
      noThrowOnError: true
    });
    this.limit = _.get(this.options, 'limit') ? Number(this.options.limit) : 1000;
    this.currentForm = null;
    this.currentSubmission = null;
  }

  /**
   * Load the state of a previously interrupted clone so that it can be resumed.
   */
  loadCloneState() {
    if (this.dryRun) {
      // A dry run always reports every operation, so it ignores the resume state of a previous clone.
      this.cloneState = {};
      return;
    }
    try {
      this.cloneState = JSON.parse(fs.readFileSync('clonestate.json', 'utf8'));
      this.savedState = JSON.stringify(this.cloneState, null, 2);
    }
    catch (e) {
      this.cloneState = {};
      console.log('No clonestate.json file found.');
    }
  }

  /**
   * Log a submission operation that would have been performed against the destination.
   * The buffered lines are flushed either when the buffer is full, or when a form is done cloning.
   * @param {string} operation - Either "Created" or "Updated".
   * @param {*} submissionId - The id of the submission being created or updated.
   */
  async dryRunLog(operation, submissionId, context = null) {
    const id = submissionId.toString();
    this.dryRunTotals[operation] = (this.dryRunTotals[operation] || 0) + 1;
    if (!this.options.extra) {
      // Without --extra a dry run reports how much is wrong, not which records.
      return;
    }
    this.dryRunBuffer.push(context ? `    ${operation} ${id} ${context}` : `    ${operation} ${id}`);
    if (this.dryRunBuffer.length >= this.dryRunFlushSize) {
      await this.flushDryRun();
    }
  }

  /**
   * Say what the form that has just been compared turned out to hold.
   */
  reportDryRunForm() {
    if (!this.dryRunForm) {
      return;
    }
    const missing = (this.dryRunTotals.Created || 0) - this.dryRunForm.created;
    const stale = (this.dryRunTotals.Updated || 0) - this.dryRunForm.updated;
    const extra = (this.dryRunTotals.Extra || 0) - this.dryRunForm.extra;
    const parts = [`${missing} missing`, `${stale} out of date`];
    if (this.options.extra) {
      parts.push(`${extra} only in the destination`);
    }
    process.stdout.write(`    ${parts.join(', ')}\n`);
    this.dryRunForm = null;
  }

  /**
   * Report the submissions the destination holds for a form that the source does not have. This is
   * the one thing a clone never looks at, so it is a second pass, only done when it is asked for.
   *
   * @param {*} srcForm - The source form.
   * @param {*} destForm - The destination form.
   */
  async reportExtraSubmissions(srcForm, destForm) {
    const where = this.itemQuery({form: destForm._id, project: destForm.project});
    const cursor = this.dest.submissions.find(where).project(TIMESTAMP_FIELDS).batchSize(this.writeBufferSize);
    let batch = [];

    const check = async() => {
      const ids = batch.map((doc) => doc._id);
      const present = new Set();
      const found = this.src.submissions.find({_id: {$in: ids}}).project({_id: 1});
      while (await found.hasNext()) {
        present.add((await found.next())._id.toString());
      }
      const extra = [];
      batch.forEach((doc) => {
        if (!present.has(doc._id.toString())) {
          extra.push(doc._id);
        }
      });
      for (const id of extra) {
        await this.dryRunLog('Extra', id, `form=${srcForm._id}`);
      }
      batch = [];
    };

    while (await cursor.hasNext()) {
      batch.push(await cursor.next());
      if (batch.length >= this.writeBufferSize) {
        await check();
      }
    }
    if (batch.length) {
      await check();
    }
  }

  /**
   * Write the buffered report lines out, waiting for the pipe to drain when the output is being
   * sent somewhere that cannot keep up.
   */
  async flushDryRun() {
    if (!this.dryRunBuffer.length) {
      return;
    }
    const text = `${this.dryRunBuffer.join('\n')}\n`;
    this.dryRunBuffer = [];
    if (!process.stdout.write(text)) {
      await new Promise((resolve) => process.stdout.once('drain', resolve));
    }
  }

  /**
   * Write out whatever is buffered without waiting, for the paths that cannot await.
   */
  flushDryRunSync() {
    if (this.dryRunBuffer.length) {
      process.stdout.write(`${this.dryRunBuffer.join('\n')}\n`);
      this.dryRunBuffer = [];
    }
  }

  /**
   * Derive the key and iv for a secret the way the server does.
   * @param {string} secret - The secret to derive the key and iv from.
   * @returns {{key: Buffer, iv: Buffer}} - The derived key and iv.
   */
  legacyKey(secret) {
    return encryption.legacyKey(secret);
  }

  /**
   * Encrypt data or settings using a secret.
   * @param {*} secret
   * @param {*} rawData
   * @param {*} nosalt
   * @returns
   */
  encrypt(secret, rawData, nosalt) {
    return encryption.encrypt(secret, rawData, nosalt, this.defaultSaltLength);
  }

  /**
   * Decrypt data or settings using a secret.
   * @param {*} secret
   * @param {*} cipherbuffer
   * @param {*} nosalt
   * @returns
   */
  decrypt(secret, cipherbuffer, nosalt) {
    return encryption.decrypt(secret, cipherbuffer, nosalt, this.defaultSaltLength);
  }

  /**
   * Create the database configuration for the given database source type.
   * @param {*} type - The type of database source.
   * @returns MongoDB configuration.
   */
  dbConfig(type) {
    return tlsOptions(this.options[`${type}Ca`], this.options[`${type}Cert`]);
  }

  /**
   * Iterate through each document in a collection.
   *
   * @param {*} collection - The collection to iterate through.
   * @param {*} query - The query to use to find the documents.
   * @param {*} cb - The callback to call for each document.
   */
  async each(collection, query, cb, sort = {created: 1, _id: 1}, options = {}) {
    // The resume point is scoped to what is actually being iterated: the submissions of one form,
    // not "the submissions collection", which is walked once per form.
    const stateKey = options.stateKey || collection;
    const needsLookup = options.needsLookup !== false;
    const failuresBefore = this.writeFailures;

    // When the destination is checked document by document, the source is first read with only the
    // timestamps that decide whether a document has to be cloned again. The documents that do are
    // then read in full. Everything else, which can be megabytes of submission data each, is never
    // sent over the wire at all.
    // An afterAll handler is handed every source document, so it always gets them in full.
    const timestampsOnly = needsLookup && !this.afterAll && !!this.destProjection(collection);
    const where = this.resumeQuery(stateKey, query);
    const count = options.count ? () => this.countSource(collection, where) : null;
    const progress = await this.startProgress(options.label, count);
    const cursor = _.get(this, collection)
      .find(where)
      .sort(sort)
      .batchSize(Math.min(this.writeBufferSize, 1000));
    if (timestampsOnly) {
      cursor.project(TIMESTAMP_FIELDS);
    }

    while (await cursor.hasNext()) {
      // When the destination has to be looked up, the documents are walked in chunks so that the
      // lookup is one query per chunk instead of one query per document. Without a lookup there is
      // nothing to gain by holding documents in memory, so they are streamed one at a time.
      const chunk = await this.readChunk(cursor, needsLookup);
      if (needsLookup) {
        await this.warmDestinationCache(collection, chunk);
      }
      const source = timestampsOnly ? this.sourceReader(collection, chunk) : null;
      for (const projected of chunk) {
        const doc = source ? await source(projected) : projected;
        if (!doc) {
          // It disappeared from the source while this clone was reading it.
          this.vanished = (this.vanished || 0) + 1;
          this.error(`${this.collectionName(collection)} ${projected._id} is no longer in the source, skipped.`);
          this.tick(progress);
          continue;
        }

        // eslint-disable-next-line callback-return
        await cb(doc);
        this.tick(progress);

        // The progress is only committed to the clone state once the writes it belongs to have been
        // flushed, so an interrupted clone never skips a document that was queued but never written.
        this.pendingState[stateKey] = {
          created: (doc.created ? new Date(doc.created) : new Date(0)).toISOString(),
          _id: doc._id ? doc._id.toString() : null
        };
      }
      this.destCaches.delete(this.collectionName(collection));
    }

    if (options.deferFlush) {
      // A nested iteration (the revisions of one submission) leaves its writes to be flushed with
      // the ones of its parent, so that the batching is not undone for every single parent. Its
      // resume point is forgotten once that flush succeeds.
      this.completedState.add(stateKey);
    }
    else {
      // The writes are flushed by their own size and count thresholds while the documents are
      // walked; this is the final flush of whatever is left over.
      await this.flushWrites();
      if (this.writeFailures === failuresBefore) {
        // Only forget the resume point when everything this iteration produced was actually written.
        delete this.cloneState[stateKey];
      }
    }
    delete this.pendingState[stateKey];
    this.endProgress(progress);
  }

  /**
   * Build a reader that hands back the full source document for the documents of this chunk that
   * are going to be written, and the timestamps-only document for the ones that are not.
   *
   * The full documents are fetched in groups whose size adapts to how big they turn out to be, so
   * that a form full of base64 files holds no more memory than one full of plain text.
   *
   * @param {string} collection - The source collection being iterated.
   * @param {Array} chunk - The chunk of timestamp-only documents.
   * @returns {Function} - Called with a projected document, resolves to the document to clone.
   */
  sourceReader(collection, chunk) {
    const name = this.collectionName(collection);
    const cache = this.destCaches.get(name);

    // A dry run only reports what it found, so it never needs the data of anything.
    const wanted = this.dryRun ? [] : chunk
      .filter((doc) => this.shouldClone(name, doc, cache ? cache.get(doc._id.toString()) : null))
      .map((doc) => doc._id);
    const needed = new Set(wanted.map((id) => id.toString()));
    let fetched = new Map();
    let next = 0;

    return async(projected) => {
      const key = projected._id.toString();
      if (!needed.has(key)) {
        // Nothing will be written for this one, so its data is never read.
        return projected;
      }
      if (!fetched.has(key)) {
        const size = Math.max(1, Math.min(this.fullFetchSize || 50, wanted.length - next));
        const ids = wanted.slice(next, next + size);
        next += ids.length;
        fetched = new Map();
        let bytes = 0;
        const docs = await _.get(this, collection).find({_id: {$in: ids}}).toArray();
        docs.forEach((doc) => {
          fetched.set(doc._id.toString(), doc);
          bytes += this.documentSize(doc);
        });

        // Aim the next group at the byte budget, based on how big these turned out to be.
        const average = docs.length ? Math.max(bytes / docs.length, 1) : 1;
        this.fullFetchSize = Math.max(1, Math.min(Math.floor(this.maxBatchBytes / average), this.writeBufferSize));
      }
      // The document was there when the timestamps were read and is gone now. Writing what we hold
      // would replace it with nothing but its timestamps, so it is skipped and reported.
      return fetched.get(key) || null;
    };
  }

  /**
   * Read the next chunk of source documents, bounded both by the number of documents and by the
   * number of bytes they hold, so that large submissions cannot exhaust memory.
   *
   * @param {*} cursor - The source cursor.
   * @param {boolean} needsLookup - Whether the destination has to be looked up for these documents.
   */
  async readChunk(cursor, needsLookup) {
    const chunk = [];
    const maxDocuments = needsLookup ? this.writeBufferSize : 1;
    let bytes = 0;
    while ((chunk.length < maxDocuments) && (bytes < this.maxBatchBytes) && await cursor.hasNext()) {
      const doc = await cursor.next();
      chunk.push(doc);
      if (maxDocuments > 1) {
        bytes += this.documentSize(doc);
      }
    }
    return chunk;
  }

  /**
   * The size, in bytes, a document takes up.
   * @param {*} doc - The document to measure.
   */
  documentSize(doc) {
    try {
      return BSON.calculateObjectSize(doc);
    }
    catch (err) {
      // Never let measuring a document stop it from being cloned.
      return 0;
    }
  }

  /**
   * Decorate a query so that an interrupted clone continues where it left off.
   *
   * The resume point is a (created, _id) pair rather than a date on its own, because several
   * documents can share the exact same creation millisecond.
   *
   * @param {string} stateKey - The key the progress of this iteration is saved under.
   * @param {object} query - The query to decorate.
   */
  resumeQuery(stateKey, query) {
    const state = this.cloneState[stateKey];
    if (query._id || !state) {
      return query;
    }
    const created = new Date(typeof state === 'string' ? state : state.created);
    const lastId = (typeof state === 'string') ? null : this.convertToObjectId(state._id);
    const keyset = lastId
      ? {$or: [{created: {$gt: created}}, {created: created, _id: {$gt: lastId}}]}
      : {created: {$gt: created}};
    return Object.assign({}, query, {$and: (query.$and || []).concat([keyset])});
  }

  /**
   * Fetch the destination documents of a chunk of source documents in one query, so that the
   * per document destination lookups become a cache hit.
   *
   * @param {string} collection - The source collection being iterated.
   * @param {Array} docs - The chunk of source documents.
   */
  async warmDestinationCache(collection, docs) {
    const name = this.collectionName(collection);
    this.destCaches.delete(name);
    const target = _.get(this, `dest.${name}`);
    if (!target || !docs.length) {
      return;
    }
    const ids = docs.map((doc) => doc._id).filter((id) => id);
    if (!ids.length) {
      return;
    }
    const cache = new Map();
    const cursor = target.find({_id: {$in: ids}});
    const projection = this.destProjection(name);
    if (projection) {
      cursor.project(projection);
    }
    const found = await cursor.toArray();
    found.forEach((doc) => cache.set(doc._id.toString(), doc));
    this.destCaches.set(name, cache);
  }

  /**
   * Write a line of the clone's running commentary. A dry run reports differently, so it stays
   * quiet here.
   * @param {string} text - What to write.
   */
  status(text) {
    if (!this.dryRun) {
      process.stdout.write(text);
    }
  }

  /**
   * Start showing the progress of a collection being cloned. A dry run reports differently, so it
   * shows none.
   *
   * @param {string} label - What is being cloned, such as "         - Submissions:". Nothing is shown
   *                         without one.
   * @param {Function} count - Resolves to the number of documents there are, or null when unknown.
   * @returns {Progress|null} - The progress, if any is shown.
   */
  async startProgress(label, count = null) {
    if (!label || this.dryRun) {
      return null;
    }
    const progress = new Progress(label, {interactive: this.interactive});
    this.activeProgress = progress;

    // The clone does not wait for the count: it shows a running count until the total is known. Only
    // one count runs at a time, so that the source is never asked for more than one at once.
    if (count && !this.counting) {
      this.counting = Promise.resolve()
        .then(() => count())
        .then((total) => {
          if (total) {
            progress.setTotal(total);
          }
        })
        .catch(() => {})
        .then(() => {
          this.counting = null;
        });
    }
    return progress;
  }

  /**
   * Where an item is in the list it belongs to, such as " [12/340]", when the size of the list is known.
   * @param {number} position - The position of the item, from 1.
   * @param {number|null} total - The size of the list.
   */
  position(position, total) {
    return total ? ` [${position}/${total}]` : '';
  }

  /**
   * Count a document as done.
   * @param {Progress|null} progress - The progress it belongs to.
   */
  tick(progress) {
    if (progress) {
      progress.tick();
    }
  }

  /**
   * Write the final state of a progress.
   * @param {Progress|null} progress - The progress.
   */
  endProgress(progress) {
    if (!progress) {
      return;
    }
    progress.done();
    if (this.activeProgress === progress) {
      this.activeProgress = null;
    }
  }

  /**
   * Count the source documents a query matches, for a progress bar. A count that takes too long
   * (there is no index for it) is given up on, and so are all the counts after it.
   *
   * @param {string} collection - The source collection, such as "src.submissions".
   * @param {object} query - The query.
   * @returns {number|null} - The count, or null when it is not known.
   */
  async countSource(collection, query, timeout = BAR_COUNT_TIMEOUT) {
    if (this.countsDisabled || this.options.apiSource) {
      return null;
    }
    try {
      return await _.get(this, collection).countDocuments(query, {maxTimeMS: timeout});
    }
    catch (err) {
      // Said once, so that a clone without totals is not a mystery.
      this.countsDisabled = true;
      const reason = (err && err.code === 50)
        ? `counting the ${this.collectionName(collection)} took longer than ${timeout / 1000}s`
        : `counting the ${this.collectionName(collection)} failed: ${err && err.message}`;
      const hint = (this.collectionName(collection) === 'submissions')
        ? ' An index on {form: 1, project: 1, created: 1} of the source submissions makes these counts fast.'
        : '';
      this.error(`Progress totals are off for the rest of this clone: ${reason}.${hint}`);
      return null;
    }
  }

  /**
   * Report an error, without it ending up in the middle of a progress line.
   * @param {...*} args - What to report.
   */
  error(...args) {
    if (this.activeProgress) {
      this.activeProgress.interrupt();
    }
    console.error(...args);
  }

  /**
   * Queue a write against a destination collection. The writes are sent in batches.
   * @param {string} collection - The destination collection.
   * @param {object} operation - The bulk write operation.
   */
  async queueWrite(collection, operation, bytes) {
    const target = this.dest[collection];
    const buffer = this.writeBuffer[collection];
    if (buffer && buffer.target !== target) {
      // The destination collection was swapped out (a form with its own submission collection):
      // the queued writes belong to the previous one.
      await this.flushWrites(collection);
    }
    if (!this.writeBuffer[collection] || this.writeBuffer[collection].target !== target) {
      this.writeBuffer[collection] = {target, operations: [], bytes: 0};
    }
    this.writeBuffer[collection].operations.push(operation);
    this.writeBuffer[collection].bytes += bytes || 0;
    if (this.pendingWrites >= this.writeBufferSize || this.pendingBytes >= this.maxBatchBytes) {
      await this.flushWrites();
    }
  }

  /**
   * The number of writes that are currently queued.
   */
  get pendingWrites() {
    return Object.values(this.writeBuffer).reduce((total, buffer) => total + buffer.operations.length, 0);
  }

  /**
   * The number of bytes the queued writes hold.
   */
  get pendingBytes() {
    return Object.values(this.writeBuffer).reduce((total, buffer) => total + buffer.bytes, 0);
  }

  /**
   * Send every queued write to the destination, and commit the progress they belong to.
   * @param {string} collection - An optional single collection to flush.
   */
  async flushWrites(collection = null) {
    const names = collection ? [collection] : Object.keys(this.writeBuffer);
    const everything = !collection;
    for (const name of names) {
      const buffer = this.writeBuffer[name];
      if (!buffer || !buffer.operations.length) {
        continue;
      }
      const {target, operations} = buffer;
      this.writeBuffer[name] = {target: this.dest[name], operations: [], bytes: 0};
      await this.bulkWrite(name, target, operations);
    }
    if (this.writeFailed || !everything) {
      // Once a write has been lost the resume point must not move past it, and a flush of a single
      // collection says nothing about the documents still queued for the others.
      return;
    }
    Object.assign(this.cloneState, this.pendingState);
    this.completedState.forEach((stateKey) => delete this.cloneState[stateKey]);
    this.completedState.clear();

    // The resume point is saved as it moves, so that even a clone that is killed outright can be
    // resumed from the last batch that was written.
    if (!this.dryRun) {
      this.persistCloneState();
    }
  }

  /**
   * Send a batch of writes to a destination collection.
   * @param {string} name - The destination collection name.
   * @param {*} target - The destination collection.
   * @param {Array} operations - The bulk write operations.
   * @returns {boolean} - True when every document was written.
   */
  async bulkWrite(name, target, operations) {
    try {
      await target.bulkWrite(operations, {ordered: false});
      return true;
    }
    catch (err) {
      return !this.reportWriteErrors(name, err, operations.length);
    }
  }

  /**
   * Report the errors of a batched write. Documents that already exist in the destination are not
   * an error: they simply do not need to be cloned again.
   *
   * @param {string} collection - The collection that was written to.
   * @param {Error} err - The error thrown by the bulk write.
   */
  reportWriteErrors(collection, err, attempted = 1) {
    const reported = err.writeErrors || _.get(err, 'result.result.writeErrors') || [];
    const writeErrors = Array.isArray(reported) ? reported : [reported];
    const errors = writeErrors.filter((writeError) => !this.alreadyExists(writeError));
    if (!writeErrors.length) {
      // The batch failed as a whole, so every document in it was lost, not just one.
      const written = _.get(err, 'result.result.nInserted', 0) + _.get(err, 'result.result.nModified', 0);
      const lost = Math.max(attempted - written, 1);
      this.recordWriteFailure(collection, err.message || err, lost);
      return lost;
    }
    errors.forEach((writeError) => {
      this.recordWriteFailure(collection, this.writeErrorMessage(writeError) || writeError);
    });
    return errors.length;
  }

  /**
   * The message of a single write error, whichever shape the driver reported it in.
   * @param {*} writeError - The write error.
   */
  writeErrorMessage(writeError) {
    return writeError.errmsg || _.get(writeError, 'err.errmsg') || writeError.message || '';
  }

  /**
   * Whether a write error only says that the document is already in the destination. That is a
   * duplicate _id: a duplicate on any other unique index is a document that conflicts with a
   * different one, and was not written.
   *
   * @param {*} writeError - The write error.
   */
  alreadyExists(writeError) {
    if ((writeError.code || _.get(writeError, 'err.code')) !== 11000) {
      return false;
    }
    const message = String(this.writeErrorMessage(writeError));
    return !/index: /.test(message) || /index: _id_ /.test(message);
  }

  /**
   * Record a document that could not be written. The clone reports these at the end and exits with
   * an error, rather than claiming it cloned data that never arrived.
   *
   * @param {string} collection - The collection that was written to.
   * @param {*} reason - Why the write failed.
   */
  recordWriteFailure(collection, reason, count = 1) {
    this.writeFailures += count;
    this.writeFailed = true;
    this.reportedFailures = this.reportedFailures || 0;
    if (this.reportedFailures < 10) {
      this.reportedFailures++;
      const scale = count > 1 ? ` (${count} documents)` : '';
      this.error(`Error writing to ${collection}${scale}:`, reason);
    }
    else if (this.reportedFailures === 10) {
      this.reportedFailures++;
      this.error('Further write errors will not be printed.');
    }
  }

  /**
   * Record a document that could not be cloned because cloning it threw. The clone carries on with
   * the other documents, but reports the failure at the end rather than claiming success.
   *
   * The same programming error on document after document is a broken callback rather than bad
   * data, so it stops the clone instead of being reported once per document.
   *
   * @param {string} collection - The collection being cloned.
   * @param {*} id - The id of the document.
   * @param {Error} err - What went wrong.
   */
  recordDocumentFailure(collection, id, err) {
    this.documentFailures++;

    // The resume point must not move past a document that was never cloned.
    this.writeFailed = true;
    this.error(`Error creating ${collection} ${id}`, err);
    if (!(err instanceof TypeError || err instanceof ReferenceError)) {
      this.repeatedError = null;
      return;
    }
    const message = err.message;
    const count = (this.repeatedError && this.repeatedError.message === message) ? this.repeatedError.count + 1 : 1;
    this.repeatedError = {message, count};
    if (count >= MAX_REPEATED_ERRORS) {
      // Fatal, so that the iterations this one is nested in pass it on rather than count it again.
      err.fatal = true;
      throw err;
    }
  }

  /**
   * Everything that went wrong during the clone, or null when nothing did.
   */
  get failures() {
    const failures = [];
    if (this.writeFailures) {
      failures.push(`${this.writeFailures} document(s) could not be written to the destination`);
    }
    if (this.documentFailures) {
      failures.push(`${this.documentFailures} document(s) could not be cloned`);
    }
    if (this.undecryptable.size) {
      failures.push(`${this.undecryptable.size} project(s) had settings that could not be decrypted`);
    }
    return failures.length ? failures.join(', ') : null;
  }

  /**
   * Before handler for each document.
   *
   * @param {*} collection - The collection to run the before handler on.
   * @param {*} beforeEach - The callback to call before each document.
   * @param {*} src - The source document.
   * @param {*} update - The updated document.
   * @param {*} dest - The destination document.
   */
  async before(collection, beforeEach, src, update, dest) {
    if (beforeEach && await beforeEach(src, update, dest) === false) {
      return false;
    }
    if (this.beforeAll && await this.beforeAll(collection, src, update, dest) === false) {
      return false;
    }
    return true;
  }

  /**
   * After handler for each document.
   * @param {*} collection - The collection to run the after handler on.
   * @param {*} afterEach - The callback to call after each document.
   * @param {*} srcItem - The source item.
   * @param {*} update - The updated item.
   * @param {*} dest - The destination item.
   */
  async after(collection, afterEach, srcItem, update, dest) {
    if (afterEach) {
      await afterEach(srcItem, update, dest);
    }
    if (this.afterAll) {
      await this.afterAll(collection, srcItem, update, dest);
    }
  }

  /**
   * Find the last item in the collection by provided query.
   * @param {string} collection - The collection where to run find query.
   * @param {object} query - The query to use to find the item in the database.
   * @param {object} sort - The sort option to use when searching for the item.
   */
  async findLast(collection, query) {
    if (!collection || !query) {
      return;
    }
    const target = _.get(this, collection);
    const projection = this.destProjection(collection);
    const keys = Object.keys(query);
    if (keys.length === 1 && keys[0] === '_id' && query._id) {
      const cache = this.destCaches.get(this.collectionName(collection));
      if (cache) {
        return cache.get(query._id.toString()) || null;
      }
      // A lookup by id is unique: there is nothing to sort.
      return await target.findOne(query, projection ? {projection} : {});
    }
    const cursor = target.find(query).sort({created: -1}).limit(1);
    if (projection) {
      cursor.project(projection);
    }
    const [found] = await cursor.toArray();

    return found;
  }

  /**
   * The fields to fetch when looking an item up in the destination.
   *
   * Only the fields that are actually used are fetched: the timestamps that decide whether the item
   * needs to be cloned again, and the id used to update it.
   *
   * @param {string} collection - The collection being looked up, such as "dest.submissions".
   * @returns {object|null} - The projection to use, or null to fetch the whole document.
   */
  destProjection(collection) {
    return TIMESTAMP_ONLY_COLLECTIONS.includes(this.collectionName(collection)) ? TIMESTAMP_FIELDS : null;
  }

  /**
   * The bare collection name, with the "src." or "dest." prefix removed.
   * @param {string} collection - The collection, such as "dest.submissions".
   */
  collectionName(collection) {
    return String(collection).replace(/^(src|dest)\./, '');
  }

  /**
   * Determine if we should clone the given item.
   * @param {*} collection - The collection the item belongs to.
   * @param {*} srcItem - The source item to check.
   * @param {*} destItem - The equivalent item found in the destination (if any).
   */
  shouldClone(collection, srcItem, destItem) {
    if (this.options.submissionsOnly && collection !== 'submissions') {
      return false;
    }
    const srcCreated = this.timestamp(srcItem.created);
    if (this.options.createdAfter && srcCreated < parseInt(this.options.createdAfter, 10)) {
      return false;
    }
    const srcModified = this.timestamp(srcItem.modified);
    if (this.options.modifiedAfter && srcModified < parseInt(this.options.modifiedAfter, 10)) {
      return false;
    }

    if (destItem && destItem._id) {
      // They can ask us to leave the projects and forms they already have alone.
      if (!this.updateExisting && ['projects', 'forms'].includes(collection)) {
        return false;
      }

      // Make sure to not re-clone the same item it if has not been modified.
      if (srcCreated === this.timestamp(destItem.created) && srcModified === this.timestamp(destItem.modified)) {
        return false;
      }
    }
    return true;
  }

  /**
   * The time, in milliseconds, of a date that may be a Date, a number of milliseconds, or a date
   * string (which is what an API source returns).
   * @param {*} value - The date.
   */
  timestamp(value) {
    if (value instanceof Date) {
      return value.getTime();
    }
    if (typeof value === 'string' && !/^\s*-?\d+\s*$/.test(value)) {
      return Date.parse(value);
    }
    return parseInt(value, 10);
  }

  /**
   * Find a query.
   * @param {*} current - The current record.
   */
  findQuery(current, findQuery = null) {
    if (findQuery) {
      return findQuery(current);
    }
    if (findQuery === false) {
      return null;
    }
    return {_id: current._id};
  }

  /**
   * Convert value to Date.
   * @param {*} value
   */
  convertToDate(value) {
    if (value instanceof Date) {
      return value;
    }

    if (typeof value === 'string' || typeof value === 'number') {
      return new Date(value);
    }

    throw new Error(`Can't extract date from ${value}`);
  }

  /**
   * Convert value to ObjectId.
   * @param {*} value
   */
  convertToObjectId(value) {
    if (value instanceof ObjectId) {
      return value;
    }

    if (ObjectId.isValid(value)) {
      return new ObjectId(value);
    }

    return null;
  }

  /**
   * Converts API returned item fields that have id's to ObjectId type.
   * @param {*} item - The item to convert.
   */
  convertApiObjectToDbRecord(item) {
    const idFields = ['owner', '_rid', 'form', 'project'];
    const dateFields = ['trial', 'created', 'modified'];

    idFields.forEach(fieldName => {
      // eslint-disable-next-line no-prototype-builtins
      if (item.hasOwnProperty(fieldName)) {
        item[fieldName] = this.convertToObjectId(item[fieldName]);
      }
    });

    dateFields.forEach(fieldName => {
      // eslint-disable-next-line no-prototype-builtins
      if (item.hasOwnProperty(fieldName)) {
        item[fieldName] = this.convertToDate(item[fieldName]);
      }
    });
  }

  /**
   * Queue the insert or update of a single item, or record it when this is a dry run.
   *
   * @param {string} collection - The collection being cloned.
   * @param {*} srcItem - The source item.
   * @param {*} updatedItem - The item as it should exist in the destination.
   * @param {*} destItem - The item that already exists in the destination, if any.
   * @returns {boolean} - False when the item is known not to have been written.
   */
  async writeItem(collection, srcItem, updatedItem, destItem) {
    if (this.dryRun) {
      if (collection === 'submissions') {
        await this.dryRunLog(
          destItem ? 'Updated' : 'Created',
          destItem ? destItem._id : updatedItem._id,
          `form=${updatedItem.form}`
        );
      }
      return true;
    }
    if (this.options.apiSource) {
      if (!destItem && collection === 'projects') {
        updatedItem.machineName = updatedItem.name;
      }
      this.convertApiObjectToDbRecord(updatedItem);
    }
    const operation = destItem
      ? {updateOne: {
        filter: this.findQuery(destItem),
        update: {$set: _.omit(updatedItem, ['_id', 'machineName'])}
      }}
      : {insertOne: {document: updatedItem}};
    if (PARENT_COLLECTIONS.includes(collection)) {
      return await this.bulkWrite(collection, this.dest[collection], [operation]);
    }
    await this.queueWrite(collection, operation, this.documentSize(updatedItem));
    return true;
  }

  upsertCurrent(eachItem, beforeEach, afterEach, collection, find) {
    return async(current) => {
      const srcItem = _.cloneDeep(current);

      if (this.options.apiSource) {
        srcItem._id = this.convertToObjectId(srcItem._id);
        // eslint-disable-next-line no-prototype-builtins
        if (srcItem.hasOwnProperty('project')) {
          srcItem.project = this.convertToObjectId(srcItem.project);
        }
      }

      if (collection === 'forms' && this.exclude.includes(srcItem._id.toString())) {
        return;
      }

      if (eachItem) {
        eachItem(srcItem);
      }

      try {
        // Create the item we will be inserting/updating.
        const destItem = await this.findLast(
          `dest.${collection}`,
          this.findQuery(
            this.options.apiSource ? srcItem : current,
            find
          ));
        const updatedItem = {...destItem, ...(_.omit(srcItem, ['_id']))};
        if (!updatedItem._id) {
          updatedItem._id = srcItem._id;
        }

        // The before handler maps the source item onto the destination (its project, its roles, the
        // collection it belongs to). It always runs, even for items we are not going to write,
        // because everything that hangs off of this item is cloned using those mapped values.
        const allowed = await this.before(collection, beforeEach, srcItem, updatedItem, destItem) !== false;
        if (allowed && this.shouldClone(collection, srcItem, destItem)) {
          const written = await this.writeItem(collection, srcItem, updatedItem, destItem);
          if (!written && !destItem) {
            // The item is not in the destination, so nothing that hangs off of it can be cloned.
            this.error(`${collection} ${current._id} was not written, so nothing within it was cloned.`);
            return;
          }
        }

        // Call the after handler.
        await this.after(collection, afterEach, srcItem, updatedItem, destItem);
        this.repeatedError = null;
      }
      catch (err) {
        if (err && err.fatal) {
          // Something is wrong with the source or the destination itself, not with this document.
          throw err;
        }
        this.recordDocumentFailure(collection, current._id, err);
      }
    };
  }

  /**
   * Upsert a record in the destination database.
   * @param {*} collection - The collection to upsert to.
   * @param {*} query - The query to use to find the document in the source database.
   * @param {*} beforeEach - The callback to call before upserting the document.
   * @param {*} afterEach - The callback to call after upserting the document.
   * @param {*} options - Extra options.
   * @param {*} options.find - The query to use to find the "equivalent" document in the destination
   *                           database, or false when the destination is not looked up at all.
   * @param {*} options.scope - The id of the item being walked (a form, a project), so that the
   *                            resume point of a collection that is walked more than once is not
   *                            shared between them.
   * @param {*} options.deferFlush - Leave the writes to be flushed with the ones of the iteration
   *                                 this one is nested in.
   * @param {*} options.label - The label the progress of the collection is shown with, if any.
   * @param {*} options.count - Count the documents first, so that the progress shows a bar.
   */
  async upsertAll(collection, query, eachItem, beforeEach, afterEach, options = {}) {
    [['eachItem', eachItem], ['beforeEach', beforeEach], ['afterEach', afterEach]].forEach(([name, handler]) => {
      if (handler && typeof handler !== 'function') {
        throw new Error(`The ${name} handler of ${collection} is a ${typeof handler}, not a function.`);
      }
    });
    const {find = null, scope = null, deferFlush = false, label = null, count = false} = options;
    if (this.options.apiSource) {
      await this.cloneFromApi(
        collection,
        query,
        this.upsertCurrent(eachItem, beforeEach, afterEach, collection, find),
        {label}
      );
    }
    else {
      await this.each(
        `src.${collection}`,
        query,
        this.upsertCurrent(eachItem, beforeEach, afterEach, collection, find),
        {created: 1, _id: 1},
        {
          // The same collection is walked once per form or per project, so the resume point is
          // scoped to the item being walked.
          stateKey: scope ? `src.${collection}:${scope}` : `src.${collection}`,

          // Only the default lookup is by id, which is the only one the prefetch can answer. There
          // is nothing to gain from prefetching for a custom lookup (roles, actions) or for a
          // collection whose destination is never looked up at all (find: false).
          needsLookup: find === null || find === undefined,
          deferFlush,
          label,
          count
        }
      );
    }
  }

  /**
   * Create a query for the given collection.
   * @param {*} query - The default query to decorate.
   * @returns - The decorated query.
   */
  query(query, includeAll = false) {
    let newQuery = _.cloneDeep(query);
    if (!this.options.all && !includeAll) {
      newQuery.deleted = {$eq: null};
    }
    return newQuery;
  }

  /**
   * Get the destination project id.
   */
  get destProject() {
    return this.options.dstProject || this.options.project;
  }

  /**
   * Get the source project id.
   */
  get sourceProject() {
    return this.options.srcProject || this.options.project;
  }

  /**
   * Create a decorated query for a single item.
   * @param {*} query - The default query to decorate.
   * @returns - The decorated query.
   */
  itemQuery(query, includeAll = false) {
    let newQuery = _.cloneDeep(query);
    if (this.options.deletedAfter && !this.options.all && !includeAll) {
      const deletedAfter = parseInt(this.options.deletedAfter, 10);
      // The servers store "deleted" as a timestamp, but be tolerant of databases that stored a date.
      newQuery['$or'] = [
        {deleted: {$eq: null}},
        {deleted: {$gt: deletedAfter}},
        {deleted: {$gt: new Date(deletedAfter)}}
      ];
    }
    else {
      newQuery = this.query(newQuery, includeAll);
    }
    // If it's OSS, then project would be undefined
    // eslint-disable-next-line no-prototype-builtins
    if (newQuery.hasOwnProperty('project') && !newQuery.project) {
      delete newQuery.project;
    }
    return newQuery;
  }

  /**
   * Adding a query for created and modified dates.
   * @param {*} query - The default query to decorate.
   */
  afterQuery(query, createdAfter, modifiedAfter, includeAll = false) {
    const newQuery = this.itemQuery(query, includeAll);
    createdAfter = createdAfter || this.options.createdAfter;
    modifiedAfter = modifiedAfter || this.options.modifiedAfter;
    if (createdAfter) {
      newQuery.created = {$gt: new Date(parseInt(createdAfter, 10))};
    }
    if (modifiedAfter) {
      newQuery.modified = {$gt: new Date(parseInt(modifiedAfter, 10))};
    }
    return newQuery;
  }

  /**
   * Create a decorated query for project searching.
   * @param {*} srcProject - The source project to use.
   * @param {*} defaultQuery - The default query to decorate.
   * @returns - The decorated project query.
   */
  projectQuery(srcProject = null, defaultQuery = {}) {
    const query = this.itemQuery(defaultQuery);
    if (srcProject && srcProject._id) {
      query.project = srcProject._id;
    }
    else if (!this.oss) {
      // An open source source database has no projects, so a project id can only be naming the
      // destination: matching the source items against it would find nothing at all.
      const sourceProjects = idList(this.sourceProject);
      if (sourceProjects.length === 1) {
        query._id = new ObjectId(sourceProjects[0]);
      }
      else if (sourceProjects.length) {
        query._id = {$in: sourceProjects.map((id) => new ObjectId(id))};
      }
    }
    return query;
  }

  /**
   * Create a decorated query for forms searching.
   */
  formQuery(srcProject = null, defaultQuery = {}) {
    const query = this.projectQuery(srcProject, defaultQuery);
    const forms = idList(this.options.forms);
    if (forms.length) {
      query._id = {$in: forms.map((id) => new ObjectId(id))};
    }
    return query;
  }

  /**
   * Sets the submission collection configuration for the destination imports.
   * @param {*} form - The form we are currently cloning.
   * @param {*} srcProj - The source project.
   * @param {*} destProj - The destination project.
   */
  async setCollection(form, srcProj, destProj) {
    // Any queued submission writes belong to the collection that is about to be swapped out.
    await this.flushWrites();
    const subsCollection = _.get(form, 'settings.collection');

    if (!this.options.apiSource) {
      this.useCollection(this.src, subsCollection && srcProj && submissionCollectionName(srcProj.name, subsCollection));
    }
    const destCollection = subsCollection && destProj && submissionCollectionName(destProj.name, subsCollection);
    this.useCollection(this.dest, destCollection);
    if (destCollection) {
      console.log(`Using collection - ${destCollection}`);
      await this.warnAboutMisnamedCollection(form, destProj, subsCollection, destCollection);
    }
  }

  /**
   * Point the submissions, and submission revisions, of a database at the collections of a form.
   * @param {object} database - The source or the destination.
   * @param {string|null} name - The custom collection of the form, or null for the default ones.
   */
  useCollection(database, name) {
    database.submissions = name ? database.db.collection(name) : database.ogSubmissions;
    database.submissionrevisions = name
      ? database.db.collection(`${name}_revisions`)
      : (database.ogSubmissionRevisions || database.submissionrevisions);
  }

  /**
   * Earlier versions of the clone wrote the submissions of a custom collection to a collection named
   * after the unsanitized project and collection names, where the server never reads them. Say so
   * when the destination still has them, since they are not moved.
   *
   * @param {object} form - The form.
   * @param {object} destProj - The destination project.
   * @param {string} subsCollection - The collection setting of the form.
   * @param {string} destCollection - The collection the submissions are cloned to.
   */
  async warnAboutMisnamedCollection(form, destProj, subsCollection, destCollection) {
    const misnamed = `${destProj.name}_${subsCollection}`;
    if (this.dryRun || misnamed === destCollection) {
      return;
    }
    let found = 0;
    try {
      found = await this.dest.db.collection(misnamed).countDocuments({form: form._id}, {limit: 1});
    }
    catch (err) {
      // Only a warning: it is never a reason to stop the clone.
    }
    if (found) {
      this.error(
        `The destination has submissions of ${form.title || form._id} in ${misnamed}, where the server never ` +
        `reads them. They are cloned to ${destCollection}; ${misnamed} can be dropped once that is done.`
      );
    }
  }

  /**
   * Connnect to a mongodb database.
   * @param {*} uri - The uri to connect to.
   * @param {*} type - The type of database to connect to.
   * @returns - A promise that resolves to an object with all database collections.
   */
  async connectDb(uri, type) {
    try {
      console.log(`Connecting to ${redact(uri)}\n`);
      const client = new MongoClient(uri, this.dbConfig(type));
      await client.connect();
      const db = await client.db();
      console.log(`Succesfully connected to ${redact(uri)}`);
      return {
        client,
        db,
        projects: db.collection('projects'),
        forms: db.collection('forms'),
        ogSubmissions: db.collection('submissions'),
        submissions: db.collection('submissions'),
        ogSubmissionRevisions: db.collection('submissionrevisions'),
        submissionrevisions: db.collection('submissionrevisions'),
        roles: db.collection('roles'),
        actions: db.collection('actions'),
        actionItems: db.collection('actionitems'),
        formrevisions: db.collection('formrevisions'),
        tags: db.collection('tags')
      };
    }
    catch (err) {
      throw new Error(`Could not connect to database ${redact(uri)}: ${err.message}`, {cause: err});
    }
  }

  /**
   * Based on DB collection name defines the API endpoint path.
   * @param {*} collection - DB collection name.
   */
  getApiPath(collection) {
    switch (collection) {
    case 'projects':
      return `${this.src}`;

    case 'roles':
      return `${this.src}/role`;

    case 'formrevisions':
      return `${this.src}/form/${this.currentForm._id}/v`;

    case 'tags':
      return `${this.src}/tag`;

    case 'forms':
      return `${this.src}/form`;

    case 'submissions':
      return `${this.src}/form/${this.currentForm._id}/submission`;

    case 'actions':
      return `${this.src}/form/${this.currentForm._id}/action`;

    case 'submissionrevisions':
      return `${this.src}/form/${this.currentForm._id}/submission/${this.currentSubmission._id}/v`;

    default:
      throw new Error(`Unknown collection ${collection}`);
    }
  }

  /**
   * Based on DB collection name, DB query and skip parameter creates the URL for request.
   * @param {String} collection - DB collection name.
   * @param {Object} query - DB query object.
   * @param {Number} skip - skip URL parameter.
   */
  getRequestUrl(collection, query, skip) {
    if (collection === 'projects') {
      return this.getApiPath(collection);
    }

    const url = `${this.getApiPath(collection)}?limit=${this.limit}&skip=${skip}`;

    if (collection === 'submissions' && query.created && query.created.$gt) {
      return `${url}&created__gt=${this.convertToDate(query.created.$gt).getTime()}`;
    }

    return url;
  }

  /**
   * Does a request to the API, returns response data in Array format.
   * @param {String} collection - DB collection name.
   * @param {Object} query - DB query object.
   * @param {Number} skip - skip URL parameter.
   * @returns {Array}
   */
  async fetchRecordsFromApi(collection, query, skip) {
    const res = await this.fetch({
      url: this.getRequestUrl(collection, query, skip),
      method: 'GET',
      headers: this.requestHeaders
    });

    // A 416 means the API has already returned every existing record.
    if (!res.ok && res.status === 416) {
      return [];
    }
    if (!res.ok) {
      const url = this.getRequestUrl(collection, query, skip);
      const error = new Error(`HTTP Error: ${res.status} ${res.statusText || ''} ${url}\n${JSON.stringify(res.body)}`);

      // Failing to read from the source is not a per document problem: carrying on would silently
      // clone an incomplete project.
      error.fatal = true;
      throw error;
    }
    return Array.isArray(res.body) ? res.body : [res.body];
  }

  /**
   * Gets records from the API and passes them to callback function.
   * @param {String} collection - DB collection name.
   * @param {Object} query - DB query object.
   * @param {Function} cb - Callback to which each fetched record is passed.
   * @returns {Array}
   */
  async cloneFromApi(collection, query, cb, options = {}) {
    let skip = 0;
    let previousPage = null;

    // The API does not say how many records there are, so its progress is a running count.
    const progress = await this.startProgress(options.label);
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const records = await this.fetchRecordsFromApi(collection, query, skip);

      if (!records || !records.length) {
        break;
      }

      // Guard against an endpoint that hands back the same page no matter what we skip.
      const last = records.length - 1;
      const page = `${records.length}:${_.get(records, '0._id', '')}:${_.get(records, `${last}._id`, '')}`;
      if (page === previousPage) {
        this.error(`The ${collection} endpoint ignored the skip parameter, stopping after ${skip} records.`);
        break;
      }
      previousPage = page;

      for (const record of records) {
        // eslint-disable-next-line callback-return
        await cb(record);
        this.tick(progress);
      }

      // Fetch only one project
      if (collection === 'projects') {
        break;
      }

      // A short page does NOT mean the end: servers are free to cap the page size below the limit
      // that was asked for. Paging stops on an empty page, a 416, or a repeated page.
      skip += records.length;
    }
    this.endProgress(progress);
  }

  async connect() {
    if (!this.srcPath) {
      throw new Error('Source should be provided.');
    }

    if (this.srcPath === this.mongoDest) {
      throw new Error('Source and destination databases cannot be the same.');
    }

    this.src = this.options.apiSource
      ? this.srcPath
      : await this.connectDb(this.srcPath, 'src');

    // If there are no source projects, then we can assume we are cloning from OSS.
    this.oss = this.options.apiSource ? false : !(await this.src.projects.findOne({}));

    // Connect to the destination databases.
    if (this.mongoDest) {
      this.dest = await this.connectDb(this.mongoDest, 'dst');
    }
  }

  /**
   * Disconnect the database connections.
   */
  async disconnect() {
    // Disconnect from the source and destination databases. Either of them may not have been
    // connected when the clone failed early.
    if (!this.options.apiSource && _.get(this, 'src.client')) {
      await this.src.client.close();
      this.src.client = null;
    }
    if (_.get(this, 'dest.client')) {
      await this.dest.client.close();
      this.dest.client = null;
    }
  }

  /**
   * Migrate the data encrypted within a submission to a new secret.
   * @param {*} src - The source record
   * @param {*} update - The updated record
   * @param {object[]|null} encryptedComponents - The components of the form, when it has encrypted ones.
   */
  migrateDataEncryption(src, update, encryptedComponents) {
    const srcSecret = this.srcSecret || this.options.srcDbSecret;
    const destSecret = this.dstSecret || this.options.dstDbSecret;
    if (
      !encryptedComponents ||
      !srcSecret ||
      !destSecret ||
      srcSecret === destSecret
    ) {
      return;
    }

    // The values are collected first: the update can share its data with the source.
    const values = [];
    encryption.eachEncryptedValue(encryptedComponents, src.data, (value, path) => values.push({value, path}));
    values.forEach(({value, path}) => {
      const decrypted = this.decrypt(srcSecret, value);

      // A value that decrypts to 0, false or an empty string is still a value: only a decrypt
      // that actually failed comes back as null.
      const reEncrypted = (decrypted === null || decrypted === undefined)
        ? null
        : this.encrypt(destSecret, decrypted);
      if (!reEncrypted) {
        // Leave the value as it is rather than destroying it: it can still be read with the
        // secret it was encrypted with.
        this.error(`Could not re-encrypt ${path.join('.')} of submission ${src._id}, it was left as it is.`);
        return;
      }
      _.set(update, ['data', ...path], reEncrypted);
    });
  }

  /**
   * Clone submissions from one form to another.
   * @param {*} srcForm - The source form from the database.
   * @param {*} destForm - The destination from from the database.
   * @param {object[]|null} encryptedComponents - The components of the form, when it has encrypted ones.
   */
  async cloneSubmissions(srcForm, destForm, encryptedComponents) {
    // A dry run reports on every submission of the form, not only the ones a clone would write, so
    // it checks the destination for each of them and does not start from the last one cloned.
    const compareAll = this.options.updateExistingSubmissions || this.dryRun;

    // Determine the last one cloned, and ensure that we only fetch submissions after that date.
    const lastSubmission = compareAll ? null : await this.findLast('dest.submissions', {
      form: destForm._id,
      project: destForm.project
    });

    // Submissions always "create new" so we need to ensure we only clone the ones that have not yet been cloned.
    const query = this.afterQuery({
      form: srcForm._id,
      project: srcForm.project
    },
    lastSubmission && lastSubmission.created
      ? this.convertToDate(lastSubmission.created).getTime()
      : null
    );

    // Clone the submissions.
    await this.upsertAll('submissions', query, null, async(src, update) => {
      update.form = destForm._id;
      update.project = destForm.project;
      this.migrateDataEncryption(src, update, encryptedComponents);
      if (update.roles) {
        // Only the source roles are mapped: a submission without roles must not have the roles of
        // the destination document wiped, which are no longer fetched.
        update.roles = this.migrateRoles(update.roles);
      }
      this.migrateAccess(src.access, update.access);
    }, async(srcSubmission, destSubmission) => {
      this.currentSubmission = srcSubmission;
      await this.cloneSubmissionRevisions(srcSubmission, destSubmission, encryptedComponents);
    }, {
      find: compareAll ? null : false,
      scope: srcForm._id.toString(),
      label: '      - Submissions:',
      count: true
    });

    if (this.dryRun && this.options.extra) {
      if (this.options.apiSource) {
        this.error('--extra cannot be used with --api-source: the source cannot be queried by id.');
      }
      else {
        await this.reportExtraSubmissions(srcForm, destForm);
      }
    }
  }

  /**
   * Clone submission revisions from one database to another.
   * @param {*} srcSubmission - The source submission.
   * @param {*} destSubmission - The destination submission.
   */
  async cloneSubmissionRevisions(srcSubmission, destSubmission, encryptedComponents) {
    if (!this.options.includeSubmissionRevisions) {
      return;
    }
    await this.upsertAll('submissionrevisions', this.afterQuery({
      _rid: srcSubmission._id
    }), null, async(src, update) => {
      update._rid = destSubmission._id;
      this.migrateDataEncryption(src, update, encryptedComponents);
    }, null, {
      scope: srcSubmission._id.toString(),

      // This runs once for every submission: flushing each time would write one batch per
      // submission. The revisions are written with the batches of the submissions instead.
      deferFlush: true
    });
  }

  /**
   * Provided the source role id, and the destination project, this will return the equivalent destination role id.
   * @param {ObjectId|string} srcId - The source resource id.
   * @param {ObjectId|string} destProjectId - The destination project id.
   */
  async getDestinationRoleId(srcId, destProjectId) {
    if (this.roleMap && this.roleMap.has(srcId.toString())) {
      return this.roleMap.get(srcId.toString());
    }
    let role;

    if (this.options.apiSource) {
      const roleRes = await this.fetch({
        url: `${this.src}/role/${srcId.toString()}`,
        headers: this.requestHeaders
      });

      if (roleRes.ok) {
        role = roleRes.body;
      }
      else {
        // Keep the role as it is rather than wiping it from the action.
        this.error(`Failed to fetch role: ${roleRes.status} ${roleRes.statusText} ${roleRes.url}`);
        return srcId.toString();
      }
    }
    const srcRole = this.options.apiSource && role
      ? role
      : await this.src.roles.findOne({_id: this.convertToObjectId(srcId)});

    if (srcRole) {
      // eslint-disable-next-line max-len
      const destRole = await this.dest.roles.findOne({title: srcRole.title, project: new ObjectId(destProjectId.toString())});
      if (destRole) {
        return destRole._id.toString();
      }
    }
    return srcId.toString();
  }

  /**
   * Clone actions from one form to another.
   * @param {*} srcForm - The source form to clone actions from.
   * @param {*} destForm - The destination form to clone actions to.
   */
  async cloneActions(srcForm, destForm) {
    await this.upsertAll('actions', this.itemQuery({
      form: srcForm._id
    }), null, async(src, update) => {
      update.form = destForm._id;
      if (!update.settings) {
        return;
      }
      if (update.settings.role) {
        const srcId = update.settings.role;
        update.settings.role = await this.getDestinationRoleId(srcId, destForm.project);
      }
    }, null, {
      find: (current) => {
        return {$or: [{_id: current._id}, {machineName: current.machineName}]};
      },
      scope: srcForm._id.toString(),
      label: '      - Actions:'
    });
  }

  /**
   * Clone forms from one project to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   */
  async cloneForms(srcProject, destProject) {
    let encryptedComponents = null;
    const query = this.formQuery(srcProject);
    const total = this.dryRun ? null : await this.countSource('src.forms', query, POSITION_COUNT_TIMEOUT);
    let position = 0;
    await this.upsertAll('forms', query, (form) => {
      position++;
      this.status(`\n   - Form: ${form.title} (${form._id})${this.position(position, total)}`);
      if (this.dryRun) {
        this.dryRunForm = {
          created: this.dryRunTotals.Created || 0,
          updated: this.dryRunTotals.Updated || 0,
          extra: this.dryRunTotals.Extra || 0
        };
        process.stdout.write(`  ${form.path || form.name} (${form._id})\n`);
      }
    }, async(src, update, dest) => {
      // This mapping runs for every source form, including the ones that are not written to the
      // destination (--submissions-only, or a form that has not changed), because the submissions
      // of the form are cloned using these values.
      encryptedComponents = encryption.hasEncryptedComponents(update.components) ? update.components : null;

      await this.setCollection(update, srcProject, destProject);
      if (destProject) {
        update.project = destProject._id;
      }
      this.migrateFormAccess(src, update);
    }, async(srcForm, destForm) => {
      if (this.options.deleteSubmissions && !this.dryRun) {
        await this.flushWrites();
        console.log(`Deleting submissions from ${destForm.title}`);
        await this.dest.submissions.deleteMany(this.itemQuery({
          project: destForm.project,
          form: destForm._id
        }));
      }
      this.currentForm = srcForm;
      await this.flushWrites();
      await this.cloneSubmissions(srcForm, destForm, encryptedComponents);
      await this.cloneActions(srcForm, destForm);
      await this.cloneFormRevisions(srcForm, destForm);
      await this.flushWrites();

      // Write out what was found for this form before its summary line.
      if (this.dryRun) {
        await this.flushDryRun();
        this.reportDryRunForm();
      }
    }, {scope: _.get(srcProject, '_id', 'oss').toString()});
  }

  async cloneRoles(srcProject, destProject) {
    await this.upsertAll('roles', this.projectQuery(srcProject), null, (src, update) => {
      update.project = destProject._id;
    }, null, {
      find: (current) => {
        return {
          project: destProject._id,
          _id: current._id,
          title: current.title
        };
      },
      scope: _.get(srcProject, '_id', 'oss').toString(),
      label: '   - Roles:'
    });
  }

  async cloneTags(srcProject, destProject) {
    await this.upsertAll('tags', this.projectQuery(srcProject), null, (src, update) => {
      update.project = destProject._id;
    }, null, {scope: _.get(srcProject, '_id', 'oss').toString(), label: '   - Tags:'});
  }

  async cloneFormRevisions(srcForm, destForm) {
    if (!this.options.includeFormRevisions) {
      return;
    }
    await this.upsertAll('formrevisions', this.afterQuery({
      _rid: srcForm._id,
      project: srcForm.project
    }), null, (src, update, dest) => {
      // If the revision already exists in the destination, don't upsert it
      if (dest) {
        return false;
      }
      update._rid = destForm._id;
      update.project = destForm.project;
    }, null, {scope: srcForm._id.toString(), label: '      - Revisions:', count: true});
  }

  /**
   * Build a lookup of source role id to destination role id, so that migrating the roles of a
   * submission does not scan the role arrays for every single role of every single document.
   */
  buildRoleMap() {
    this.roleMap = new Map();
    const destByTitle = new Map();
    (this.destRoles || []).forEach((role) => {
      // The first role of a title wins, which is the role the destination project already had.
      if (!destByTitle.has(role.title)) {
        destByTitle.set(role.title, role._id);
      }
    });
    (this.srcRoles || []).forEach((srcRole) => {
      const destId = destByTitle.get(srcRole.title);
      if (destId) {
        this.roleMap.set(srcRole._id.toString(), destId.toString());
      }
    });
  }

  destRole(roleId) {
    const destId = this.roleMap ? this.roleMap.get(roleId.toString()) : null;
    return new ObjectId(destId || roleId.toString());
  }

  /**
   * Migrate a roles array to use destination roles instead of source roles.
   * @param {*} roles - An array of role ids that need to be migrated.
   */
  migrateRoles(roles) {
    if (!Array.isArray(roles) || !roles.length) {
      return [];
    }
    // An empty entry is not a role: it is dropped rather than failing the whole document.
    return roles.filter((roleId) => roleId).map((roleId) => this.destRole(roleId));
  }

  /**
   * Migrate access array to use destination roles instead of source roles.
   * @param {*} access - An access array.
   */
  migrateAccess(srcAccess, dstAccess) {
    if (!Array.isArray(dstAccess)) {
      // Nothing to merge into: a document that has no access array is valid data.
      return;
    }
    if (Array.isArray(srcAccess) && srcAccess.length) {
      srcAccess.forEach((roleAccess) => {
        if (!roleAccess) {
          return;
        }
        if (!roleAccess.type || String(roleAccess.type).indexOf('team_') === -1) {
          const existing = dstAccess.find((access) => access && access.type === roleAccess.type);
          if (existing) {
            existing.roles = this.migrateRoles(roleAccess.roles);
          }
          else {
            dstAccess.push(_.assign({}, roleAccess, {roles: this.migrateRoles(roleAccess.roles)}));
          }
        }
      });
    }
  }

  /**
   * Migrate the form access to use destination roles instead of source roles.
   * @param {*} item
   */
  migrateFormAccess(src, dest) {
    if (!src || !dest) {
      return;
    }
    if (src.access && !Array.isArray(dest.access)) {
      dest.access = [];
    }
    if (src.submissionAccess && !Array.isArray(dest.submissionAccess)) {
      dest.submissionAccess = [];
    }
    this.migrateAccess(src.access, dest.access);
    this.migrateAccess(src.submissionAccess, dest.submissionAccess);
  }

  /**
   * Migrate the project settings from one project encryption to another.
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   */
  async migrateSettings(src, update, dest) {
    if (!this.settingsNeedMigration(src)) {
      // Both databases share a secret (or there is nothing encrypted): the settings are copied as
      // they are.
      return true;
    }
    const decryptedSrcSettings = this.loadProjectSecrets(src, dest);

    // Never overwrite the settings the destination project already has.
    if (dest && dest['settings_encrypted']) {
      update['settings_encrypted'] = dest['settings_encrypted'];
      return true;
    }

    // Copying settings that could not be decrypted would hand the destination settings it can
    // never read, so they are left out. A project that is not in the destination yet is not
    // created without them: it is reported, and can be cloned once the secret is corrected.
    delete update['settings_encrypted'];
    if (!decryptedSrcSettings) {
      return !!dest;
    }
    const reEncrypted = this.encrypt(this.options.dstDbSecret, decryptedSrcSettings, true);
    if (reEncrypted) {
      update['settings_encrypted'] = reEncrypted;
    }
    return true;
  }

  /**
   * Whether the settings of a project are encrypted with a secret the destination does not share.
   * @param {*} srcProject - The source project.
   */
  settingsNeedMigration(srcProject) {
    return !!(
      srcProject &&
      srcProject['settings_encrypted'] &&
      this.options.srcDbSecret &&
      this.options.dstDbSecret &&
      this.options.srcDbSecret !== this.options.dstDbSecret
    );
  }

  /**
   * Decrypt the project settings of the source and destination projects so that the per project
   * secrets are known. Those secrets, and not the database secrets, are what encrypted submission
   * data is encrypted with.
   *
   * @param {*} srcProject - The source project.
   * @param {*} destProject - The destination project.
   * @returns {object|null} - The decrypted source settings, or null when they cannot be migrated.
   */
  loadProjectSecrets(srcProject, destProject) {
    if (!this.settingsNeedMigration(srcProject)) {
      return null;
    }

    // A destination project without settings has no secret of its own yet.
    const decryptedDstSettings = (destProject && destProject['settings_encrypted'])
      ? this.decrypt(this.options.dstDbSecret, destProject['settings_encrypted'], true)
      : {};
    if (!decryptedDstSettings) {
      this.reportUndecryptable('destination', destProject, '--dst-db-secret');
      return null;
    }
    if (decryptedDstSettings.secret) {
      this.dstSecret = decryptedDstSettings.secret;
    }
    const decryptedSrcSettings = this.decrypt(this.options.srcDbSecret, srcProject['settings_encrypted'], true);
    if (!decryptedSrcSettings) {
      this.reportUndecryptable('source', srcProject, '--src-db-secret');
      return null;
    }
    if (decryptedSrcSettings.secret) {
      this.srcSecret = decryptedSrcSettings.secret;
    }
    return decryptedSrcSettings;
  }

  /**
   * Report, once per project, settings that could not be decrypted. Encrypted submission data of
   * that project cannot be migrated, so the clone does not report success.
   *
   * @param {string} side - Either "source" or "destination".
   * @param {*} item - The project.
   * @param {string} option - The option holding the secret that did not work.
   */
  reportUndecryptable(side, item, option) {
    const key = `${side}:${item._id}`;
    if (this.undecryptable.has(key)) {
      return;
    }
    this.undecryptable.add(key);
    this.error(
      `The settings of the ${side} project ${_.get(item, 'name', item._id)} could not be decrypted. ` +
      `Check the ${option}.`
    );
  }

  /**
   * Close all items within a project.
   * @param {*} srcProject - The source project
   * @param {*} destProject - The destination project.
   */
  async cloneProjectItems(srcProject, destProject, destinationExisted = true) {
    if (!destProject) {
      throw new Error('Destination project not found for this cloning operation.');
    }
    await this.cloneRoles(srcProject, destProject);

    let roles;

    if (this.options.apiSource) {
      const rolesRes = await this.fetch({
        url: `${this.src}/role`,
        headers: this.requestHeaders
      });

      if (rolesRes.ok) {
        roles = rolesRes.body;
      }
      else {
        // Without the roles nothing below can be mapped: cloning the rest would quietly produce a
        // project whose forms and submissions point at roles that do not exist.
        const error = new Error(
          `Failed to fetch project roles: ${rolesRes.status} ${rolesRes.statusText || ''} ${this.src}/role`
        );
        error.fatal = true;
        throw error;
      }
    }

    this.srcRoles = this.options.apiSource && roles
      ? roles
      : await this.src.roles.find(srcProject ? {project: srcProject._id} : {}).toArray();
    this.destRoles = await this.dest.roles.find({project: destProject._id}).toArray();
    this.buildRoleMap();

    // Load the project secrets so that encrypted submission data can be migrated, even when we are
    // cloning into an existing destination project and never upsert the project itself.
    await this.loadProjectSecrets(srcProject, destProject);

    if (srcProject && destProject) {
      this.migrateFormAccess(srcProject, destProject);

      // The access is migrated here because it can only be mapped once the roles exist. A project
      // that was just created still needs it; --no-update-existing only protects what was already
      // in the destination.
      if (!this.dryRun && (this.updateExisting || !destinationExisted)) {
        await this.dest.projects.updateOne(
          {_id: destProject._id},
          {$set: {access: destProject.access}}
        );
      }
    }
    await this.cloneForms(srcProject, destProject);
    await this.flushWrites();
  }

  /**
   * Tell them when a project they asked for is not in the source at all, which would otherwise look
   * like a clone that simply found nothing to do.
   */
  async warnAboutMissingProjects() {
    const sourceProject = this.sourceProject;
    if (!sourceProject || this.options.apiSource) {
      return;
    }
    const asked = idList(sourceProject);
    const found = await this.src.projects
      .find({_id: {$in: asked.map((id) => new ObjectId(id))}})
      .project({_id: 1}).toArray();
    const here = new Set(found.map((project) => project._id.toString()));
    const absent = asked.filter((id) => !here.has(id));
    if (absent.length) {
      this.error(`${absent.length} of the ${asked.length} projects asked for are not in the source:`);
      absent.forEach((id) => this.error(`  ${id}`));
    }
  }

  /**
   * Validate the combination of project options before any work is done.
   */
  validateOptions() {
    const sourceProject = this.sourceProject;
    const sourceProjects = idList(sourceProject);
    if (sourceProject && !sourceProjects.length) {
      throw new Error(`Invalid source project id provided: ${sourceProject}`);
    }
    sourceProjects.forEach((id) => {
      if (!ObjectId.isValid(id)) {
        throw new Error(`Invalid source project id provided: ${id}`);
      }
    });
    idList(this.options.forms).forEach((id) => {
      if (!ObjectId.isValid(id)) {
        throw new Error(`Invalid form id provided: ${id}`);
      }
    });
    if (this.options.dstProject && !ObjectId.isValid(this.options.dstProject)) {
      throw new Error(`Invalid destination project id provided: ${this.options.dstProject}`);
    }
    if (this.options.dstProject && sourceProjects.length > 1) {
      throw new Error(
        'Only one source project can be cloned into a single destination project. ' +
        'Provide a single --src-project, or clone without a --dst-project.'
      );
    }
    if (this.oss && this.options.srcProject) {
      // Note that --project is not checked here: it names the destination project as well, and is
      // how an OSS database is cloned into a project.
      throw new Error(
        'The source is an open source (OSS) database, which has no projects: ' +
        '--src-project cannot be used with it.'
      );
    }
  }

  /**
   * Fetch the source project of a clone that targets a single destination project.
   */
  async sourceProjectItem() {
    if (this.options.apiSource) {
      // The source url names the project, so it does not have to be given with --src-project.
      return await this.fetchApiProject();
    }
    if (!this.sourceProject) {
      // An OSS source has no project to clone from.
      return null;
    }
    return await this.src.projects.findOne(this.itemQuery({_id: new ObjectId(idList(this.sourceProject)[0])}));
  }

  /**
   * Fetch the project being cloned from an API source.
   */
  async fetchApiProject() {
    const res = await this.fetch({
      url: `${this.src}`,
      headers: this.requestHeaders
    });
    if (!res.ok) {
      throw new Error(`Failed to fetch the source project: ${res.status} ${res.statusText || ''} ${this.src}`);
    }
    const project = Array.isArray(res.body) ? res.body[0] : res.body;
    if (project && project._id) {
      project._id = this.convertToObjectId(project._id);
    }
    return project;
  }

  /**
   * Clone the project from one database to another.
   */
  async cloneProject() {
    this.status('\nFetching formio project owner.');
    await this.warnAboutMissingProjects();
    const formioProject = await this.dest.projects.findOne({name: 'formio'});
    const formioOwner = formioProject ? formioProject.owner : null;
    const query = this.projectQuery();
    const total = this.dryRun
      ? null
      : await this.countSource('src.projects', {...query, name: {$ne: 'formio'}}, POSITION_COUNT_TIMEOUT);
    let position = 0;
    await this.upsertAll('projects', query, (project) => {
      if (project.name === 'formio') {
        return false;
      }
      position++;
      this.status(`\n- Project ${project.title}:${this.position(position, total)}`);
      if (this.dryRun) {
        process.stdout.write(`project ${project.name} (${project._id})\n`);
      }
    }, async(src, update, dest) => {
      // Do not update if they provide a destination project or we are the "formio" project.
      if (src.name === 'formio') {
        return false;
      }

      if (formioOwner) {
        update.owner = formioOwner;
      }

      // Migrate the settings.
      this.srcSecret = null;
      this.dstSecret = null;
      if (!(await this.migrateSettings(src, update, dest))) {
        this.error(`Project ${src.name} was not cloned because its settings could not be decrypted.`);
        this.skippedProjects.add(src._id.toString());
        return false;
      }

      // Keep the access settings.
      update.access = dest ? dest.access : [];
    }, async(src, dest, existing) => {
      if (src.name === 'formio' || this.skippedProjects.has(src._id.toString())) {
        return;
      }

      await this.cloneProjectItems(src, dest, !!existing);
      await this.cloneTags(src, dest);
    });
  }

  /**
   * Clone a number of projects from one database to another.
   */
  async clone(beforeAll = null, afterAll = null) {
    this.beforeAll = beforeAll;
    this.afterAll = afterAll;

    // This instance may have been destroyed by a previous clone: make sure an interruption is
    // still saved.
    this.listen();

    // Connect to the source and destination.
    await this.connect();
    try {
      await this.cloneAll();
    }
    finally {
      // However this ended, the resume point is saved and the connections are not left open. The
      // exit handler cannot do it: it is removed by destroy() below.
      this.saveCloneState();
      if (process.env.TEST_SUITE !== '1') {
        await this.disconnect();
      }
      this.destroy();
    }

    const failures = this.failures;
    if (failures) {
      throw new Error(
        `The clone did not complete: ${failures}. ` +
        'The clone state was kept, so the clone can be run again to retry them.'
      );
    }
  }

  /**
   * Clone everything the options ask for, once the connections are open.
   */
  async cloneAll() {
    this.validateOptions();

    // If they wish to clone into an existing destination project, then do that. An API source
    // without a destination project still clones the project it is given.
    const intoProject = this.options.dstProject ||
      (!this.options.apiSource && (this.options.submissionsOnly || this.oss));
    if (intoProject) {
      process.stdout.write('\n');
      process.stdout.write(`Cloning forms and submissions of ${this.sourceProject} to ${this.destProject}.`);
      process.stdout.write('\n');
      if (!this.destProject) {
        throw new Error('You must provide a destination project id.');
      }
      await this.cloneProjectItems(
        await this.sourceProjectItem(),
        await this.dest.projects.findOne(this.itemQuery({_id: new ObjectId(this.destProject)}))
      );
    }
    else {
      await this.cloneProject();
    }
    await this.flushWrites();
    if (this.dryRun) {
      await this.flushDryRun();
    }
    else if (this.writeFailures || this.documentFailures) {
      // Keep the state so the clone can be retried from the last document that was written.
      this.saveCloneState();
    }
    else {
      // Everything was cloned, so there is nothing left to resume: that includes resume points a
      // previous clone left behind for anything this one did not walk.
      this.cloneState = {};
      this.persistCloneState();
    }

    process.stdout.write('\n');
    if (!this.failures) {
      console.log('Done!');
    }
    if (this.dryRun) {
      console.log('Dry run complete. No changes were made to the destination.');
      console.log(`  missing from the destination : ${this.dryRunTotals.Created || 0}`);
      console.log(`  out of date                  : ${this.dryRunTotals.Updated || 0}`);
      if (this.options.extra) {
        console.log(`  only in the destination      : ${this.dryRunTotals.Extra || 0}`);
      }
    }
  }
}

module.exports = Cloner;
