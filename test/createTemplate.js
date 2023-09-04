/* eslint-disable max-depth */
/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';
var request = require('supertest');
var formioProject = require('./fixtures/default.json');
require('dotenv').config();
var async = require('async');
const {textFormFirstSrc, textFormFirstDst, submissionFirst, submissionSecond, textFormSecondSrc, submissionThird, textFormThirdSrc, textFormFirstDst2, textFormFirstDst3, textFormResource, textFormSrcResource, textFormDstResource, formCopyChainSrc, formCopyChainDst, formDeployCheck} = require('./fixtures/fix');

module.exports = (template) => {
  describe('Create Template', function() {
    it('Installs the form.io project', async function() {
      const formioSettings = {
        title: 'Form.io',
        name: 'formio',
        plan: 'commercial',
        template: formioProject
      };

      const projectSrc = await request(template.appScr)
        .post('/project')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .send(formioSettings)
        .expect(201);

      template.src.project = projectSrc.body;

      const projectDst =  await request(template.appDst)
        .post('/project')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .send(formioSettings)
        .expect(201);

      template.dst.project = projectDst.body;
    });
    it('Create template src', (done) => {
      const createStageProject = (source, title, name)=>  function(cb) {
        const newStage = {
          stageTitle:'testedStageProjectTitle',
          title: title,
          description: 'test Project',
          project: template.dst.project._id,
          copyFromProject: 'empty',
          type: 'stage',
          framework: 'custom'
        };
        request(source)
          .post('/project')
          .send(newStage)
          .set('x-admin-key', process.env.ADMIN_KEY)
          .expect('Content-Type', /json/)
          .expect(201)
          .end(function(err, res) {
            if (err) {
              return done(err);
            }

            template.dst[name] = res.body;

            cb();
          });
      };

      const createForm = (source, direction, fixture)=>  function(cb) {
        request(source)
          .post('/project/'+ template[direction].project._id + '/form')
          .set('x-admin-key', process.env.ADMIN_KEY)
          .send(fixture)
          .end(function(err, resForm) {
            if (err) {
              return cb(err);
            }
            template[direction].forms[resForm.body.name] = resForm.body;
            cb();
          });
      };

      const createFormSubmission = (source, textForm, fixture)=>  function(cb) {
        request(source)
          .post('/project/'+ template.src.project._id + '/form/' + template.src.forms[textForm]._id +'/submission')
          .set('x-admin-key', process.env.ADMIN_KEY)
          .send(fixture)
          .end(function(err, resFormSubmissions) {
            if (err) {
              return cb(err);
            }
            template.src.submission[textForm].push(resFormSubmissions.body);

            cb();
          });
      };

      request(template.appScr)
        .get('/project/'+ template.src.project._id +'/form?limit=9999999')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            return done(err);
          }
          async.series([
            createForm(template.appScr, 'src', textFormFirstSrc),
            createFormSubmission(template.appScr, 'textForm1', submissionFirst ),
            createFormSubmission(template.appScr, 'textForm1', submissionSecond ),
            createForm(template.appScr, 'src', textFormSecondSrc),
            createFormSubmission(template.appScr, 'textForm2', submissionThird ),
            createForm(template.appScr, 'src', textFormThirdSrc),
            createFormSubmission(template.appScr,  'textForm3', submissionThird ),
            createForm(template.appScr, 'src', textFormSrcResource),
            createForm(template.appScr, 'src', formCopyChainSrc),
            createForm(template.appScr, 'src', formDeployCheck),

          ], function(err) {
            if (err) {
              return done(err);
            }

            async.series([
              createStageProject(template.appDst, 'testedStagedProject1', 'stagedProject'),
              createStageProject(template.appDst, 'testedStagedProject2', 'stagedProject2'),
              createForm(template.appDst, 'dst', textFormFirstDst),
              createForm(template.appDst, 'dst', textFormFirstDst2),
              createForm(template.appDst, 'dst', textFormDstResource),
              createForm(template.appDst, 'dst', formCopyChainDst),

            ], function(err) {
              if (err) {
                return done(err);
              }
              done();
            });
          });
        });
    });
  });
};

