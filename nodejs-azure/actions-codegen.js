/* Files to be generated: handler and types (optional)

- Take input from request JSON body
- Extract Hasura payload into an object.
  {
    session_variables: {
      'x-hasura-user-id': <>,
      'x-hasura-role': <>,
      'x-hasura-xxxx': <>
    },
    input: {
      arg1: <>,
      arg2: <>
    }
  }
  - If this is a typed language:
  - codegen the types in the second file &
  - parse into the right type if this is a typed language
- If this is derived from a hasura operation
  - Take the inputs and use them to create variables
  - Pass these variables and fire the underlying Hasura operation
  - If Hasura operation returns error, return error
  - Else return the exact response that the Hasura operation returns
- If this is not derived:
  - Have a small error block showing what an error response would look like
  - Return a success with a JSON object, the keys set to the return type
    of the action
 */

// Generate the basic handler
// For azure
const generateHandler = (extractArgsFromBody, outputTypeSpread) => {
  const handlerBeginningCode = `
module.exports = async function (context, req) {
  ${extractArgsFromBody}

  // Write business logic that deals with inputs here...

`;

  const errorSuccessHandlerResponseCode = `
  // If error:
  // context.res = {
  //   status: 400,
  //   body: { code: "internal-error", message: "Internal error." }
  // };
  // return;

  context.res = {
    headers: { 'Content-Type': 'application/json' },
    body: ${outputTypeSpread}
  };
};`
  return {handlerBeginningCode, errorSuccessHandlerResponseCode};
};

// Generate all the custom types
// - Input types for all actions (including the current one this is invoked for)
// - Output types for all actions (including the current one this is invoked for)


// Template code for generating a fetch API call
// Only used for derive
const generateFetch = (actionName, rawQuery, variables, queryRootFieldName) => {
  const queryName = 'HASURA_' + actionName.toUpperCase();
  let actionNameUpper = actionName[0].toUpperCase() + actionName.slice(1);

  const fetchExecuteCode = `
const fetch = require ('node-fetch');

const ${queryName} = \`
${rawQuery}
\`;

const execute${actionNameUpper} = async (variables, headers) => {
  const result = await fetch (url, {
    method: 'POST',
    body: JSON.stringify({
      query: ${queryName},
      variables
    }),
    headers: headers || {}
  });

  const data = await result.json();
  return data;
};
`

  const runExecuteInHandlerCode = `
  // Execute the Hasura query
  const {data, errors} = execute${actionNameUpper}(${variables}, req.headers);

  // If there's an error in the running the Hasura query
  if (errors) {
    context.res = {
      headers: { 'Content-Type': 'application/json' },
      status: 400,
      body: {
        message: errors.message
      }
    };
    return;
  }

  // If success
  context.res = {
    headers: { 'Content-Type': 'application/json' },
    body: {
      ...data.${queryRootFieldName}
    }
  };
};`;

  return {fetchExecuteCode, runExecuteInHandlerCode};
};

// Let us now begin the codegen!
const { parse } = require('graphql');

// actionName: Name of the action
// actionsSdl: GraphQL SDL string that has the action and dependent types
// derive: Whether this action was asked to be derived from a Hasura operation
//         derive.operation contains the operation string
const templater = (actionName, actionsSdl, derive) => {

  console.log('Running the codegen for: ' + actionName);

  // Parse the actions SDL into an AST
  let ast;
  ast = parse(actionsSdl);

  // Find the Mutation type for this action
  const actionMutationTypeDef = ast.definitions
    .find(def => (def.name.value === 'Mutation'))
    .fields
    .find(def => (def.name.value === actionName));

  // If the input arguments are {name, age, email}
  // then we want to generate: const {name, age, email} = req.body
  const inputArgumentsNames = actionMutationTypeDef.arguments.map(i => i.name.value);
  console.log('Input arguments: ' + inputArgumentsNames);

  const extractArgsFromBody = `const {${inputArgumentsNames.join(', ')}} = req.body.input;`;

  // If the output type is type ActionResult {field1: <>, field2: <>}
  // we want to template the response of the handler to be:
  // {
  //    field1: "",
  //    field2: ""
  // }
  const actionOutputType = ast.definitions
    .find(def => (def.name.value === actionMutationTypeDef.type.name.value))
  console.log('Output type: ' + actionOutputType.name.value);
  const outputTypeFieldNames = actionOutputType.fields.map(f => f.name.value);
  console.log('Output type fields: ' + outputTypeFieldNames);

  let outputTypeSpread = '{\n      ';
  outputTypeFieldNames.forEach((n, i) => {
    outputTypeSpread += n + ': ""';
    if (i === outputTypeFieldNames.length - 1) {
      outputTypeSpread += '\n    }'
    } else {
      outputTypeSpread += ',\n      ';
    }
  });

  console.log('Generating base hanlder...');
  const basicHandlerCode = generateHandler(extractArgsFromBody, outputTypeSpread);

  console.log(basicHandlerCode);
  // If this action is being derived for an existing operation
  // then we'll add a fetch API call
  let deriveCode;
  let isDerivation = derive && derive.operation;
  if (isDerivation) {
    const operationAST = parse(derive.operation);
    const queryRootField = operationAST.definitions[0].selectionSet
      .selections
      .find(f => (!f.name.value.startsWith('__')))
    const queryRootFieldName = queryRootField.alias ?
      queryRootField.alias.value :
      queryRootField.name.value;
    const variableNames = operationAST.definitions[0]
      .variableDefinitions
      .map(vdef => vdef.variable.name.value);

    console.log('Derive:: \n' + derive.operation);
    console.log('Derive:: root field name: ' + queryRootFieldName);
    console.log('Derive:: variable names: ' + variableNames);

    deriveCode = generateFetch(
      actionName,
      derive.operation,
      `{ ${variableNames.join(', ')} }`,
      queryRootFieldName
    );
  }

  // Render the handler!
  console.log('Rendering handler');
  let finalHandlerCode = ''
  if (!isDerivation) {
    finalHandlerCode +=
      basicHandlerCode.handlerBeginningCode +
      basicHandlerCode.errorSuccessHandlerResponseCode;
  } else {
    finalHandlerCode +=
      deriveCode.fetchExecuteCode +
      basicHandlerCode.handlerBeginningCode +
      deriveCode.runExecuteInHandlerCode;
  }

  console.log(finalHandlerCode);

  return [
    {
      name: actionName + '.js',
      content: finalHandlerCode
    }
  ];
};
