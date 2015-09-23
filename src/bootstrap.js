var async = require('async');
var _ = require('lodash');
module.exports = function(formio) {
    var download = require('./download')(formio);
    var extract = require('./extract')(formio);
    var project = require('./project')(formio);
    var serve = require('./serve')(formio);
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