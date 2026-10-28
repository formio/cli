/* globals describe, it */
'use strict';
const assert = require('assert');
const {ObjectId} = require('mongodb');
const Cloner = require('../../src/Cloner');
const {encrypt, decrypt} = require('../../src/encryption');
const {quiet} = require('./helper');

/**
 * Build a cloner instance without touching the filesystem or any database.
 * @param {object} options - The options to assign to the instance.
 */
function bare(options = {}) {
  const instance = Object.create(Cloner.prototype);
  instance.options = options;
  instance.exclude = [];
  instance.dryRun = !!options.dryRun;
  instance.dryRunBuffer = [];
  instance.dryRunFlushSize = 1000;
  instance.dryRunTotals = {};
  instance.dryRunWatch = new Map();
  instance.completedState = new Set();
  instance.undecryptable = new Set();
  instance.skippedProjects = new Set();
  instance.documentFailures = 0;
  return instance;
}

describe('Cloner units', function() {
  describe('encrypt/decrypt', function() {
    it('Should produce the legacy OpenSSL compatible ciphertext', function() {
      // Generated with: printf '{"a":1}' | openssl enc -aes-256-cbc -nosalt -md md5 -pass pass:mysecret -base64
      // which is the exact format the removed crypto.createCipher() produced.
      const encrypted = encrypt('mysecret', {a: 1}, true);
      assert.equal(encrypted.toString('base64'), 'aqN/mkNcqrTMql3ObHRt6Q==');
    });

    it('Should read the secret as UTF-8, the way createCipher did', function() {
      // printf '{"a":1}' | openssl enc -aes-256-cbc -nosalt -md md5 -pass pass:sécret -base64
      // Reading the secret as latin1 instead derives a different key, and nothing encrypted with a
      // non ASCII secret could be decrypted again.
      const encrypted = encrypt('sécret', {a: 1}, true);
      assert.equal(encrypted.toString('base64'), 's332i21yTmVluklx2eqRaA==');
      assert.deepEqual(decrypt('sécret', encrypted, true), {a: 1});
    });

    it('Should decrypt legacy ciphertext', function() {
      const buffer = Buffer.from('aqN/mkNcqrTMql3ObHRt6Q==', 'base64');
      assert.deepEqual(decrypt('mysecret', buffer, true), {a: 1});
    });

    it('Should round trip salted data', function() {
      const encrypted = encrypt('a-secret', {ssn: '123-45-6789'});
      assert.deepEqual(decrypt('a-secret', encrypted), {ssn: '123-45-6789'});
    });

    it('Should round trip a binary buffer wrapper', function() {
      const encrypted = encrypt('a-secret', 'plain value');
      assert.equal(decrypt('a-secret', {buffer: encrypted}), 'plain value');
    });

    it('Should encrypt values that are falsy but real', function() {
      for (const value of [0, false, '']) {
        const encrypted = encrypt('a-secret', value);
        assert.ok(encrypted, `${JSON.stringify(value)} is a value and must be encrypted.`);
        assert.deepEqual(decrypt('a-secret', encrypted), value);
      }
    });

    it('Should return null when a secret or payload is missing', function() {
      assert.equal(encrypt('', {a: 1}), null);
      assert.equal(encrypt('secret', null), null);
      assert.equal(decrypt('', Buffer.from('x')), null);
      assert.equal(decrypt('secret', null), null);
    });

    it('Should return null when decrypting with the wrong secret', function() {
      const encrypted = encrypt('right-secret', {a: 1}, true);
      assert.equal(decrypt('wrong-secret', encrypted, true), null);
    });
  });

  describe('migrateDataEncryption', function() {
    it('Should re-encrypt values an API returned as JSON', function() {
      const instance = bare({srcDbSecret: 'source', dstDbSecret: 'destination'});
      const src = {_id: 'a', data: JSON.parse(JSON.stringify({ssn: encrypt('source', '123-45-6789')}))};
      const update = {data: Object.assign({}, src.data)};
      instance.migrateDataEncryption(src, update, [{type: 'textfield', key: 'ssn', encrypted: true}]);
      assert.ok(Buffer.isBuffer(update.data.ssn), 'It should be written back as binary data.');
      assert.equal(decrypt('destination', update.data.ssn), '123-45-6789');
    });
  });

  describe('dbConfig', function() {
    it('Should not enable TLS without a certificate authority or certificate', function() {
      const config = bare({}).dbConfig('src');
      assert.equal(config.tls, undefined);
      assert.equal(config.tlsCAFile, undefined);
    });

    it('Should enable TLS with a certificate authority', function() {
      const config = bare({srcCa: 'ca.pem'}).dbConfig('src');
      assert.equal(config.tls, true);
      assert.equal(config.tlsCAFile, `${process.cwd()}/ca.pem`);
      assert.equal(config.tlsCertificateKeyFile, undefined);
    });

    it('Should use a certificate provided without a certificate authority', function() {
      const config = bare({srcCert: 'cert.pem'}).dbConfig('src');
      assert.equal(config.tls, true);
      assert.equal(config.tlsCertificateKeyFile, `${process.cwd()}/cert.pem`);
    });

    it('Should keep verifying the host name when only a certificate is given', function() {
      const config = bare({srcCert: 'cert.pem'}).dbConfig('src');
      assert.notEqual(config.tlsAllowInvalidHostnames, true,
        'A client certificate is no reason to stop checking who we are connected to.');
    });

    it('Should allow an internal certificate authority to name another host', function() {
      const config = bare({srcCa: 'ca.pem'}).dbConfig('src');
      assert.equal(config.tlsAllowInvalidHostnames, true);
    });

    it('Should use both a certificate authority and a certificate', function() {
      const config = bare({dstCa: 'ca.pem', dstCert: 'cert.pem'}).dbConfig('dst');
      assert.equal(config.tlsCAFile, `${process.cwd()}/ca.pem`);
      assert.equal(config.tlsCertificateKeyFile, `${process.cwd()}/cert.pem`);
    });
  });

  describe('shouldClone', function() {
    const src = {_id: new ObjectId(), created: new Date(1000), modified: new Date(2000)};

    it('Should clone when the destination does not have the item', function() {
      assert.equal(bare({}).shouldClone('submissions', src, null), true);
      assert.equal(bare({}).shouldClone('submissions', src, undefined), true);
    });

    it('Should not clone when the destination item is identical', function() {
      const dest = {_id: new ObjectId(), created: new Date(1000), modified: new Date(2000)};
      assert.equal(bare({}).shouldClone('submissions', src, dest), false);
    });

    it('Should clone when the destination item is out of date', function() {
      const dest = {_id: new ObjectId(), created: new Date(1000), modified: new Date(1500)};
      assert.equal(bare({}).shouldClone('submissions', src, dest), true);
    });

    it('Should only clone submissions when submissionsOnly is set', function() {
      const options = {submissionsOnly: true};
      assert.equal(bare(options).shouldClone('forms', src, null), false);
      assert.equal(bare(options).shouldClone('projects', src, null), false);
      assert.equal(bare(options).shouldClone('roles', src, null), false);
      assert.equal(bare(options).shouldClone('submissions', src, null), true);
    });

    it('Should honor createdAfter', function() {
      assert.equal(bare({createdAfter: '500'}).shouldClone('submissions', src, null), true);
      assert.equal(bare({createdAfter: '1500'}).shouldClone('submissions', src, null), false);
    });

    it('Should honor modifiedAfter', function() {
      assert.equal(bare({modifiedAfter: '1500'}).shouldClone('submissions', src, null), true);
      assert.equal(bare({modifiedAfter: '2500'}).shouldClone('submissions', src, null), false);
    });

    it('Should not update existing projects and forms when updateExisting is false', function() {
      const dest = {_id: new ObjectId(), created: new Date(1000), modified: new Date(1500)};
      const options = {updateExisting: false};
      assert.equal(bare(options).shouldClone('forms', src, dest), false);
      assert.equal(bare(options).shouldClone('projects', src, dest), false);
      assert.equal(bare(options).shouldClone('forms', src, null), true,
        'New forms should still be created.');
      assert.equal(bare(options).shouldClone('submissions', src, dest), true,
        'Submissions are controlled by their own option.');
    });
  });

  describe('write failures', function() {
    /**
     * A cloner instance that only tracks failures.
     */
    function counter() {
      const instance = bare({});
      instance.writeFailures = 0;
      instance.writeFailed = false;
      return instance;
    }

    it('Should count every document of a batch that failed as a whole', function() {
      const instance = counter();
      const consoleError = console.error;
      console.error = () => {};
      try {
        instance.reportWriteErrors('submissions', new Error('connection closed'), 250);
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 250,
        'A batch that never reached the server lost every document in it.');
      assert.equal(instance.writeFailed, true);
    });

    it('Should report a batch that failed as a whole', function() {
      const instance = counter();
      const messages = [];
      const consoleError = console.error;
      console.error = (...args) => messages.push(args.map(String).join(' '));
      try {
        instance.reportWriteErrors('submissions', new Error('connection reset'), 1000);
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 1000);
      assert.ok(messages.length > 0,
        'Losing a whole batch must be reported, not only counted.');
      assert.ok(messages.some((line) => /connection reset/.test(line)),
        `The reason must be printed, got: ${JSON.stringify(messages)}`);
    });

    it('Should not count documents that already exist as failures', function() {
      const instance = counter();
      const consoleError = console.error;
      console.error = () => {};
      try {
        instance.reportWriteErrors('submissions', {
          writeErrors: [
            {code: 11000, errmsg: 'duplicate key'},
            {code: 11000, errmsg: 'duplicate key'}
          ]
        }, 2);
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 0, 'Documents already cloned are not a failure.');
      assert.equal(instance.writeFailed, false);
    });

    it('Should count the real failures of a partially applied batch', function() {
      const instance = counter();
      const consoleError = console.error;
      console.error = () => {};
      try {
        instance.reportWriteErrors('submissions', {
          writeErrors: [
            {code: 11000, errmsg: 'duplicate key'},
            {code: 121, errmsg: 'document failed validation'},
            {code: 121, errmsg: 'document failed validation'}
          ]
        }, 10);
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 2);
    });
  });

  describe('queries', function() {
    it('Should exclude deleted items by default', function() {
      assert.deepEqual(bare({}).query({project: 'a'}), {project: 'a', deleted: {$eq: null}});
    });

    it('Should include deleted items with all', function() {
      assert.deepEqual(bare({all: true}).query({project: 'a'}), {project: 'a'});
    });

    it('Should include recently deleted items with deletedAfter', function() {
      const query = bare({deletedAfter: '1000'}).itemQuery({project: 'a'});
      assert.deepEqual(query.$or, [
        {deleted: {$eq: null}},
        // The servers store "deleted" as a timestamp; older databases may hold a date.
        {deleted: {$gt: 1000}},
        {deleted: {$gt: new Date(1000)}}
      ]);
    });

    it('Should let all take precedence over deletedAfter', function() {
      const query = bare({all: true, deletedAfter: '1000'}).itemQuery({project: 'a'});
      assert.deepEqual(query, {project: 'a'},
        'Asking for everything should not be narrowed by a deleted window.');
    });

    it('Should drop an empty project from the query', function() {
      assert.deepEqual(bare({}).itemQuery({project: null}), {deleted: {$eq: null}});
    });

    it('Should add created and modified filters', function() {
      const query = bare({createdAfter: '1000', modifiedAfter: '2000'}).afterQuery({form: 'a'});
      assert.deepEqual(query.created, {$gt: new Date(1000)});
      assert.deepEqual(query.modified, {$gt: new Date(2000)});
    });
  });

  describe('conversions', function() {
    it('Should convert values to ObjectIds', function() {
      const id = new ObjectId();
      assert.equal(bare({}).convertToObjectId(id), id);
      assert.equal(bare({}).convertToObjectId(id.toString()).toString(), id.toString());
      assert.equal(bare({}).convertToObjectId('nope'), null);
    });

    it('Should convert values to dates', function() {
      const date = new Date(1000);
      assert.equal(bare({}).convertToDate(date), date);
      assert.deepEqual(bare({}).convertToDate(1000), date);
      assert.deepEqual(bare({}).convertToDate('1970-01-01T00:00:01.000Z'), date);
      assert.throws(() => bare({}).convertToDate(null), /Can't extract date/);
    });

    it('Should convert API records into database records', function() {
      const instance = bare({});
      const id = new ObjectId();
      const item = {
        owner: id.toString(),
        form: id.toString(),
        project: id.toString(),
        created: '1970-01-01T00:00:01.000Z',
        modified: 1000
      };
      instance.convertApiObjectToDbRecord(item);
      assert.ok(item.owner instanceof ObjectId);
      assert.ok(item.form instanceof ObjectId);
      assert.ok(item.created instanceof Date);
      assert.ok(item.modified instanceof Date);
    });
  });

  describe('API urls', function() {
    it('Should build request urls', function() {
      const instance = bare({});
      instance.src = 'https://api.example.com/project';
      instance.limit = 500;
      instance.currentForm = {_id: 'form1'};

      assert.equal(instance.getRequestUrl('projects', {}, 0), 'https://api.example.com/project');
      assert.equal(instance.getRequestUrl('forms', {}, 100),
        'https://api.example.com/project/form?limit=500&skip=100');
      assert.equal(instance.getRequestUrl('submissions', {created: {$gt: new Date(1000)}}, 0),
        'https://api.example.com/project/form/form1/submission?limit=500&skip=0&created__gt=1000');
    });

    it('Should throw for an unknown collection', function() {
      assert.throws(() => bare({}).getApiPath('nope'), /Unknown collection/);
    });
  });

  describe('dry run buffering', function() {
    /**
     * Capture what the instance writes out.
     * @param {Function} cb - What to run.
     */
    async function capture(cb) {
      const chunks = [];
      const write = process.stdout.write;
      process.stdout.write = (text) => {
        chunks.push(String(text));
        return true;
      };
      try {
        // eslint-disable-next-line callback-return
        await cb();
      }
      finally {
        process.stdout.write = write;
      }
      return chunks.join('');
    }

    it('Should buffer the report until the flush size is reached', async function() {
      const instance = bare({dryRun: true, extra: true});
      instance.dryRunFlushSize = 3;

      const early = await capture(async() => {
        await instance.dryRunLog('Created', 'a');
        await instance.dryRunLog('Updated', 'b');
      });
      assert.equal(early, '', 'Nothing should be written yet.');

      const flushed = await capture(() => instance.dryRunLog('Created', 'c'));
      assert.equal(flushed, '    Created a\n    Updated b\n    Created c\n');
      assert.equal(instance.dryRunBuffer.length, 0, 'The buffer should be emptied on flush.');
      assert.deepEqual(instance.dryRunTotals, {Created: 2, Updated: 1},
        'The run keeps a tally of what it found.');
    });

    it('Should write nothing for an empty flush', async function() {
      const instance = bare({dryRun: true, extra: true});
      const output = await capture(() => instance.flushDryRun());
      assert.equal(output, '');
    });

    it('Should accept ObjectId values', async function() {
      const instance = bare({dryRun: true, extra: true});
      const id = new ObjectId();

      const output = await capture(async() => {
        await instance.dryRunLog('Created', id);
        await instance.flushDryRun();
      });

      assert.equal(output, `    Created ${id.toString()}\n`);
    });

    it('Should wait for the output to drain when the pipe is full', async function() {
      const instance = bare({dryRun: true, extra: true});
      await instance.dryRunLog('Created', 'a');
      const write = process.stdout.write;
      let written = '';
      process.stdout.write = (text) => {
        written += String(text);
        setImmediate(() => process.stdout.emit('drain'));
        return false;
      };
      try {
        await instance.flushDryRun();
      }
      finally {
        process.stdout.write = write;
      }
      assert.equal(written, '    Created a\n');
    });

    it('Should not report a form that was never started', async function() {
      const instance = bare({dryRun: true});
      instance.dryRunForm = null;
      const output = await capture(async() => instance.reportDryRunForm());
      assert.equal(output, '');
    });
  });

  describe('handlers', function() {
    it('Should run the beforeAll handler for a collection without its own handler', async function() {
      const instance = bare({});
      const calls = [];
      instance.beforeAll = async(collection, src) => calls.push([collection, src.name]);
      await instance.before('forms', null, {name: 'a'}, {}, null);
      assert.deepEqual(calls, [['forms', 'a']]);
    });

    it('Should prefer the handler of the collection over beforeAll', async function() {
      const instance = bare({});
      instance.beforeAll = () => assert.fail('beforeAll should not run');
      assert.equal(await instance.before('forms', () => false, {}, {}, null), false);
    });
  });

  describe('batched writes', function() {
    /**
     * A destination collection that records the batches written to it.
     */
    function collection() {
      return {
        batches: [],
        async bulkWrite(operations) {
          this.batches.push(operations);
        }
      };
    }

    /**
     * A cloner instance ready to queue writes.
     */
    function writer(dest) {
      const instance = bare({});
      instance.dest = dest;
      instance.writeBuffer = {};
      instance.writeBufferSize = 1000;
      instance.maxBatchBytes = 1024 * 1024;
      instance.cloneState = {};
      instance.pendingState = {};
      instance.writeFailures = 0;
      instance.writeFailed = false;
      return instance;
    }

    it('Should flush the queued writes when the destination collection is swapped', async function() {
      const first = collection();
      const second = collection();
      const instance = writer({submissions: first});
      instance.pendingState = {'src.submissions:a': {created: 'x', _id: 'y'}};

      await instance.queueWrite('submissions', {insertOne: {document: {_id: 1}}}, 10);
      instance.dest.submissions = second;
      await instance.queueWrite('submissions', {insertOne: {document: {_id: 2}}}, 10);

      assert.deepEqual(first.batches, [[{insertOne: {document: {_id: 1}}}]],
        'The writes of the previous collection must go to that collection.');
      assert.deepEqual(second.batches, []);
      assert.deepEqual(instance.cloneState, {},
        'Flushing one collection says nothing about the writes still queued for the others.');

      await instance.flushWrites();
      assert.deepEqual(second.batches, [[{insertOne: {document: {_id: 2}}}]]);
      assert.deepEqual(instance.cloneState, {'src.submissions:a': {created: 'x', _id: 'y'}});
    });

    it('Should flush once the byte budget is reached', async function() {
      const target = collection();
      const instance = writer({submissions: target});
      instance.maxBatchBytes = 100;
      await instance.queueWrite('submissions', {insertOne: {document: {_id: 1}}}, 60);
      assert.equal(target.batches.length, 0);
      await instance.queueWrite('submissions', {insertOne: {document: {_id: 2}}}, 60);
      assert.equal(target.batches.length, 1);
      assert.equal(instance.pendingBytes, 0);
    });

    it('Should stop printing write errors after the first ten', function() {
      const instance = writer({});
      const errors = [];
      const consoleError = console.error;
      console.error = (...args) => errors.push(args.map(String).join(' '));
      try {
        for (let i = 0; i < 15; i++) {
          instance.recordWriteFailure('submissions', `failure ${i}`);
        }
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 15, 'Every failure is still counted.');
      assert.equal(errors.length, 11);
      assert.match(errors[10], /Further write errors will not be printed/);
    });

    it('Should read the write errors of every driver error shape', function() {
      const instance = writer({});
      const errors = [];
      const consoleError = console.error;
      console.error = (...args) => errors.push(args.map(String).join(' '));
      try {
        instance.reportWriteErrors('forms', {result: {result: {writeErrors: [{code: 121, errmsg: 'invalid'}]}}});
        instance.reportWriteErrors('forms', {writeErrors: {err: {code: 11000}, message: 'dup'}});
        instance.reportWriteErrors('forms', {writeErrors: [{err: {code: 2}, message: 'bad value'}]});
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 2);
      assert.ok(errors.some((line) => /invalid/.test(line)));
      assert.ok(errors.some((line) => /bad value/.test(line)));
    });

    it('Should not count the documents a failed batch did write', function() {
      const instance = writer({});
      const consoleError = console.error;
      console.error = () => {};
      try {
        instance.reportWriteErrors('forms', {
          message: 'interrupted',
          result: {result: {nInserted: 7, nModified: 1}}
        }, 10);
      }
      finally {
        console.error = consoleError;
      }
      assert.equal(instance.writeFailures, 2);
    });
  });

  describe('destination lookups', function() {
    it('Should not cache anything without a destination collection or ids', async function() {
      const instance = bare({});
      instance.destCaches = new Map();
      instance.dest = {};
      await instance.warmDestinationCache('src.forms', [{_id: 1}]);
      assert.equal(instance.destCaches.has('forms'), false);

      instance.dest = {forms: {find: () => assert.fail('nothing to look up')}};
      await instance.warmDestinationCache('src.forms', []);
      await instance.warmDestinationCache('src.forms', [{name: 'no id'}]);
      assert.equal(instance.destCaches.has('forms'), false);
    });

    it('Should treat a document that cannot be measured as empty', function() {
      const doc = {};
      doc.self = doc;
      assert.equal(bare({}).documentSize(doc), 0);
    });

    it('Should compare timestamps stored as numbers', function() {
      const instance = bare({});
      instance.updateExisting = true;
      const item = {_id: 1, created: 1000, modified: 2000};
      assert.equal(instance.shouldClone('forms', item, {_id: 1, created: 1000, modified: 2000}), false);
      assert.equal(instance.shouldClone('forms', item, {_id: 1, created: 1000, modified: 1000}), true);
    });
  });

  describe('submission collections', function() {
    /**
     * A database stand-in that names the collections it hands out.
     */
    function database() {
      return {collection: (name) => ({name})};
    }

    it('Should use the default collection when a project is not known', async function() {
      const instance = bare({});
      instance.writeBuffer = {};
      instance.cloneState = {};
      instance.pendingState = {};
      instance.src = {db: database(), ogSubmissions: {name: 'submissions'}};
      instance.dest = {db: database(), ogSubmissions: {name: 'submissions'}};
      await quiet(() => instance.setCollection({settings: {collection: 'custom'}}, null, null));
      assert.equal(instance.src.submissions.name, 'submissions');
      assert.equal(instance.dest.submissions.name, 'submissions');

      await quiet(() => instance.setCollection({settings: {collection: 'custom'}}, {name: 'a'}, {name: 'b'}));
      assert.equal(instance.src.submissions.name, 'a_custom');
      assert.equal(instance.dest.submissions.name, 'b_custom');
    });

    it('Should name custom collections, and their revisions, the way the server does', async function() {
      const instance = bare({});
      instance.writeBuffer = {};
      instance.cloneState = {};
      instance.pendingState = {};
      const defaults = () => ({
        db: database(),
        ogSubmissions: {name: 'submissions'},
        ogSubmissionRevisions: {name: 'submissionrevisions'}
      });
      instance.src = defaults();
      instance.dest = defaults();

      // The server strips everything but letters and digits from both names.
      await quiet(() => instance.setCollection(
        {settings: {collection: 'custom-records'}},
        {name: 'my-source'},
        {name: 'my_destination.v2'}
      ));
      assert.equal(instance.src.submissions.name, 'mysource_customrecords');
      assert.equal(instance.src.submissionrevisions.name, 'mysource_customrecords_revisions');
      assert.equal(instance.dest.submissions.name, 'mydestinationv2_customrecords');
      assert.equal(instance.dest.submissionrevisions.name, 'mydestinationv2_customrecords_revisions');

      // The next form without a collection of its own goes back to the default ones.
      await quiet(() => instance.setCollection({settings: {}}, {name: 'my-source'}, {name: 'my_destination.v2'}));
      assert.equal(instance.src.submissions.name, 'submissions');
      assert.equal(instance.src.submissionrevisions.name, 'submissionrevisions');
      assert.equal(instance.dest.submissions.name, 'submissions');
      assert.equal(instance.dest.submissionrevisions.name, 'submissionrevisions');
    });
  });

  describe('roles and access', function() {
    it('Should keep role ids that have no destination equivalent', function() {
      const instance = bare({});
      const id = new ObjectId();
      assert.equal(instance.destRole(id).toString(), id.toString(), 'Works before a role map exists.');
      instance.buildRoleMap();
      assert.equal(instance.roleMap.size, 0, 'Works without any roles loaded.');
    });

    it('Should map onto the first destination role of a title', function() {
      const instance = bare({});
      const src = {_id: new ObjectId(), title: 'Authenticated'};
      const first = {_id: new ObjectId(), title: 'Authenticated'};
      const second = {_id: new ObjectId(), title: 'Authenticated'};
      instance.srcRoles = [src, {_id: new ObjectId(), title: 'Missing'}];
      instance.destRoles = [first, second];
      instance.buildRoleMap();
      assert.equal(instance.migrateRoles([src._id])[0].toString(), first._id.toString());
      assert.deepEqual(instance.migrateRoles(null), []);
    });

    it('Should give a form access arrays it is missing', function() {
      const instance = bare({});
      const roleId = new ObjectId();
      const dest = {access: 'broken', submissionAccess: null};
      instance.migrateFormAccess({
        access: [{type: 'read_all', roles: [roleId]}],
        submissionAccess: [{type: 'create_own', roles: [roleId]}]
      }, dest);
      assert.equal(dest.access.length, 1);
      assert.equal(dest.submissionAccess.length, 1);
      assert.equal(dest.submissionAccess[0].roles[0].toString(), roleId.toString());

      // Nothing to migrate from or to.
      instance.migrateFormAccess(null, dest);
      instance.migrateFormAccess(dest, null);
    });

    it('Should leave team access alone', function() {
      const instance = bare({});
      const dest = [];
      instance.migrateAccess([{type: 'team_read', roles: [new ObjectId()]}], dest);
      assert.deepEqual(dest, []);
    });
  });
});
