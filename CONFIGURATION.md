# Input parameters assignment

All input parameters for s3blaster can be assigned via the following ways with a
decreasing priority level, i.e. parameter will get value given by the highest
priority one:

- command line
- a JSON file defined by `--config` command, [`config.json`](./config.json) by
default. A light version of JSON config file containing main input parameters is
found here: [`configLight.json`](./configLight.json)
- initialized in `lib/config.js` file

Each parameter is defined by a same key in the all three cases.

For credential keys `accessKeyId` and `secretAccessKey`, they can be
assigned by the following ways with a decreasing priority level:

- command line:

```
--accessKeyId = your_access_key_id
--secretAccessKey = your_secret_access_key
```

- config JSON file, in `acc` sub-object:

```
"accessKeyId": "your_access_key_id"
"secretAccessKey": "your_secret_access_key"
```

- environment variable:

```
ACCESSKEYID=your_access_key_id
SECRETACCESSKEY=your_secret_access_key
```

- credential file, by default `~/.s3cfg`

```
access_key = your_access_key_id
secret_key = your_secret_access_key
```

List of all input parameters are shown in the following table:

Key | Parameter | Value | Default
--- | --- | --- | ---
`host` | Host's address | String | `'localhost'`
`port` | Host's port | Number | 8000
`forksNb` | Number of S3Blaster's workers | Number | 0
`servers` | List of servers where processes runs on | Array of strings | `[]`
`signature` | Signature version for authentication process | `v2`/`v4` | `v4`
`region` | AWS Regions | String | `'eu-west-1'`
|
`bucketsNb` | Number of buckets | Number | 1
`bucketPrefix` | Bucket prefix | String | `bucketname`
`objectsNb` | Number of objects of a given size | Number | 100
`fillObjs` | Flag for initializing bucket with objects | Boolean | `false`
`fillRange` | Key range of initialized objects | `start:end` | `'0:1'`
`fillThreads` | Number of parallel requests for initialization process | Number | 64
`sizes` | Object sizes | `num1, num2, ..` or `start:step:end` | `'1, 10'`
`unit` | Size unit | `B`, `KB`, `MB` or `GB` | `'KB'`
`partSizes` | Part size for multipart upload |  `num1, num2, ..` or `start:step:end` | 5
`objMetadata` | Metadata of uploading objects | `compact`, `standard`, `full` | `'compact'`
`mdPath` | Path to metadata storage | String | `''`
|
`requests` | List of measured requests | Subset of `[put, get, delete, list, get-acl, multi-upload, combine]` | `'put,get,delete'`
`proprReqs` | Proportion of requests | Array of numbers | `[1, 1, 1]`
`range` | Key range of objects for each requests | Array of `all` or `start:end` | `['all', 'all', 'all']`
`schedule` | Schedule for sending requests | `each`, `mixed` | `'each'`
`simulDelay` | Delay time between two tests (in second) | Number | 0
`nextKey` | The way for choosing key of objects for next request | `rand`, `seq`|`'rand'`
`paralReqs` | Number of parallel requests | `num1, num2,..` or  `start:step:end`|`'1'`
`sendReqRates` | Rates for sending requests | Array of numbers or `max` | `['max', 'max', 'max']`
`observationsNb` | Number of requests per measured point | Number | 1000
`workOnCurrObjs` | Operation on objects uploaded currently on buckets | Boolean | `true`
`dontCleanDB` | Flag for cleaning database | Boolean | `false`
`freqShow` | Frequency for displaying stats results | Number | 1000
`samplingStep` | Sampling step for estimating pdf and cdf (in ms) | Number | 1
`percentiles` | Percentile points | Array of numbers |`[60, 80, 90, 95, 99, 100]`
`runTime` | Maximal running time per test (in second) | Number | 600
`ssm` | Flag for monitoring resources' consuming | Boolean | `false`
`liveGlobal` | Flag for showing stats and live results | Boolean | `false`
`rate` | Frequency for monitoring (in ms) | Number | `false`
`ssmTypes` | Patterns for monitoring | Either `all` or subset of `[s3, sproxyd, mdBktSize, mdLogSize]` | `'all'`
`monitors` | Dynamic extra processes for monitoring | Array of string, e.g. `['s3:pattern1', 'sproxyd:pattern2']`| []
`displaySSM` | Flag for displaying monitoring results | Boolean | `false`
`showInputParams` | Flag for showing input parameters | Boolean | `false`
|
`statsFolder` | Folder containing results | Path | `'hello/scality'`
`outputType` | Type of output graphs | `pdf`, `png` | `'pdf'`
`output` | Pattern name of output files | String | `'test'`
`message` | Personalized message shown on output files | String | `'message'`

There are 4 cases for assigning host's address either

- A specified address of single S3 server
- First element of `servers` when it is assigned as `'single'`
- Address of a proxy whose backends should be S3 servers' address. In this case,
the host's port must be the proxy's port
- If it's assigned as `'balancing'`, host's address of S3Blaster workers
are assigned cyclically by elements of `servers`.
