/* eslint-disable max-len */
/* eslint-disable no-prototype-builtins */
/* globals describe, it, before, after */
'use strict';
const assert = require('assert');
const submission = require('../../src/submissions');
require('dotenv').config();

module.exports = (template) => {
  describe('Submission Command', function() {
    const options={dstOptions:{}};
    options.dstOptions.adminKey = 'dockerAdminKey';
    options.adminKey = 'dockerAdminKey';
    it('Should show submissions in console.', (done) => {
      options.params =['http://localhost:3001/formio/textForm1', 'test/submissions/middleware.js'];

      submission(options, (err, submission) => {
        if (err) {
          console.log(err.toString().red);
          return done(err);
        }
        if (err == null && submission ==null) {
          return done();
        }
        const submissionIds = template.src.submission.textForm1.map(x=>x._id);
        const isSubmissionInTemplate = submissionIds.includes(submission._id);
        assert.equal(isSubmissionInTemplate, true);
      });
    });

    it('Should show error message.', (done) => {
      options.params =[undefined, 'test/middleware.js'];

      submission(options, (err, submission) => {
        assert.equal(err, 'You must provide a source form to load submissions.');
        done();
      });
    });
  });
};
