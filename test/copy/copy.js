/* globals describe, it */
'use strict';

const request = require('supertest');
const assert = require('assert');
const copy = require('../../src/copy');

module.exports = (template) => {
  const options = {};

  options.srcOptions =  {
    adminKey:process.env.ADMIN_KEY,
    dstAdminKey:process.env.ADMIN_KEY,
    projectName:'formio',
    server:process.env.API_SRC,
    srcAdminKey:process.env.ADMIN_KEY
  };

  options.dstOptions =  {
    adminKey:process.env.ADMIN_KEY,
    dstAdminKey:process.env.ADMIN_KEY,
    projectName:'formio',
    server:process.env.API_DST,
    srcAdminKey:process.env.ADMIN_KEY
  };

  options.srcAdminKey = process.env.ADMIN_KEY;
  options.dstAdminKey = process.env.ADMIN_KEY;

  describe('Copy command', function() {
    it('Should copy forms from source to destination', (done) => {
      options.params =[
        'form',
        `${process.env.API_SRC}/formio/textForm1`,
        `${process.env.API_DST}/formio/textFormDst2`
      ];

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

    it('Should copy resources from source to destination', (done) => {
      options.params =[
        'resource',
        `${process.env.API_SRC}/formio/textFormSrcResource`,
        `${process.env.API_DST}/formio/textFormDstResource`
      ];

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

    it('Should copy multiple source form components into one destination form', (done) => {
      options.params =[
        'form',
        `${process.env.API_SRC}/formio/formCopyChainSrc,${process.env.API_SRC}/formio/textForm1`,
        `${process.env.API_DST}/formio/formCopyChainDst`
      ];

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
