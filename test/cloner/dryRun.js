/* globals describe, it */
'use strict';
const assert = require('assert');
const {ObjectId} = require('mongodb');
const {seedProject, at, project, form, submission} = require('./fixtures');
const {useTestDatabases, runClone, createCloner, quiet, dryRunLines, cloneStateExists} = require('./helper');

describe('--dry-run', function() {
  const dbs = useTestDatabases();

  /**
   * Run something with everything it prints captured.
   * @param {Function} cb - What to run.
   */
  async function captureOutput(cb) {
    const chunks = [];
    const write = process.stdout.write;
    const log = console.log;
    const error = console.error;
    process.stdout.write = (text) => {
      chunks.push(String(text));
      return true;
    };
    console.log = (...args) => chunks.push(`${args.join(' ')}\n`);
    console.error = (...args) => chunks.push(`${args.join(' ')}\n`);
    try {
      // eslint-disable-next-line callback-return
      await cb();
    }
    finally {
      process.stdout.write = write;
      console.log = log;
      console.error = error;
    }
    return chunks.join('');
  }

  it('Should not write anything to the destination', async function() {
    await seedProject(dbs.src, {forms: 2, submissions: 3});

    await quiet(() => runClone({dryRun: true}));

    assert.equal(await dbs.dst.count('projects'), 0);
    assert.equal(await dbs.dst.count('forms'), 0);
    assert.equal(await dbs.dst.count('roles'), 0);
    assert.equal(await dbs.dst.count('actions'), 0);
    assert.equal(await dbs.dst.count('submissions'), 0);
    assert.equal(await dbs.dst.count('tags'), 0);
  });

  it('Should log one "Created" line per submission that would be inserted', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 3});

    await quiet(() => runClone({dryRun: true, extra: true}));

    const lines = dryRunLines();
    assert.equal(lines.length, 6, 'There should be one line per submission.');
    for (const line of lines) {
      assert.match(line, /^Created [a-f0-9]{24} form=[a-f0-9]{24}$/, `Unexpected line: ${line}`);
    }
    const ids = lines.map((line) => line.split(' ')[1]).sort();
    assert.deepEqual(ids, seed.submissions.map((sub) => sub._id.toString()).sort());
  });

  it('Should log "Updated" for submissions that already exist in the destination', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
    await quiet(() => runClone({}));

    await dbs.src.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$set: {data: {firstName: 'Changed'}, modified: at(900)}}
    );

    await quiet(() => runClone({dryRun: true, extra: true, updateExistingSubmissions: true}));

    const lines = dryRunLines();
    assert.equal(lines.length, 1, 'Only the changed submission should be reported.');
    assert.equal(lines[0].split(' ').slice(0, 2).join(' '),
      `Updated ${seed.submissions[0]._id.toString()}`);
    const destSubmission = await dbs.dst.findOne('submissions', {_id: seed.submissions[0]._id});
    assert.equal(destSubmission.data.firstName, 'User 1-1', 'The destination must not be modified.');
  });

  it('Should report a mix of created and updated submissions', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await quiet(() => runClone({}));

    await dbs.src.collection('submissions').updateOne(
      {_id: seed.submissions[0]._id},
      {$set: {data: {firstName: 'Changed'}, modified: at(900)}}
    );
    const added = await dbs.src.insert('submissions', submission({
      form: seed.forms[0]._id,
      project: seed.project._id,
      data: {firstName: 'New'},
      created: at(950),
      modified: at(950)
    }));

    await quiet(() => runClone({dryRun: true, extra: true, updateExistingSubmissions: true}));

    const reported = dryRunLines().map((line) => line.split(' ').slice(0, 2).join(' ')).sort();
    assert.deepEqual(reported, [
      `Created ${added._id.toString()}`,
      `Updated ${seed.submissions[0]._id.toString()}`
    ].sort());
  });

  it('Should only report submissions, not forms, roles, actions or projects', async function() {
    await seedProject(dbs.src, {forms: 2, submissions: 1});

    await quiet(() => runClone({dryRun: true, extra: true}));

    const lines = dryRunLines();
    assert.equal(lines.length, 2);
  });

  it('Should write out the findings of each form as it goes', async function() {
    // With more forms than the flush size, output must already be on disk before the clone ends.
    const seed = await seedProject(dbs.src, {forms: 3, submissions: 2});
    const flushes = [];
    const cloner = await quiet(async() => {
      const Cloner = require('../../src/Cloner');
      const instance = new Cloner(require('./helper').SRC_URI, require('./helper').DST_URI,
        {dryRun: true, extra: true});
      const originalFlush = instance.flushDryRun.bind(instance);
      instance.flushDryRun = () => {
        flushes.push(instance.dryRunBuffer.length);
        return originalFlush();
      };
      await instance.clone();
      if (typeof instance.destroy === 'function') {
        instance.destroy();
      }
      return instance;
    });

    assert.ok(cloner);
    const nonEmptyFlushes = flushes.filter((size) => size > 0);
    assert.equal(nonEmptyFlushes.length, seed.forms.length,
      'The buffer should be flushed once per form that produced operations.');
    assert.deepEqual(nonEmptyFlushes, [2, 2, 2]);
    assert.equal(dryRunLines().length, 6);
  });

  it('Should not create or keep a clone state file', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});

    await quiet(() => runClone({dryRun: true}));

    assert.equal(cloneStateExists(), false, 'A dry run must not leave a clonestate.json behind.');
  });

  it('Should start from an empty file on every run', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 2});

    await quiet(() => runClone({dryRun: true, extra: true}));
    assert.equal(dryRunLines().length, 2);

    await quiet(() => runClone({dryRun: true, extra: true}));
    assert.equal(dryRunLines().length, 2, 'Each run reports only its own findings.');
  });

  it('Should not delete destination submissions when --delete-submissions is set', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 2});
    await quiet(() => runClone({}));
    assert.equal(await dbs.dst.count('submissions'), 2);

    await quiet(() => runClone({dryRun: true, deleteSubmissions: true}));

    assert.equal(await dbs.dst.count('submissions'), 2, 'A dry run must not delete anything.');
  });

  it('Should report records that a plain clone would never look at', async function() {
    // Without --update-existing-submissions a clone starts after the last one it cloned. The dry
    // run is a comparison, so it has to check every record of the form regardless.
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));

    // One record goes missing from the destination, one falls behind, both older than the newest.
    await dbs.dst.collection('submissions').deleteOne({_id: seed.submissions[0]._id});
    await dbs.src.collection('submissions').updateOne({_id: seed.submissions[1]._id},
      {$set: {data: {firstName: 'Changed'}, modified: at(900)}});

    await quiet(() => runClone({dryRun: true, extra: true}));

    const reported = dryRunLines().map((line) => line.split(' ').slice(0, 2).join(' ')).sort();
    assert.deepEqual(reported, [
      `Created ${seed.submissions[0]._id.toString()}`,
      `Updated ${seed.submissions[1]._id.toString()}`
    ].sort(), 'Both the missing and the out of date record should be reported.');
  });

  it('Should report submissions the destination has and the source does not', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
    await quiet(() => runClone({}));
    const orphan = await dbs.dst.insert('submissions', submission({
      form: seed.forms[0]._id,
      project: seed.project._id,
      data: {firstName: 'Only in the destination'},
      created: at(950),
      modified: at(950)
    }));

    await quiet(() => runClone({dryRun: true, extra: true}));

    const extra = dryRunLines().filter((line) => line.startsWith('Extra '));
    assert.equal(extra.length, 1);
    assert.equal(extra[0].split(' ')[1], orphan._id.toString());
  });

  it('Should report every extra submission when they span more than one batch', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
    await quiet(() => runClone({}));
    const orphans = [];
    for (let i = 0; i < 3; i++) {
      orphans.push(await dbs.dst.insert('submissions', submission({
        form: seed.forms[0]._id,
        project: seed.project._id,
        created: at(950 + i),
        modified: at(950 + i)
      })));
    }

    await quiet(() => runClone({dryRun: true, extra: true, batchSize: 2}));

    const extra = dryRunLines().filter((line) => line.startsWith('Extra ')).map((line) => line.split(' ')[1]);
    assert.deepEqual(extra.sort(), orphans.map((orphan) => orphan._id.toString()).sort());
  });

  it('Should not look for extra submissions unless it is asked to', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await quiet(() => runClone({}));
    await dbs.dst.insert('submissions', submission({
      form: seed.forms[0]._id,
      project: seed.project._id,
      created: at(950),
      modified: at(950)
    }));

    await quiet(() => runClone({dryRun: true}));

    assert.deepEqual(dryRunLines().filter((line) => line.startsWith('Extra ')), []);
  });

  it('Should report the same way for one project as for many', async function() {
    const first = await seedProject(dbs.src, {forms: 1, submissions: 2, project: {title: 'First'}});
    await seedProject(dbs.src, {forms: 1, submissions: 2, project: {title: 'Second'}});

    // A project line, and a form line naming the form and what was found in it.
    const shape = (output) => output
      .split('\n')
      .map((line) => {
        if (/^project \S+ \([a-f0-9]{24}\)$/.test(line)) {
          return 'project';
        }
        return /^ {2}\S+ \([a-f0-9]{24}\)$/.test(line) ? 'form' : null;
      })
      .filter((kind) => kind);

    const one = await captureOutput(() => runClone({
      dryRun: true,
      project: first.project._id.toString()
    }));
    const many = await captureOutput(() => runClone({dryRun: true}));

    assert.deepEqual(shape(one), ['project', 'form'],
      `A single project should report a project and its form, got: ${one}`);
    assert.deepEqual(shape(many), ['project', 'form', 'project', 'form'],
      `Two projects should report the same shape twice, got: ${many}`);
  });

  it('Should say which of the projects asked for are not in the source', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});
    const absent = new ObjectId().toString();

    const output = await captureOutput(() => runClone({dryRun: true, project: absent}));

    assert.match(output, new RegExp(absent),
      'A project that is not in the source must be named, not silently skipped.');
  });

  it('Should report counts without listing the records by default', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));
    await dbs.dst.collection('submissions').deleteOne({_id: seed.submissions[0]._id});

    const output = await captureOutput(() => runClone({dryRun: true}));

    assert.deepEqual(dryRunLines(), [],
      'The submission ids are detail, only shown when they are asked for.');
    assert.match(output, /1 missing, 0 out of date/,
      'The per form counts should still be reported.');
    assert.match(output, /missing from the destination : 1/);
  });

  it('Should list the records when --extra is given', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));
    await dbs.dst.collection('submissions').deleteOne({_id: seed.submissions[0]._id});

    await quiet(() => runClone({dryRun: true, extra: true}));

    const lines = dryRunLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].split(' ')[1], seed.submissions[0]._id.toString());
  });

  it('Should count what it found', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 3});
    await quiet(() => runClone({}));
    await dbs.dst.collection('submissions').deleteOne({_id: seed.submissions[0]._id});

    const cloner = createCloner({dryRun: true});
    await quiet(() => cloner.clone());
    cloner.destroy();

    assert.equal(cloner.dryRunTotals.Created, 1);
    assert.equal(cloner.dryRunTotals.Updated || 0, 0);
  });

  it('Should report submissions for a submissions-only dry run', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 2});
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination'}));
    await dbs.dst.insert('forms', form(Object.assign({}, seed.forms[0], {project: destProject._id})));

    await quiet(() => runClone({
      dryRun: true,
      extra: true,
      submissionsOnly: true,
      srcProject: seed.project._id.toString(),
      dstProject: destProject._id.toString()
    }));

    assert.equal(dryRunLines().length, 2);
    assert.equal(await dbs.dst.count('submissions'), 0);
  });
});
