'use strict';
const {MongoClient, ObjectId} = require('mongodb');
const _ = require('lodash');
const Progress = require('./Progress');
const {
  redact,
  tlsOptions,
  submissionCollectionName,
  legacySubmissionCollectionName,
  idList
} = require('./db');
const {encrypt, decrypt, eachEncryptedValue, hasEncryptedComponents} = require('./encryption');

const SETTINGS = 'settings_encrypted';

// How long, at most, counting the documents behind a progress bar may take.
const COUNT_TIMEOUT = 10000;

// How many of the values that could not be decrypted are listed one by one, per collection.
const MAX_LISTED = 20;

/**
 * Re-encrypt the project settings and the encrypted submission data of a database with a new
 * DB_SECRET.
 *
 * The project settings are encrypted with the DB_SECRET. The encrypted submission data is encrypted
 * with the secret of its project (the "secret" of the project settings) or, when the project has
 * none, with the DB_SECRET. Every value is first tried with the secret it should be encrypted with:
 * the ones that already are are left alone, so this can be run again, as often as needed, until
 * nothing is left to re-key. The others are tried with each of the old secrets, re-encrypted, and
 * only written once the new value has been read back. A value none of the secrets can read is
 * reported and left as it is.
 */
class Rekeyer {
  /**
   * @param {string} mongoUrl - The connection string of the database.
   * @param {object} options - The options.
   * @param {string} options.newDbSecret - The DB_SECRET everything should be encrypted with.
   * @param {string|string[]} options.oldDbSecret - The secrets things may currently be encrypted with.
   * @param {string} options.project - A comma separated list of the projects to re-key (all by default).
   * @param {boolean} options.dryRun - Change nothing, only report what would be re-keyed.
   * @param {number} options.batchSize - The number of documents written at a time (defaults to 1000).
   * @param {boolean} options.submissionRevisions - Re-key the submission revisions too (defaults to true).
   * @param {string} options.ca - The TLS certificate authority file.
   * @param {string} options.cert - The TLS certificate key file.
   */
  constructor(mongoUrl, options = {}) {
    this.mongoUrl = mongoUrl;
    this.options = options;
    this.newSecret = options.newDbSecret;
    this.oldSecrets = _.uniq([].concat(options.oldDbSecret || []).filter((secret) => secret));
    this.projectIds = idList(options.project);
    this.dryRun = !!options.dryRun;
    this.batchSize = Math.max(parseInt(options.batchSize, 10) || 1000, 1);
    this.includeRevisions = options.submissionRevisions !== false;
    this.interactive = (typeof options.interactive === 'boolean')
      ? options.interactive
      : !!process.stdout.isTTY;
    this.activeProgress = null;
    this.client = null;
    this.db = null;
    this.totals = {
      settings: {rekeyed: 0, current: 0, undecryptable: 0},
      values: {rekeyed: 0, current: 0, undecryptable: 0},
      skippedProjects: 0,
      conflicts: 0,
      writeFailures: 0
    };
  }

  /**
   * Make sure the options make sense before anything is touched.
   */
  validate() {
    if (!this.mongoUrl) {
      throw new Error('The connection string of the database is required.');
    }
    if (!this.newSecret) {
      throw new Error('--new-db-secret is required.');
    }
    if (!this.oldSecrets.length) {
      throw new Error('At least one --old-db-secret is required.');
    }
    if (this.oldSecrets.includes(this.newSecret)) {
      throw new Error('The new secret is also given as an old secret.');
    }
    const invalid = this.projectIds.filter((id) => !ObjectId.isValid(id));
    if (invalid.length) {
      throw new Error(`Not a valid project id: ${invalid.join(', ')}`);
    }
  }

  /**
   * Write a line, without it ending up in the middle of a progress line.
   * @param {...*} args - What to write.
   */
  log(...args) {
    if (this.activeProgress) {
      this.activeProgress.interrupt();
    }
    console.log(...args);
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

  async connect() {
    try {
      this.log(`Connecting to ${redact(this.mongoUrl)}`);
      this.client = new MongoClient(this.mongoUrl, tlsOptions(this.options.ca, this.options.cert));
      await this.client.connect();
      this.db = this.client.db();
    }
    catch (err) {
      throw new Error(`Could not connect to database ${redact(this.mongoUrl)}: ${err.message}`, {cause: err});
    }
  }

  async disconnect() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }

  /**
   * Re-key everything the options ask for.
   */
  async rekey() {
    this.validate();
    await this.connect();
    try {
      if (this.dryRun) {
        this.log('Dry run: nothing will be changed.');
      }
      await this.rekeyProjects();
    }
    finally {
      await this.disconnect();
    }
    this.report();
    const failures = this.failures();
    if (failures.length) {
      throw new Error(`The re-key did not complete: ${failures.join(', ')}.`);
    }
  }

  /**
   * What kept the re-key from completing, if anything.
   * @returns {string[]} - The reasons.
   */
  failures() {
    const {settings, values, skippedProjects, conflicts, writeFailures} = this.totals;
    const failures = [];
    if (settings.undecryptable) {
      failures.push(`${settings.undecryptable} project(s) had settings none of the secrets could decrypt`);
    }
    if (skippedProjects) {
      failures.push(`${skippedProjects} project(s) were skipped`);
    }
    if (values.undecryptable) {
      failures.push(`${values.undecryptable} encrypted value(s) could not be decrypted with any of the secrets`);
    }
    if (conflicts) {
      failures.push(`${conflicts} document(s) changed while they were being re-keyed and were left as they are`);
    }
    if (writeFailures) {
      failures.push(`${writeFailures} document(s) could not be written`);
    }
    return failures;
  }

  /**
   * Write the totals.
   */
  report() {
    const {settings, values} = this.totals;
    const rekeyed = this.dryRun ? 'would be re-keyed' : 're-keyed';
    this.log('');
    this.log(this.dryRun ? 'Dry run complete. Nothing was changed.' : 'Done.');
    this.log('  Project settings');
    this.log(`    ${rekeyed.padEnd(28)}: ${settings.rekeyed}`);
    this.log(`    ${'already on the new secret'.padEnd(28)}: ${settings.current}`);
    this.log(`    ${'could not be decrypted'.padEnd(28)}: ${settings.undecryptable}`);
    this.log('  Encrypted submission values');
    this.log(`    ${rekeyed.padEnd(28)}: ${values.rekeyed}`);
    this.log(`    ${'already on the new secret'.padEnd(28)}: ${values.current}`);
    this.log(`    ${'could not be decrypted'.padEnd(28)}: ${values.undecryptable}`);
  }

  /**
   * Try to re-key a single encrypted value.
   *
   * @param {Buffer|Binary} cipher - The encrypted value.
   * @param {string} target - The secret the value should be encrypted with.
   * @param {string[]} candidates - The secrets the value may currently be encrypted with.
   * @param {boolean} nosalt - The value is encrypted without a salt, as the project settings are.
   * @returns {{status: string, value: *, cipher: Buffer}} - The status is "current" when the value is
   *          already encrypted with the target secret, "rekeyed" when it was re-encrypted into
   *          cipher, and "undecryptable" when none of the secrets could read it.
   */
  rekeyValue(cipher, target, candidates, nosalt = false) {
    const current = decrypt(target, cipher, nosalt);
    if (current !== null) {
      return {status: 'current', value: current};
    }
    for (const secret of candidates) {
      if (secret === target) {
        continue;
      }
      const value = decrypt(secret, cipher, nosalt);
      if (value === null) {
        continue;
      }
      const reEncrypted = encrypt(target, value, nosalt);

      // Never write a value that cannot be read back.
      if (!reEncrypted || !_.isEqual(decrypt(target, reEncrypted, nosalt), value)) {
        return {status: 'undecryptable'};
      }
      return {status: 'rekeyed', value, cipher: reEncrypted};
    }
    return {status: 'undecryptable'};
  }

  /**
   * Re-key every project the options ask for.
   */
  async rekeyProjects() {
    const query = this.projectIds.length
      ? {_id: {$in: this.projectIds.map((id) => new ObjectId(id))}}
      : {};
    if (this.projectIds.length) {
      const found = await this.db.collection('projects').countDocuments(query);
      if (found !== this.projectIds.length) {
        throw new Error(`Only ${found} of the ${this.projectIds.length} projects given were found.`);
      }
    }
    // Only the ids are listed up front: a cursor left idle while the submissions of a project are
    // re-keyed, which can take hours, is closed by the server before the next project is read.
    const ids = await this.idsOf(this.db.collection('projects'), query);
    for (const _id of ids) {
      const project = await this.db.collection('projects').findOne({_id});
      if (project) {
        await this.rekeyProject(project);
      }
    }
  }

  /**
   * Re-key the settings and the encrypted submission data of a project.
   * @param {object} project - The project.
   */
  async rekeyProject(project) {
    this.log(`\n- Project ${project.title || project.name} (${project._id})${project.deleted ? ' [deleted]' : ''}`);
    const settings = await this.rekeySettings(project);
    if (!settings) {
      this.totals.skippedProjects++;
      this.error('   Its submission data was skipped: the secret it is encrypted with is in those settings.');
      return;
    }

    // The data is encrypted with the secret of the project, or with the DB_SECRET when it has none.
    // Any of the other secrets may have been used by mistake, so all of them are tried.
    const target = settings.secret || this.newSecret;
    const candidates = _.uniq([...this.oldSecrets, this.newSecret, settings.secret])
      .filter((secret) => secret && secret !== target);

    const formIds = await this.idsOf(this.db.collection('forms'), {project: project._id});
    for (const _id of formIds) {
      const form = await this.db.collection('forms').findOne({_id});
      if (form && hasEncryptedComponents(form.components)) {
        await this.rekeyForm(project, form, target, candidates);
      }
    }
  }

  /**
   * The ids of the documents a query matches, in the order they were created.
   * @param {Collection} collection - The collection.
   * @param {object} query - The query.
   * @returns {ObjectId[]} - The ids.
   */
  async idsOf(collection, query) {
    const docs = await collection.find(query, {projection: {_id: 1}}).sort({created: 1, _id: 1}).toArray();
    return docs.map((doc) => doc._id);
  }

  /**
   * Re-key the settings of a project.
   * @param {object} project - The project.
   * @returns {object|null} - The decrypted settings, or null when they could not be re-keyed.
   */
  async rekeySettings(project) {
    if (!project[SETTINGS]) {
      return {};
    }
    const result = this.rekeyValue(project[SETTINGS], this.newSecret, this.oldSecrets, true);
    if (result.status === 'undecryptable') {
      this.totals.settings.undecryptable++;
      this.error('   Its settings could not be decrypted with any of the secrets, they were left as they are.');
      return null;
    }
    this.totals.settings[result.status]++;
    if (result.status === 'current') {
      this.log('   Settings: already on the new secret.');
      return result.value;
    }
    if (this.dryRun) {
      this.log('   Settings: would be re-keyed.');
      return result.value;
    }
    const written = await this.db.collection('projects').updateOne(
      {_id: project._id, [SETTINGS]: project[SETTINGS]},
      {$set: {[SETTINGS]: result.cipher}}
    );
    if (!written.matchedCount) {
      this.totals.settings.rekeyed--;
      this.totals.conflicts++;
      this.error('   Its settings changed while they were being re-keyed, they were left as they are.');
      return null;
    }
    this.log('   Settings: re-keyed.');
    return result.value;
  }

  /**
   * The name of the collection the submissions of a form are kept in, the way the server names it.
   * @param {object} project - The project.
   * @param {object} form - The form.
   */
  submissionCollection(project, form) {
    const collection = _.get(form, 'settings.collection');
    return (collection && submissionCollectionName(project.name, collection)) || 'submissions';
  }

  /**
   * Re-key the encrypted data of the submissions, and submission revisions, of a form.
   * @param {object} project - The project.
   * @param {object} form - The form.
   * @param {string} target - The secret the data should be encrypted with.
   * @param {string[]} candidates - The secrets the data may currently be encrypted with.
   */
  async rekeyForm(project, form, target, candidates) {
    this.log(`   - Form ${form.title || form.name} (${form._id})${form.deleted ? ' [deleted]' : ''}`);
    const collections = [this.submissionCollection(project, form)];

    // Earlier versions of the clone command named a custom collection after the unsanitized project
    // name, where the server never looks for them. Those submissions are re-keyed too, but they
    // still have to be moved to where the server reads them from.
    const custom = _.get(form, 'settings.collection');
    const unsanitized = custom ? legacySubmissionCollectionName(project.name, custom) : null;
    const misplaced = unsanitized && unsanitized !== collections[0] &&
      await this.count(this.db.collection(unsanitized), {form: form._id});
    if (misplaced) {
      this.error(
        `      Submissions of this form are in ${unsanitized}, but the server reads them from ${collections[0]}. ` +
        'They are re-keyed where they are.'
      );
      collections.push(unsanitized);
    }

    const query = {form: form._id};
    for (const collection of collections) {
      await this.rekeyCollection(collection, query, form.components, target, candidates, '      - Submissions:');
    }
    if (!this.includeRevisions) {
      return;
    }
    const revisions = collections.map((collection) => {
      return (collection === 'submissions') ? 'submissionrevisions' : `${collection}_revisions`;
    });

    // Earlier versions of the clone command also wrote the revisions of a custom collection to the
    // default revisions collection. The server never reads them there, but they are re-keyed all the
    // same, so that nothing is left on the old secret.
    if (custom && !revisions.includes('submissionrevisions') &&
      await this.db.collection('submissionrevisions').findOne(query, {projection: {_id: 1}})) {
      this.error(
        `      Revisions of this form are in submissionrevisions, but the server reads them from ${revisions[0]}. ` +
        'They are re-keyed where they are.'
      );
      revisions.push('submissionrevisions');
    }
    for (const collection of revisions) {
      await this.rekeyCollection(collection, query, form.components, target, candidates, '      - Revisions:');
    }
  }

  /**
   * Count the documents behind a progress bar, giving up when it takes too long.
   * @param {Collection} collection - The collection.
   * @param {object} query - The query.
   */
  async count(collection, query) {
    try {
      return await collection.countDocuments(query, {maxTimeMS: COUNT_TIMEOUT});
    }
    catch (err) {
      return null;
    }
  }

  /**
   * Re-key the encrypted data of the documents of a collection.
   * @param {string} name - The name of the collection.
   * @param {object} query - The documents to re-key.
   * @param {object[]} components - The components of the form the documents belong to.
   * @param {string} target - The secret the data should be encrypted with.
   * @param {string[]} candidates - The secrets the data may currently be encrypted with.
   * @param {string} label - The label of the progress.
   */
  async rekeyCollection(name, query, components, target, candidates, label) {
    const collection = this.db.collection(name);
    const total = await this.count(collection, query);
    if (total === 0) {
      return;
    }
    const progress = new Progress(label, {total, interactive: this.interactive});
    this.activeProgress = progress;
    const counts = {rekeyed: 0, current: 0, undecryptable: 0};
    let operations = [];

    // What could not be decrypted is listed once the progress line is done, never in the middle of it.
    const unreadable = [];

    const cursor = collection
      .find(query, {projection: {data: 1}})
      .sort({_id: 1})
      .batchSize(Math.min(this.batchSize, 1000));
    for await (const doc of cursor) {
      const filter = {_id: doc._id};
      const update = {};
      eachEncryptedValue(components, doc.data, (value, path) => {
        const result = this.rekeyValue(value, target, candidates);
        counts[result.status]++;
        const key = ['data', ...path].join('.');
        if (result.status === 'rekeyed') {
          // The old value is part of the filter, so that a value changed in the meantime is never
          // overwritten with one re-keyed from what it used to be.
          filter[key] = value;
          update[key] = result.cipher;
        }
        else if (result.status === 'undecryptable') {
          unreadable.push(`${key} of ${name} ${doc._id}`);
        }
      });
      if (!_.isEmpty(update)) {
        operations.push({updateOne: {filter, update: {$set: update}}});
      }
      if (operations.length >= this.batchSize) {
        await this.write(collection, operations);
        operations = [];
      }
      progress.tick();
    }
    await this.write(collection, operations);
    progress.done();
    this.activeProgress = null;
    Object.keys(counts).forEach((status) => {
      this.totals.values[status] += counts[status];
    });

    // Finishes the progress line.
    this.log(
      ` - ${counts.rekeyed} ${this.dryRun ? 'would be re-keyed' : 're-keyed'}, ` +
      `${counts.current} already on the new secret, ${counts.undecryptable} could not be decrypted`
    );
    unreadable.slice(0, MAX_LISTED).forEach((value) => {
      this.error(`         ${value} could not be decrypted with any of the secrets.`);
    });
    if (unreadable.length > MAX_LISTED) {
      this.error(`         ...and ${unreadable.length - MAX_LISTED} more.`);
    }
  }

  /**
   * Write a batch of re-keyed documents.
   * @param {Collection} collection - The collection.
   * @param {object[]} operations - The bulk write operations.
   */
  async write(collection, operations) {
    if (!operations.length || this.dryRun) {
      return;
    }
    let matched;
    let failed = 0;
    try {
      const result = await collection.bulkWrite(operations, {ordered: false});
      matched = result.matchedCount;
    }
    catch (err) {
      const writeErrors = [].concat(_.get(err, 'writeErrors', []));
      if (!err.result || !writeErrors.length) {
        throw err;
      }
      failed = writeErrors.length;
      matched = err.result.matchedCount;
      this.error(`Failed to write ${failed} document(s) of ${collection.collectionName}: ${writeErrors[0].errmsg}`);
    }
    this.totals.writeFailures += failed;

    // A document whose encrypted values changed since it was read no longer matches its filter.
    const conflicts = operations.length - matched - failed;
    if (conflicts > 0) {
      this.totals.conflicts += conflicts;
      this.error(
        `${conflicts} document(s) of ${collection.collectionName} changed while being re-keyed, ` +
        'run again to re-key them.'
      );
    }
  }
}

module.exports = Rekeyer;
