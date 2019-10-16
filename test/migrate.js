var assert = require('assert');
var util = require('./util');
var SERVER1 = 'lvh.me:3000';
var SERVER2 = 'localhost.com:3000';
describe('Migrate Command', function() {
  this.timeout(20000);
  var project = null;
  describe('Migrate - CSV to Form', function() {
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
  });

  describe('Migrate - Different projects and servers', function() {
    var project2 = null;
    before(function(done) {
      util.project({
        server: SERVER2,
        forms: ['example']
      }, function(err, result) {
        if (err) {
          return done(err);
        }
        project2 = result;
        done();
      });
    });

    it('Should migrate data from one Form to another Form.', function(done) {
      var from = util.form(project, 'example');
      var to = util.form(project2, 'example');
      util.execute('migrate ' + from + ' form ' + to, [
        project.formio.currentUser.user.data.email,
        '123testing',
        project2.formio.currentUser.user.data.email,
        '123testing',
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert.equal(output.substr(output.length - 3), '...');
        (new project2.formio.Form(to)).loadSubmissions().then(function(subs) {
          assert.equal(subs.length, 3);
          assert(!!subs[0].data.email, 'No email populated');
          assert(!!subs[0].data.firstName, 'No first name populated');
          assert(!!subs[0].data.lastName, 'No last name populated');
          done();
        }).catch(done);
      });
    });
  });
});
