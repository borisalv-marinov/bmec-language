# BMEC standard-library reference

Generated from `bmec ai-spec --json` standard-library contracts. Do not edit the function list by hand.

Package version: **0.9.1-beta.2**<br>
Language version: **0.1**

| Function | Arguments | Returns | Required capabilities |
|---|---|---|---|
| `absInt` | `integer` | `integer` | none |
| `absNumber` | `number` | `number` | none |
| `addDays` | `date`, `integer` | `result<date,text>` | none |
| `addSeconds` | `datetime`, `integer` | `result<datetime,text>` | none |
| `all` | `list<T>`, `function(T)->boolean` | `boolean` | none |
| `any` | `list<T>`, `function(T)->boolean` | `boolean` | none |
| `appendTextFile` | `capability<filesystem>`, `text`, `text` | `result<boolean,text>` | `filesystem` |
| `base64Decode` | `text` | `result<text,text>` | none |
| `base64Encode` | `text` | `text` | none |
| `cancel` | `capability<time>`, `task<T>` | `result<boolean,text>` | `time` |
| `ceil` | `number` | `number` | none |
| `clamp` | `number`, `number`, `number` | `number` | none |
| `contains` | `list<T>`, `T` | `boolean` | none |
| `copyTextFile` | `capability<filesystem>`, `text`, `text` | `result<boolean,text>` | `filesystem` |
| `createDirectory` | `capability<filesystem>`, `text` | `result<boolean,text>` | `filesystem` |
| `currentTime` | `capability<time>` | `integer` | `time` |
| `dateDay` | `date|datetime` | `integer` | none |
| `dateDifference` | `date`, `date` | `integer` | none |
| `dateMonth` | `date|datetime` | `integer` | none |
| `dateYear` | `date|datetime` | `integer` | none |
| `datetimeDifference` | `datetime`, `datetime` | `integer` | none |
| `decodeJson` | `text` | `result<T,text>` | none |
| `delay` | `capability<time>`, `integer` | `task<result<boolean,text>>` | `time` |
| `distinct` | `list<T>` | `list<T>` | none |
| `encodeJson` | `T` | `text` | none |
| `endsWith` | `text`, `text` | `boolean` | none |
| `environmentArguments` | `capability<environment>` | `list<text>` | `environment` |
| `environmentBoolean` | `capability<environment>`, `text` | `result<boolean,text>` | `environment` |
| `environmentInteger` | `capability<environment>`, `text` | `result<integer,text>` | `environment` |
| `environmentSecret` | `capability<environment>`, `text` | `secret<text>?` | `environment` |
| `environmentText` | `capability<environment>`, `text` | `text?` | `environment` |
| `err` | `E` | `result<T,E>` | none |
| `fileExists` | `capability<filesystem>`, `text` | `result<boolean,text>` | `filesystem` |
| `filter` | `list<T>`, `function(T)->boolean` | `list<T>` | none |
| `find` | `list<T>`, `function(T)->boolean` | `T?` | none |
| `first` | `list<T>` | `T?` | none |
| `floor` | `number` | `number` | none |
| `fold` | `list<T>`, `U`, `function(U,T)->U` | `U` | none |
| `formatDate` | `date|datetime` | `text` | none |
| `httpRequest` | `capability<http>`, `text`, `text`, `text?`, `list<text>`, `list<text>`, `integer` | `task<result<text,text>>` | `http` |
| `httpRequestJson` | `capability<http>`, `text`, `text`, `T?`, `list<text>`, `list<text>`, `integer` | `task<result<T,text>>` | `http` |
| `httpRequestMultipart` | `capability<http>`, `text`, `text`, `list<text>`, `list<text>`, `list<upload>`, `integer` | `task<result<text,text>>` | `http` |
| `isErr` | `result<T,E>` | `boolean` | none |
| `isNone` | `T?` | `boolean` | none |
| `isOk` | `result<T,E>` | `boolean` | none |
| `isSome` | `T?` | `boolean` | none |
| `join` | `list<text>`, `text` | `text` | none |
| `last` | `list<T>` | `T?` | none |
| `length` | `list<T>` | `integer` | none |
| `listDirectory` | `capability<filesystem>`, `text` | `result<list<text>,text>` | `filesystem` |
| `lower` | `text` | `text` | none |
| `map` | `list<T>`, `function(T)->U` | `list<U>` | none |
| `maxInt` | `integer`, `integer` | `integer` | none |
| `minInt` | `integer`, `integer` | `integer` | none |
| `moveTextFile` | `capability<filesystem>`, `text`, `text` | `result<boolean,text>` | `filesystem` |
| `ok` | `T` | `result<T,E>` | none |
| `parseBoolean` | `text` | `result<boolean,text>` | none |
| `parseDate` | `text` | `result<date,text>` | none |
| `parseDateTime` | `text` | `result<datetime,text>` | none |
| `parseId` | `text` | `result<id,text>` | none |
| `parseInteger` | `text` | `result<integer,text>` | none |
| `parseNumber` | `text` | `result<number,text>` | none |
| `pathBasename` | `text` | `text` | none |
| `pathDirname` | `text` | `text` | none |
| `pathJoin` | `text`, `text` | `text` | none |
| `pathRelative` | `text`, `text` | `text` | none |
| `power` | `number`, `number` | `number` | none |
| `randomId` | `capability<random>` | `id` | `random` |
| `randomInteger` | `capability<random>`, `integer`, `integer` | `integer` | `random` |
| `randomNumber` | `capability<random>` | `number` | `random` |
| `range` | `integer`, `integer` | `list<integer>` | none |
| `readStdin` | `capability<environment>` | `task<result<text,text>>` | `environment` |
| `readTextFile` | `capability<filesystem>`, `text` | `result<text,text>` | `filesystem` |
| `removeTextFile` | `capability<filesystem>`, `text` | `result<boolean,text>` | `filesystem` |
| `revealSecret` | `secret<text>`, `capability<environment>` | `text` | `environment` |
| `reverse` | `list<T>` | `list<T>` | none |
| `round` | `number` | `number` | none |
| `saveUpload` | `capability<filesystem>`, `upload`, `text` | `result<boolean,text>` | `filesystem` |
| `scheduleOnce` | `capability<time>`, `integer`, `()->task<result<boolean,text>>` | `task<result<boolean,text>>` | `time` |
| `secureRandomId` | `capability<secureRandom>` | `id` | `secureRandom` |
| `secureRandomInteger` | `capability<secureRandom>`, `integer`, `integer` | `integer` | `secureRandom` |
| `sendEmail` | `capability<email>`, `text`, `text`, `text` | `task<result<boolean,text>>` | `email` |
| `setExitCode` | `capability<environment>`, `integer` | `result<boolean,text>` | `environment` |
| `slice` | `list<T>`, `integer`, `integer` | `list<T>` | none |
| `some` | `T` | `T?` | none |
| `sort` | `list<T>` | `list<T>` | none |
| `split` | `text`, `text` | `list<text>` | none |
| `sqrt` | `number` | `number` | none |
| `startsWith` | `text`, `text` | `boolean` | none |
| `substring` | `text`, `integer`, `integer` | `text` | none |
| `textContains` | `text`, `text` | `boolean` | none |
| `textIndexOf` | `text`, `text` | `integer?` | none |
| `textLength` | `text` | `integer` | none |
| `textReplace` | `text`, `text`, `text` | `text` | none |
| `timeout` | `capability<time>`, `task<T>`, `integer` | `task<result<T,text>>` | `time` |
| `today` | `capability<time>` | `date` | `time` |
| `trim` | `text` | `text` | none |
| `uploadFilename` | `upload` | `text` | none |
| `uploadMediaType` | `upload` | `text` | none |
| `uploadSize` | `upload` | `integer` | none |
| `upper` | `text` | `text` | none |
| `writeStderr` | `capability<environment>`, `text` | `result<boolean,text>` | `environment` |
| `writeStdout` | `capability<environment>`, `text` | `result<boolean,text>` | `environment` |
| `writeTextFile` | `capability<filesystem>`, `text`, `text` | `result<boolean,text>` | `filesystem` |

For usage constraints and examples, inspect the compiler contract with `bmec stdlib --json` or `bmec ai-spec --json`.
