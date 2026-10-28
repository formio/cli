/* globals describe, it */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {ObjectId, Collection} = require('mongodb');
const {seedProject, at, project, role, form, formRevision, submissionRevision} = require('./fixtures');
const {
  useTestDatabases,
  createCloner,
  runClone,
  quiet,
  capturedOutput,
  writeCloneState,
  cloneStateExists
} = require('./helper');

/**
 * The helpers that encrypt and decrypt the way the server does.
 */
function crypter() {
  return require('../../src/encryption');
}

/**
 * Run a callback, capturing everything it reports as an error.
 * @param {Function} cb - The callback to run.
 */
async function capturingErrors(cb) {
  const errors = [];
  const consoleError = console.error;
  console.error = (...args) => errors.push(args.map(String).join(' '));
  try {
    // eslint-disable-next-line callback-return
    await cb();
  }
  finally {
    console.error = consoleError;
  }
  return errors;
}

describe('Clone operations', function() {
  const dbs = useTestDatabases();

  describe('Action roles', function() {
    /**
     * Seed a source project and an existing destination project whose roles have their own ids.
     */
    async function seedWithDestinationRoles() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));
      const destRoles = [];
      for (const title of ['Administrator', 'Authenticated', 'Anonymous']) {
        destRoles.push(await dbs.dst.insert('roles', role({title, project: destProject._id})));
      }
      return {seed, destProject, destRoles};
    }

    /**
     * Give the seeded action of the source form a role.
     */
    async function setActionRole(seed, roleId) {
      await dbs.src.collection('actions').updateOne({_id: seed.actions[0]._id},
        {$set: {settings: {role: roleId}}});
    }

    it('Should map an action role onto the destination role of the same title', async function() {
      const {seed, destProject, destRoles} = await seedWithDestinationRoles();
      const authenticated = seed.roles.find((r) => r.title === 'Authenticated');
      await setActionRole(seed, authenticated._id.toString());

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const cloned = await dbs.dst.findOne('actions', {_id: seed.actions[0]._id});
      const destAuthenticated = destRoles.find((r) => r.title === 'Authenticated');
      assert.equal(cloned.settings.role, destAuthenticated._id.toString());
    });

    it('Should map an action role that belongs to another source project', async function() {
      const {seed, destProject, destRoles} = await seedWithDestinationRoles();
      const elsewhere = await dbs.src.insert('roles', role({title: 'Anonymous', project: new ObjectId()}));
      await setActionRole(seed, elsewhere._id.toString());

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const cloned = await dbs.dst.findOne('actions', {_id: seed.actions[0]._id});
      const destAnonymous = destRoles.find((r) => r.title === 'Anonymous');
      assert.equal(cloned.settings.role, destAnonymous._id.toString(),
        'A role outside of the project should be looked up by its title.');
    });

    it('Should keep an action role that has no destination equivalent', async function() {
      const {seed, destProject} = await seedWithDestinationRoles();
      const unknown = new ObjectId();
      await setActionRole(seed, unknown.toString());

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const cloned = await dbs.dst.findOne('actions', {_id: seed.actions[0]._id});
      assert.equal(cloned.settings.role, unknown.toString());
    });

    it('Should clone an action that has no settings', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await dbs.src.collection('actions').updateOne({_id: seed.actions[0]._id}, {$set: {settings: null}});

      const errors = await capturingErrors(() => quiet(() => runClone({})));

      assert.deepEqual(errors, []);
      const cloned = await dbs.dst.findOne('actions', {_id: seed.actions[0]._id});
      assert.ok(cloned);
      assert.equal(cloned.settings, null);
    });
  });

  describe('Encrypted project settings', function() {
    const srcDbSecret = 'source-db-secret';
    const dstDbSecret = 'destination-db-secret';

    it('Should re-encrypt the settings of a new project with the destination secret', async function() {
      const crypt = crypter();
      const settings = {secret: 'project-secret', email: {smtp: {host: 'mail.example.com'}}};
      const seed = await seedProject(dbs.src, {
        forms: 1,
        submissions: 0,
        project: {['settings_encrypted']: crypt.encrypt(srcDbSecret, settings, true)}
      });

      await quiet(() => runClone({srcDbSecret, dstDbSecret}));

      const cloned = await dbs.dst.findOne('projects', {_id: seed.project._id});
      assert.deepEqual(crypt.decrypt(dstDbSecret, cloned['settings_encrypted'], true), settings,
        'The destination must be able to read the settings with its own secret.');
      // A failed decrypt logs the error, which is expected here.
      assert.equal(await quiet(async() => crypt.decrypt(srcDbSecret, cloned['settings_encrypted'], true)), null,
        'The settings must no longer be encrypted with the source secret.');
    });

    it('Should report a destination project whose settings it cannot decrypt', async function() {
      const crypt = crypter();
      const seed = await seedProject(dbs.src, {
        forms: 1,
        submissions: 1,
        project: {['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: 'project-secret'}, true)}
      });
      const destSettings = crypt.encrypt('another-secret', {secret: 'theirs'}, true);
      const destProject = await dbs.dst.insert('projects', project({['settings_encrypted']: destSettings}));

      let error = null;
      const errors = await capturingErrors(() => quiet(() => runClone({
        srcDbSecret,
        dstDbSecret,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      })).catch((err) => {
        error = err;
      }));

      const expected = /destination project .* could not be decrypted\. Check the --dst-db-secret/;
      assert.ok(errors.some((line) => expected.test(line)),
        `Expected the destination to be named, got: ${JSON.stringify(errors)}`);
      assert.match(String(error && error.message), /1 project\(s\) had settings that could not be decrypted/);
      const kept = await dbs.dst.findOne('projects', {_id: destProject._id});
      assert.ok(Buffer.from(kept['settings_encrypted'].buffer).equals(destSettings));
    });

    it('Should copy the settings as they are when both databases share a secret', async function() {
      const crypt = crypter();
      const encrypted = crypt.encrypt(srcDbSecret, {secret: 'project-secret'}, true);
      const seed = await seedProject(dbs.src, {
        forms: 1,
        submissions: 0,
        project: {['settings_encrypted']: encrypted}
      });

      await quiet(() => runClone({srcDbSecret, dstDbSecret: srcDbSecret}));

      const cloned = await dbs.dst.findOne('projects', {_id: seed.project._id});
      assert.ok(Buffer.from(cloned['settings_encrypted'].buffer).equals(encrypted));
    });
  });

  describe('The formio project', function() {
    it('Should skip the formio project and give cloned projects its owner', async function() {
      const owner = new ObjectId();
      const destFormio = await dbs.dst.insert('projects', project({name: 'formio', title: 'Formio', owner}));
      const srcFormio = await dbs.src.insert('projects', project({name: 'formio', title: 'Source Formio'}));
      await dbs.src.insert('forms', form({project: srcFormio._id}));
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});

      await quiet(() => runClone({}));

      assert.equal(await dbs.dst.count('projects'), 2);
      assert.equal(await dbs.dst.findOne('projects', {_id: srcFormio._id}), null,
        'The source formio project must never be cloned.');
      const keptFormio = await dbs.dst.findOne('projects', {_id: destFormio._id});
      assert.equal(keptFormio.title, 'Formio', 'The destination formio project must be left alone.');
      const cloned = await dbs.dst.findOne('projects', {_id: seed.project._id});
      assert.equal(cloned.owner.toString(), owner.toString(),
        'Cloned projects should be owned by the owner of the destination formio project.');
      assert.equal(await dbs.dst.count('forms'), 1, 'Nothing of the formio project should be cloned.');
    });
  });

  describe('Form revisions', function() {
    it('Should never overwrite a form revision the destination already has', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      const revision = await dbs.src.insert('formrevisions', formRevision({
        _rid: seed.forms[0]._id,
        project: seed.project._id,
        title: 'Source revision'
      }));
      await dbs.dst.insert('formrevisions', Object.assign({}, revision, {
        title: 'Destination revision',
        modified: new Date(revision.modified.getTime() - 1000)
      }));

      await quiet(() => runClone({includeFormRevisions: true}));

      const kept = await dbs.dst.findOne('formrevisions', {_id: revision._id});
      assert.equal(kept.title, 'Destination revision', 'Revisions are immutable once cloned.');
      assert.equal(await dbs.dst.count('formrevisions'), 1);
    });
  });

  describe('Option validation', function() {
    it('Should reject an invalid destination project id', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 0});
      await assert.rejects(
        () => quiet(() => runClone({dstProject: 'not-an-id'})),
        /Invalid destination project id provided: not-an-id/
      );
    });

    it('Should reject --submissions-only without a destination project', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 1});
      await assert.rejects(
        () => quiet(() => runClone({submissionsOnly: true})),
        /You must provide a destination project id/
      );
      assert.equal(await dbs.dst.count('submissions'), 0);
    });
  });

  describe('Per document errors', function() {
    it('Should report a document that fails, keep cloning the others, and not claim success', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
      const failing = seed.submissions[1]._id.toString();
      const cloner = createCloner({});
      let error = null;
      let errors;
      try {
        errors = await capturingErrors(() => quiet(() => cloner.clone(null, async(collection, src) => {
          if (collection === 'submissions' && src._id.toString() === failing) {
            throw new Error('the after handler failed');
          }
        })).catch((err) => {
          error = err;
        }));
      }
      finally {
        cloner.destroy();
      }

      assert.ok(errors.some((line) => line.includes(`Error creating submissions ${failing}`)),
        `The failing document should be named, got: ${JSON.stringify(errors)}`);
      assert.equal(await dbs.dst.count('submissions'), 3, 'The other submissions must still be cloned.');
      assert.match(String(error && error.message), /1 document\(s\) could not be cloned/);
    });

    it('Should clone the other documents when one holds bad data', async function() {
      const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
      await dbs.src.collection('submissions').updateOne({_id: seed.submissions[0]._id},
        {$set: {roles: [null, seed.roles[1]._id], access: [null, {type: 'read', roles: [null]}]}});

      const errors = await capturingErrors(() => quiet(() => runClone({})));

      assert.deepEqual(errors, []);
      assert.equal(await dbs.dst.count('submissions'), 4);
      const cloned = await dbs.dst.findOne('submissions', {_id: seed.submissions[0]._id});
      assert.deepEqual(cloned.roles.map(String), [seed.roles[1]._id.toString()],
        'The empty role is dropped, the real one is kept.');
    });

    it('Should keep going when an error that is not a programming error repeats', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 8});
      const cloner = createCloner({});
      let error = null;
      try {
        await capturingErrors(() => quiet(() => cloner.clone(null, async(collection) => {
          if (collection === 'submissions') {
            throw new Error('rejected by a hook');
          }
        })).catch((err) => {
          error = err;
        }));
      }
      finally {
        cloner.destroy();
      }
      assert.equal(cloner.documentFailures, seed.submissions.length,
        'Every submission should have been tried.');
      assert.match(String(error && error.message), /could not be cloned/);
    });
  });

  describe('Parents that cannot be written', function() {
    it('Should not clone the submissions of a form that conflicts with another destination form', async function() {
      const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
      await dbs.dst.collection('forms').createIndex({path: 1}, {unique: true});
      const conflicting = await dbs.dst.insert('forms', form({path: seed.forms[0].path, project: new ObjectId()}));

      let error = null;
      const errors = await capturingErrors(() => quiet(() => runClone({})).catch((err) => {
        error = err;
      }));

      assert.equal(await dbs.dst.findOne('forms', {_id: seed.forms[0]._id}), null);
      assert.equal(await dbs.dst.count('submissions', {form: seed.forms[0]._id}), 0,
        'Submissions must never be cloned for a form that is not in the destination.');
      assert.equal(await dbs.dst.count('submissions', {form: seed.forms[1]._id}), 2,
        'The other forms are not affected.');
      assert.ok(errors.some((line) => /path_1 dup key/.test(line)),
        `The conflict must be reported, got: ${JSON.stringify(errors)}`);
      assert.match(String(error && error.message), /1 document\(s\) could not be written/);
      assert.ok(await dbs.dst.findOne('forms', {_id: conflicting._id}));
    });

    it('Should report a duplicate on any index other than _id', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await dbs.dst.collection('submissions').createIndex({'data.firstName': 1}, {unique: true});
      // Created before anything in the source, so that the clone still has every submission to write.
      const copy = Object.assign({}, seed.submissions[0], {_id: new ObjectId(), created: at(0)});
      await dbs.dst.insert('submissions', copy);

      let error = null;
      await capturingErrors(() => quiet(() => runClone({})).catch((err) => {
        error = err;
      }));

      assert.match(String(error && error.message), /1 document\(s\) could not be written/);
    });
  });

  describe('Hooks', function() {
    it('Should run the beforeAll hook, and let it veto a document', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 2});
      const seen = new Set();
      const cloner = createCloner({});
      try {
        await quiet(() => cloner.clone((collection) => {
          seen.add(collection);
          return collection !== 'tags';
        }));
      }
      finally {
        cloner.destroy();
      }
      assert.deepEqual([...seen].sort(), ['actions', 'forms', 'projects', 'roles', 'submissions', 'tags']);
      assert.equal(await dbs.dst.count('tags'), 0, 'A document the hook vetoes is not written.');
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should hand the afterAll hook the full source documents', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await quiet(() => runClone({}));
      const data = [];
      const cloner = createCloner({updateExistingSubmissions: true});
      try {
        await quiet(() => cloner.clone(null, (collection, src) => {
          if (collection === 'submissions') {
            data.push(src.data && src.data.firstName);
          }
        }));
      }
      finally {
        cloner.destroy();
      }
      assert.deepEqual(data, seed.submissions.map((sub) => sub.data.firstName),
        'Unchanged submissions must not be handed over with only their timestamps.');
    });
  });

  describe('Submission revisions', function() {
    it('Should batch the writes instead of flushing them for every submission', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 20});
      for (const sub of seed.submissions) {
        await dbs.src.insert('submissionrevisions', submissionRevision({
          _rid: sub._id,
          form: sub.form,
          project: sub.project
        }));
      }
      const batches = {};
      const bulkWrite = Collection.prototype.bulkWrite;
      Collection.prototype.bulkWrite = function(...args) {
        batches[this.collectionName] = (batches[this.collectionName] || 0) + 1;
        return bulkWrite.apply(this, args);
      };
      try {
        await quiet(() => runClone({includeSubmissionRevisions: true}));
      }
      finally {
        Collection.prototype.bulkWrite = bulkWrite;
      }

      assert.equal(await dbs.dst.count('submissions'), 20);
      assert.equal(await dbs.dst.count('submissionrevisions'), 20);
      assert.equal(batches.submissions, 1, `Expected one batch of submissions, got ${batches.submissions}.`);
      assert.equal(batches.submissionrevisions, 1,
        `Expected one batch of revisions, got ${batches.submissionrevisions}.`);
    });
  });

  describe('Project lists', function() {
    it('Should accept spaces around the ids of a list', async function() {
      const first = await seedProject(dbs.src, {forms: 1, submissions: 1, project: {title: 'First'}});
      const second = await seedProject(dbs.src, {forms: 1, submissions: 1, project: {title: 'Second'}});

      await quiet(() => runClone({srcProject: ` ${first.project._id}, ${second.project._id} `}));

      assert.equal(await dbs.dst.count('projects'), 2);
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should reject a project list that holds no ids', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 1});
      await assert.rejects(() => quiet(() => runClone({srcProject: ' , '})), /Invalid source project id provided/);
    });

    it('Should reject an invalid form id before cloning anything', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 1});
      await assert.rejects(() => quiet(() => runClone({forms: 'nope'})), /Invalid form id provided: nope/);
      assert.equal(await dbs.dst.count('projects'), 0);
    });
  });

  describe('Connection strings', function() {
    it('Should never print the password of a connection string', async function() {
      const uri = 'mongodb://admin:hunter2@localhost:1/db?serverSelectionTimeoutMS=200';
      let error = null;
      await quiet(() => runClone({}, uri, 'mongodb://localhost:27018/elsewhere')).catch((err) => {
        error = err;
      });
      assert.ok(error);
      assert.doesNotMatch(error.message, /hunter2/);
      assert.doesNotMatch(capturedOutput(), /hunter2/);
      assert.match(error.message, /admin|\*\*\*/);
    });
  });

  describe('Running a clone more than once', function() {
    it('Should register the exit handler again for a second clone of the same instance', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 1});
      const cloner = createCloner({});
      try {
        await quiet(() => cloner.clone());
        assert.equal(cloner.exitHandler, null, 'The first clone should release its exit handler.');

        const listeners = process.listeners('exit').length;
        let during = null;
        await quiet(() => cloner.clone(null, () => {
          during = during === null ? process.listeners('exit').length : during;
        }));
        assert.equal(during, listeners + 1, 'An interruption of the second clone must still be saved.');
        assert.equal(process.listeners('exit').length, listeners);
      }
      finally {
        cloner.destroy();
      }
    });
  });

  describe('Saving the clone state', function() {
    it('Should remove resume points a previous clone left behind once a clone succeeds', async function() {
      await seedProject(dbs.src, {forms: 1, submissions: 1});
      // An older version of the cloner kept one resume point for every submission it walked.
      writeCloneState({'src.submissions': {created: new Date(0).toISOString(), _id: null}});

      await quiet(() => runClone({}));

      assert.equal(cloneStateExists(), false,
        'A stale resume point would make a later clone silently skip submissions.');
    });

    it('Should save the resume point to disk as the clone moves', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
      const stateKey = `src.submissions:${seed.forms[0]._id}`;
      const saved = [];
      const cloner = createCloner({batchSize: 1});
      try {
        await quiet(() => cloner.clone(null, (collection) => {
          if (collection === 'submissions' && cloneStateExists()) {
            saved.push(JSON.parse(fs.readFileSync('clonestate.json', 'utf8'))[stateKey]);
          }
        }));
      }
      finally {
        cloner.destroy();
      }
      assert.ok(saved.some((point) => point && point._id === seed.submissions[0]._id.toString()),
        `A clone killed outright must be able to resume, saw: ${JSON.stringify(saved)}`);
      assert.equal(cloneStateExists(), false, 'A finished clone leaves nothing to resume.');
    });

    it('Should save the resume point when interrupted', function() {
      const cloner = createCloner({});
      try {
        assert.ok(process.listeners('SIGINT').includes(cloner.signalHandler),
          'Ctrl+C does not emit "exit", so it needs a handler of its own.');
        assert.ok(process.listeners('SIGTERM').includes(cloner.signalHandler));
      }
      finally {
        cloner.destroy();
      }
      assert.equal(process.listeners('SIGINT').includes(cloner.signalHandler), false);
    });

    it('Should save the resume point and exit when a signal arrives', function() {
      const cloner = createCloner({});
      const exit = process.exit;
      let code = null;
      process.exit = (value) => {
        code = value;
      };
      try {
        cloner.cloneState = {'src.forms': {created: new Date(0).toISOString(), _id: null}};
        cloner.signalHandler('SIGINT');
        assert.equal(code, 130);
        assert.ok(cloneStateExists());
        cloner.signalHandler('SIGTERM');
        assert.equal(code, 143);
      }
      finally {
        process.exit = exit;
        cloner.destroy();
        fs.rmSync('clonestate.json', {force: true});
      }
    });

    it('Should report, not throw, when the clone state cannot be written', async function() {
      const cloner = createCloner({});
      const target = path.join(process.cwd(), 'clonestate.json');
      try {
        fs.mkdirSync(target);
        cloner.cloneState = {'src.forms': {created: new Date(0).toISOString(), _id: null}};
        const errors = await capturingErrors(async() => cloner.saveCloneState());
        assert.ok(errors.some((line) => /Could not save the clone state/.test(line)),
          `Expected the failure to be reported, got: ${JSON.stringify(errors)}`);
      }
      finally {
        cloner.destroy();
        fs.rmSync(target, {recursive: true, force: true});
      }
    });
  });
});
