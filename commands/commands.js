module.exports = function(formio, program, next) {
    return {
        bootstrap: require('./bootstrap.js')(formio, program, next)
    };
};