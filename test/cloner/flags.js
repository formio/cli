/* globals describe, it */
'use strict';
const assert = require('assert');
const {seedProject, at, form, submission, formRevision, submissionRevision} = require('./fixtures');
const {useTestDatabases, runClone, quiet, writeCloneState} = require('./helper');

describe('Clone flags', function() {
  const dbs = useTestDatabases();

  describe('--all', function() {
    it('Should skip deleted items by default', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await dbs.src.insert('forms', form({
        title: 'Deleted Form',
        project: seed.project._id,
        deleted: at(10).getTime()
      }));
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        deleted: at(10).getTime()
      }));

      await quiet(() => runClone({}));

      assert.equal(await dbs.dst.count('forms'), 1);
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should include deleted items when set', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await dbs.src.insert('forms', form({
        title: 'Deleted Form',
        project: seed.project._id,
        deleted: at(10).getTime()
      }));
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        deleted: at(10).getTime()
      }));

      await quiet(() => runClone({all: true}));

      assert.equal(await dbs.dst.count('forms'), 2);
      assert.equal(await dbs.dst.count('submissions'), 3);
    });
  });

  describe('--deleted-after', function() {
    it('Should include live items and items deleted after the timestamp', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Deleted Early'},
        deleted: at(10).getTime()
      }));
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Deleted Late'},
        deleted: at(50).getTime()
      }));

      await quiet(() => runClone({deletedAfter: `${at(30).getTime()}`}));

      const submissions = await dbs.dst.all('submissions');
      const names = submissions.map((sub) => sub.data.firstName).sort();
      assert.deepEqual(names, ['Deleted Late', 'User 1-1']);
    });

    it('Should include every deleted item when combined with --all', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Deleted Early'},
        deleted: at(10).getTime()
      }));

      await quiet(() => runClone({all: true, deletedAfter: `${at(30).getTime()}`}));

      assert.equal(await dbs.dst.count('submissions'), 2);
    });
  });

  describe('--created-after', function() {
    it('Should only clone submissions created after the timestamp', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      for (const minutes of [10, 20, 30, 40]) {
        await dbs.src.insert('submissions', submission({
          form: seed.forms[0]._id,
          project: seed.project._id,
          data: {firstName: `Sub ${minutes}`},
          created: at(minutes),
          modified: at(minutes)
        }));
      }

      await quiet(() => runClone({createdAfter: `${at(25).getTime()}`}));

      const names = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
      assert.deepEqual(names, ['Sub 30', 'Sub 40']);
    });

    it('Should still clone new submissions of forms that are older than the timestamp', async function() {
      // The form was created long ago, but has new submissions. This is the incremental clone case:
      // the form itself is not re-written, but its submissions must still land in the right place.
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0, project: {created: at(0), modified: at(0)}});
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Recent'},
        created: at(90),
        modified: at(90)
      }));

      await quiet(() => runClone({createdAfter: `${at(50).getTime()}`}));

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].data.firstName, 'Recent');
      assert.equal(submissions[0].form.toString(), seed.forms[0]._id.toString());
      assert.equal(submissions[0].project.toString(), seed.project._id.toString());
    });
  });

  describe('--modified-after', function() {
    it('Should only clone submissions modified after the timestamp', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Stale'},
        created: at(10),
        modified: at(10)
      }));
      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Fresh'},
        created: at(10),
        modified: at(80)
      }));

      await quiet(() => runClone({modifiedAfter: `${at(50).getTime()}`}));

      const names = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName);
      assert.deepEqual(names, ['Fresh']);
    });
  });

  describe('--forms', function() {
    it('Should only clone the provided forms and their submissions', async function() {
      const seed = await seedProject(dbs.src, {forms: 3, submissions: 2});

      await quiet(() => runClone({forms: seed.forms[1]._id.toString()}));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms.length, 1);
      assert.equal(forms[0]._id.toString(), seed.forms[1]._id.toString());
      assert.equal(await dbs.dst.count('submissions'), 2);
    });

    it('Should accept a comma separated list of forms', async function() {
      const seed = await seedProject(dbs.src, {forms: 3, submissions: 1});

      await quiet(() => runClone({
        forms: `${seed.forms[0]._id.toString()},${seed.forms[2]._id.toString()}`
      }));

      const ids = (await dbs.dst.all('forms')).map((frm) => frm._id.toString()).sort();
      assert.deepEqual(ids, [seed.forms[0]._id.toString(), seed.forms[2]._id.toString()].sort());
      assert.equal(await dbs.dst.count('submissions'), 2);
    });
  });

  describe('--exclude', function() {
    it('Should not clone the excluded forms or their submissions', async function() {
      const seed = await seedProject(dbs.src, {forms: 3, submissions: 2});

      await quiet(() => runClone({exclude: seed.forms[1]._id.toString()}));

      const ids = (await dbs.dst.all('forms')).map((frm) => frm._id.toString());
      assert.equal(ids.length, 2);
      assert.ok(!ids.includes(seed.forms[1]._id.toString()), 'The excluded form should not be cloned.');
      assert.equal(await dbs.dst.count('submissions'), 4);
      assert.equal(await dbs.dst.count('submissions', {form: seed.forms[1]._id}), 0);
    });
  });

  describe('--delete-submissions', function() {
    it('Should remove the destination submissions of a form before cloning it', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await quiet(() => runClone({}));

      // Add a submission to the destination that does not exist in the source.
      const destForm = (await dbs.dst.all('forms'))[0];
      await dbs.dst.insert('submissions', submission({
        form: destForm._id,
        project: destForm.project,
        data: {firstName: 'Only In Destination'},
        created: at(500),
        modified: at(500)
      }));
      assert.equal(await dbs.dst.count('submissions'), 3);

      await quiet(() => runClone({deleteSubmissions: true}));

      const names = (await dbs.dst.all('submissions')).map((sub) => sub.data.firstName).sort();
      assert.deepEqual(names, ['User 1-1', 'User 1-2']);
      assert.equal(seed.submissions.length, 2);
    });

    it('Should clone every submission again when resuming an interrupted clone', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 4});
      await quiet(() => runClone({}));

      // A previous run deleted the submissions of the form, cloned half of them and was killed.
      writeCloneState({
        [`src.submissions:${seed.forms[0]._id}`]: {
          created: seed.submissions[1].created.toISOString(),
          _id: seed.submissions[1]._id.toString()
        }
      });

      await quiet(() => runClone({deleteSubmissions: true}));

      assert.equal(await dbs.dst.count('submissions'), 4,
        'The submissions before the resume point must not be lost.');
    });
  });

  describe('--include-form-revisions', function() {
    it('Should not clone form revisions by default', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await dbs.src.insert('formrevisions', formRevision({
        _rid: seed.forms[0]._id,
        project: seed.project._id
      }));

      await quiet(() => runClone({}));

      assert.equal(await dbs.dst.count('formrevisions'), 0);
    });

    it('Should clone form revisions when set', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await dbs.src.insert('formrevisions', formRevision({
        _rid: seed.forms[0]._id,
        project: seed.project._id
      }));

      await quiet(() => runClone({includeFormRevisions: true}));

      const revisions = await dbs.dst.all('formrevisions');
      assert.equal(revisions.length, 1);
      assert.equal(revisions[0]._rid.toString(), seed.forms[0]._id.toString());
    });
  });

  describe('--include-submission-revisions', function() {
    it('Should not clone submission revisions by default', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      await dbs.src.insert('submissionrevisions', submissionRevision({
        _rid: seed.submissions[0]._id,
        form: seed.forms[0]._id,
        project: seed.project._id
      }));

      await quiet(() => runClone({}));

      assert.equal(await dbs.dst.count('submissionrevisions'), 0);
    });

    it('Should clone submission revisions when set', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      for (const sub of seed.submissions) {
        await dbs.src.insert('submissionrevisions', submissionRevision({
          _rid: sub._id,
          form: seed.forms[0]._id,
          project: seed.project._id,
          data: sub.data
        }));
      }

      await quiet(() => runClone({includeSubmissionRevisions: true}));

      const revisions = await dbs.dst.all('submissionrevisions');
      assert.equal(revisions.length, 2);
      const rids = revisions.map((rev) => rev._rid.toString()).sort();
      assert.deepEqual(rids, seed.submissions.map((sub) => sub._id.toString()).sort());
    });
  });

  describe('--update-existing-submissions', function() {
    it('Should update a destination submission when the source submission changed', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      await quiet(() => runClone({}));

      await dbs.src.collection('submissions').updateOne(
        {_id: seed.submissions[0]._id},
        {$set: {data: {firstName: 'Changed'}, modified: at(900)}}
      );

      await quiet(() => runClone({updateExistingSubmissions: true}));

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 1, 'The submission should be updated, not duplicated.');
      assert.equal(submissions[0].data.firstName, 'Changed');
    });

    it('Should not rewrite destination submissions that have not changed', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await quiet(() => runClone({}));

      // Mark the destination documents so we can detect a rewrite.
      await dbs.dst.collection('submissions').updateMany({}, {$set: {marker: 'untouched'}});

      await quiet(() => runClone({updateExistingSubmissions: true}));

      const submissions = await dbs.dst.all('submissions');
      assert.equal(submissions.length, 2);
      for (const sub of submissions) {
        assert.equal(sub.marker, 'untouched', 'An unchanged submission should not be rewritten.');
      }
      assert.equal(seed.submissions.length, 2);
    });

    it('Should not create duplicates when the source has new and existing submissions', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
      await quiet(() => runClone({}));

      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'Brand New'},
        created: at(950),
        modified: at(950)
      }));

      await quiet(() => runClone({updateExistingSubmissions: true}));

      assert.equal(await dbs.dst.count('submissions'), 3);
    });
  });

  describe('--update-existing', function() {
    it('Should update an existing destination form by default', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await quiet(() => runClone({}));

      await dbs.src.collection('forms').updateOne(
        {_id: seed.forms[0]._id},
        {$set: {title: 'Renamed Form', modified: at(900)}}
      );

      await quiet(() => runClone({}));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms.length, 1);
      assert.equal(forms[0].title, 'Renamed Form');
    });

    it('Should leave existing destination projects and forms alone when disabled', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
      await quiet(() => runClone({}));

      await dbs.src.collection('forms').updateOne(
        {_id: seed.forms[0]._id},
        {$set: {title: 'Renamed Form', modified: at(900)}}
      );
      await dbs.src.collection('projects').updateOne(
        {_id: seed.project._id},
        {$set: {title: 'Renamed Project', modified: at(900)}}
      );

      await quiet(() => runClone({updateExisting: false}));

      const forms = await dbs.dst.all('forms');
      assert.equal(forms[0].title, 'Test Form 1', 'The existing form should not be updated.');
      const projects = await dbs.dst.all('projects');
      assert.equal(projects[0].title, 'Test Project', 'The existing project should not be updated.');
    });

    it('Should still clone new submissions when updating existing forms is disabled', async function() {
      const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
      await quiet(() => runClone({}));

      await dbs.src.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        data: {firstName: 'After'},
        created: at(950),
        modified: at(950)
      }));

      await quiet(() => runClone({updateExisting: false}));

      assert.equal(await dbs.dst.count('submissions'), 2);
    });
  });
});
