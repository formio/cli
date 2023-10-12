/* globals describe, it, before, after */
'use strict';
const assert = require('assert');
const utils = require('./util');
const Cloner = require('../src/Cloner');
const request = require('supertest');
const {ObjectId} = require('bson');
const {submissionFirst} = require('./templates/test');

module.exports = (template) => {
  describe('Clone Command', function() {
    let cloner = null;
    let dstDb = null;
    let previousAmountSubmissions = null;
    require('./clearData')(null, process.env.MONGO_DST);
    describe('Clone with API: checking general flow', function() {
      before('Create clone options', async() => {
        cloner = new Cloner(`${template.appSrc}/formioApi`, process.env.MONGO_DST, {
          apiSource: true,
          key: template.xToken,
        });
        dstDb = await cloner.connectDb(process.env.MONGO_DST);
      });
      it('Should clone with api', async() => {
        assert.equal((await dstDb.submissions.find({}).toArray()).length, 0);
        assert.equal((await dstDb.projects.find({}).toArray()).length, 0);
        assert.equal((await dstDb.forms.find({}).toArray()).length, 0);
        assert.equal((await dstDb.roles.find({}).toArray()).length, 0);

        await cloner.clone();
        const projects = await request(template.appSrc)
          .get('/project/'+ template.api.projectApi._id)
          .set('x-token', template.xToken);

        assert.equal((await dstDb.projects.find({}).toArray()).length, [projects.body].length);
        assert.equal((await dstDb.projects.find({}).toArray())[0].name, projects.body.name);

        const forms = await request(template.appSrc)
          .get('/project/'+ template.api.projectApi._id +'/form?limit=9999999')
          .set('x-token', template.xToken);

        assert.equal((await dstDb.forms.find({}).toArray()).length, forms.body.length);

        const submissions = await request(template.appSrc)
          .get('/project/'+ template.api.projectApi._id +'/form/'+ template.api.forms.textForm1._id +'/submission')
          .set('x-token', template.xToken);

        previousAmountSubmissions = submissions.body.length;
        // eslint-disable-next-line max-len
        assert.equal((await dstDb.submissions.find({form: new ObjectId(template.api.forms.textForm1._id)}).toArray()).length,
          previousAmountSubmissions);

        const roles = await request(template.appSrc)
          .get('/project/'+ template.api.projectApi._id +'/role')
          .set('x-token', template.xToken);

        assert.equal((await dstDb.roles.find({}).toArray()).length, roles.body.length);
      });

      it('Add one more submission to the textForm1 and clone again', async() => {
        await request(template.appSrc)
          // eslint-disable-next-line max-len
          .post( `/project/${template.api.projectApi._id}/form/${template.api.forms.textForm1._id}/submission`)
          .set('x-admin-key', process.env.ADMIN_KEY)
          .send(submissionFirst);

        await cloner.clone();

        // eslint-disable-next-line max-len
        assert.equal((await dstDb.submissions.find({form: new ObjectId(template.api.forms.textForm1._id)}).toArray()).length,
          previousAmountSubmissions + 1);
      });
    });

    require('./clearData')(null, process.env.MONGO_DST);
    describe('Clone with API: checking "only submissions" option', function() {
      before('Create clone options', async() => {
        cloner = new Cloner(`${template.appSrc}/formioApi`, process.env.MONGO_DST, {
          apiSource: true,
          key: template.xToken,
          submissionsOnly: true
        });
      });
      it('Should clone only submissions', async() => {
        assert.equal((await dstDb.submissions.find({}).toArray()).length, 0);
        assert.equal((await dstDb.projects.find({}).toArray()).length, 0);
        assert.equal((await dstDb.forms.find({}).toArray()).length, 0);
        assert.equal((await dstDb.roles.find({}).toArray()).length, 0);

        await cloner.clone();

        assert.notEqual((await dstDb.submissions.find({}).toArray()).length, 0);
        assert.equal((await dstDb.projects.find({}).toArray()).length, 0);
        assert.equal((await dstDb.forms.find({}).toArray()).length, 0);
        assert.equal((await dstDb.roles.find({}).toArray()).length, 0);
      });
    });
    describe('One database to another.', function() {
      require('./clearData')(process.env.MONGO_SRC, process.env.MONGO_DST);
      let deployment = null;
      describe('One database to another.', function() {
        before('Create two projects with resources and submissions.', async() => {
          deployment = await utils.newDeployment(
            process.env.MONGO_SRC,
            process.env.MONGO_DST
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
        require('./clearData')(process.env.MONGO_SRC, process.env.MONGO_DST);
      });

      describe('Same database.', function() {
        it('Should throw error when tying to clone within the same database', async() => {
          try {
            await utils.newDeployment(
              process.env.MONGO_SRC,
              process.env.MONGO_SRC
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
            process.env.MONGO_SRC,
            process.env.MONGO_DST,
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
        require('./clearData')(process.env.MONGO_SRC, process.env.MONGO_DST);
      });
      describe('Clone Command: checking "all" option', function() {
        before('Create two projects with resources and submissions.', async() => {
          deployment = await utils.newDeployment(
            process.env.MONGO_SRC,
            process.env.MONGO_DST
          );
        });
        describe('', function() {
          it('Should clone all documents including deleted documents', async() => {
            deployment.cloner.options = {
              srcProject: deployment.project._id.toString(),
              all:true

            };

            const srcSubmissions = await deployment.cloner.src.submissions.find({}).toArray();
            const srcForms = await deployment.cloner.src.forms.find({}).toArray();
            await deployment.cloner.src.submissions.updateOne({
              _id: srcSubmissions[0]._id
            }, {
              $set: {
                deleted: 12332434534523
              }
            });

            await deployment.cloner.src.forms.updateOne({
              _id: srcForms[0]._id
            }, {
              $set: {
                deleted: 12332434534523
              }
            });

            await deployment.cloner.clone();

            assert.equal((await deployment.cloner.dest.submissions.find({}).toArray()).length, srcSubmissions.length);
            assert.equal((await deployment.cloner.dest.forms.find({}).toArray()).length, srcForms.length);
          });
          require('./clearData')(null, process.env.MONGO_DST);
        });

        describe('', function() {
          it('Should clone all documents except deleted documents', async() => {
            deployment.cloner.options = {
              srcProject: deployment.project._id.toString(),
            };

            const srcSubmissions = await deployment.cloner.src.submissions.find({}).toArray();
            const srcForms = await deployment.cloner.src.forms.find({}).toArray();
            const submissionsWithoutFirstForm = srcSubmissions.
              filter(x=> x.form.toString() !== srcForms[0]._id.toString());

            await deployment.cloner.src.submissions.updateOne({
              _id: submissionsWithoutFirstForm[0]._id
            }, {
              $set: {
                deleted: 12332434534523
              }
            });

            await deployment.cloner.clone();

            assert.equal((await deployment.cloner.dest.submissions.find({}).toArray()).length,
              submissionsWithoutFirstForm.length-1);
            assert.equal((await deployment.cloner.dest.forms.find({}).toArray()).length, srcForms.length-1);
          });
        });
      });
    });
  });
};
