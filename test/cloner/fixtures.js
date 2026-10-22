'use strict';
const {MongoClient, ObjectId} = require('mongodb');

const SRC_URI = process.env.CLONER_TEST_SRC || 'mongodb://localhost:27018/cloner-test-src';
const DST_URI = process.env.CLONER_TEST_DST || 'mongodb://localhost:27018/cloner-test-dst';

// Every document created by these fixtures uses a deterministic clock so that tests can assert on
// created/modified filters without depending on wall time.
const BASE_TIME = Date.UTC(2024, 0, 1);

/**
 * Convert an offset (in minutes from the base time) into a Date.
 * @param {number} minutes - The number of minutes from the base time.
 */
function at(minutes) {
  return new Date(BASE_TIME + (minutes * 60000));
}

/**
 * A thin wrapper around a test database, used to seed and inspect data.
 */
class TestDb {
  constructor(uri) {
    this.uri = uri;
    this.client = null;
    this.db = null;
  }

  async connect() {
    this.client = new MongoClient(this.uri);
    await this.client.connect();
    this.db = this.client.db();
    return this;
  }

  /**
   * Drop every collection of the database. Collections are dropped rather than emptied so that a
   * test can never inherit the indexes or validation rules another test left behind.
   */
  async reset() {
    const collections = await this.db.listCollections().toArray();
    for (const info of collections) {
      await this.db.collection(info.name).drop().catch(() => {});
    }
  }

  collection(name) {
    return this.db.collection(name);
  }

  /**
   * Return all documents of a collection, sorted by creation date.
   * @param {string} name - The collection name.
   * @param {object} query - An optional query.
   */
  async all(name, query = {}) {
    return await this.db.collection(name).find(query).sort({created: 1}).toArray();
  }

  /**
   * Return the number of documents matching a query.
   * @param {string} name - The collection name.
   * @param {object} query - An optional query.
   */
  async count(name, query = {}) {
    return await this.db.collection(name).countDocuments(query);
  }

  async findOne(name, query) {
    return await this.db.collection(name).findOne(query);
  }

  async insert(name, doc) {
    await this.db.collection(name).insertOne(doc);
    return doc;
  }

  async close() {
    if (this.client) {
      await this.client.close();
      this.client = null;
    }
  }
}

/**
 * Build a project document.
 * @param {object} options - Overrides for the project document.
 */
function project(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    title: 'Test Project',
    name: `test-project-${new ObjectId().toString().slice(-6)}`,
    type: 'project',
    plan: 'commercial',
    owner: new ObjectId(),
    project: null,
    access: [],
    deleted: null,
    created: at(0),
    modified: at(0),
    machineName: `test-project-${new ObjectId().toString().slice(-6)}`
  }, options);
}

/**
 * Build a role document.
 * @param {object} options - Overrides for the role document.
 */
function role(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    title: 'Authenticated',
    description: '',
    project: null,
    default: false,
    admin: false,
    deleted: null,
    created: at(0),
    modified: at(0)
  }, options);
}

/**
 * Build a form document.
 * @param {object} options - Overrides for the form document.
 */
function form(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    title: 'Test Form',
    name: `testForm${new ObjectId().toString().slice(-6)}`,
    path: `testform${new ObjectId().toString().slice(-6)}`,
    type: 'form',
    display: 'form',
    project: null,
    components: [{
      type: 'textfield',
      key: 'firstName',
      label: 'First Name',
      input: true
    }],
    access: [],
    submissionAccess: [],
    settings: {},
    deleted: null,
    created: at(0),
    modified: at(0),
    machineName: `test:form${new ObjectId().toString().slice(-6)}`
  }, options);
}

/**
 * Build a submission document.
 * @param {object} options - Overrides for the submission document.
 */
function submission(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    form: null,
    project: null,
    owner: null,
    roles: [],
    access: [],
    data: {firstName: 'Bob'},
    deleted: null,
    created: at(0),
    modified: at(0)
  }, options);
}

/**
 * Build an action document.
 * @param {object} options - Overrides for the action document.
 */
function action(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    title: 'Save Submission',
    name: 'save',
    form: null,
    handler: ['before'],
    method: ['create', 'update'],
    priority: 10,
    settings: {},
    deleted: null,
    created: at(0),
    modified: at(0),
    machineName: `test:save${new ObjectId().toString().slice(-6)}`
  }, options);
}

/**
 * Build a form revision document.
 * @param {object} options - Overrides for the form revision document.
 */
function formRevision(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    _rid: null,
    project: null,
    title: 'Test Form',
    name: 'testForm',
    path: 'testform',
    components: [],
    _vid: 1,
    deleted: null,
    created: at(0),
    modified: at(0)
  }, options);
}

/**
 * Build a submission revision document.
 * @param {object} options - Overrides for the submission revision document.
 */
function submissionRevision(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    _rid: null,
    form: null,
    project: null,
    data: {firstName: 'Bob'},
    _vid: 1,
    deleted: null,
    created: at(0),
    modified: at(0)
  }, options);
}

/**
 * Build a tag document.
 * @param {object} options - Overrides for the tag document.
 */
function tag(options = {}) {
  return Object.assign({
    _id: new ObjectId(),
    project: null,
    tag: '0.0.1',
    template: {},
    deleted: null,
    created: at(0),
    modified: at(0)
  }, options);
}

/**
 * Seed a complete project (roles, forms, submissions, actions, tags) into a database.
 *
 * @param {TestDb} db - The database to seed.
 * @param {object} options - The seeding options.
 * @param {object} options.project - Overrides for the project document.
 * @param {number} options.forms - The number of forms to create.
 * @param {number} options.submissions - The number of submissions to create per form.
 * @returns {object} - The seeded documents.
 */
async function seedProject(db, options = {}) {
  const proj = project(options.project || {});
  await db.insert('projects', proj);

  const roles = [];
  for (const title of options.roles || ['Administrator', 'Authenticated', 'Anonymous']) {
    roles.push(await db.insert('roles', role({title, project: proj._id})));
  }

  const forms = [];
  const submissions = [];
  const actions = [];
  const formCount = options.forms === undefined ? 2 : options.forms;
  const submissionCount = options.submissions === undefined ? 3 : options.submissions;

  for (let f = 0; f < formCount; f++) {
    const created = at(f + 1);
    const frm = await db.insert('forms', form(Object.assign({
      title: `Test Form ${f + 1}`,
      name: `testForm${f + 1}`,
      path: `testform${f + 1}`,
      machineName: `test:form${f + 1}`,
      project: proj._id,
      created,
      modified: created,
      submissionAccess: [{type: 'read_all', roles: [roles[1]._id]}]
    }, (options.formOverrides || [])[f] || {})));
    forms.push(frm);

    actions.push(await db.insert('actions', action({
      form: frm._id,
      machineName: `test:form${f + 1}:save`,
      created,
      modified: created
    })));

    for (let s = 0; s < submissionCount; s++) {
      const subCreated = at(((f + 1) * 100) + s);
      submissions.push(await db.insert('submissions', submission({
        form: frm._id,
        project: proj._id,
        roles: [roles[1]._id],
        data: {firstName: `User ${f + 1}-${s + 1}`},
        created: subCreated,
        modified: subCreated
      })));
    }
  }

  const tags = [await db.insert('tags', tag({project: proj._id}))];

  return {project: proj, roles, forms, submissions, actions, tags};
}

module.exports = {
  SRC_URI,
  DST_URI,
  BASE_TIME,
  at,
  TestDb,
  project,
  role,
  form,
  submission,
  action,
  formRevision,
  submissionRevision,
  tag,
  seedProject
};
