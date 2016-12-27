module.exports = function(record, index, next) {
  if (record.data.firstName) {
    console.log('SUBMISSION: ' + index + ': FirstName=' + record.data.firstName);
  }
  next();
};
