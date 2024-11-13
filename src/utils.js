'use strict';
const axios = require('axios');
const crypto = require('crypto');

async function fetchPdf(url) {
  const response = await axios.get(url, {responseType: 'arraybuffer'});
  const buffer = Buffer.from(response.data, 'binary'); // Get the file buffer
  const randomStr = crypto.randomBytes(24).toString('hex');

  return {
    name: `${randomStr}.pdf`,
    buffer: buffer
  };
}

async function migratePdfData(form, options) {
  if (!options.pdfMigrate) {
    return;
  }
  const urlDestUpload = `${options.dstOptions.server}/${options.dstOptions.projectName}/upload`;
  const pdfData = await fetchPdf(form.settings.pdf.src + '.pdf');
  const formData = new FormData();
  const file = new Blob([pdfData.buffer], {type: 'application/pdf'});
  formData.set('file', file, pdfData.name);
  const result = await axios.post(urlDestUpload, formData, {'headers': {
    'x-token': options.dstOptions.key,
    'Content-Type': 'multipart/form-data',
  }});
  form.settings.pdf = {src: `${options.dstOptions.server}/pdf-proxy${result.data.path}`,
    id: result.data.file};
}

module.exports = {
  migratePdfData
};
