'use strict';
const mongodb = require('mongodb');
const async = require('async');
const _ = require('lodash');
const fs = require('fs');
const MongoClient = mongodb.MongoClient;

module.exports = function(source, destination, options) {
  const mongoConfig = (type) => {
    const config = {
      useNewUrlParser: true,
      useUnifiedTopology: true
    };
    if (options[`${type}Ca`]) {
      const caFile = options[`${type}Ca`];
      config.tlsCAFile = `${process.cwd()}/${caFile}`;
      config.tlsAllowInvalidHostnames = true;
    }
    return config;
  };

  const srcConfig = mongoConfig('src');
  console.log(`Connecting to ${source} with config ${JSON.stringify(srcConfig, null, 2)}\n`);
  MongoClient.connect(source, srcConfig, (err, _src) => {
    if (err) {
      return console.log(`Could not connect to source database ${source}: ${err.message}`);
    }

    console.log(`Succesfully connected to ${source}`);
    const srcDb = _src.db(_src.s.options.dbName);
    const src = {
      db: srcDb,
      projects: srcDb.collection('projects'),
      forms: srcDb.collection('forms'),
      submissions: srcDb.collection('submissions'),
      roles: srcDb.collection('roles'),
      actions: srcDb.collection('actions'),
      formrevisions: srcDb.collection('formrevisions'),
      tags: srcDb.collection('tags')
    };

    const dstConfig = mongoConfig('dst');
    console.log(`\nConnecting to ${destination} with config ${JSON.stringify(dstConfig, null, 2)}\n`);
    MongoClient.connect(destination, dstConfig, (err, _dest) => {
      if (err) {
        return console.log(`Could not connect to destination database ${destination}`);
      }

      console.log(`Succesfully connected to ${destination}`);
      console.log('');
      const destDb = _dest.db(_dest.s.options.dbName);
      const dest = {
        db: destDb,
        projects: destDb.collection('projects'),
        forms: destDb.collection('forms'),
        submissions: destDb.collection('submissions'),
        roles: destDb.collection('roles'),
        actions: destDb.collection('actions'),
        formrevisions: destDb.collection('formrevisions'),
        tags: destDb.collection('tags')
      };

      const eachDocument = function(cursor, each, done) {
        let current = null;
        async.whilst(
          (test) => {
            cursor.next((err, doc) => {
              if (err) {
                current = null;
                return test(err);
              }
              current = doc;
              test(null, !!doc);
            });
          },
          (nextItem) => each(current, nextItem),
          done);
      };

      const upsertAll = function(collection, query, beforeEach, afterEach, done) {
        const cursor = src[collection].find(query);
        eachDocument(cursor, (current, nextItem) => {
          let cloned = current;
          try {
            cloned = JSON.parse(JSON.stringify(current));
          }
          catch (err) {
            console.error(`Error copying ${collection} ${current._id}`, err);
            return nextItem();
          }
          if (beforeEach) {
            beforeEach(cloned);
          }
          delete current._id;
          dest[collection].insertOne(cloned, (err, copy) => {
            if (err) {
              console.error(`Error creating ${collection} ${current._id}`, err);
              return nextItem();
            }
            process.stdout.write('.');
            if (afterEach) {
              afterEach(current, copy, nextItem);
            }
            else {
              nextItem();
            }
          });
        }, done);
      };

      if (options.submissionsOnly) {
        console.log(`Cloning all submissions from project ${options.srcProject} to ${options.dstProject}.`);
        if (!options.dstProject) {
          return console.log(`You must provide a destination project. --dst-project=<project_id>`);
        }

        if (!options.srcProject) {
          return console.log(`You must provide a source project. --src-project=<project_id>`);
        }

        const dstFormCursor = dest.forms.find({
          project: mongodb.ObjectID(options.dstProject),
          deleted: {$eq: null}
        });
        eachDocument(dstFormCursor, (dstForm, nextForm) => {
          src.forms.findOne({
            project: mongodb.ObjectID(options.srcProject),
            name: dstForm.name
          }, (err, srcForm) => {
            if (err) {
              return nextForm(err);
            }
            if (!srcForm) {
              return nextForm();
            }

            console.log('');
            let deletePromise = Promise.resolve();
            if (options.deleteSubmissions) {
              console.log(`Deleting submissions from ${dstForm.title}`);
              deletePromise = dest.submissions.deleteMany({
                project: dstForm.project,
                form: dstForm._id
              });
            }

            deletePromise.then(() => {
              process.stdout.write(`Cloning submissions from form ${srcForm.title}: `);
              upsertAll('submissions', {
                form: srcForm._id,
                project: srcForm.project,
                deleted: {$eq: null}
              }, (submission) => {
                submission.form = dstForm._id;
                submission.project = dstForm.project;
              }, null,() => nextForm());
            });
          });
        }, () => {
          console.log('');
          console.log('DONE!');
        });
      }
      else {
        let itemQuery = {};
        let formItemQuery = {};
        let projectQuery = {};
        const sourceProject = options.project || options.srcProject;
        if (sourceProject) {
          projectQuery = {_id: mongodb.ObjectID(sourceProject)};
        }
        else if (options.deletedAfter) {
          projectQuery = {
            $or: [
              {deleted: {$eq: null}},
              {deleted: {$gt: parseInt(options.deletedAfter, 10)}}
            ]
          };
          itemQuery = {...projectQuery};
          formItemQuery = {...projectQuery};
        }
        else if (!options.all) {
          projectQuery = {deleted: {$eq: null}};
          itemQuery = {...projectQuery};
          formItemQuery = {...projectQuery};
        }

        upsertAll('projects', projectQuery, null, (project, clonedProject, nextProject) => {
          // Do not include the formio project
          if (project.name === 'formio') {
            return nextProject();
          }
          itemQuery.project = project._id;
          process.stdout.write("\n");
          process.stdout.write(`Project ${project._id}: `);
          upsertAll('forms', itemQuery, (form) => {
            form.project = clonedProject._id;
          }, (form, clonedForm, nextForm) => {
            formItemQuery.form = form._id;
            process.stdout.write("\n");
            process.stdout.write(` - Form ${form._id}: `);
            process.stdout.write("\n");
            process.stdout.write(`   - Submissions: : `);
            upsertAll('submissions', formItemQuery, (sub) => {
              sub.form = clonedForm._id;
              sub.project = clonedProject._id;
            }, null, () => {
              process.stdout.write("\n");
              process.stdout.write(`   - Actions: : `);
              upsertAll('actions', formItemQuery, (action) => {
                action.form = clonedForm._id;
              }, null, () => nextForm());
            });
          }, () => {
            upsertAll('roles', itemQuery, (role) => {
              role.project = clonedProject._id;
            }, null, () => {
              upsertAll('tags', itemQuery, (tag) => {
                tag.project = clonedProject._id;
              }, null, () => {
                upsertAll('formrevisions', itemQuery, (revision) => {
                  revision.project = clonedProject._id;
                }, null, () => nextProject());
              });
            });
          });
        }, () => {
          console.log('');
          console.log('DONE!');
        });
      }
    });
  });
};
