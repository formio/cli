/* globals describe, it, before */
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

module.exports = (mongoSrc= null, mongoDest=null) => {
  describe('', function() {
    it('Clear server Data',  function(done) {
      done();
    });

    before(async() => {
      src= null;
      dst= null;
      try {
        if (mongoSrc) {
          src = await connectDb(mongoSrc);
        }

        if (mongoDest) {
          dst = await connectDb(mongoDest);
        }

        if (!mongoSrc && !mongoDest) {
          throw new Error('You need to provide at least one database path to be cleaned');
        }
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

        const srcCollections = src? [src.forms, src.actions, src.roles, src.projects, src.submissions]:[];
        const dstCollections = dst? [dst.forms, dst.actions, dst.roles, dst.projects, dst.submissions]:[];

        const collectionsToClean = [...srcCollections, ...dstCollections];

        async.series(
          collectionsToClean.map(x=> {
            return async.apply(dropDocuments, x);
          }), (err)=> {
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

