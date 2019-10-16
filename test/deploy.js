var assert = require('assert');
var util = require('./util');
var SERVER1 = 'lvh.me:3000';
var SERVER2 = 'localhost.com:3000';
var Chance = require('chance');
var chance = new Chance();
describe('Deploy Command', function() {
  this.timeout(20000);
  var project = null;
  var project2 = null;
  describe('Deploy project from one server to another', function() {
    before(function(done) {
      util.project({
        server: SERVER1,
        forms: ['example']
      }, function(err, result) {
        if (err) {
          return done(err);
        }
        project = result;
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
    });

    it('Should update a project on destination server.', function(done) {
      var from = util.projectUrl(project);
      util.execute('deploy ' + from + ' http://api.' + SERVER2, [
        project.formio.currentUser.user.data.email,
        '123testing',
        project2.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert.equal(output.substr(output.length - 16), "Project Updated\n");
        done();
      });
    });

    it('Should deploy a project from a project.json file.', function(done) {
      var from = util.projectUrl(project);
      util.execute('deploy ./deploy/project.json http://' + chance.word() + '.' + SERVER1, [
        project.formio.currentUser.user.data.email,
        '123testing'
      ], function(err, form, output) {
        if (err) {
          return done(err);
        }
        assert.equal(output.substr(output.length - 16), "Project Updated\n");
        done();
      });
    });
  });
});
