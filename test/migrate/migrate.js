/* globals describe, it */
'use strict';

const request = require('supertest');
const migrate = require('../../src/migrate');
const assert = require('assert');
const async = require('async');

module.exports = (template) => {
  const options = {};

  options.srcOptions =  {
    adminKey: process.env.ADMIN_KEY,
    dstAdminKey: process.env.ADMIN_KEY,
    host: process.env.API_SRC,
    projectName:'formio',
    server: process.env.API_SRC,
    srcAdminKey: process.env.ADMIN_KEY
  };

  options.dstOptions =  {
    adminKey: process.env.ADMIN_KEY,
    dstAdminKey: process.env.ADMIN_KEY,
    projectName:'formio',
    server: process.env.API_DST,
    srcAdminKey: process.env.ADMIN_KEY
  };

  describe('Migrate command', function() {
    it('Should migrate submissions from source form to destination form', (done) => {
      options.params =[
        `${process.env.API_SRC}/formio/textForm1`,
        'form',
        `${process.env.API_DST}/formio/textFormDst`
      ];

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

    it('Should migrate all source project forms and submissions to destination project', (done) => {
      options.params =[
        `${process.env.API_SRC}/formio`,
        'project',
        `${process.env.API_DST}/${template.dst.stagedProject.name}`
      ];
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

    it('Should migrate submissions from CSV file and pass them through transformer function', (done) => {
      const options = {};
      options.dstAdminKey = process.env.ADMIN_KEY;
      options.dstOptions =  {
        adminKey: process.env.ADMIN_KEY,
        dstAdminKey: process.env.ADMIN_KEY,
        projectName:'formio',
        server: process.env.API_SRC,
        srcAdminKey: undefined
      };
      options.params =[
        'test/migrate/import.csv',
        'test/migrate/transform.js',
        `${process.env.API_SRC}/${template.src.project.name}/form/${template.src.forms.textForm2._id}`
      ];

      migrate(options, (err) => {
        if (!err) {
          request(template.appSrc)
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

    it('Should delete destination form submissions when migrating with --delete option', (done) => {
      options.params =[
        `${process.env.API_SRC}/formio/textForm2`,
        'form',
        `${process.env.API_DST}/formio/textFormDst`
      ];
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

    it('Should migrate project forms starting with the specified form path', (done) => {
      options.params =[
        `${process.env.API_SRC}/formio`,
        'project',
        `${process.env.API_DST}/${template.dst.stagedProject2.name}`
      ];
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
