/* globals describe, it, before */
'use strict';

var request = require('supertest');
const assert = require('assert');
const deploy = require('../../src/deploy');

module.exports = (template) => {
  const options = {};

  options.srcOptions =  {
    adminKey:process.env.ADMIN_KEY,
    dstAdminKey:process.env.ADMIN_KEY,
    projectName:'formio',
    server: process.env.API_SRC,
    srcAdminKey:process.env.ADMIN_KEY
  };

  options.dstOptions =  {
    adminKey:process.env.ADMIN_KEY,
    dstAdminKey:process.env.ADMIN_KEY,
    projectName:'formio',
    server:process.env.API_DST,
    srcAdminKey:process.env.ADMIN_KEY
  };

  describe('Deploy command', () => {
    before(() => {
      options.params =[`${process.env.API_SRC}/formio`, `${process.env.API_DST}/formio`];
      options.srcAdminKey =process.env.ADMIN_KEY;
      options.dstAdminKey =process.env.ADMIN_KEY;
    });

    it('Should deploy project', (done) => {
      request(template.appSrc)
        .get('/project/'+ template.src.project._id +'/form?limit=9999999')
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            return done(err);
          }
          const formsSrc = res.body;

          request(template.appDst)
            .get('/project/'+ template.dst.project._id +'/form?limit=9999999')
            .set('x-admin-key', process.env.ADMIN_KEY)
            .expect(200)
            .expect('Content-Type', /json/)
            .end(function(err, res) {
              if (err) {
                return done(err);
              }

              const formsDst = res.body;

              deploy(options, (err) => {
                if (!err) {
                  request(template.appDst)
                    .get('/project/'+ template.dst.project._id +'/form?limit=9999999')
                    .set('x-admin-key', process.env.ADMIN_KEY)
                    .expect(200)
                    .expect('Content-Type', /json/)
                    .end(function(err, res) {
                      if (err) {
                        return done(err);
                      }

                      const allForms = [...formsSrc, ...formsDst];

                      const allFormsUnique = allForms.reduce((o, i) => {
                        if (!o.find(v => v.name === i.name)) {
                          o.push(i);
                        }
                        return o;
                      }, []);

                      const expectedComponents  = res.body.map(x=> x.name);
                      assert.equal(expectedComponents.includes(template.src.forms.formDeployCheck.name), true);
                      assert.equal(res.body.length, allFormsUnique.length);
                      done();
                    });
                }
              });
            });
        });
    });

    it('Should not allow to deploy for unpaid plans', (done) => {
      request(template.appSrc)
        .put('/project/'+ template.src.project._id)
        .set('x-admin-key', process.env.ADMIN_KEY)
        .send({plan: 'basic'})
        .end(function(err) {
          if (err) {
            return done(err);
          }

          deploy(options, (err) => {
            assert.equal(err, 'Deploy is only available for projects on a paid plan.');
            done();
          });
        });
    });
  });
};
