var assert = require('assert');
var util = require('./util');
var async = require('async');
var SERVER1 = 'lvh.me:3000';
var SERVER2 = 'localhost.com:3000';
describe('Copy Command', function() {
  this.timeout(20000);
  describe('Single Server - Within project', function() {
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

    it('Should copy a form within a project', function(done) {
      var formUrl = util.form(project, 'example');
      util.execute('copy form ' + formUrl + ' ' + formUrl + 'copy', [
        project.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert(form.hasOwnProperty('_id'), 'No form was copied.');
        assert(output.indexOf('prompt: Enter your email') !== -1);
        assert.equal(form.title, 'Copy of ' + project.forms.example.title);
        assert.deepEqual(form.components, project.forms.example.components);
        assert.deepEqual(form.tags, project.forms.example.tags);
        done();
      });
    });

    it('Should update a form using username and password', function(done) {
      var formUrl = util.form(project, 'example');
      util.execute('copy form ' + formUrl + ' ' + formUrl + 'copy --username ' + project.formio.currentUser.user.data.email + ' --password 123testing', [
        project.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert(form.hasOwnProperty('_id'), 'No form was copied.');
        assert(output.indexOf('prompt: Enter your email') === -1);
        assert(output.indexOf('Updating existing form') !== -1);
        assert.equal(form.title, 'Copy of ' + project.forms.example.title);
        assert.deepEqual(form.components, project.forms.example.components);
        assert.deepEqual(form.tags, project.forms.example.tags);
        done();
      });
    });
  });

  describe('Single Server - Between projects', function() {
    var project1 = null;
    var project2 = null;
    before(function(done) {
      async.series([
        function(next) {
          util.project({
            server: SERVER1,
            forms: ['example']
          }, function(err, result) {
            if (err) {
              return next(err);
            }
            project1 = result;
            next();
          });
        },
        function(next) {
          util.project({
            server: SERVER1,
            forms: ['example'],
            user: project1.formio.currentUser
          }, function(err, result) {
            if (err) {
              return next(err);
            }
            project2 = result;
            next();
          });
        }
      ], done);
    });

    it('Should copy a form between two projects', function(done) {
      var from = util.form(project1, 'example');
      var to = util.form(project2, 'examplecopy');
      util.execute('copy form ' + from + ' ' + to, [
        project1.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert(form.hasOwnProperty('_id'), 'No form was copied.');
        assert(output.indexOf('prompt: Enter your email') !== -1);
        assert(output.indexOf('Creating new form') !== -1);
        assert.equal(form.title, 'Copy of ' + project1.forms.example.title);
        assert.deepEqual(form.components, project1.forms.example.components);
        assert.deepEqual(form.tags, project1.forms.example.tags);
        done();
      });
    });
  });

  describe('Two Different Servers - Between projects', function() {
    var project1 = null;
    var project2 = null;
    before(function(done) {
      async.series([
        function(next) {
          util.project({
            server: SERVER1,
            forms: ['example']
          }, function(err, result) {
            if (err) {
              return next(err);
            }
            project1 = result;
            next();
          });
        },
        function(next) {
          util.project({
            server: SERVER2
          }, function(err, result) {
            if (err) {
              return next(err);
            }
            project2 = result;
            next();
          });
        }
      ], done);
    });

    it('Should copy a form between two projects', function(done) {
      var from = util.form(project1, 'example');
      var to = util.form(project2, 'example');
      util.execute('copy form ' + from + ' ' + to, [
        project1.formio.currentUser.user.data.email,
        '123testing',
        project2.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert(form.hasOwnProperty('_id'), 'No form was copied.');
        assert(output.indexOf('prompt: Enter your email') !== -1);
        assert(output.indexOf('Creating new form') !== -1);
        assert.equal(form.title, 'Copy of ' + project1.forms.example.title);
        assert.deepEqual(form.components, project1.forms.example.components);
        assert.deepEqual(form.tags, project1.forms.example.tags);
        done();
      });
    });
  });
});
