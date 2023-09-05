/* eslint-disable max-depth */
/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';
const async = require('async');
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
      submissions: db.collection('submissions'),
      roles: db.collection('roles'),
      actions: db.collection('actions')
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
        src = await connectDb(process.env.MONGO_SRC);
        dst = await connectDb(process.env.MONGO_DST);
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

