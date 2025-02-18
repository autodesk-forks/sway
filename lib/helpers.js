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
const jsf = require('json-schema-faker');
const ZSchema = require('z-schema');
const formatGenerators = require('./validation/format-generators');
const formatValidators = require('./validation/format-validators');

// full-date from http://xml2rfc.ietf.org/public/rfc/html/rfc3339.html#anchor14
const dateRegExp = new RegExp(
  '^'
  + '\\d{4}' // year
  + '-'
  + '([0]\\d|1[012])' // month
  + '-'
  + '(0[1-9]|[12]\\d|3[01])' // day
  + '$',
);

// date-time from http://xml2rfc.ietf.org/public/rfc/html/rfc3339.html#anchor14
const dateTimeRegExp = new RegExp(
  '^'
  + '\\d{4}' // year
  + '-'
  + '([0]\\d|1[012])' // month
  + '-'
  + '(0[1-9]|[12]\\d|3[01])' // day
  + 'T'
  + '([01]\\d|2[0-3])' // hour
  + ':'
  + '[0-5]\\d' // minute
  + ':'
  + '[0-5]\\d' // second
  + '(\\.\\d+)?' // fractional seconds
  + '(Z|(\\+|-)([01]\\d|2[0-4]):[0-5]\\d)' // Z or time offset
  + '$',
);

const collectionFormats = [undefined, 'csv', 'multi', 'pipes', 'ssv', 'tsv'];
let jsonMocker;
// https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.0.md#parameterObject
const parameterSchemaProperties = [
  'allowEmptyValue',
  'default',
  'description',
  'enum',
  'exclusiveMaximum',
  'exclusiveMinimum',
  'format',
  'items',
  'maxItems',
  'maxLength',
  'maximum',
  'minItems',
  'minLength',
  'minimum',
  'multipleOf',
  'pattern',
  'type',
  'uniqueItems',
];
const types = ['array', 'boolean', 'integer', 'object', 'number', 'string'];

function registerFormat(name, validator) {
  ZSchema.registerFormat(name, validator);
}

function createJSONValidator() {
  const validator = new ZSchema({
    breakOnFirstError: false,
    ignoreUnknownFormats: true,
    reportPathAsArray: true,
  });

  // Add the custom validators
  _.each(formatValidators, (handler, name) => {
    registerFormat(name, handler);
  });

  return validator;
}

const jsonSchemaValidator = createJSONValidator();

function createJSONMocker() {
  // Add the custom format generators
  _.each(formatGenerators, (gen, name) => {
    jsf.format(name, gen(jsf));
  });

  return jsf;
}

function findExtraParameters(expected, actual, location, results) {
  let codeSuffix = location.toUpperCase();

  switch (location) {
    case 'formData':
      codeSuffix = 'FORM_DATA';
      location = 'form data field';
      break;
    case 'query':
      location = 'query parameter';
      break;

    // no default
  }

  _.each(actual, (name) => {
    if (expected.indexOf(name) === -1) {
      results.errors.push({
        code: `REQUEST_ADDITIONAL_${codeSuffix}`,
        message: `Additional ${location} not allowed: ${name}`,
        path: [],
      });
    }
  });
}

function getJSONSchemaMocker() {
  if (!jsonMocker) {
    jsonMocker = createJSONMocker(jsf);
  }

  return jsonMocker;
}

function registerFormatGenerator(name, func) {
  getJSONSchemaMocker().format(name, func);
}

function unregisterFormat(name) {
  ZSchema.unregisterFormat(name);
}

function unregisterFormatGenerator(name) {
  delete getJSONSchemaMocker().format()[name];
}

function normalizeError(obj) {
  // Remove superfluous error details
  if (_.isUndefined(obj.schemaId)) {
    delete obj.schemaId;
  }

  if (obj.inner) {
    _.each(obj.inner, (nObj) => {
      normalizeError(nObj);
    });
  }
}

/**
 * Helper method to take an OpenAPI Parameter Object definition and compute its schema.
 *
 * For non-body OpenAPI parameters, the definition itself is not suitable as a JSON Schema so we must compute it.
 *
 * @param {object} paramDef - The parameter definition
 *
 * @returns {object} The computed schema
 */
function computeParameterSchema(paramDef) {
  let schema;

  if (_.isUndefined(paramDef.schema)) {
    schema = {};

    // Build the schema from the schema-like parameter structure
    _.forEach(parameterSchemaProperties, (name) => {
      if (!_.isUndefined(paramDef[name])) {
        schema[name] = paramDef[name];
      }
    });
  } else {
    schema = paramDef.schema;
  }

  return schema;
}

/**
 * Converts a raw JavaScript value to a JSON Schema value based on its schema.
 *
 * @param {object} schema - The schema for the value
 * @param {object} options - The conversion options
 * @param {string} [options.collectionFormat] - The collection format
 * @param {string} [options.encoding] - The encoding if the raw value is a `Buffer`
 * @param {*} value - The value to convert
 *
 * @returns {*} The converted value
 *
 * @throws {TypeError} IF the `collectionFormat` or `type` is invalid for the `schema`, or if conversion fails
 */
function convertValue(schema, options, value) {
  const originalValue = value; // Used in error reporting for invalid values
  const type = _.isPlainObject(schema) ? schema.type : undefined;
  let pValue = value;
  let pType = typeof pValue;
  let err;
  let isDate;
  let isDateTime;

  // If there is an explicit type provided, make sure it's one of the supported ones
  if (_.has(schema, 'type') && types.indexOf(type) === -1) {
    throw new TypeError(`Invalid 'type' value: ${type}`);
  }

  // Since JSON Schema allows you to not specify a type and it is treated as a wildcard of sorts, we should not do any
  // coercion for these types of values.
  if (_.isUndefined(type)) {
    return value;
  }

  // If there is no value, do not convert it
  if (_.isUndefined(value)) {
    return value;
  }

  // Convert Buffer value to String
  // (We use this type of check to identify Buffer objects.  The browser does not have a Buffer type and to avoid having
  //  import the browserify buffer module, we just do a simple check.  This is brittle but should work.)
  if (_.isFunction(value.readUInt8)) {
    value = value.toString(options.encoding);
    pValue = value;
    pType = typeof value;
  }

  // If the value is empty and empty is allowed, use it
  if (schema.allowEmptyValue && value === '') {
    return value;
  }

  // Attempt to parse the string as JSON if the type is array or object
  if (['array', 'object'].indexOf(type) > -1 && _.isString(value)) {
    if ((type === 'array' && value.indexOf('[') === 0) || (type === 'object' && value.indexOf('{') === 0)) {
      try {
        value = JSON.parse(value);
      } catch (parseErr) {
        // Nothing to do here, just fall through
      }
    }
  }

  switch (type) {
    case 'array':
      if (_.isString(value)) {
        if (collectionFormats.indexOf(options.collectionFormat) === -1) {
          throw new TypeError(`Invalid 'collectionFormat' value: ${options.collectionFormat}`);
        }

        switch (options.collectionFormat) {
          case 'csv':
          case undefined:
            value = value.split(',');
            break;
          case 'multi':
            value = [value];
            break;
          case 'pipes':
            value = value.split('|');
            break;
          case 'ssv':
            value = value.split(' ');
            break;
          case 'tsv':
            value = value.split('\t');
            break;

        // no default
        }
      }

      if (_.isArray(value)) {
        value = _.map(value, (item, index) => convertValue(_.isArray(schema.items) ? schema.items[index] : schema.items, options, item));
      }

      break;
    case 'boolean':
      if (!_.isBoolean(value)) {
        if (value === 'true') {
          value = true;
        } else if (value === 'false') {
          value = false;
        } else {
          err = new TypeError(`Not a valid boolean: ${value}`);
        }
      }

      break;
    case 'integer':
      if (!_.isNumber(value)) {
        if (_.isString(value) && _.trim(value).length === 0) {
          value = NaN;
        }

        value = Number(value);

        if (_.isNaN(value)) {
          err = new TypeError(`Not a valid integer: ${originalValue}`);
        }
      }

      break;
    case 'number':
      if (!_.isNumber(value)) {
        if (_.isString(value) && _.trim(value).length === 0) {
          value = NaN;
        }

        value = Number(value);

        if (_.isNaN(value)) {
          err = new TypeError(`Not a valid number: ${originalValue}`);
        }
      }
      break;
    case 'string':
      if (['date', 'date-time'].indexOf(schema.format) > -1) {
        if (_.isString(value)) {
          isDate = schema.format === 'date' && dateRegExp.test(value);
          isDateTime = schema.format === 'date-time' && dateTimeRegExp.test(value);

          if (!isDate && !isDateTime) {
            err = new TypeError(`Not a valid ${schema.format} string: ${originalValue}`);
            err.code = 'INVALID_FORMAT';
          } else {
            value = new Date(value);
          }
        }

        if (!_.isDate(value) || value.toString() === 'Invalid Date') {
          err = new TypeError(`Not a valid ${schema.format} string: ${originalValue}`);

          err.code = 'INVALID_FORMAT';
        }
      } else if (!_.isString(value)) {
        err = new TypeError(`Not a valid string: ${value}`);
      }

      break;

    // no default
  }

  if (!_.isUndefined(err)) {
    // Convert the error to be more like a JSON Schema validation error
    if (_.isUndefined(err.code)) {
      err.code = 'INVALID_TYPE';
      err.message = `Expected type ${type} but found type ${pType}`;
    } else {
      err.message = `Object didn't pass validation for format ${schema.format}: ${pValue}`;
    }

    // Format and type errors resemble JSON Schema validation errors
    err.failedValidation = true;
    err.path = [];

    throw err;
  }

  return value;
}

/**
 * Returns the header value regardless of the case of the provided/requested header name.
 *
 * @param {object} headers - The headers to search
 * @param {string} headerName - The header name
 *
 * @returns {string} The header value or `undefined` if it is not found
 */
function getHeaderValue(headers, headerName) {
  // Default to an empty object
  headers = headers || {};

  const lcHeaderName = headerName.toLowerCase();
  const realHeaderName = _.find(Object.keys(headers), (header) => header.toLowerCase() === lcHeaderName);

  return headers[realHeaderName];
}

/**
 * Returns the provided content type or `application/octet-stream` if one is not provided.
 *
 * @see http://www.w3.org/Protocols/rfc2616/rfc2616-sec7.html#sec7.2.1
 *
 * @param {object} headers - The headers to search
 *
 * @returns {string} The content type
 */
function getContentType(headers) {
  return getHeaderValue(headers, 'content-type') || 'application/octet-stream';
}

/**
 * Returns a json-schema-faker mocker.
 *
 * @returns {object} The json-schema-faker mocker to use
 */

function getSample(schema) {
  let sample;

  if (!_.isUndefined(schema)) {
    if (schema.type === 'file') {
      sample = 'This is sample content for the "file" type.';
    } else {
      sample = getJSONSchemaMocker().generate(schema);
    }
  }

  return sample;
}

/**
 * Returns a z-schema validator.
 *
 * @returns {object} The z-schema validator to use
 */
function getJSONSchemaValidator() {
  return jsonSchemaValidator;
}

module.exports.parameterLocations = ['body', 'formData', 'header', 'path', 'query'];

/**
 * Process validators.
 *
 * @param {object|module:Sway~ServerResponseWrapper} target - The thing being validated
 * @param {module:Sway~ApiDefinition|module:Sway~Operation|module:Sway~Response} caller - The object requesting validation _(can be `undefined`)_
 * @param {module:Sway~DocumentValidationFunction[]|module:Sway~RequestValidationFunction[]|module:Sway~ResposeValidationFunction[]} validators - The validators
 * @param {module:Sway~ValidationResults} results - The cumulative validation results
 */
function processValidators(target, caller, validators, results) {
  _.each(validators, (validator) => {
    const vArgs = [target];

    if (!_.isUndefined(caller)) {
      vArgs.push(caller);
    }

    const vResults = validator(...vArgs);

    if (!_.isUndefined(vResults)) {
      if (!_.isUndefined(vResults.errors) && vResults.errors.length > 0) {
        results.errors.push(...vResults.errors);
      }

      if (!_.isUndefined(vResults.warnings) && vResults.warnings.length > 0) {
        results.warnings.push(...vResults.warnings);
      }
    }
  });
}

/**
 * Registers a custom format.
 *
 * @param {string} name - The name of the format
 * @param {function} validator - The format validator *(See [ZSchema Custom Format](https://github.com/zaggino/z-schema#register-a-custom-format))*
 */
module.exports.registerFormat = registerFormat;

/**
 * Registers a custom format generator.
 *
 * @param {string} name - The name of the format
 * @param {function} generator - The format generator *(See [json-schema-mocker Custom Format](https://github.com/json-schema-faker/json-schema-faker#custom-formats))*
 */
module.exports.registerFormatGenerator = registerFormatGenerator;

/**
 * Walk an object and invoke the provided function for each node.
 *
 * @param {*} obj - The object to walk
 * @param {function} [fn] - The function to invoke
 */
function walk(obj, fn) {
  const callFn = _.isFunction(fn);

  function doWalk(ancestors, node, path) {
    if (callFn) {
      fn(node, path, ancestors);
    }

    // We do not process circular objects again
    if (ancestors.indexOf(node) === -1) {
      ancestors.push(node);

      if (_.isArray(node) || _.isPlainObject(node)) {
        _.each(node, (member, indexOrKey) => {
          doWalk(ancestors, member, path.concat(indexOrKey.toString()));
        });
      }
    }

    ancestors.pop();
  }

  doWalk([], obj, []);
}

/**
 * Replaces the circular references in the provided object with an empty object.
 *
 * @param {object} obj - The JavaScript object
 */
function removeCirculars(obj) {
  walk(obj, (node, path, ancestors) => {
    // Replace circulars with {}
    if (ancestors.indexOf(node) > -1) {
      _.set(obj, path, {});
    }
  });
}

/**
 * Unregisters a custom format.
 *
 * @param {string} name - The name of the format
 */
module.exports.unregisterFormat = unregisterFormat;

/**
 * Unregisters a custom format generator.
 *
 * @param {string} name - The name of the format generator
 */
module.exports.unregisterFormatGenerator = unregisterFormatGenerator;

/**
 * Validates the provided value against the JSON Schema by name or value.
 *
 * @param {object} validator - The JSON Schema validator created via {@link #createJSONValidator}
 * @param {object} schema - The JSON Schema
 * @param {*} value - The value to validate
 *
 * @returns {object} Object containing the errors and warnings of the validation
 */
function validateAgainstSchema(validator, schema, value) {
  schema = _.cloneDeep(schema); // Clone the schema as z-schema alters the provided document

  const response = {
    errors: [],
    warnings: [],
  };

  if (!validator.validate(value, schema)) {
    response.errors = _.map(validator.getLastErrors(), (err) => {
      normalizeError(err);

      return err;
    });
  }

  return response;
}

/**
 * Validates the content type.
 *
 * @param {string} contentType - The Content-Type value of the request/response
 * @param {string[]} supportedTypes - The supported (declared) Content-Type values for the request/response
 * @param {object} results - The results object to update in the event of an invalid content type
 */
function validateContentType(contentType, supportedTypes, results) {
  const rawContentType = contentType;

  if (!_.isUndefined(contentType)) {
    // http://www.w3.org/Protocols/rfc2616/rfc2616-sec14.html#sec14.17
    ([contentType] = contentType.split(';')); // Strip the parameter(s) from the content type
  }

  // Check for exact match or mime-type only match
  if (_.indexOf(supportedTypes, rawContentType) === -1 && _.indexOf(supportedTypes, contentType) === -1) {
    results.errors.push({
      code: 'INVALID_CONTENT_TYPE',
      message: `Invalid Content-Type (${contentType}).  These are supported: ${
        supportedTypes.join(', ')}`,
      path: [],
    });
  }
}

/**
 * Validates that each item in the array are of type function.
 *
 * @param {array} arr - The array
 * @param {string} paramName - The parameter name
 */
function validateOptionsAllAreFunctions(arr, paramName) {
  _.forEach(arr, (item, index) => {
    if (!_.isFunction(item)) {
      throw new TypeError(`options.${paramName} at index ${index} must be a function`);
    }
  });
}

/**
 * Validates the request/response strictly based on the provided options.
 *
 * @param {module:Sway~Operation|module:Sway~Response} opOrRes - The Sway operation or response
 * @param {object|module:Sway~ServerResponseWrapper} reqOrRes - The http client request *(or equivalent)* or the
 *                                                              response or *(response like object)*
 * @param {object} strictMode - The options for configuring strict mode
 * @param {boolean} options.formData - Whether or not form data parameters should be validated strictly
 * @param {boolean} options.header - Whether or not header parameters should be validated strictly
 * @param {boolean} options.query - Whether or not query parameters should be validated strictly
 * @param {module:Sway~ValidationResults} results - The validation results
 */
function validateStrictMode(opOrRes, reqOrRes, strictMode, results) {
  const definedParameters = {
    formData: [],
    header: [],
    query: [],
  };
  const mode = opOrRes.constructor.name === 'Operation' ? 'req' : 'res';
  const strictModeValidation = {
    formData: false,
    header: false,
    query: false,
  };

  if (!_.isUndefined(strictMode)) {
    if (!_.isBoolean(strictMode) && !_.isPlainObject(strictMode)) {
      throw new TypeError('options.strictMode must be a boolean or an object');
    } else if (_.isPlainObject(strictMode)) {
      _.each(['formData', 'header', 'query'], (location) => {
        if (!_.isUndefined(strictMode[location])) {
          if (!_.isBoolean(strictMode[location])) {
            throw new TypeError(`options.strictMode.${location} must be a boolean`);
          } else {
            strictModeValidation[location] = strictMode[location];
          }
        }
      });
    } else if (strictMode === true) {
      strictModeValidation.formData = true;
      strictModeValidation.header = true;
      strictModeValidation.query = true;
    }
  }

  // Only process the parameters if necessary
  if (strictModeValidation.formData === true
      || strictModeValidation.header === true
      || strictModeValidation.query === true) {
    _.each((mode === 'req' ? opOrRes : opOrRes.operationObject).getParameters(), (parameter) => {
      if (_.isArray(definedParameters[parameter.in])) {
        definedParameters[parameter.in].push(parameter.name);
      }
    });
  }

  // Validating form data only matters for requests
  if (strictModeValidation.formData === true && mode === 'req') {
    findExtraParameters(
      definedParameters.formData,
      _.isPlainObject(reqOrRes.body) ? Object.keys(reqOrRes.body) : [],
      'formData',
      results,
    );
  }

  // Always validate the headers for requests and responses
  if (strictModeValidation.header === true) {
    findExtraParameters(
      definedParameters.header,
      _.isPlainObject(reqOrRes.headers) ? Object.keys(reqOrRes.headers) : [],
      'header',
      results,
    );
  }

  // Validating the query string only matters for requests
  if (strictModeValidation.query === true && mode === 'req') {
    findExtraParameters(
      definedParameters.query,
      _.isPlainObject(reqOrRes.query) ? Object.keys(reqOrRes.query) : [],
      'query',
      results,
    );
  }
}

module.exports.computeParameterSchema = computeParameterSchema;
module.exports.getContentType = getContentType;
module.exports.convertValue = convertValue;
module.exports.getHeaderValue = getHeaderValue;
module.exports.walk = walk;
module.exports.getSample = getSample;
module.exports.getJSONSchemaValidator = getJSONSchemaValidator;
module.exports.processValidators = processValidators;
module.exports.removeCirculars = removeCirculars;
module.exports.validateAgainstSchema = validateAgainstSchema;
module.exports.validateContentType = validateContentType;
module.exports.validateOptionsAllAreFunctions = validateOptionsAllAreFunctions;
module.exports.validateStrictMode = validateStrictMode;
module.exports.getJSONSchemaMocker = getJSONSchemaMocker;
