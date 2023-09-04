/* eslint-disable no-prototype-builtins */
/* eslint-disable max-len */
/* globals describe, it, before, after */
'use strict';

var request = require('supertest');
const assert = require('assert');
const deploy = require('../../src/deploy');

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

  describe('Deploy command', function() {
    it('Should deploy project', (done) => {
      options.params =['http://localhost:3001/formio', 'http://localhost:3002/formio'];
      options.srcAdminKey ='dockerAdminKey';
      options.dstAdminKey ='dockerAdminKey';

      request(template.appScr)
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

    it('Should not alow to deploy for unpaid plans', (done) => {
      options.params =['http://localhost:3001/formio', 'http://localhost:3002/formio'];
      options.srcAdminKey ='dockerAdminKey';
      options.dstAdminKey ='dockerAdminKey';

      request(template.appScr)
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
