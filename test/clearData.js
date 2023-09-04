/* eslint-disable max-depth */
/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';
var async = require('async');
require('dotenv').config();
const {MongoClient} = require('mongodb');

let src, dst;

const connectDb = async(uri) => {
  try {
    console.log(`Connecting to ${uri}\n`);
    const client = new MongoClient(uri, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    await client.connect();
    const db = await client.db();
    console.log(`Succesfully connected to ${uri}`);
    return {
      client,
      db,
      projects: db.collection('projects'),
      forms: db.collection('forms'),
      ogSubmissions: db.collection('submissions'),
      submissions: db.collection('submissions'),
      submissionrevisions: db.collection('submissionrevisions'),
      roles: db.collection('roles'),
      actions: db.collection('actions'),
      actionItems: db.collection('actionitems'),
      formrevisions: db.collection('formrevisions'),
      tags: db.collection('tags')
    };
  }
  catch (err) {
    throw new Error(`Could not connect to database ${uri}: ${err.message}`);
  }
};

module.exports = () => {
  describe('', function() {
    it('Clear server Data',  function(done) {
      done();
    });

    before(async() => {
      try {
        src = await connectDb(`mongodb://localhost:27017/${process.env.DATA_BASE_SRC}`);
        dst = await connectDb(`mongodb://localhost:27017/${process.env.DATA_BASE_DST}`);
      }
      catch (err) {
        console.log(err);
      }
    });

    before((done) => {
      const clearData = () => {
        var dropDocuments = async function(model, next) {
          await model.deleteMany({});
          next();
        };

        async.series([
          async.apply(dropDocuments, src.forms),
          async.apply(dropDocuments, src.actions),
          async.apply(dropDocuments, src.roles),
          async.apply(dropDocuments, src.projects),
          async.apply(dropDocuments, src.submissions),
          async.apply(dropDocuments, dst.forms),
          async.apply(dropDocuments, dst.actions),
          async.apply(dropDocuments, dst.roles),
          async.apply(dropDocuments, dst.projects),
          async.apply(dropDocuments, dst.submissions)
        ], (err)=> {
          if (err) {
            done(err);
          }
          done();
        });
      };
      clearData();
    });
  });
};

