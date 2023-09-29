/* globals describe, it */
'use strict';
const assert = require('assert');
const submission = require('../../src/submissions');

module.exports = (template) => {
  describe('Submission Command', function() {
    const options={dstOptions:{}};
    options.dstOptions.adminKey = process.env.ADMIN_KEY;
    options.adminKey = process.env.ADMIN_KEY;

    it('Should show submissions in console.', (done) => {
      options.params = [`${process.env.API_SRC}/formio/textForm1`, 'test/submissions/middleware.js'];

      submission(options, (err, submission) => {
        if (err) {
          console.log(err.toString().red);
          return done(err);
        }

        if (!submission) {
          return done();
        }

        assert.ok(
          template.src.submission.textForm1.some(sub => sub._id === submission._id),
          'Should output submission from template'
        );
      });
    });

    it('Should throw an error if form URL not provided.', (done) => {
      options.params = [];

      submission(options, (err) => {
        assert.equal(err, 'You must provide a source form to load submissions.');
        done();
      });
    });
  });
};
