/* globals describe, it */
'use strict';
const assert = require('assert');
const {seedProject} = require('./fixtures');
const {useTestDatabases, runClone, quiet} = require('./helper');

describe('Basic cloning', function() {
  const dbs = useTestDatabases();

  it('Should clone a project, its roles, forms, actions, submissions and tags', async function() {
    const seed = await seedProject(dbs.src, {forms: 2, submissions: 3});

    await quiet(() => runClone({}));

    assert.equal(await dbs.dst.count('projects'), 1);
    assert.equal(await dbs.dst.count('roles'), 3);
    assert.equal(await dbs.dst.count('forms'), 2);
    assert.equal(await dbs.dst.count('actions'), 2);
    assert.equal(await dbs.dst.count('submissions'), 6);
    assert.equal(await dbs.dst.count('tags'), 1);

    const destProject = await dbs.dst.findOne('projects', {_id: seed.project._id});
    assert.ok(destProject, 'The project should retain its _id.');
    assert.equal(destProject.title, seed.project.title);
  });

  it('Should be idempotent when run twice', async function() {
    await seedProject(dbs.src, {forms: 2, submissions: 3});

    await quiet(() => runClone({}));
    await quiet(() => runClone({}));

    assert.equal(await dbs.dst.count('projects'), 1);
    assert.equal(await dbs.dst.count('forms'), 2);
    assert.equal(await dbs.dst.count('submissions'), 6);
  });
});
