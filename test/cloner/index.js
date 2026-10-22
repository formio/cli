/* globals describe */
'use strict';

describe('Cloner', function() {
  this.timeout(120000);
  require('./units');
  require('./basic');
  require('./flags');
  require('./projects');
  require('./projection');
  require('./dryRun');
  require('./state');
  require('./resume');
  require('./handlers');
  require('./racing');
  require('./memory');
  require('./errors');
  require('./api');
  require('./operations');
  require('./progress');
  require('./rekey');
});
