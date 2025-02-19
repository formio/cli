'use strict';
const axios = require('axios');
const crypto = require('crypto');

async function getPdfFile(url) {
  const response = await axios.get(url, {responseType: 'arraybuffer'});
  const buffer = Buffer.from(response.data, 'binary'); // Get the file buffer
  const fileName = `${crypto.randomUUID()}.pdf`;

  return {
    name: fileName,
    buffer
  };
}

async function migratePdfFileForForm(form, options) {
  if (form.display !== 'pdf' || !form.settings.pdf) {
    return;
  }

  const destUploadUrl = `${options.dstOptions.server}/${options.dstOptions.projectName}/upload`;
  const file = await getPdfFile(form.settings.pdf.src + '.pdf');
  const formData = new FormData();
  const fileBlob = new Blob([file.buffer], {type: 'application/pdf'});

  formData.set('file', fileBlob, file.name);

  const result = await axios.post(destUploadUrl, formData, {
    headers: {
      'x-token': options.dstOptions.key,
      'Content-Type': 'multipart/form-data',
    }
  });

  // Assign new pdf file info to the form
  form.settings.pdf = {
    src: `${options.dstOptions.server}/pdf-proxy${result.data.path}`,
    id: result.data.file
  };
}

module.exports = {
  migratePdfFileForForm
};
