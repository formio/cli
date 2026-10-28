/* globals describe, it */
'use strict';
const assert = require('assert');
const {seedProject, project, submissionRevision, formRevision, tag} = require('./fixtures');
const {useTestDatabases, createCloner, runClone, quiet} = require('./helper');

describe('Callbacks and handlers', function() {
  const dbs = useTestDatabases();

  /**
   * Run a clone, capturing everything it reports as an error. A clean clone must be silent: errors
   * logged per document hide broken callbacks behind what looks like a data problem.
   */
  async function cloneCapturingErrors(options) {
    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      await quiet(() => runClone(options));
    }
    finally {
      console.error = consoleError;
    }
    return errors;
  }

  it('Should clone everything without reporting a single error', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 2});
    for (const sub of seed.submissions) {
      await dbs.src.insert('submissionrevisions', submissionRevision({
        _rid: sub._id,
        form: sub.form,
        project: sub.project
      }));
    }
    for (const frm of seed.forms) {
      await dbs.src.insert('formrevisions', formRevision({_rid: frm._id, project: seed.project._id}));
    }
    await dbs.src.insert('tags', tag({project: seed.project._id, tag: '0.0.2'}));

    const errors = await cloneCapturingErrors({
      includeSubmissionRevisions: true,
      includeFormRevisions: true
    });

    assert.deepEqual(errors, [], 'A clean clone must not log any errors.');
    assert.equal(await dbs.dst.count('submissionrevisions'), 4);
    assert.equal(await dbs.dst.count('formrevisions'), 2);
    assert.equal(await dbs.dst.count('tags'), 2);
  });

  it('Should run the afterAll handler for every collection', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    await dbs.src.insert('submissionrevisions', submissionRevision({
      _rid: seed.submissions[0]._id,
      form: seed.forms[0]._id,
      project: seed.project._id
    }));
    await dbs.src.insert('formrevisions', formRevision({
      _rid: seed.forms[0]._id,
      project: seed.project._id
    }));

    const seen = new Set();
    const cloner = createCloner({includeSubmissionRevisions: true, includeFormRevisions: true});
    await quiet(() => cloner.clone(null, async(collection) => {
      seen.add(collection);
    }));
    cloner.destroy();

    for (const collection of ['projects', 'roles', 'forms', 'submissions', 'tags',
      'submissionrevisions', 'formrevisions']) {
      assert.ok(seen.has(collection), `The afterAll handler never ran for ${collection}.`);
    }
  });

  it('Should scope the resume point of every collection that is walked more than once', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 1});
    for (const sub of seed.submissions) {
      await dbs.src.insert('submissionrevisions', submissionRevision({
        _rid: sub._id,
        form: sub.form,
        project: sub.project
      }));
    }
    for (const frm of seed.forms) {
      await dbs.src.insert('formrevisions', formRevision({_rid: frm._id, project: seed.project._id}));
    }

    const keys = new Set();
    const cloner = createCloner({includeSubmissionRevisions: true, includeFormRevisions: true});
    const each = cloner.each.bind(cloner);
    cloner.each = (collection, query, cb, sort, options = {}) => {
      keys.add(options.stateKey || collection);
      return each(collection, query, cb, sort, options);
    };
    await quiet(() => cloner.clone());
    cloner.destroy();

    for (const collection of ['submissions', 'submissionrevisions', 'formrevisions', 'actions']) {
      const unscoped = [...keys].filter((key) => key === `src.${collection}`);
      assert.deepEqual(unscoped, [],
        `${collection} is walked once per parent, so its resume point must be scoped.`);
      assert.ok([...keys].some((key) => key.startsWith(`src.${collection}:`)),
        `No scoped resume point was used for ${collection}.`);
    }
  });

  it('Should refuse a handler that is not a function', async function() {
    const cloner = createCloner({});
    await assert.rejects(
      () => cloner.upsertAll('tags', {}, null, () => {}, {scope: 'oops'}),
      /afterEach handler of tags is a object/
    );
    cloner.destroy();
  });

  it('Should not bury a broken callback under one error per document', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});
    const cloner = createCloner({});
    await assert.rejects(
      () => quiet(() => cloner.clone(null, () => {
        throw new TypeError('someCallback is not a function');
      })),
      /someCallback is not a function/
    );
    cloner.destroy();
  });

  it('Should leave the destination project access alone with --no-update-existing', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 0});
    // The source and the destination must genuinely differ, otherwise rewriting the access would
    // not be visible.
    await dbs.src.collection('projects').updateOne({_id: seed.project._id},
      {$set: {access: [{type: 'read_all', roles: [seed.roles[1]._id]}]}});
    const destProject = await dbs.dst.insert('projects', project(Object.assign({}, seed.project, {
      access: [{type: 'create_all', roles: []}]
    })));

    await quiet(() => runClone({updateExisting: false}));

    const cloned = await dbs.dst.findOne('projects', {_id: destProject._id});
    assert.deepEqual(cloned.access.map((entry) => entry.type), ['create_all'],
      'The access of an existing destination project must not be rewritten.');
  });

  it('Should clone a destination project that has no access array', async function() {
    const seed = await seedProject(dbs.src, {forms: 1, submissions: 1});
    // There must be something to migrate, otherwise nothing would touch the missing array.
    await dbs.src.collection('projects').updateOne({_id: seed.project._id},
      {$set: {access: [{type: 'create_all', roles: [seed.roles[0]._id]}]}});
    // A document written by an older version of the servers, without the field at all.
    const destProject = project(Object.assign({}, seed.project));
    delete destProject.access;
    await dbs.dst.insert('projects', destProject);

    const errors = await cloneCapturingErrors({});

    assert.deepEqual(errors, [], 'A missing access array is data, not a reason to stop.');
    assert.equal(await dbs.dst.count('submissions'), 1);

    const cloned = await dbs.dst.findOne('projects', {_id: destProject._id});
    assert.deepEqual((cloned.access || []).map((entry) => entry.type), ['create_all'],
      'The access of the source should be migrated onto a destination that had none.');
  });

  it('Should close both connections when the clone fails', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 1});
    const cloner = createCloner({srcProject: 'not-an-object-id'});

    await assert.rejects(() => quiet(() => cloner.clone()));

    assert.equal(cloner.src.client, null, 'The source connection should be closed.');
    assert.equal(cloner.dest.client, null, 'The destination connection should be closed.');
  });

  it('Should not stall on a batch size below one', async function() {
    await seedProject(dbs.src, {forms: 1, submissions: 3});

    await quiet(() => runClone({batchSize: '-1'}));

    assert.equal(await dbs.dst.count('submissions'), 3);
  });
});
