/* globals describe, it, before, after, beforeEach */
'use strict';
const assert = require('assert');
const express = require('express');
const {ObjectId} = require('mongodb');
const {at, project, role, form, submission, action, formRevision, submissionRevision} = require('./fixtures');
const {useTestDatabases, runClone, quiet, DST_URI} = require('./helper');

/**
 * A minimal stand-in for the Form.io API, serving the endpoints the cloner uses.
 */
function createApiServer() {
  const state = {
    project: null,
    roles: [],
    forms: [],
    submissions: {},
    actions: {},
    revisions: {},
    tags: [],
    requests: [],
    failures: {}
  };

  const app = express();

  app.use((req, res, next) => {
    state.requests.push({url: req.originalUrl, headers: req.headers});
    const failure = state.failures[req.path];
    if (failure) {
      if (failure.type === 'text') {
        return res.status(failure.status).type('text/plain').send(failure.body);
      }
      return res.status(failure.status).json(failure.body);
    }
    return next();
  });

  /**
   * Apply the limit/skip paging parameters the cloner sends.
   */
  function page(req, items) {
    const limit = Math.min(parseInt(req.query.limit, 10) || 1000, state.maxPageSize || Infinity);
    const skip = parseInt(req.query.skip, 10) || 0;
    let filtered = items;
    if (req.query.created__gt) {
      const after = parseInt(req.query.created__gt, 10);
      filtered = filtered.filter((item) => new Date(item.created).getTime() > after);
    }
    return filtered.slice(skip, skip + limit);
  }

  app.get('/', (req, res) => res.json(state.project));
  app.get('/role', (req, res) => {
    if (state.failRoleLookup && !req.query.limit) {
      // The paged listing succeeds; the direct lookup the cloner does afterwards fails.
      return res.status(500).json({message: 'Internal Server Error'});
    }
    return res.json(state.ignorePaging ? state.roles : page(req, state.roles));
  });
  app.get('/role/:roleId', (req, res) => {
    const found = state.roles.concat(state.hiddenRoles || []).find((item) => item._id === req.params.roleId);
    return found ? res.json(found) : res.status(404).json({message: 'Not found'});
  });
  app.get('/tag', (req, res) => res.json(page(req, state.tags)));
  app.get('/form', (req, res) => res.json(page(req, state.forms)));
  app.get('/form/:formId/submission', (req, res) => res.json(page(req, state.submissions[req.params.formId] || [])));
  app.get('/form/:formId/action', (req, res) => res.json(page(req, state.actions[req.params.formId] || [])));
  app.get('/form/:formId/v', (req, res) => res.json(page(req, state.revisions[req.params.formId] || [])));
  app.get('/form/:formId/submission/:submissionId/v', (req, res) => {
    return res.json(page(req, state.submissionRevisions[req.params.submissionId] || []));
  });

  return {app, state};
}

/**
 * Convert a fixture document into the JSON shape the API returns (string ids, ISO dates).
 */
function asApi(doc) {
  const converted = {};
  for (const [key, value] of Object.entries(doc)) {
    if (value instanceof ObjectId) {
      converted[key] = value.toString();
    }
    else if (value instanceof Date) {
      converted[key] = value.toISOString();
    }
    else if (Array.isArray(value)) {
      converted[key] = value.map((item) => (item instanceof ObjectId ? item.toString() : item));
    }
    else {
      converted[key] = value;
    }
  }
  return converted;
}

describe('Cloning from an API source', function() {
  const dbs = useTestDatabases();
  let server = null;
  let api = null;
  let baseUrl = null;

  before('Start the fake API', function(done) {
    api = createApiServer();
    server = api.app.listen(0, () => {
      baseUrl = `http://localhost:${server.address().port}`;
      done();
    });
  });

  after('Stop the fake API', function(done) {
    server.close(done);
  });

  beforeEach('Reset the fake API', function() {
    const proj = project({title: 'Api Project', name: 'apiproject'});
    const roles = [
      role({title: 'Administrator', project: proj._id}),
      role({title: 'Authenticated', project: proj._id})
    ];
    const frm = form({title: 'Api Form', project: proj._id});
    const submissions = [];
    for (let i = 0; i < 3; i++) {
      submissions.push(submission({
        form: frm._id,
        project: proj._id,
        data: {firstName: `Api User ${i}`},
        created: at(100 + i),
        modified: at(100 + i)
      }));
    }

    api.state.project = asApi(proj);
    api.state.roles = roles.map(asApi);
    api.state.forms = [asApi(frm)];
    api.state.submissions = {[frm._id.toString()]: submissions.map(asApi)};
    api.state.actions = {};
    api.state.revisions = {};
    api.state.submissionRevisions = {};
    api.state.hiddenRoles = [];
    api.state.tags = [];
    api.state.requests = [];
    api.state.failures = {};
    api.state.ignorePaging = false;
    api.state.maxPageSize = null;
    api.state.failRoleLookup = false;
    api.state.ids = {project: proj._id, form: frm._id, submissions: submissions.map((sub) => sub._id)};
  });

  it('Should clone a project, roles, forms and submissions from the API', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));

    assert.equal(await dbs.dst.count('projects'), 1);
    assert.equal(await dbs.dst.count('roles'), 2);
    assert.equal(await dbs.dst.count('forms'), 1);
    assert.equal(await dbs.dst.count('submissions'), 3);

    const cloned = await dbs.dst.findOne('submissions', {_id: api.state.ids.submissions[0]});
    assert.ok(cloned, 'Submission ids should be retained.');
    assert.ok(cloned.created instanceof Date, 'Dates should be stored as dates.');
    assert.ok(cloned.form instanceof ObjectId, 'Ids should be stored as ObjectIds.');
  });

  it('Should send the raw data access header', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));

    const withHeader = api.state.requests.filter((req) => req.headers['x-raw-data-access']);
    assert.ok(withHeader.length > 0, 'The cloner should send the x-raw-data-access header.');
  });

  it('Should page through submissions using the limit', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key', limit: '2'}, baseUrl, DST_URI));

    assert.equal(await dbs.dst.count('submissions'), 3);
    const submissionRequests = api.state.requests.filter((req) => req.url.includes('/submission?'));
    assert.ok(submissionRequests.length >= 2, 'The cloner should request more than one page.');
    assert.ok(submissionRequests.every((req) => req.url.includes('limit=2')));
  });

  it('Should fail with a clear error when the API returns a server error', async function() {
    api.state.failures[`/form/${api.state.ids.form.toString()}/submission`] = {
      status: 500,
      body: {message: 'Internal Server Error'}
    };

    await assert.rejects(
      () => quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI)),
      (err) => {
        assert.match(err.message, /500/, 'The error should mention the status code.');
        assert.doesNotMatch(err.message, /Cannot read properties of undefined/);
        return true;
      }
    );
  });

  it('Should stop paging when the API reports the range is not satisfiable', async function() {
    api.state.failures[`/form/${api.state.ids.form.toString()}/submission`] = {
      status: 416,
      type: 'text',
      body: 'Invalid resource range'
    };

    await quiet(() => runClone({apiSource: true, key: 'test-key', limit: '2'}, baseUrl, DST_URI));

    const submissionRequests = api.state.requests.filter((req) => req.url.includes('/submission?'));
    assert.ok(submissionRequests.length <= 2,
      `A 416 response must end paging, made ${submissionRequests.length} requests.`);
    assert.equal(await dbs.dst.count('submissions'), 0);
  });

  it('Should clone every page when the API returns smaller pages than asked for', async function() {
    // Servers are free to cap the page size below the requested limit.
    api.state.maxPageSize = 2;

    await quiet(() => runClone({apiSource: true, key: 'test-key', limit: '1000'}, baseUrl, DST_URI));

    assert.equal(await dbs.dst.count('submissions'), 3,
      'A page smaller than the limit must not be treated as the end of the data.');
  });

  it('Should stop instead of looping when the API ignores the skip parameter', async function() {
    api.state.ignorePaging = true;

    await quiet(() => runClone({apiSource: true, key: 'test-key', limit: '1'}, baseUrl, DST_URI));

    const roleRequests = api.state.requests.filter((req) => req.url.startsWith('/role?'));
    assert.ok(roleRequests.length <= 3,
      `A repeated page must end paging, made ${roleRequests.length} requests.`);
  });

  it('Should clone only submissions from an API source without a destination project', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key', submissionsOnly: true}, baseUrl, DST_URI));

    assert.equal(await dbs.dst.count('projects'), 0);
    assert.equal(await dbs.dst.count('forms'), 0);
    assert.equal(await dbs.dst.count('roles'), 0);
    assert.equal(await dbs.dst.count('submissions'), 3);
  });

  it('Should fail rather than skip the project when the roles cannot be fetched', async function() {
    api.state.failures['/role'] = {status: 500, body: {message: 'Internal Server Error'}};

    await assert.rejects(
      () => quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI)),
      /500|role/i
    );

    assert.equal(await dbs.dst.count('submissions'), 0,
      'A clone that could not read the roles must not silently report success.');
  });

  it('Should fail rather than skip the project when the role lookup fails', async function() {
    api.state.failRoleLookup = true;

    await assert.rejects(
      () => quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI)),
      /roles/i
    );

    assert.equal(await dbs.dst.count('submissions'), 0,
      'The forms and submissions of a project whose roles are unknown must not be cloned.');
  });

  it('Should refuse --extra against an API source instead of crashing', async function() {
    const warnings = [];
    const consoleError = console.error;
    console.error = (...args) => warnings.push(args.map(String).join(' '));
    try {
      await quiet(() => runClone({apiSource: true, key: 'test-key', dryRun: true, extra: true},
        baseUrl, DST_URI));
    }
    finally {
      console.error = consoleError;
    }

    assert.ok(warnings.some((line) => /--extra cannot be used with --api-source/.test(line)),
      `Expected a clear warning, got: ${JSON.stringify(warnings)}`);
  });

  it('Should clone into an existing destination project when one is given', async function() {
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'destination'}));

    await quiet(() => runClone({
      apiSource: true,
      key: 'test-key',
      dstProject: destProject._id.toString()
    }, baseUrl, DST_URI));

    assert.equal(await dbs.dst.count('projects'), 1, 'The source project should not be created.');
    const forms = await dbs.dst.all('forms');
    assert.equal(forms.length, 1);
    assert.equal(forms[0].project.toString(), destProject._id.toString());
    const submissions = await dbs.dst.all('submissions');
    assert.equal(submissions.length, 3);
    for (const sub of submissions) {
      assert.equal(sub.project.toString(), destProject._id.toString());
    }
  });

  it('Should only fetch submissions created after the last cloned submission', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));
    api.state.requests = [];

    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));

    const submissionRequests = api.state.requests.filter((req) => req.url.includes('/submission?'));
    assert.ok(submissionRequests.length > 0);
    assert.ok(submissionRequests.every((req) => req.url.includes('created__gt=')),
      'An incremental run should ask the API only for newer submissions.');
    assert.equal(await dbs.dst.count('submissions'), 3);
  });

  it('Should clone form and submission revisions from the API', async function() {
    const formId = api.state.ids.form;
    const submissionId = api.state.ids.submissions[0];
    api.state.revisions[formId.toString()] = [asApi(formRevision({
      _rid: formId,
      project: api.state.ids.project
    }))];
    api.state.submissionRevisions[submissionId.toString()] = [asApi(submissionRevision({
      _rid: submissionId,
      form: formId,
      project: api.state.ids.project
    }))];

    await quiet(() => runClone({
      apiSource: true,
      key: 'test-key',
      includeFormRevisions: true,
      includeSubmissionRevisions: true
    }, baseUrl, DST_URI));

    const formRevisions = await dbs.dst.all('formrevisions');
    assert.equal(formRevisions.length, 1);
    assert.equal(formRevisions[0]._rid.toString(), formId.toString());
    const submissionRevisions = await dbs.dst.all('submissionrevisions');
    assert.equal(submissionRevisions.length, 1);
    assert.equal(submissionRevisions[0]._rid.toString(), submissionId.toString());
    assert.ok(api.state.requests.some((req) => req.url.startsWith(`/form/${formId}/v?`)));
    assert.ok(api.state.requests.some((req) => req.url.startsWith(`/form/${formId}/submission/${submissionId}/v?`)));
  });

  it('Should map the role of an action through the role API', async function() {
    // A role the paged listing does not return has to be looked up on its own.
    const hidden = role({title: 'Authenticated', project: api.state.ids.project});
    api.state.hiddenRoles = [asApi(hidden)];
    api.state.actions[api.state.ids.form.toString()] = [asApi(action({
      form: api.state.ids.form,
      settings: {role: hidden._id.toString()}
    }))];

    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));

    const authenticated = await dbs.dst.findOne('roles', {title: 'Authenticated'});
    const cloned = (await dbs.dst.all('actions'))[0];
    assert.equal(cloned.settings.role, authenticated._id.toString(),
      'The action role should point at the destination role with the same title.');
    assert.ok(api.state.requests.some((req) => req.url === `/role/${hidden._id}`));
  });

  it('Should report an action role the API cannot find', async function() {
    const missing = new ObjectId();
    api.state.actions[api.state.ids.form.toString()] = [asApi(action({
      form: api.state.ids.form,
      settings: {role: missing.toString()}
    }))];

    const errors = [];
    const consoleError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));
    }
    finally {
      console.error = consoleError;
    }

    assert.ok(errors.some((line) => /Failed to fetch role: 404/.test(line)),
      `Expected the failed role lookup to be reported, got: ${JSON.stringify(errors)}`);
    const cloned = (await dbs.dst.all('actions'))[0];
    assert.equal(cloned.settings.role, missing.toString(), 'A role that cannot be looked up is kept, not wiped.');
  });

  it('Should read the source project when cloning it into a destination project', async function() {
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'destination'}));

    await quiet(() => runClone({
      apiSource: true,
      key: 'test-key',
      srcProject: api.state.ids.project.toString(),
      dstProject: destProject._id.toString()
    }, baseUrl, DST_URI));

    assert.ok(api.state.requests.some((req) => req.url === '/'), 'The source project should be fetched.');
    assert.equal(await dbs.dst.count('projects'), 1);
    const forms = await dbs.dst.all('forms');
    assert.equal(forms.length, 1);
    assert.equal(forms[0].project.toString(), destProject._id.toString());
  });

  it('Should fail clearly when the source project cannot be fetched', async function() {
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'destination'}));
    api.state.failures['/'] = {status: 403, body: {message: 'Forbidden'}};

    await assert.rejects(
      () => quiet(() => runClone({
        apiSource: true,
        key: 'test-key',
        srcProject: api.state.ids.project.toString(),
        dstProject: destProject._id.toString()
      }, baseUrl, DST_URI)),
      /Failed to fetch the source project: 403/
    );
    assert.equal(await dbs.dst.count('forms'), 0);
  });

  it('Should read the source project when cloning into a destination project without --src-project', async function() {
    const destProject = await dbs.dst.insert('projects', project({title: 'Destination', name: 'destination'}));

    await quiet(() => runClone({
      apiSource: true,
      key: 'test-key',
      dstProject: destProject._id.toString()
    }, baseUrl, DST_URI));

    assert.ok(api.state.requests.some((req) => req.url === '/'),
      'The source project holds the secrets of its encrypted data, so it must be fetched.');
  });

  it('Should not rewrite unchanged items on a second run', async function() {
    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));
    // Anything the second run rewrites loses this marker.
    for (const name of ['projects', 'forms', 'roles']) {
      await dbs.dst.collection(name).updateMany({}, {$set: {marker: true}});
    }

    await quiet(() => runClone({apiSource: true, key: 'test-key'}, baseUrl, DST_URI));

    for (const name of ['projects', 'forms', 'roles']) {
      assert.equal(await dbs.dst.count(name, {marker: true}), await dbs.dst.count(name),
        `The ${name} the API returns as date strings must be recognised as unchanged.`);
    }
  });

  it('Should honor --created-after with the dates the API returns', async function() {
    await quiet(() => runClone({
      apiSource: true,
      key: 'test-key',
      createdAfter: String(at(101).getTime() - 1)
    }, baseUrl, DST_URI));

    const cloned = await dbs.dst.all('submissions');
    assert.deepEqual(cloned.map((sub) => sub._id.toString()).sort(),
      api.state.ids.submissions.slice(1).map((id) => id.toString()).sort());
  });
});
