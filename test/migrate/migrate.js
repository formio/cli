/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';

var request = require('supertest');
const migrate = require('../../src/migrate');
const assert = require('assert');
let async = require('async');

require('dotenv').config();

module.exports = (template) => {
  const options = {};

  options.srcOptions =  {
    adminKey:'dockerAdminKey',
    dstAdminKey:'dockerAdminKey',
    host:'localhost:3001',
    key: undefined,
    projectName:'formio',
    protocol:'http',
    server:'http://localhost:3001', srcAdminKey:'dockerAdminKey'
  };

  options.dstOptions =  {
    adminKey:'dockerAdminKey',
    dstAdminKey:'dockerAdminKey',
    host:'localhost:3002',
    key: undefined,
    projectName:'formio',
    protocol:'http',
    server:'http://localhost:3002',
    srcAdminKey:'dockerAdminKey'
  };

  describe('Migrate command', function() {
    it('Should migrate submissions from src to dst forms', (done) => {
      options.params =['http://localhost:3001/formio/textForm1', 'form', 'http://localhost:3002/formio/textFormDst'];

      migrate(options, (err) => {
        if (!err) {
          request(template.appDst)
            .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDst._id +'/submission')
            .set('x-admin-key', process.env.ADMIN_KEY)
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function(err, res) {
              if (err) {
                return done(err);
              }

              res.body.sort((a,b) => a.data.textField - b.data.textField).forEach((element, index) => {
                assert.deepEqual(element.data, template.src.submission.textForm1[index].data );
              });
              done();
            });
        }
      });
    });

    it('Should migrate all project', (done) => {
      options.params =['http://localhost:3001/formio', 'project', `http://localhost:3002/${template.dst.stagedProject.name}`];
      options.dstOptions.projectName =template.dst.stagedProject.name,

      migrate(options, (err) => {
        if (!err) {
          request(template.appDst)
            .get('/project/'+ template.dst.stagedProject._id +'/form?limit=9999999')
            .set('x-admin-key', process.env.ADMIN_KEY)
            .end(function(err, res) {
              if (err) {
                return done(err);
              }

              const formNames = Object.keys(template.src.forms);

              formNames.forEach(x=> {
                assert.equal(res.body.map(x=> x.name).includes(x), true);
              });

              const formLookUp = res.body.filter(x=> formNames.includes(x.name)).map(x=> {
                return {name: x.name, id: x._id};
              });

              async.each(formLookUp, function(form, cb) {
                request(template.appDst)
                  .get('/project/'+ template.dst.stagedProject._id +'/form/'+form.id +'/submission')
                  .set('x-admin-key', process.env.ADMIN_KEY)
                  .end(function(err, res) {
                    if (err) {
                      return done(err);
                    }
                    res.body.sort((a,b) => a.data.textField - b.data.textField).forEach((element, index) => {
                      assert.deepEqual(element.data, template.src.submission[form.name][index].data );
                    });

                    cb();
                  });
              }, function(err) {
                if (err) {
                  return done(err);
                }
                done();
              });
            });
        }
      });
    });

    it('Should migrate from cvs file', (done) => {
      const options = {};
      options.dstAdminKey = 'dockerAdminKey';
      options.dstOptions =  {
        adminKey:'dockerAdminKey',
        dstAdminKey:'dockerAdminKey',
        host:'localhost:3001',
        key: undefined,
        projectName:'formio',
        protocol:'http',
        server:'http://localhost:3001',
        srcAdminKey: undefined
      };
      options.params =['test/migrate/import.csv', 'test/migrate/transform.js', `http://localhost:3001/${template.src.project.name}/form/${template.src.forms.textForm2._id}`];

      migrate(options, (err) => {
        if (!err) {
          request(template.appScr)
            .get('/project/'+ template.src.project._id +'/form/'+ template.src.forms.textForm2._id + '/submission')
            .set('x-admin-key', process.env.ADMIN_KEY)
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function(err, res) {
              if (err) {
                return done(err);
              }
              const result = res.body.find(x=> x.data.textField === 'Joe');
              assert.equal(!!result, true);
              assert.equal(result.data.secondField, 'Smith');
              assert.equal(result.data.thirdField, 'joe@example.com');
              template.src.submission['textForm2']= res.body;
              done();
            });
        }
      });
    });

    it('Should migrate form with --delete option', (done) => {
      options.params =['http://localhost:3001/formio/textForm2', 'form', 'http://localhost:3002/formio/textFormDst'];
      options.delete = true;

      request(template.appDst)
        .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDst._id +'/submission')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, result) {
          if (err) {
            return done(err);
          }
          result.body.forEach(x=> assert.equal(['1','2'].includes(x.data.textField), true));

          migrate(options, (err) => {
            if (err) {
              return done(err);
            }

            request(template.appDst)
              .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDst._id +'/submission')
              .set('x-admin-key', process.env.ADMIN_KEY)
              .expect(200)
              .expect('Content-Type', /json/)
              .end(function(err, result) {
                if (err) {
                  return done(err);
                }
                result.body.forEach(x=> assert.equal(['1','2'].includes(x.data.textField), false));
                done();
              });
          });
        });
    });

    it('Should migrate project with --startWith', (done) => {
      options.params =['http://localhost:3001/formio', 'project', `http://localhost:3002/${template.dst.stagedProject2.name}`];
      options.startWith = 'textform2';
      options.delete = false;
      options.dstOptions.projectName = template.dst.stagedProject2.name,

      migrate(options, (err) => {
        if (err) {
          return done(err);
        }

        request(template.appDst)
          .get('/project/'+ template.dst.stagedProject2._id +'/form')
          .set('x-admin-key', process.env.ADMIN_KEY)
          .expect(200)
          .expect('Content-Type', /json/)
          .end(function(err, result) {
            if (err) {
              return done(err);
            }

            const formSrcKeys = Object.keys(template.src.forms);
            const firstForm = formSrcKeys.shift();
            const bodyForms = result.body.map(x=> x.name);

            const formLookUp = result.body.filter(x=> formSrcKeys.includes(x.name)).map(x=> {
              return {name: x.name, id: x._id};
            });

            formSrcKeys.forEach(x=> assert.equal(bodyForms.includes(x), true));
            assert.equal(bodyForms.includes(firstForm), false);

            async.each(formLookUp, function(form, cb) {
              request(template.appDst)
                .get('/project/'+ template.dst.stagedProject2._id +'/form/'+form.id +'/submission')
                .set('x-admin-key', process.env.ADMIN_KEY)
                .end(function(err, res) {
                  if (err) {
                    return done(err);
                  }
                  res.body.forEach((element, index) => {
                    assert.deepEqual(element.data, template.src.submission[form.name][index].data );
                  });

                  cb();
                });
            }, function(err) {
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
