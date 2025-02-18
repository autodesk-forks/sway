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
const JsonRefs = require('json-refs');
const { pathToRegexp } = require('path-to-regexp');
const supportedHttpMethods = require('swagger-methods');
const debug = require('debug')('sway:path');
const Operation = require('./operation');
const Parameter = require('./parameter');

/**
 * The Path object.
 *
 * **Note:** Do not use directly.
 *
 * **Extra Properties:** Other than the documented properties, this object also exposes all properties of the
 * [OpenAPI Path Object](https://github.com/OAI/OpenAPI-Specification/blob/master/versions/3.0.0.md#pathItemObject).
 *
 * @param {module:sway.ApiDefinition} apiDefinition - The `ApiDefinition` object
 * @param {string} path - The path string
 * @param {object} definition - The path definition *(The raw path definition __after__ remote references were
 * resolved)*
 * @param {object} definitionFullyResolved - The path definition with all of its resolvable references resolved
 * @param {string[]} pathToDefinition - The path segments to the path definition
 *
 * @property {module:sway.ApiDefinition} apiDefinition - The `ApiDefinition` object
 * @property {object} definition - The path definition *(The raw path definition __after__ remote references were
 * resolved)*
 * @property {object} definitionFullyResolved - The path definition with all of its resolvable references resolved
 * @property {module:sway.Operation[]} operationObjects - The `Operation` objects
 * @property {module:sway.Parameter[]} parameterObjects - The path-level `Parameter` objects
 * @property {string} path - The path string
 * @property {string[]} pathToDefinition - The path segments to the path definition
 * @property {ptr} ptr - The JSON Pointer to the path
 * @property {regexp} regexp - The `RegExp` used to match request paths against this path
 *
 * @constructor
 *
 * @memberof module:sway
 */
class Path {
  constructor(apiDefinition, path, definition, definitionFullyResolved, pathToDefinition) {
    let basePathPrefix = apiDefinition.definitionFullyResolved.basePath || '/';
    const that = this;

    // TODO: We could/should refactor this to use the path module

    // Remove trailing slash from the basePathPrefix so we do not end up with double slashes
    if (basePathPrefix.charAt(basePathPrefix.length - 1) === '/') {
      basePathPrefix = basePathPrefix.substring(0, basePathPrefix.length - 1);
    }

    // Converts OpenAPI parameters to Express-style parameters, and also escapes all path-to-regexp special characters
    //
    // @see: https://github.com/pillarjs/path-to-regexp/issues/76#issuecomment-219085357
    const sanitizedPath = basePathPrefix + path.replace('(', '\\(') // path-to-regexp
      .replace(')', '\\)') // path-to-regexp
      .replace(':', '\\:') // path-to-regexp
      .replace('*', '\\*') // path-to-regexp
      .replace('+', '\\+') // path-to-regexp
      .replace('?', '\\?') // path-to-regexp
      .replace(/\{/g, ':') // OpenAPI -> Express-style
      .replace(/\}/g, ''); // OpenAPI -> Express-style

    // Assign local properties
    this.apiDefinition = apiDefinition;
    this.definition = definition;
    this.definitionFullyResolved = definitionFullyResolved;
    this.path = path;
    this.pathToDefinition = pathToDefinition;
    this.ptr = JsonRefs.pathToPtr(pathToDefinition);
    const regExpKeys = [];
    try {
      this.regexp = pathToRegexp(sanitizedPath, regExpKeys, { sensitive: true });
      this.regexp.keys = regExpKeys;
    } catch (e) {
      debug('regexp throwed an error', e);
    }

    // Assign local properties from the OpenAPI Path Object definition
    _.assign(this, definitionFullyResolved);

    this._debug = this.apiDefinition._debug;

    this._debug('    %s', this.path);

    this.parameterObjects = _.map(definitionFullyResolved.parameters, (paramDef, index) => {
      const pPath = pathToDefinition.concat(['parameters', index.toString()]);

      return new Parameter(
        that,
        _.get(apiDefinition.definitionRemotesResolved, pPath),
        paramDef,
        pPath,
      );
    });

    this._debug('      Operations:');

    this.operationObjects = _.reduce(definitionFullyResolved, (operations, operationDef, method) => {
      const oPath = pathToDefinition.concat(method);

      if (supportedHttpMethods.indexOf(method) > -1) {
        operations.push(new Operation(that, method, _.get(apiDefinition.definitionRemotesResolved, oPath), operationDef, oPath));
      }

      return operations;
    }, []);
  }

  /**
   * Return the operation for this path and operation id or method.
   *
   * @param {string} idOrMethod - The operation id or method
   *
   * @returns {module:sway.Operation[]} The `Operation` objects for this path and method or `undefined` if there is no
   * operation for the provided method
   */
  getOperation(idOrMethod) {
    return _.find(this.operationObjects, (operationObject) => operationObject.operationId === idOrMethod || operationObject.method === idOrMethod.toLowerCase());
  }

  /**
   * Return the operations for this path.
   *
   * @returns {module:sway.Operation[]} The `Operation` objects for this path
   */
  getOperations() {
    return this.operationObjects;
  }

  /**
   * Return the operations for this path and tag.
   *
   * @param {string} tag - The tag
   *
   * @returns {module:sway.Operation[]} The `Operation` objects for this path and tag
   */
  getOperationsByTag(tag) {
    return _.filter(this.operationObjects, (operationObject) => _.includes(operationObject.tags, tag));
  }

  /**
   * Return the parameters for this path.
   *
   * @returns {module:sway.Parameter[]} The `Parameter` objects for this path
   */
  getParameters() {
    return this.parameterObjects;
  }
}

module.exports = Path;
