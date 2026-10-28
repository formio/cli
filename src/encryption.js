'use strict';
const crypto = require('crypto');
const _ = require('lodash');
const keygenerator = require('keygenerator');

// The number of random characters the server appends to an encrypted value (but not to encrypted
// settings) before encrypting it.
const SALT_LENGTH = 40;

// The components whose data is nested under their own key. Layout components never nest data, even
// when they have a key.
const DATA_TYPES = ['datagrid', 'container', 'editgrid', 'address', 'dynamicWizard'];
const LAYOUT_TYPES = ['panel', 'table', 'well', 'columns', 'fieldset', 'tabs', 'form'];

/**
 * Derive the key and iv for a secret exactly the way the removed crypto.createCipher() did, which
 * is OpenSSL's EVP_BytesToKey with MD5, a single iteration and no salt. This keeps us compatible
 * with data that was encrypted by the servers, while still running on Node versions where
 * crypto.createCipher() no longer exists.
 *
 * @param {string} secret - The secret to derive the key and iv from.
 * @returns {{key: Buffer, iv: Buffer}} - The derived key and iv.
 */
function legacyKey(secret) {
  // createCipher() read the password as UTF-8; latin1 would derive a different key for any secret
  // holding a non ASCII character, and nothing encrypted with it could be read back.
  const password = Buffer.from(secret, 'utf8');
  const keyLength = 32;
  const ivLength = 16;
  let derived = Buffer.alloc(0);
  let block = Buffer.alloc(0);
  while (derived.length < keyLength + ivLength) {
    block = crypto.createHash('md5').update(Buffer.concat([block, password])).digest();
    derived = Buffer.concat([derived, block]);
  }
  return {
    key: derived.subarray(0, keyLength),
    iv: derived.subarray(keyLength, keyLength + ivLength)
  };
}

/**
 * Whether a value is a Buffer that went through JSON, which is how an API hands back the encrypted
 * values it reads raw from the database.
 * @param {*} value - The value.
 */
function isSerializedBuffer(value) {
  return !!(value && value.type === 'Buffer' && Array.isArray(value.data));
}

/**
 * Encrypt data or settings using a secret, the way the server does.
 * @param {string} secret - The secret.
 * @param {*} rawData - The data to encrypt.
 * @param {boolean} nosalt - Leave out the salt, as the project settings do.
 * @param {number} saltLength - The length of the salt.
 * @returns {Buffer|null} - The encrypted data, or null when there is nothing to encrypt.
 */
function encrypt(secret, rawData, nosalt, saltLength = SALT_LENGTH) {
  if (!secret || rawData === null || rawData === undefined) {
    return null;
  }
  const salt = nosalt ? '' : keygenerator._({length: saltLength});
  const {key, iv} = legacyKey(secret);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  return Buffer.concat([
    cipher.update(JSON.stringify(rawData) + salt),
    cipher.final()
  ]);
}

/**
 * Decrypt data or settings using a secret.
 * @param {string} secret - The secret.
 * @param {Buffer|Binary|object} cipherbuffer - The encrypted data, as a Buffer, a mongo Binary or a
 *                                       Buffer serialized as JSON.
 * @param {boolean} nosalt - The data was encrypted without a salt, as the project settings are.
 * @param {number} saltLength - The length of the salt.
 * @returns {*} - The decrypted data, or null when it cannot be decrypted with this secret.
 */
function decrypt(secret, cipherbuffer, nosalt, saltLength = SALT_LENGTH) {
  if (!secret || !cipherbuffer) {
    return null;
  }
  try {
    const buffer = Buffer.isBuffer(cipherbuffer)
      ? cipherbuffer
      : (isSerializedBuffer(cipherbuffer) ? Buffer.from(cipherbuffer.data) : cipherbuffer.buffer);
    const {key, iv} = legacyKey(secret);
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    const decryptedJSON = Buffer.concat([
      decipher.update(buffer),
      decipher.final()
    ]);
    return JSON.parse(nosalt ? decryptedJSON : decryptedJSON.slice(0, -saltLength));
  }
  catch (err) {
    // The wrong secret: either the padding does not check out, or what comes out is not JSON.
    return null;
  }
}

/**
 * Whether a stored value is encrypted data, rather than a plain value the server never encrypted
 * (it leaves empty values, and the values saved before a component was marked encrypted, alone).
 * @param {*} value - The stored value.
 */
function isEncryptedValue(value) {
  return Buffer.isBuffer(value) || !!(value && value._bsontype === 'Binary') || isSerializedBuffer(value);
}

/**
 * Whether the server encrypts the value of a component.
 * @param {object} component - The component.
 */
function isEncryptedComponent(component) {
  return !!(
    component &&
    component.key &&
    component.encrypted &&
    (!Object.prototype.hasOwnProperty.call(component, 'persistent') || component.persistent)
  );
}

/**
 * The lists of child components of a component.
 * @param {object} component - The component.
 */
function childComponents(component) {
  const lists = [];
  if (Array.isArray(component.columns)) {
    component.columns.forEach((column) => lists.push(column && column.components));
  }
  else if (Array.isArray(component.rows)) {
    component.rows.forEach((row) => {
      if (Array.isArray(row)) {
        row.forEach((column) => lists.push(column && column.components));
      }
      else {
        lists.push(row && row.components);
      }
    });
  }
  else if (Array.isArray(component.components)) {
    lists.push(component.components);
  }
  return lists.filter(Array.isArray);
}

/**
 * Whether the data of the children of a component is nested under the key of the component.
 * @param {object} component - The component.
 */
function nestsData(component) {
  return !!(
    component.key &&
    !LAYOUT_TYPES.includes(component.type) &&
    (DATA_TYPES.includes(component.type) || component.tree)
  );
}

/**
 * Walk the encrypted values of a submission. The form is walked against the data itself, so the
 * values of the rows of a datagrid or an editgrid are found as well. The children of an encrypted
 * component are never visited: the server encrypts the whole value of the component at once.
 *
 * @param {object[]} components - The components of the form.
 * @param {object} data - The data of the submission.
 * @param {Function} fn - Called with each encrypted value and the path to it within the data, as
 *                        an array of keys and row indexes.
 * @param {Array} path - The path to the data, used while recursing.
 */
function eachEncryptedValue(components, data, fn, path = []) {
  if (!Array.isArray(components) || !_.isPlainObject(data)) {
    return;
  }
  for (const component of components) {
    if (!component) {
      continue;
    }
    if (isEncryptedComponent(component)) {
      const value = data[component.key];
      if (isEncryptedValue(value)) {
        fn(value, [...path, component.key]);
      }
      continue;
    }
    const children = childComponents(component);
    if (!children.length) {
      continue;
    }
    if (nestsData(component)) {
      const value = data[component.key];
      if (Array.isArray(value)) {
        value.forEach((row, index) => children.forEach((list) => {
          eachEncryptedValue(list, row, fn, [...path, component.key, index]);
        }));
      }
      else {
        children.forEach((list) => eachEncryptedValue(list, value, fn, [...path, component.key]));
      }
    }
    else {
      children.forEach((list) => eachEncryptedValue(list, data, fn, path));
    }
  }
}

/**
 * Whether a form has any encrypted component.
 * @param {object[]} components - The components of the form.
 */
function hasEncryptedComponents(components) {
  if (!Array.isArray(components)) {
    return false;
  }
  return components.some((component) => component && (
    isEncryptedComponent(component) ||
    childComponents(component).some(hasEncryptedComponents)
  ));
}

module.exports = {
  SALT_LENGTH,
  legacyKey,
  encrypt,
  decrypt,
  isEncryptedValue,
  isEncryptedComponent,
  eachEncryptedValue,
  hasEncryptedComponents
};
