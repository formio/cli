/* globals describe, it */
'use strict';

const request = require('supertest');
const assert = require('assert');
const copy = require('../../src/copy');

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

  options.srcAdminKey ='dockerAdminKey';
  options.dstAdminKey ='dockerAdminKey';

  describe('Copy command', function() {
    it('Should copy forms from src to dst', (done) => {
      options.params =['form', 'http://localhost:3001/formio/textForm1', 'http://localhost:3002/formio/textFormDst2'];

      request(template.appDst)
        .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDst2._id)
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            return done(err);
          }
          const expectedComponents  = template.dst.forms.textFormDst2.components.map(x=> x.type);

          res.body.components.forEach(x=> {
            assert.equal(expectedComponents.includes(x.type), true);
          });
          copy(options, (err) => {
            if (!err) {
              request(template.appDst)
                .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDst2._id)
                .set('x-admin-key', process.env.ADMIN_KEY)
                .expect(200)
                .expect('Content-Type', /json/)
                .end(function(err, res) {
                  if (err) {
                    return done(err);
                  }

                  const expectedComponents  = template.src.forms.textForm1.components.map(x=> x.type);

                  res.body.components.forEach(x=> {
                    assert.equal(expectedComponents.includes(x.type), true);
                  });

                  done();
                });
            }
          });
        });
    });

    it('Should copy resources from src to dst', (done) => {
      options.params =['resource', 'http://localhost:3001/formio/textFormSrcResource', 'http://localhost:3002/formio/textFormDstResource'];

      request(template.appDst)
        .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDstResource._id)
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            return done(err);
          }
          const expectedComponents  = template.dst.forms.textFormDstResource.components.map(x=> x.type);

          res.body.components.forEach(x=> {
            assert.equal(expectedComponents.includes(x.type), true);
          });
          copy(options, (err) => {
            if (!err) {
              request(template.appDst)
                .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.textFormDstResource._id)
                .set('x-admin-key', process.env.ADMIN_KEY)
                .expect(200)
                .expect('Content-Type', /json/)
                .end(function(err, res) {
                  if (err) {
                    return done(err);
                  }

                  const expectedComponents  = template.src.forms.textFormSrcResource.components.map(x=> x.type);

                  res.body.components.forEach(x=> {
                    assert.equal(expectedComponents.includes(x.type), true);
                  });

                  done();
                });
            }
          });
        });
    });

    it('Should copy chain forms', (done) => {
      options.params =['form', 'http://localhost:3001/formio/formCopyChainSrc,http://localhost:3001/formio/textForm1' , 'http://localhost:3002/formio/formCopyChainDst'];

      request(template.appDst)
        .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.formCopyChainDst._id)
        .set('x-admin-key', process.env.ADMIN_KEY)
        .expect(200)
        .expect('Content-Type', /json/)
        .end(function(err, res) {
          if (err) {
            return done(err);
          }
          const expectedComponents  = template.dst.forms.formCopyChainDst.components.map(x=> x.type);

          res.body.components.forEach(x=> {
            assert.equal(expectedComponents.includes(x.type), true);
          });
          copy(options, (err) => {
            if (!err) {
              request(template.appDst)
                .get('/project/'+ template.dst.project._id +'/form/'+template.dst.forms.formCopyChainDst._id)
                .set('x-admin-key', process.env.ADMIN_KEY)
                .expect(200)
                .expect('Content-Type', /json/)
                .end(function(err, res) {
                  if (err) {
                    return done(err);
                  }

                  const formCopyChainSrcKeys = template.src.forms.formCopyChainSrc.components.map(x=> x.type);
                  const formTextForm1SrcKeys = template.src.forms.textForm1.components.map(x=> x.type);

                  const allKeys = [...formCopyChainSrcKeys, ...formTextForm1SrcKeys];

                  res.body.components.forEach(x=> {
                    assert.equal(allKeys.includes(x.type), true);
                  });

                  assert.equal(allKeys.includes('select'), false);

                  done();
                });
            }
          });
        });
    });
  });
};

