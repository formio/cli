/* globals describe, it, before, after, beforeEach */
'use strict';
const assert = require('assert');
const {ObjectId} = require('mongodb');
const Rekeyer = require('../../src/Rekeyer');
const {encrypt, decrypt, eachEncryptedValue, hasEncryptedComponents} = require('../../src/encryption');
const {DST_URI, TestDb, project, form, submission, submissionRevision} = require('./fixtures');
const {quiet} = require('./helper');

const NEW_SECRET = 'the-right-secret';
const WRONG_SECRET = 'the-wrong-destination-secret';
const SOURCE_SECRET = 'the-source-secret';
const PROJECT_SECRET = 'the-project-secret';

// A form with an encrypted field at the top, one within the rows of a datagrid (inside a panel), one
// within a container, and an encrypted datagrid whose rows are encrypted as a whole.
const COMPONENTS = [
  {type: 'textfield', key: 'name', input: true},
  {type: 'textfield', key: 'ssn', input: true, encrypted: true},
  {type: 'panel', key: 'panel', components: [{
    type: 'datagrid',
    key: 'people',
    input: true,
    components: [
      {type: 'textfield', key: 'name', input: true},
      {type: 'textfield', key: 'ssn', input: true, encrypted: true}
    ]
  }]},
  {type: 'container', key: 'details', input: true, components: [
    {type: 'columns', key: 'columns', columns: [{components: [
      {type: 'textfield', key: 'pin', input: true, encrypted: true}
    ]}]}
  ]},
  {type: 'datagrid', key: 'secrets', input: true, encrypted: true, components: [
    {type: 'textfield', key: 'value', input: true, encrypted: true}
  ]}
];

/**
 * Submission data with every encrypted value of COMPONENTS encrypted with a secret.
 * @param {string} secret - The secret.
 */
function encryptedData(secret) {
  return {
    name: 'Plain',
    ssn: encrypt(secret, '123-45-6789'),
    people: [
      {name: 'One', ssn: encrypt(secret, '111-11-1111')},
      {name: 'Two', ssn: encrypt(secret, '222-22-2222')}
    ],
    details: {pin: encrypt(secret, 1234)},
    secrets: encrypt(secret, [{value: 'a'}, {value: 'b'}])
  };
}

/**
 * Decrypt every encrypted value of submission data built by encryptedData().
 * @param {string} secret - The secret to decrypt with.
 * @param {object} data - The data.
 */
function decryptedData(secret, data) {
  return {
    name: data.name,
    ssn: decrypt(secret, data.ssn),
    people: data.people.map((row) => ({name: row.name, ssn: decrypt(secret, row.ssn)})),
    details: {pin: decrypt(secret, data.details.pin)},
    secrets: decrypt(secret, data.secrets)
  };
}

const PLAIN = {
  name: 'Plain',
  ssn: '123-45-6789',
  people: [{name: 'One', ssn: '111-11-1111'}, {name: 'Two', ssn: '222-22-2222'}],
  details: {pin: 1234},
  secrets: [{value: 'a'}, {value: 'b'}]
};

/**
 * Run a re-key, returning what it reported as errors, what it printed, and the error it ended with.
 * @param {object} options - The re-key options.
 */
async function runRekey(options) {
  const warnings = [];
  const consoleError = console.error;
  console.error = (...args) => warnings.push(args.map(String).join(' '));
  const rekeyer = new Rekeyer(DST_URI, Object.assign({
    newDbSecret: NEW_SECRET,
    oldDbSecret: [WRONG_SECRET, SOURCE_SECRET],
    interactive: false
  }, options));
  let error = null;
  try {
    await quiet(() => rekeyer.rekey());
  }
  catch (err) {
    error = err;
  }
  finally {
    console.error = consoleError;
  }
  return {rekeyer, warnings, error};
}

describe('Rekey', function() {
  describe('eachEncryptedValue', function() {
    it('Should find the encrypted values within rows, containers and layout components', function() {
      const found = [];
      eachEncryptedValue(COMPONENTS, encryptedData('x'), (value, path) => found.push(path.join('.')));
      assert.deepEqual(found, ['ssn', 'people.0.ssn', 'people.1.ssn', 'details.pin', 'secrets']);
    });

    it('Should skip plain values, and components that are not saved', function() {
      const found = [];
      eachEncryptedValue([
        {type: 'textfield', key: 'plain', encrypted: true},
        {type: 'textfield', key: 'empty', encrypted: true},
        {type: 'textfield', key: 'transient', encrypted: true, persistent: false}
      ], {plain: 'not encrypted', empty: '', transient: encrypt('x', 'value')}, (value, path) => found.push(path));
      assert.deepEqual(found, []);
    });

    it('Should tell whether a form has encrypted components', function() {
      assert.equal(hasEncryptedComponents(COMPONENTS), true);
      assert.equal(hasEncryptedComponents([{type: 'panel', components: [{type: 'textfield', key: 'a'}]}]), false);
      assert.equal(hasEncryptedComponents(undefined), false);
    });
  });

  describe('rekeyValue', function() {
    const rekeyer = new Rekeyer(DST_URI, {newDbSecret: NEW_SECRET, oldDbSecret: [WRONG_SECRET]});

    it('Should leave a value that is already encrypted with the target secret', function() {
      const result = rekeyer.rekeyValue(encrypt(NEW_SECRET, 'value'), NEW_SECRET, [WRONG_SECRET]);
      assert.equal(result.status, 'current');
    });

    it('Should re-encrypt a value encrypted with one of the candidates', function() {
      const result = rekeyer.rekeyValue(encrypt(WRONG_SECRET, 0), NEW_SECRET, [SOURCE_SECRET, WRONG_SECRET]);
      assert.equal(result.status, 'rekeyed');
      assert.strictEqual(decrypt(NEW_SECRET, result.cipher), 0, 'A falsy value is still a value.');
    });

    it('Should re-encrypt settings without a salt', function() {
      const result = rekeyer.rekeyValue(encrypt(WRONG_SECRET, {secret: 'a'}, true), NEW_SECRET, [WRONG_SECRET], true);
      assert.equal(result.status, 'rekeyed');
      assert.deepEqual(decrypt(NEW_SECRET, result.cipher, true), {secret: 'a'});
    });

    it('Should report a value none of the secrets can read', function() {
      const result = rekeyer.rekeyValue(encrypt('unknown', 'value'), NEW_SECRET, [WRONG_SECRET]);
      assert.equal(result.status, 'undecryptable');
    });
  });

  describe('options', function() {
    it('Should refuse to run without the secrets', async function() {
      assert.throws(() => new Rekeyer(DST_URI, {oldDbSecret: ['a']}).validate(), /--new-db-secret is required/);
      assert.throws(() => new Rekeyer(DST_URI, {newDbSecret: 'a'}).validate(), /At least one --old-db-secret/);
      assert.throws(() => new Rekeyer(DST_URI, {newDbSecret: 'a', oldDbSecret: ['a']}).validate(),
        /also given as an old secret/);
      assert.throws(() => new Rekeyer(DST_URI, {newDbSecret: 'a', oldDbSecret: ['b'], project: 'nope'}).validate(),
        /Not a valid project id: nope/);
    });

    it('Should accept a single old secret as a string', function() {
      assert.deepEqual(new Rekeyer(DST_URI, {newDbSecret: 'a', oldDbSecret: 'b'}).oldSecrets, ['b']);
    });
  });

  describe('a database', function() {
    let db = null;
    let seed = null;

    before('Connect to the test database', async function() {
      db = await new TestDb(DST_URI).connect();
    });

    after('Disconnect from the test database', async function() {
      await db.close();
    });

    /**
     * Seed the database the way a clone with the wrong destination secret leaves it.
     */
    beforeEach('Seed a database cloned with the wrong secret', async function() {
      await db.reset();

      // A project without a secret of its own: its data is encrypted with the DB_SECRET, which the
      // clone got wrong. The values within datagrid rows were never migrated, and still have the
      // source secret.
      const plain = await db.insert('projects', project({
        title: 'No project secret',
        name: 'no-secret',
        ['settings_encrypted']: encrypt(WRONG_SECRET, {cors: '*'}, true)
      }));
      const plainForm = await db.insert('forms', form({project: plain._id, components: COMPONENTS}));
      const wrongData = encryptedData(WRONG_SECRET);
      wrongData.people = encryptedData(SOURCE_SECRET).people;
      const plainSubmission = await db.insert('submissions', submission({
        form: plainForm._id,
        project: plain._id,
        data: wrongData
      }));
      await db.insert('submissionrevisions', submissionRevision({
        _rid: plainSubmission._id,
        form: plainForm._id,
        project: plain._id,
        data: encryptedData(WRONG_SECRET)
      }));
      const unreadable = await db.insert('submissions', submission({
        form: plainForm._id,
        project: plain._id,
        data: {ssn: encrypt('a-secret-nobody-knows', 'lost')}
      }));

      // A form of the same project with its own collection, which the server names after the
      // project name without its dashes.
      const customForm = await db.insert('forms', form({
        project: plain._id,
        components: COMPONENTS,
        settings: {collection: 'people-records'}
      }));
      await db.insert('nosecret_peoplerecords', submission({
        form: customForm._id,
        project: plain._id,
        data: encryptedData(WRONG_SECRET)
      }));

      // A project with a secret of its own: its data is encrypted with that, so only its settings
      // need to be re-keyed.
      const own = await db.insert('projects', project({
        title: 'Own secret',
        name: 'own-secret',
        ['settings_encrypted']: encrypt(WRONG_SECRET, {secret: PROJECT_SECRET}, true)
      }));
      const ownForm = await db.insert('forms', form({project: own._id, components: COMPONENTS}));
      const ownSubmission = await db.insert('submissions', submission({
        form: ownForm._id,
        project: own._id,
        data: encryptedData(PROJECT_SECRET)
      }));

      // The project the destination server created itself, already on the right secret.
      const formio = await db.insert('projects', project({
        title: 'Form.io',
        name: 'formio',
        ['settings_encrypted']: encrypt(NEW_SECRET, {secret: 'formio-secret'}, true)
      }));

      seed = {plain, plainForm, plainSubmission, unreadable, customForm, own, ownForm, ownSubmission, formio};
    });

    /**
     * The decrypted settings of a project.
     * @param {object} proj - The project.
     */
    async function settings(proj) {
      return decrypt(NEW_SECRET, (await db.findOne('projects', {_id: proj._id}))['settings_encrypted'], true);
    }

    it('Should change nothing on a dry run', async function() {
      const before = await db.all('submissions');
      const {rekeyer, error} = await runRekey({dryRun: true});

      assert.deepEqual(await db.all('submissions'), before, 'The submissions must be left as they are.');
      assert.equal(await settings(seed.plain), null, 'The settings must be left as they are.');
      assert.deepEqual(rekeyer.totals.settings, {rekeyed: 2, current: 1, undecryptable: 0});
      // The plain project has 5 values in its submission, 5 in its revision and 5 in its custom
      // collection. The own secret project has 5 that are already right. One value is lost.
      assert.deepEqual(rekeyer.totals.values, {rekeyed: 15, current: 5, undecryptable: 1});
      assert.match(String(error && error.message), /1 encrypted value\(s\) could not be decrypted/);
    });

    it('Should re-key the settings and the encrypted data', async function() {
      const {rekeyer, warnings, error} = await runRekey({});

      assert.deepEqual(await settings(seed.plain), {cors: '*'});
      assert.deepEqual(await settings(seed.own), {secret: PROJECT_SECRET});
      assert.deepEqual(await settings(seed.formio), {secret: 'formio-secret'});

      const sub = await db.findOne('submissions', {_id: seed.plainSubmission._id});
      assert.deepEqual(decryptedData(NEW_SECRET, sub.data), PLAIN,
        'Every value, including the ones within rows, must be readable with the new secret.');
      const revision = await db.findOne('submissionrevisions', {_rid: seed.plainSubmission._id});
      assert.deepEqual(decryptedData(NEW_SECRET, revision.data), PLAIN, 'Revisions must be re-keyed as well.');
      const custom = (await db.all('nosecret_peoplerecords'))[0];
      assert.deepEqual(decryptedData(NEW_SECRET, custom.data), PLAIN, 'Custom collections must be re-keyed as well.');

      const own = await db.findOne('submissions', {_id: seed.ownSubmission._id});
      assert.deepEqual(decryptedData(PROJECT_SECRET, own.data), PLAIN);
      assert.ok(Buffer.from(own.data.ssn.buffer).equals(seed.ownSubmission.data.ssn),
        'Data encrypted with the project secret must not be touched.');

      const unreadable = await db.findOne('submissions', {_id: seed.unreadable._id});
      assert.ok(Buffer.from(unreadable.data.ssn.buffer).equals(seed.unreadable.data.ssn),
        'A value no secret can read must be left as it is.');
      assert.ok(warnings.some((line) => line.includes(`data.ssn of submissions ${seed.unreadable._id}`)),
        'The value that could not be decrypted must be reported.');
      assert.match(String(error && error.message), /1 encrypted value\(s\) could not be decrypted/,
        'The re-key must not report success.');
      assert.equal(rekeyer.totals.conflicts, 0);
    });

    it('Should find nothing left to do when it is run again', async function() {
      await runRekey({});
      const {rekeyer} = await runRekey({});
      assert.deepEqual(rekeyer.totals.settings, {rekeyed: 0, current: 3, undecryptable: 0});
      assert.deepEqual(rekeyer.totals.values, {rekeyed: 0, current: 20, undecryptable: 1});
    });

    it('Should re-key data encrypted with the wrong secret into the project secret', async function() {
      await db.collection('submissions').updateOne(
        {_id: seed.ownSubmission._id},
        {$set: {'data.ssn': encrypt(WRONG_SECRET, 'moved')}}
      );
      await runRekey({project: seed.own._id.toString()});
      const own = await db.findOne('submissions', {_id: seed.ownSubmission._id});
      assert.equal(decrypt(PROJECT_SECRET, own.data.ssn), 'moved');
    });

    it('Should only re-key the projects it is given', async function() {
      const {rekeyer, error} = await runRekey({project: seed.own._id.toString()});
      assert.equal(error, null);
      assert.deepEqual(rekeyer.totals.settings, {rekeyed: 1, current: 0, undecryptable: 0});
      assert.deepEqual(await settings(seed.own), {secret: PROJECT_SECRET});
      assert.equal(await settings(seed.plain), null, 'Other projects must be left alone.');
    });

    it('Should refuse projects that do not exist', async function() {
      const {error} = await runRekey({project: new ObjectId().toString()});
      assert.match(String(error && error.message), /Only 0 of the 1 projects given were found/);
    });

    it('Should skip the data of a project whose settings none of the secrets can read', async function() {
      const {rekeyer, error} = await runRekey({oldDbSecret: ['something-else'], project: seed.plain._id.toString()});
      assert.deepEqual(rekeyer.totals.settings, {rekeyed: 0, current: 0, undecryptable: 1});
      assert.deepEqual(rekeyer.totals.values, {rekeyed: 0, current: 0, undecryptable: 0},
        'Without the settings, the secret of the data is not known.');
      assert.match(String(error && error.message), /had settings none of the secrets could decrypt/);
    });

    it('Should leave the submission revisions alone when asked to', async function() {
      await runRekey({submissionRevisions: false});
      const revision = await db.findOne('submissionrevisions', {_rid: seed.plainSubmission._id});
      assert.deepEqual(decryptedData(WRONG_SECRET, revision.data), PLAIN);
    });

    it('Should never overwrite a value that changed after it was read', async function() {
      const rekeyer = new Rekeyer(DST_URI, {newDbSecret: NEW_SECRET, oldDbSecret: [WRONG_SECRET]});
      const collection = db.collection('submissions');
      const changed = encrypt(NEW_SECRET, 'changed by someone else');
      await collection.updateOne({_id: seed.plainSubmission._id}, {$set: {'data.ssn': changed}});

      const consoleError = console.error;
      console.error = () => {};
      try {
        await rekeyer.write(collection, [{updateOne: {
          filter: {_id: seed.plainSubmission._id, 'data.ssn': seed.plainSubmission.data.ssn},
          update: {$set: {'data.ssn': encrypt(NEW_SECRET, '123-45-6789')}}
        }}]);
      }
      finally {
        console.error = consoleError;
      }

      assert.equal(rekeyer.totals.conflicts, 1);
      const sub = await db.findOne('submissions', {_id: seed.plainSubmission._id});
      assert.equal(decrypt(NEW_SECRET, sub.data.ssn), 'changed by someone else');
    });
  });
});
