/*
 * The MIT License (MIT)
 *
 * Copyright (c) 2015 Apigee Corporation
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 * THE SOFTWARE.
 */

const _ = require('lodash');
let Base64 = require('js-base64');

// Due to the differences in how node.js and the browser use js-base64, we need this hack
if (typeof Base64.Base64 !== 'undefined') {
  Base64 = Base64.Base64;
}

/**
 * We have to filter the schema to avoid a maximum callstack issue by deleting the format property.
 *
 * @param {object} schema - The JSON Schema object
 *
 * @returns {object} The filtered schema
 */
function filterSchema(schema) {
  const cSchema = _.cloneDeep(schema);

  delete cSchema.format;

  return cSchema;
}

// Build the list of custom JSON Schema generator formats
module.exports.byte = (mocker) => (schema) => Base64.encode(mocker.generate(filterSchema(schema)));

module.exports.password = (mocker) => (schema) => mocker.generate(filterSchema(schema));
