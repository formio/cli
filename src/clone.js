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
      config.sslValidate = true;
      config.ca = fs.readFileSync(options[`${type}Ca`]).toString();
    }
    return config;
  };

  console.log(`Connecting to ${source}`);
  MongoClient.connect(source, mongoConfig('src'), (err, _src) => {
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

    console.log(`Connecting to ${destination}`);
    MongoClient.connect(destination, mongoConfig('dst'), (err, _dest) => {
      if (err) {
        return console.log(`Could not connect to destination database ${destination}`);
      }

      console.log(`Succesfully connected to ${destination}`);
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

      const upsertAll = function(collection, query, each, done) {
        const cursor = src[collection].find(query);
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
          (nextItem) => {
            dest[collection].replaceOne({_id: current._id}, current, {upsert: true}, (err) => {
              if (err) {
                console.error(`Error updating ${collection} ${current._id}`, err);
                return nextItem();
              }
              process.stdout.write('.');
              if (each) {
                each(current, nextItem);
              }
              else {
                nextItem();
              }
            });
          },
        done);
      };

      let itemQuery = {};
      let formItemQuery = {};
      let projectQuery = {};
      if (options.project) {
        projectQuery = {_id: mongodb.ObjectID(options.project)};
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

      upsertAll('projects', projectQuery, (project, nextProject) => {
        // Do not include the formio project
        if (project.name === 'formio') {
          return nextProject();
        }
        itemQuery.project = project._id;
        process.stdout.write("\n");
        process.stdout.write(`Project ${project._id}: `);
        upsertAll('forms', itemQuery, (form, nextForm) => {
          formItemQuery.form = form._id;
          process.stdout.write("\n");
          process.stdout.write(` - Form ${form._id}: `);
          process.stdout.write("\n");
          process.stdout.write(`   - Submissions: : `);
          upsertAll('submissions', formItemQuery, null, () => {
            process.stdout.write("\n");
            process.stdout.write(`   - Actions: : `);
            upsertAll('actions', formItemQuery, null, () => nextForm());
          });
        }, () => {
          upsertAll('roles', itemQuery, null, () => {
            upsertAll('tags', itemQuery, null, () => {
              upsertAll('formrevisions', itemQuery, null, () => nextProject());
            });
          });
        });
      }, () => {
        console.log('');
        console.log('DONE!');
      });
    });
  });
};
