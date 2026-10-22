/* globals describe, it */
'use strict';
const assert = require('assert');
const _ = require('lodash');
const {ObjectId} = require('mongodb');
const Cloner = require('../../src/Cloner');
const {seedProject, at, project, role, form, submission} = require('./fixtures');
const {useTestDatabases, runClone, quiet} = require('./helper');

/**
 * Build a bare cloner instance that can encrypt/decrypt without connecting to anything.
 */
function crypter() {
  const instance = Object.create(Cloner.prototype);
  instance.defaultSaltLength = 40;
  return instance;
}

describe('Project targeting', function() {
  const dbs = useTestDatabases();

  describe('--src-project / --dst-project', function() {
    it('Should clone forms and submissions into the destination project', async function() {
      const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms.length, 2);
      for (const frm of forms) {
        assert.equal(frm.project.toString(), destProject._id.toString(),
          'Cloned forms must belong to the destination project.');
      }

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 4);
      for (const sub of submissions) {
        assert.equal(sub.project.toString(), destProject._id.toString(),
          'Cloned submissions must belong to the destination project.');
      }
    });

    it('Should map submission roles onto the destination project roles', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));
      const destRoles = [];
      for (const title of ['Administrator', 'Authenticated', 'Anonymous']) {
        destRoles.push(await dbs.dst.insert('roles', role({title, project: destProject._id})));
      }

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const cloned = (await dbs.dst.all('submissions'))[0];
      const authenticated = destRoles.find((r) => r.title === 'Authenticated');
      assert.equal(cloned.roles.length, 1);
      assert.equal(cloned.roles[0].toString(), authenticated._id.toString(),
        'The submission role should be remapped to the destination role id.');
    });

    it('Should clone multiple source projects when given a comma separated list', async function() {
      const first = await seedProject(dbs.src, {forms: 1, submissions: 1, project: {title: 'First'}});
      const second = await seedProject(dbs.src, {forms: 1, submissions: 1, project: {title: 'Second'}});
      await seedProject(dbs.src, {forms: 1, submissions: 1, project: {title: 'Third'}});

      await quiet(() => runClone({
        srcProject: `${first.project._id.toString()},${second.project._id.toString()}`
      }));

      const titles = (await dbs.dst.all('projects')).map((proj) => proj.title).sort();
      assert.deepEqual(titles, ['First', 'Second']);
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should fail clearly when multiple source projects target a single destination project', async function() {
      const first = await seedProject(dbs.src, {forms: 1, submissions: 1});
      const second = await seedProject(dbs.src, {forms: 1, submissions: 1});
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await assert.rejects(
        () => quiet(() => runClone({
          srcProject: `${first.project._id.toString()},${second.project._id.toString()}`,
          dstProject: destProject._id.toString()
        })),
        /single destination project|only one source project/i
      );
    });
  });

  describe('Project access', function() {
    it('Should migrate the project access onto the destination roles', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      const authenticated = seed.roles.find((r) => r.title === 'Authenticated');
      await dbs.src.collection('projects').updateOne({_id: seed.project._id},
        {$set: {access: [{type: 'create_all', roles: [authenticated._id]}]}});

      await quiet(() => runClone({}));

      const cloned = await dbs.dst.findOne('projects', {_id: seed.project._id});
      assert.equal(cloned.access.length, 1, 'The project access must be cloned.');
      assert.equal(cloned.access[0].type, 'create_all');
      assert.equal(cloned.access[0].roles.length, 1);
    });

    it('Should migrate the access of a new project even with --no-update-existing', async function() {
      // The flag is about not touching what the destination already has: a project that is not
      // there yet still has to be cloned completely.
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      const authenticated = seed.roles.find((r) => r.title === 'Authenticated');
      await dbs.src.collection('projects').updateOne({_id: seed.project._id},
        {$set: {access: [{type: 'create_all', roles: [authenticated._id]}]}});

      await quiet(() => runClone({updateExisting: false}));

      const cloned = await dbs.dst.findOne('projects', {_id: seed.project._id});
      assert.ok(cloned, 'A project the destination does not have should still be cloned.');
      assert.equal(cloned.access.length, 1,
        'A newly cloned project must keep its access, the flag only protects what already exists.');
    });
  });

  describe('--submissions-only', function() {
    /**
     * Seed a source project and a destination project that already contains the same forms, as a
     * previous full clone would have left it.
     */
    async function seedClonedForms(options = {}) {
      const seed = await seedProject(dbs.src, Object.assign({forms: 1, submissions: 2}, options));
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));
      const destForms = [];
      for (const srcForm of seed.forms) {
        destForms.push(await dbs.dst.insert('forms', form(Object.assign({}, srcForm, {
          project: destProject._id
        }))));
      }
      return {seed, destProject, destForms};
    }

    it('Should clone submissions into the destination project without touching forms', async function() {
      const {seed, destProject, destForms} = await seedClonedForms();

      await quiet(() => runClone({
        submissionsOnly: true,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      assert.equal(await dbs.dst.count('projects'), 1, 'No project should be created.');
      assert.equal(await dbs.dst.count('forms'), destForms.length, 'No form should be created.');
      assert.equal(await dbs.dst.count('actions'), 0, 'No action should be cloned.');
      assert.equal(await dbs.dst.count('roles'), 0, 'No role should be cloned.');

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 2);
      for (const sub of submissions) {
        assert.equal(sub.project.toString(), destProject._id.toString(),
          'Submissions must reference the destination project, not the source project.');
        assert.equal(sub.form.toString(), destForms[0]._id.toString());
      }
    });

    it('Should not modify the existing destination forms', async function() {
      const {seed, destProject, destForms} = await seedClonedForms();
      await dbs.dst.collection('forms').updateOne(
        {_id: destForms[0]._id},
        {$set: {title: 'Destination Title'}}
      );

      await quiet(() => runClone({
        submissionsOnly: true,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const destForm = await dbs.dst.findOne('forms', {_id: destForms[0]._id});
      assert.equal(destForm.title, 'Destination Title');
    });

    it('Should not duplicate submissions when run twice', async function() {
      const {seed, destProject} = await seedClonedForms();
      const options = {
        submissionsOnly: true,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      };

      await quiet(() => runClone(options));
      await quiet(() => runClone(options));

      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should clone submissions added to the source after the first run', async function() {
      const {seed, destProject} = await seedClonedForms();
      const options = {
        submissionsOnly: true,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      };

      await quiet(() => runClone(options));

      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Later'},
        created: at(900),
        modified: at(900)
      }));

      await quiet(() => runClone(options));

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 3);
      assert.ok(submissions.some((sub) => sub.data.firstName === 'Later'));
      for (const sub of submissions) {
        assert.equal(sub.project.toString(), destProject._id.toString());
      }
    });
  });

  describe('Custom submission collections', function() {
    it('Should read and write submissions using the form collection setting', async function() {
      const seed = await seedProject(dbs.src, {
        forms: 1,
        submissions: 0,
        project: {name: 'srcproject'},
        formOverrides: [{settings: {collection: 'custom'}}]
      });
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'dstproject'}));

      await dbs.src.insert('srcproject_custom', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'In Custom Collection'},
        created: at(20),
        modified: at(20)
      }));

      await quiet(() => runClone({
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      assert.equal(await dbs.dst.count('submissions'), 0,
        'Submissions must not land in the default collection.');
      const custom = await dbs.dst.all('dstproject_custom');
      assert.equal(custom.length, 1);
      assert.equal(custom[0].data.firstName, 'In Custom Collection');
      assert.equal(custom[0].project.toString(), destProject._id.toString());
    });

    it('Should honor the collection setting when only cloning submissions', async function() {
      const seed = await seedProject(dbs.src, {
        forms: 1,
        submissions: 0,
        project: {name: 'srcproject'},
        formOverrides: [{settings: {collection: 'custom'}}]
      });
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'dstproject'}));
      await dbs.dst.insert('forms', form(Object.assign({}, seed.forms[0], {project: destProject._id})));

      await dbs.src.insert('srcproject_custom', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Custom Only'},
        created: at(20),
        modified: at(20)
      }));

      await quiet(() => runClone({
        submissionsOnly: true,
        srcProject: seed.project._id.toString(),
        dstProject: destProject._id.toString()
      }));

      assert.equal(await dbs.dst.count('submissions'), 0);
      const custom = await dbs.dst.all('dstproject_custom');
      assert.equal(custom.length, 1);
      assert.equal(custom[0].project.toString(), destProject._id.toString());
    });
  });

  describe('Encrypted submission data', function() {
    const srcDbSecret = 'source-db-secret';
    const dstDbSecret = 'destination-db-secret';
    const srcProjectSecret = 'source-project-secret';
    const dstProjectSecret = 'destination-project-secret';

    it('Should re-encrypt encrypted components with the destination project secret', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const srcForm = await dbs.src.insert('forms', form({
        title: 'Secure Form',
        project: srcProject._id,
        components: [{type: 'textfield', key: 'ssn', label: 'SSN', input: true, encrypted: true}]
      }));
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: srcProject._id,
        data: {ssn: crypt.encrypt(srcProjectSecret, '123-45-6789')},
        created: at(20),
        modified: at(20)
      }));

      // The destination project already exists with its own project secret.
      await dbs.dst.insert('projects', project(Object.assign({}, srcProject, {
        ['settings_encrypted']: crypt.encrypt(dstDbSecret, {secret: dstProjectSecret}, true)
      })));

      await quiet(() => runClone({srcDbSecret, dstDbSecret}));

      const cloned = (await dbs.dst.all('submissions'))[0];
      assert.ok(cloned, 'The submission should be cloned.');
      const decrypted = crypt.decrypt(dstProjectSecret, cloned.data.ssn);
      assert.equal(decrypted, '123-45-6789',
        'Encrypted data must be readable with the destination project secret.');
    });

    it('Should leave unencrypted components untouched', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted2',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const srcForm = await dbs.src.insert('forms', form({
        project: srcProject._id,
        components: [{type: 'textfield', key: 'firstName', label: 'First Name', input: true}]
      }));
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: srcProject._id,
        data: {firstName: 'Plain'},
        created: at(20),
        modified: at(20)
      }));
      await dbs.dst.insert('projects', project(Object.assign({}, srcProject, {
        ['settings_encrypted']: crypt.encrypt(dstDbSecret, {secret: dstProjectSecret}, true)
      })));

      await quiet(() => runClone({srcDbSecret, dstDbSecret}));

      const cloned = (await dbs.dst.all('submissions'))[0];
      assert.equal(cloned.data.firstName, 'Plain');
    });

    /**
     * Run a clone that is expected to fail, returning what it reported as errors and its error.
     */
    async function failingClone(options) {
      const warnings = [];
      const consoleError = console.error;
      console.error = (...args) => warnings.push(args.map(String).join(' '));
      let error = null;
      try {
        await quiet(() => runClone(options));
      }
      catch (err) {
        error = err;
      }
      finally {
        console.error = consoleError;
      }
      return {warnings, error};
    }

    it('Should not create a project whose settings it could not decrypt', async function() {
      // Copying the settings would give the destination settings it can never read.
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted4',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      await dbs.src.insert('forms', form({project: srcProject._id}));

      const {warnings, error} = await failingClone({srcDbSecret: 'the-wrong-secret', dstDbSecret});

      assert.equal(await dbs.dst.findOne('projects', {_id: srcProject._id}), null,
        'A project must not be created with settings the destination cannot read.');
      assert.equal(await dbs.dst.count('forms'), 0, 'Nothing of the project should be cloned.');
      assert.ok(warnings.some((line) => /could not be decrypted/.test(line)),
        'The operator must be told which project could not be decrypted.');
      assert.match(String(error && error.message), /1 project\(s\) had settings that could not be decrypted/,
        'The clone must not report success.');
    });

    it('Should never replace the settings of an existing project it could not decrypt', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted5',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const destSettings = crypt.encrypt(dstDbSecret, {secret: dstProjectSecret}, true);
      await dbs.dst.insert('projects', Object.assign({}, srcProject, {
        ['settings_encrypted']: destSettings,
        modified: new Date(srcProject.modified.getTime() - 1000)
      }));

      const {error} = await failingClone({srcDbSecret: 'the-wrong-secret', dstDbSecret});

      const cloned = await dbs.dst.findOne('projects', {_id: srcProject._id});
      assert.ok(Buffer.from(cloned['settings_encrypted'].buffer).equals(destSettings),
        'The destination settings must be kept as they are.');
      assert.ok(error, 'The clone must not report success.');
    });

    it('Should not copy unreadable settings into an existing project that has none', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted6',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      await dbs.dst.insert('projects', Object.assign({}, _.omit(srcProject, 'settings_encrypted'), {
        modified: new Date(srcProject.modified.getTime() - 1000)
      }));

      await failingClone({srcDbSecret: 'the-wrong-secret', dstDbSecret});

      const cloned = await dbs.dst.findOne('projects', {_id: srcProject._id});
      assert.equal(cloned['settings_encrypted'], undefined);
    });

    it('Should keep cloning the other projects when one cannot be decrypted', async function() {
      const crypt = crypter();
      const broken = project({
        title: 'Broken',
        name: 'broken',
        ['settings_encrypted']: crypt.encrypt('a-rotated-secret', {secret: 'gone'}, true)
      });
      await dbs.src.insert('projects', broken);
      const healthy = await seedProject(dbs.src, {
        forms: 1,
        submissions: 2,
        project: {title: 'Healthy', name: 'healthy'}
      });

      const {error} = await failingClone({srcDbSecret, dstDbSecret});

      assert.ok(error, 'The clone must report the project it could not clone.');
      const cloned = await dbs.dst.findOne('projects', {_id: healthy.project._id});
      assert.ok(cloned, 'A project that decrypts fine must still be cloned.');
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should migrate encrypted data into an existing project that has no settings yet', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted7',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const srcForm = await dbs.src.insert('forms', form({
        project: srcProject._id,
        components: [{type: 'textfield', key: 'ssn', input: true, encrypted: true}]
      }));
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: srcProject._id,
        data: {ssn: crypt.encrypt(srcProjectSecret, '123-45-6789')}
      }));
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await quiet(() => runClone({
        srcDbSecret,
        dstDbSecret,
        srcProject: srcProject._id.toString(),
        dstProject: destProject._id.toString()
      }));

      const cloned = (await dbs.dst.all('submissions'))[0];
      assert.equal(await quiet(async() => crypt.decrypt(dstDbSecret, cloned.data.ssn)), '123-45-6789',
        'Without a project secret of its own, the data is encrypted with the destination database secret.');
    });

    it('Should leave encrypted data alone when it cannot be re-encrypted', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted5',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const srcForm = await dbs.src.insert('forms', form({
        project: srcProject._id,
        components: [{type: 'textfield', key: 'ssn', label: 'SSN', input: true, encrypted: true}]
      }));
      // Encrypted with a secret this clone knows nothing about, as a rotated project would be.
      const original = crypt.encrypt('a-secret-nobody-has', '123-45-6789');
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: srcProject._id,
        data: {ssn: original},
        created: at(20),
        modified: at(20)
      }));
      await dbs.dst.insert('projects', project(Object.assign({}, srcProject, {
        ['settings_encrypted']: crypt.encrypt(dstDbSecret, {secret: dstProjectSecret}, true)
      })));

      await quiet(() => runClone({srcDbSecret, dstDbSecret}));

      const cloned = (await dbs.dst.all('submissions'))[0];
      assert.ok(cloned, 'The submission should still be cloned.');
      assert.notEqual(cloned.data.ssn, null,
        'Data that could not be re-encrypted must never be replaced with nothing.');
      assert.equal(
        Buffer.from(cloned.data.ssn.buffer || cloned.data.ssn).toString('base64'),
        original.toString('base64'),
        'The original encrypted value must be kept as it is.'
      );
    });

    it('Should keep the destination project settings', async function() {
      const crypt = crypter();
      const srcProject = project({
        title: 'Encrypted',
        name: 'encrypted3',
        ['settings_encrypted']: crypt.encrypt(srcDbSecret, {secret: srcProjectSecret}, true)
      });
      await dbs.src.insert('projects', srcProject);
      const destSettings = crypt.encrypt(dstDbSecret, {secret: dstProjectSecret}, true);
      await dbs.dst.insert('projects', project(Object.assign({}, srcProject, {
        ['settings_encrypted']: destSettings
      })));

      await quiet(() => runClone({srcDbSecret, dstDbSecret}));

      const cloned = await dbs.dst.findOne('projects', {_id: srcProject._id});
      const settings = crypt.decrypt(dstDbSecret, cloned.settings_encrypted, true);
      assert.deepEqual(settings, {secret: dstProjectSecret},
        'The destination project settings must not be overwritten by the source settings.');
    });
  });

  describe('OSS sources', function() {
    it('Should clone an OSS database into a destination project', async function() {
      // An OSS database has no projects collection content.
      const srcForm = await dbs.src.insert('forms', form({title: 'OSS Form', project: null}));
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: null,
        data: {firstName: 'OSS User'},
        created: at(20),
        modified: at(20)
      }));
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await quiet(() => runClone({dstProject: destProject._id.toString()}));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms.length, 1);
      assert.equal(forms[0].project.toString(), destProject._id.toString());
      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].project.toString(), destProject._id.toString());
    });

    it('Should let --project name the destination project for an OSS source', async function() {
      const srcForm = await dbs.src.insert('forms', form({title: 'OSS Form', project: null}));
      await dbs.src.insert('submissions', submission({
        form: srcForm._id,
        project: null,
        data: {firstName: 'OSS User'},
        created: at(20),
        modified: at(20)
      }));
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await quiet(() => runClone({project: destProject._id.toString()}));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms.length, 1, 'The OSS forms should be cloned into the destination project.');
      assert.equal(forms[0].project.toString(), destProject._id.toString());
      assert.equal(await dbs.dst.count('submissions'), 1);
    });

    it('Should fail clearly when a source project is requested from an OSS database', async function() {
      const srcForm = await dbs.src.insert('forms', form({title: 'OSS Form', project: null}));
      await dbs.src.insert('submissions', submission({form: srcForm._id, project: null}));
      const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));

      await assert.rejects(
        () => quiet(() => runClone({
          srcProject: new ObjectId().toString(),
          dstProject: destProject._id.toString()
        })),
        /open source|oss/i
      );
    });
  });
});
