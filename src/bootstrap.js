var async = require('async');
var _ = require('lodash');
module.exports = function(formio) {
    var download = require(__dirname + '/download')(formio);
    var extract = require(__dirname + '/extract')(formio);
    var project = require(__dirname + '/project')(formio);
    var serve = require(__dirname + '/serve')(formio);
    return function(options, next) {
        options.path = options.param;
        async.series([
            _.partial(download, options),
            _.partial(extract, options),
            _.partial(project.create.bind(project), options),
            _.partial(serve, options)
        ], next);
    };
};