'use strict';
const Cloner = require('../src/Cloner');
const {faker} = require('@faker-js/faker');
module.exports = {
  async newDeployment(srcDb, dstDb, oss) {
    const cloner = new Cloner(srcDb, dstDb);
    const roles = [];
    const forms = [];
    const submissions = [];
    const actions = [];
    const actionItems = [];
    await cloner.connect();
    const project = {
      title: `Test Project ${faker.string.alphanumeric(10)}`,
      name: `test${faker.string.alpha(10)}`,
      type: 'project',
      tag: '0.0.0',
      owner: null,
      project: null,
      deleted: null,
      created: new Date(),
      modified: new Date()
    };
    if (oss) {
      project._id = (await cloner.dest.projects.insertOne(project)).insertedId;
    }
    else {
      project._id = (await cloner.src.projects.insertOne(project)).insertedId;
    }
    for (let i = 0; i < 5; i++) {
      const role = {
        title: faker.person.jobType,
        description: '',
        deleted: null,
        default: false,
        admin: false,
        created: new Date(),
        modified: new Date()
      };
      if (!oss) {
        role.project = project._id;
      }
      role._id = (await cloner.src.roles.insertOne(role)).insertedId;
      roles.push(role);
    }
    for (let i = 0; i < 5; i++) {
      const form = {
        title: `Form ${faker.string.alpha(10)}`,
        path: faker.string.alpha(10),
        name: faker.string.alpha(10),
        type: 'form',
        deleted: null,
        components: [
          {type: 'textfield', key: 'a', label: 'A'},
          {type: 'textfield', key: 'b', label: 'B'},
          {type: 'textfield', key: 'c', label: 'C'}
        ]
      };
      if (!oss) {
        form.project = project._id;
      }
      form._id = (await cloner.src.forms.insertOne(form)).insertedId;
      forms.push(form);
      const action = {
        title: 'Save Submission',
        name: 'save',
        handler: ['before'],
        method: ['create', 'update'],
        priority: 10,
        form: form._id,
        deleted: null,
        settings: {}
      };
      action._id = (await cloner.src.actions.insertOne(action)).insertedId;
      actions.push(action);
      for (let j = 0; j < 20; j++) {
        const submission = {
          form: form._id,
          owner: null,
          deleted: null,
          roles: [],
          access: [],
          metadata: {},
          data: {
            a: faker.string.alpha(10),
            b: faker.string.alpha(10),
            c: faker.string.alpha(10)
          }
        };
        if (!oss) {
          submission.project = project._id;
        }
        submission._id = (await cloner.src.submissions.insertOne(submission)).insertedId;
        submissions.push(submission);
      }
    }
    return {
      cloner,
      project,
      roles,
      forms,
      submissions,
      actions,
      actionItems
    };
  }
};
