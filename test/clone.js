/* globals describe, it, before, after */
'use strict';
const assert = require('assert');
const utils = require('./util');

module.exports = () => {
  describe('Clone Command', function() {
    require('./clearData')(process.env.MONGO_CLONE_SRC, process.env.MONGO_CLONE_DST);
    let deployment = null;
    describe('One database to another.', function() {
      before('Create two projects with resources and submissions.', async() => {
        deployment = await utils.newDeployment(
          process.env.MONGO_CLONE_SRC,
          process.env.MONGO_CLONE_DST
        );
      });
      it('Should clone all projects and submissions from one to another.', async() => {
        deployment.cloner.options = {
          srcProject: deployment.project._id.toString()
        };
        await deployment.cloner.clone(null, (collection, beforeItem, afterItem) => {
          if (collection === 'projects') {
            assert(beforeItem.name.toString() === afterItem.name.toString(), 'The project names should be the same.');
          }
          assert(beforeItem._id.toString() === afterItem._id.toString(), 'The _id should be the same.');
        });

        const dstSubs = await deployment.cloner.dest.submissions.find({}).toArray();
        assert.equal(dstSubs.length, 100);
        assert(
          await deployment.cloner.dest.forms.findOne({_id: dstSubs[0].form}),
          'There should be a form in the destination database.'
        );
        assert(
          await deployment.cloner.dest.projects.findOne({_id: dstSubs[0].project}),
          'There should be a project in the destination database.'
        );
      });
      after('Delete the projects.', async() => {
        await deployment.cloner.src.db.dropDatabase();
        await deployment.cloner.dest.db.dropDatabase();
      });
    });

    describe('Same database.', function() {
      it('Should throw error when tying to clone within the same database', async() => {
        try {
          await utils.newDeployment(
            process.env.MONGO_CLONE_SRC,
            process.env.MONGO_CLONE_SRC
          );
        }
        catch (err) {
          assert.equal(err.message, 'Source and destination databases cannot be the same.');
        }
      });
    });

    describe('Clone Command: OSS to enterprise.', function() {
      let deployment = null;
      before('Create two projects with resources and submissions.', async() => {
        deployment = await utils.newDeployment(
          process.env.MONGO_CLONE_SRC,
          process.env.MONGO_CLONE_DST,
          true
        );
      });
      it('Should clone from OSS to enterprise', async() => {
        deployment.cloner.options = {
          dstProject: deployment.project._id.toString()
        };
        await deployment.cloner.clone();
        assert.equal((await deployment.cloner.dest.roles.find({
          project: deployment.project._id
        }).toArray()).length, 5);
        assert.equal((await deployment.cloner.dest.forms.find({
          project: deployment.project._id
        }).toArray()).length, 5);
        assert.equal((await deployment.cloner.dest.actions.find({}).toArray()).length, 5);
        assert.equal((await deployment.cloner.dest.submissions.find({
          project: deployment.project._id
        }).toArray()).length, 100);
      });
      after('Delete the projects.', async() => {
        await deployment.cloner.src.db.dropDatabase();
        await deployment.cloner.dest.db.dropDatabase();
      });
    });
  });
};
