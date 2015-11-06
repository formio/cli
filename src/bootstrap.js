var async = require('async');
var _ = require('lodash');
var download = require(__dirname + '/download');
var extract = require(__dirname + '/extract');
var project = require(__dirname + '/project');
var serve = require(__dirname + '/serve');
module.exports = function(options, next) {
    options.path = options.params[0];
    async.series([
        _.partial(download, options),
        _.partial(extract, options),
        _.partial(project.create.bind(project), options),
        _.partial(serve, options)
    ], next);
};