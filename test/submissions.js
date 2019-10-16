var assert = require('assert');
var util = require('./util');
var SERVER1 = 'lvh.me:3000';
var SERVER2 = 'localhost.com:3000';
describe('Submission Command', function() {
  this.timeout(20000);
  var project = null;
  before(function(done) {
    util.project({
      server: SERVER1,
      forms: ['example']
    }, function(err, result) {
      if (err) {
        return done(err);
      }
      project = result;
      done();
    });
  });
  it('Should migrate data from CSV to a Form.', function(done) {
    var to = util.form(project, 'example');
    util.execute('migrate ./migrate/export.csv ./migrate/transformer.js ' + to, [
      project.formio.currentUser.user.data.email,
      '123testing'
    ], function(err, form, output) {
      if (err) {
        return done(err);
      }
      assert.equal(output.substr(output.length - 3), '...');
      var form = util.form(project, 'example');
      (new project.formio.Form(form)).loadSubmissions().then(function(subs) {
        assert.equal(subs.length, 3);
        assert(!!subs[0].data.email, 'No email populated');
        assert(!!subs[0].data.firstName, 'No first name populated');
        assert(!!subs[0].data.lastName, 'No last name populated');
        done();
      }).catch(done);
    });
  });

  it('Should read submissions from a project.', function(done) {
    var from = util.form(project, 'example');
    util.execute('submissions ' + from, [
      project.formio.currentUser.user.data.email,
      '123testing'
    ], function(err, submissions, output) {
      if (err) {
        return done(err);
      }
      done();
    });
  });

  it('Should read submissions through a handler.', function(done) {
    var from = util.form(project, 'example');
    util.execute('submissions ' + from + ' ./submissions/each.js', [
      project.formio.currentUser.user.data.email,
      '123testing'
    ], function(err, submissions, output) {
      if (err) {
        return done(err);
      }
      assert(output.indexOf('SUBMISSION: 0') !== -1, 'No 0 submission');
      assert(output.indexOf('SUBMISSION: 1') !== -1, 'No 1 submission');
      assert(output.indexOf('SUBMISSION: 2') !== -1, 'No 2 submission');
      done();
    });
  });
});
