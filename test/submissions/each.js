module.exports = function(record, index, options, next) {
  if (record.data.firstName) {
    console.log('SUBMISSION: ' + index + ': FirstName=' + record.data.firstName);
  }
  next();
};
