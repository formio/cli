module.exports = function(options, next) {
    var method = options.params[0];
    var url = options.params[1];
    var parts = url.split('://');
    var subparts = parts[1].split('/');
    var hostparts = subparts[0].split('.');
    if (
        (hostparts.length > 2) ||
        ((hostparts.length > 1) && hostparts[1].indexOf('localhost') !== -1)
    ) {
        hostparts.shift();
    }
    options.server = parts[0] + '://' + hostparts.join('.');
    var formio = require('../src/formio')(options);
    var project = new formio.Project(parts[0] + '://' + subparts[0]);
    project.load().then(function() {
        project.bind(subparts[1], method, function(err, data) {
            if (err) {
                console.log(err.red);
            }
            console.log(JSON.stringify(data.body).blue);
        }).then(function() {
            var msg = 'Succesfully bound to ' + options.params[1];
            console.log(msg.green);
        }).catch(function(err) {
            console.log(err.toString().red);
        });
    }).catch(function(err) {
        console.log(err.toString().red);
    });
};