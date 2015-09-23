var express = require('express');
var app = express();
module.exports = function(formio) {
    return function(options, next) {
        app.use(express.static(options.directory));
        options.port = options.port || 8081;
        console.log('Serving application at http://localhost:' + options.port);
        app.listen(options.port);
        next();
    };
}